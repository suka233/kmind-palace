import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Kit } from './kit';
import type { Catalog } from './catalog';
import type { PalaceDoc, Rect, Vec2 } from './schema';
import { Wall } from './walls';
import { mergeStatic, disposeTree } from './merge';
import { planRoads, type RoadNet } from './roads';
import { seedFromString } from './random';
import { BEND, unbendRay } from './bend';
import { t } from './i18n';
import { buildRoof } from './roof';
import { THEMES, getTheme, type ThemePack } from './themes';
import { commonMats, GRASS_Y, WATER_Y, type Landmark, type Mats, type ThemeCtx } from './themes/common';
import {
  PLAZA_R, bboxOf, frontDoor, indoorRects, palaceColor, palaceLot, palaceStats, placedLot, rectCenter, regionExtent, regionOrigin, rotateVec, toRegion,
  type PalaceWorld, type PlacedPalace, type WorldRegion,
} from './world';

/* =====================================================================
 * 世界图层（群岛）
 *   WorldLayer   整个世界：一片海 + 若干座岛；宫殿外壳的总索引；点光源池
 *   RegionLayer  一座岛：地形 / 道路 / 地标（由场景主题生成）+ 岛上宫殿的外壳
 * 坐标：WorldLayer.group 内是世界坐标；每座岛的 group 平移到它的原点（浮空岛再抬高），
 * 岛内一切（地块、道路、外壳）都用区域局部坐标。
 * 视图进入某座宫殿时，会把 WorldLayer.group 整体变换到那座宫殿的局部坐标系。
 * ===================================================================== */

const DEG = Math.PI / 180;
/** 夜里同时点亮的小镇点光源数量（固定数量，避免切换时重新编译着色器） */
const LIGHT_POOL = 10;

export interface Shell {
  id: string;
  regionId: string;
  placed: PlacedPalace;
  doc: PalaceDoc;
  group: THREE.Group;
  body: THREE.Group;
  roof: THREE.Group;
  roofMats: THREE.MeshStandardMaterial[];
  owned: THREE.Material[];
  /** 屋顶最高点（局部 y） */
  top: number;
  /** 屋顶掀起程度 0..1 */
  lift: number;
  liftTarget: number;
  /** 掀起时屋顶滑开的方向（宫殿局部坐标） */
  liftDir: THREE.Vector2;
  tag: CSS2DObject;
  /** 地块（区域坐标） */
  lot: Rect;
}

// =====================================================================
// 一座岛
// =====================================================================

export class RegionLayer {
  readonly group = new THREE.Group();
  readonly land = new THREE.Group();
  readonly shellRoot = new THREE.Group();
  theme: ThemePack;
  /** 宫殿地块 + 广场的外包矩形（区域坐标，取景用） */
  extent: Rect = [-10, -10, 10, 10];
  center: Vec2 = [0, 0];
  maxR = 24;
  roads: RoadNet | null = null;
  landmarks: Landmark[] = [];
  readonly tag: CSS2DObject;
  private radial: ((a: number) => number) | null = null;

  constructor(public region: WorldRegion, private W: WorldLayer) {
    this.theme = getTheme(region.theme);
    this.group.name = 'region:' + region.id;
    this.group.userData.regionId = region.id;
    this.land.name = 'land';
    this.shellRoot.name = 'shells';
    this.group.add(this.land, this.shellRoot);
    const el = document.createElement('div');
    el.className = 'kp-region-tag';
    el.dataset.act = 'regionTag';
    el.dataset.id = region.id;
    this.tag = new CSS2DObject(el);
    this.tag.center.set(.5, 1);
    this.tag.visible = false;
    this.group.add(this.tag);
    this.place();
  }

  get lift() { return this.theme.lift || 0; }
  /** 岛（含浅滩）的外接圆半径 */
  get outerR() { return this.maxR + 9; }

  place() {
    const [ox, oz] = regionOrigin(this.region);
    this.group.position.set(ox, this.lift, oz);
    this.group.updateMatrixWorld(true);
  }

  /** 岛中心（世界坐标，草地高度） */
  worldCenter(out = new THREE.Vector3()) {
    const [ox, oz] = regionOrigin(this.region);
    return out.set(ox + this.center[0], this.lift + GRASS_Y, oz + this.center[1]);
  }

  /** 世界坐标 → 区域局部坐标 */
  toLocal(x: number, z: number): Vec2 {
    const [ox, oz] = regionOrigin(this.region);
    return [x - ox, z - oz];
  }

  onLand(x: number, z: number, pad = 0) {
    if (!this.radial) return false;
    const [cx, cz] = this.center;
    return Math.hypot(x - cx, z - cz) < this.radial(Math.atan2(z - cz, x - cx)) - pad;
  }

  /** 重建地形、道路、地标和装饰（宫殿增删 / 移动 / 换主题后） */
  rebuildLand(docs: Map<string, PalaceDoc>) {
    const region = this.region, K = this.W.K;
    this.theme = getTheme(region.theme);
    this.place();
    this.clearLand();
    seedFromString('town:' + region.seed);
    const lots: Rect[] = [];
    for (const p of region.palaces) {
      const d = docs.get(p.palaceId);
      if (d) lots.push(placedLot(p, d));
    }
    const ext = this.extent = regionExtent(region, docs);
    this.center = rectCenter(ext);
    const R = this.radial = islandRadial(ext, lots, region.seed, this.center, this.theme.margin ?? 8, this.theme.minR ?? 22);
    let maxR = 0;
    for (let i = 0; i < 64; i++) maxR = Math.max(maxR, R(i / 64 * Math.PI * 2));
    this.maxR = maxR;

    const raw = new THREE.Group();
    const ctx: ThemeCtx = {
      K, catalog: this.W.catalog, region, mats: this.W.mats(this.theme.id),
      land: this.land, raw, seaY: WATER_Y - this.lift, R, center: this.center, maxR, lots, roads: null,
      blockers: [{ x: 0, z: 0, r: PLAZA_R + 2.5 }], landmarks: [{ kind: 'plaza', x: 0, z: 0, angle: 0 }],
    };
    this.theme.terrain(ctx);

    // 道路：从每座宫殿的门口通往广场
    const [cx, cz] = this.center;
    const sources = region.palaces.flatMap(p => {
      const d = docs.get(p.palaceId);
      if (!d) return [];
      const door = frontDoor(d);
      let rd = null;
      if (door) {
        const [x, z] = toRegion(p, door.x, door.z), [nx, nz] = rotateVec(p.rot, door.nx, door.nz);
        rd = { x, z, nx: Math.round(nx), nz: Math.round(nz), w: door.w };
      }
      return [{ id: p.palaceId, door: rd, lot: placedLot(p, d) }];
    });
    ctx.roads = this.roads = planRoads({
      bounds: [cx - maxR, cz - maxR, cx + maxR, cz + maxR],
      land: (x, z) => this.onLand(x, z, 2.5),
      lots, plaza: { x: 0, z: 0, r: PLAZA_R }, sources,
    });
    this.buildRoads(ctx);
    this.theme.plaza(ctx);
    this.theme.decorate(ctx);
    raw.updateMatrixWorld(true);
    const merged = mergeStatic(raw);
    disposeTree(raw);
    merged.name = 'decor';
    this.land.add(merged);
    this.landmarks = ctx.landmarks;
    this.tag.position.set(cx, 9, cz);
  }

  private buildRoads(ctx: ThemeCtx) {
    const net = ctx.roads;
    const pave: THREE.BufferGeometry[] = [], curb: THREE.BufferGeometry[] = [];
    // 长路段切成不超过 3 m 的小段：星球模式下路面才能贴着球面弯
    const seg = (a: Vec2, b: Vec2, w: number) => {
      const h = w / 2;
      const x0 = Math.min(a[0], b[0]) - h, x1 = Math.max(a[0], b[0]) + h, z0 = Math.min(a[1], b[1]) - h, z1 = Math.max(a[1], b[1]) + h;
      const alongX = x1 - x0 >= z1 - z0, len = alongX ? x1 - x0 : z1 - z0, n = Math.max(1, Math.ceil(len / 3));
      for (let i = 0; i < n; i++) {
        const s0 = (alongX ? x0 : z0) + len * i / n, s1 = (alongX ? x0 : z0) + len * (i + 1) / n;
        const [bx0, bx1, bz0, bz1] = alongX ? [s0, s1, z0, z1] : [x0, x1, s0, s1];
        const p = new THREE.BoxGeometry(bx1 - bx0, .05, bz1 - bz0); p.translate((bx0 + bx1) / 2, GRASS_Y + .03, (bz0 + bz1) / 2); pave.push(p);
        const c = new THREE.BoxGeometry(bx1 - bx0 + (alongX ? 0 : .3), .04, bz1 - bz0 + (alongX ? .3 : 0)); c.translate((bx0 + bx1) / 2, GRASS_Y + .01, (bz0 + bz1) / 2); curb.push(c);
      }
      // 两端的路缘补齐
      for (const [ex, ez] of alongX ? [[x0 - .075, (z0 + z1) / 2], [x1 + .075, (z0 + z1) / 2]] : [[(x0 + x1) / 2, z0 - .075], [(x0 + x1) / 2, z1 + .075]]) {
        const c = new THREE.BoxGeometry(alongX ? .15 : x1 - x0 + .3, .04, alongX ? z1 - z0 + .3 : .15); c.translate(ex, GRASS_Y + .01, ez); curb.push(c);
      }
    };
    for (const r of net.runs) for (let i = 0; i + 1 < r.pts.length; i++) seg(r.pts[i], r.pts[i + 1], r.width);
    for (const w of net.walkways) seg(w.a, w.b, w.width);
    for (const [geos, mat] of [[pave, ctx.mats.paver], [curb, ctx.mats.curb]] as [THREE.BufferGeometry[], THREE.Material][]) {
      if (!geos.length) continue;
      const m = new THREE.Mesh(mergeBoxes(geos), mat);
      m.receiveShadow = true;
      this.land.add(m);
    }
  }

  private clearLand() {
    const lamps = this.W.K.LAMPS;
    this.land.traverse((o: any) => {
      if (o.isPointLight) {
        const i = lamps.findIndex(l => l.l === o);
        if (i >= 0) lamps.splice(i, 1);
      }
    });
    disposeTree(this.land);
    this.land.clear();
  }

  /** 群岛视角的岛名牌 */
  updateTag(docs: Map<string, PalaceDoc>) {
    const el = this.tag.element, r = this.region;
    const palaces = r.palaces.map(p => docs.get(p.palaceId)).filter(Boolean);
    const loci = palaces.reduce((s, d) => s + palaceStats(d).loci, 0);
    el.innerHTML = `<em></em><span><b></b><small>${t('{n} 座宫殿', { n: palaces.length })} · 📌 ${loci}</small></span>`;
    el.querySelector('em').textContent = this.theme.icon;
    el.querySelector('b').textContent = r.name;
  }

  dispose() {
    this.clearLand();
    this.tag.element.remove();
    this.group.removeFromParent();
  }
}

// =====================================================================
// 整个世界
// =====================================================================

export class WorldLayer {
  readonly group = new THREE.Group();
  readonly regions = new Map<string, RegionLayer>();
  readonly shells = new Map<string, Shell>();
  /** 所有岛的外包盒（世界坐标） */
  bounds = new THREE.Box3();
  far = false;
  private ocean: THREE.Mesh;
  private oceanMat: THREE.MeshStandardMaterial;
  private common: Mats;
  private themeMats = new Map<string, Mats>();
  private shellGlass: THREE.MeshStandardMaterial;
  private lightTick = 0;
  /** 岛与岛之间的航线（虚线 + 小帆船） */
  private lanes = new THREE.Group();

  /** 宫殿里待复习的记忆桩数（名牌上的小红点），由视图提供 */
  dueOf?: (doc: PalaceDoc) => number;
  /** 旅程面板打开时：这座宫殿是第几段 */
  journeyOf?: (palaceId: string) => number[];

  constructor(readonly K: Kit, readonly catalog: Catalog) {
    this.group.name = 'world';
    this.common = commonMats(K);
    this.oceanMat = new THREE.MeshStandardMaterial({ color: '#7cc4c0', roughness: .22, metalness: .05 });
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 220, 220), this.oceanMat);
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = WATER_Y;
    this.ocean.receiveShadow = true;
    this.ocean.name = 'ocean';
    this.lanes.name = 'lanes';
    this.group.add(this.ocean, this.lanes);
    // 外壳的窗户：白天像反光的玻璃（看不到空荡荡的内部），夜里透出暖光
    this.shellGlass = K.glow('#a9c3cb', '#ffc47a', 1.25, 0);
    this.shellGlass.roughness = .16;
    this.shellGlass.metalness = .35;
  }

  /** 某个主题的材质（共用材质 + 主题材质），按需创建、全局复用 */
  mats(themeId: string): Mats {
    let m = this.themeMats.get(themeId);
    if (!m) {
      m = { ...this.common, ...getTheme(themeId).materials(this.K) };
      this.themeMats.set(themeId, m);
    }
    return m;
  }

  // =====================================================================
  // 构建
  // =====================================================================

  /** 整体重建：所有岛 + 外壳 */
  build(world: PalaceWorld, docs: Map<string, PalaceDoc>) {
    for (const id of [...this.shells.keys()]) this.removeShell(id);
    for (const id of [...this.regions.keys()]) this.removeRegion(id);
    for (const r of world.regions) this.addRegion(r, docs);
    this.updateBounds();
  }

  addRegion(region: WorldRegion, docs: Map<string, PalaceDoc>) {
    this.removeRegion(region.id);
    const layer = new RegionLayer(region, this);
    this.regions.set(region.id, layer);
    this.group.add(layer.group);
    for (const p of region.palaces) {
      const doc = docs.get(p.palaceId);
      if (doc) this.addShell(region, p, doc);
    }
    layer.rebuildLand(docs);
    layer.updateTag(docs);
    layer.tag.visible = this.far;
    return layer;
  }

  removeRegion(id: string) {
    const layer = this.regions.get(id);
    if (!layer) return;
    for (const [sid, s] of [...this.shells]) if (s.regionId === id) this.removeShell(sid);
    layer.dispose();
    this.regions.delete(id);
  }

  /** 一座岛的宫殿摆放 / 主题变了：重建它的地形 */
  rebuildLand(regionId: string, docs: Map<string, PalaceDoc>) {
    const layer = this.regions.get(regionId);
    if (!layer) return;
    layer.rebuildLand(docs);
    layer.updateTag(docs);
    this.updateBounds();
  }

  /** 岛的实际半径（给摆放 / 推开邻岛用） */
  radii() {
    const out = new Map<string, number>();
    for (const [id, l] of this.regions) out.set(id, l.outerR);
    return out;
  }

  /** 岛的原点变了（群岛布置 / 推开邻岛）：只移动，不重建 */
  placeRegions() {
    for (const l of this.regions.values()) l.place();
    this.updateBounds();
  }

  updateBounds() {
    const b = this.bounds.makeEmpty(), v = new THREE.Vector3();
    for (const l of this.regions.values()) {
      l.worldCenter(v);
      b.expandByPoint(v.clone().add(new THREE.Vector3(-l.maxR, 0, -l.maxR)));
      b.expandByPoint(v.clone().add(new THREE.Vector3(l.maxR, 6, l.maxR)));
    }
    if (b.isEmpty()) b.set(new THREE.Vector3(-30, -1, -30), new THREE.Vector3(30, 6, 30));
    b.min.y = Math.min(b.min.y, WATER_Y);
    const c = b.getCenter(v), size = b.getSize(new THREE.Vector3());
    const span = Math.max(900, Math.max(size.x, size.z) * 5);
    this.ocean.scale.set(span, span, 1);
    this.ocean.position.set(c.x, WATER_Y, c.z);
    this.buildLanes();
  }

  /** 星球模式：海面变哑光（不然像一颗反光的玻璃弹珠） */
  setPlanetLook(p: number) {
    this.oceanMat.roughness = THREE.MathUtils.lerp(.22, .62, p);
  }

  /**
   * 航线：按最小生成树把相邻的岛连起来，海面上画一串白色虚线，中途一条小帆船。
   * 卷成星球时它们自然变成弧线。
   */
  private buildLanes() {
    disposeTree(this.lanes);
    this.lanes.clear();
    const layers = [...this.regions.values()];
    if (layers.length < 2) return;
    const pts = layers.map(l => { const w = l.worldCenter(); return { x: w.x, z: w.z, r: l.maxR + 2.5 }; });
    // Prim：从第一座岛开始，每次连上离已连通部分最近的岛
    const inTree = new Set([0]), edges: [number, number][] = [];
    while (inTree.size < pts.length) {
      let best: [number, number] | null = null, bestD = Infinity;
      for (const i of inTree) for (let j = 0; j < pts.length; j++) {
        if (inTree.has(j)) continue;
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) - pts[i].r - pts[j].r;
        if (d < bestD) { bestD = d; best = [i, j]; }
      }
      if (!best) break;
      edges.push(best);
      inTree.add(best[1]);
    }
    const K = this.K, m = this.common, raw = new THREE.Group();
    const dashMat = m.white;
    for (const [i, j] of edges) {
      const a = pts[i], b = pts[j];
      const len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      const s0 = a.r, s1 = len - b.r;
      if (s1 - s0 < 6) continue;
      const rot = Math.atan2(ux, uz);
      for (let s = s0 + 1; s < s1 - 1; s += 2.6) {
        const d = K.mesh(new THREE.BoxGeometry(.3, .04, 1.4), dashMat, false);
        d.position.set(a.x + ux * s, WATER_Y + .05, a.z + uz * s);
        d.rotation.y = rot;
        raw.add(d);
      }
      raw.add(sailboat(K, m, a.x + ux * (s0 + (s1 - s0) * .38), a.z + uz * (s0 + (s1 - s0) * .38), rot));
    }
    raw.updateMatrixWorld(true);
    const merged = mergeStatic(raw);
    disposeTree(raw);
    this.lanes.add(merged);
  }

  /** 群岛视角：显示岛名牌 */
  setFar(on: boolean) {
    this.far = on;
    for (const l of this.regions.values()) l.tag.visible = on;
  }

  // =====================================================================
  // 宫殿外壳
  // =====================================================================

  addShell(region: WorldRegion, placed: PlacedPalace, doc: PalaceDoc) {
    this.removeShell(placed.palaceId);
    const layer = this.regions.get(region.id);
    if (!layer) return null;
    const K = this.K;
    const H = doc.wallHeight ?? 2.8;
    const group = new THREE.Group();
    group.name = 'shell:' + doc.id;
    group.userData.palaceId = doc.id;

    // 外墙 + 门窗 + 地坪 → 合并
    const raw = new THREE.Group();
    for (const r of doc.rooms) {
      if (!r.floor) continue;
      const [x0, z0, x1, z1] = r.rect;
      const s = K.box(raw, x1 - x0 + .2, .15, z1 - z0 + .2, K.M.slab, (x0 + x1) / 2, -.152, (z0 + z1) / 2, .01);
      s.castShadow = false;
      if (!r.outdoor) {
        const f = K.mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), K.M.cream, false);
        f.rotation.x = -Math.PI / 2; f.position.set((x0 + x1) / 2, .005, (z0 + z1) / 2);
        raw.add(f);
      }
    }
    for (const def of doc.walls) {
      if (!def.normal) continue;
      const w = new Wall(K, def, raw, H);
      w.cur = H; w.apply();
    }
    raw.traverse((o: any) => { if (o.isMesh && o.material === K.M.glass) o.material = this.shellGlass; });
    const body = mergeStatic(raw);
    const owned = new Set<THREE.Material>();
    body.traverse((o: any) => { if (o.isMesh && o.material?.userData?.owned) owned.add(o.material); });
    disposeTree(raw);
    body.name = 'shell-body';
    group.add(body);

    const color = placed.roofColor || palaceColor(doc);
    const roof = buildRoof(K, doc, H, color, placed.roof || 'auto', !!layer.theme.roofSnow);
    group.add(roof.group);

    const el = document.createElement('div');
    el.className = 'kp-tag';
    el.dataset.act = 'tag';
    el.dataset.id = doc.id;
    const tag = new CSS2DObject(el);
    tag.center.set(.5, 1);
    group.add(tag);

    const shell: Shell = {
      id: doc.id, regionId: region.id, placed, doc, group, body, roof: roof.group, roofMats: roof.mats, owned: [...owned], top: roof.top,
      lift: 0, liftTarget: 0, liftDir: new THREE.Vector2(0, -1), tag, lot: placedLot(placed, doc),
    };
    this.updateTag(shell);
    this.placeShell(shell);
    this.shells.set(doc.id, shell);
    layer.shellRoot.add(group);
    return shell;
  }

  removeShell(id: string) {
    const s = this.shells.get(id);
    if (!s) return;
    this.shells.delete(id);
    s.tag.element.remove();
    s.group.removeFromParent();
    disposeTree(s.body);
    disposeTree(s.roof);
    s.roofMats.forEach(m => m.dispose());
    s.owned.forEach(m => m.dispose());
  }

  /** 按 placed 更新外壳位置（拖动时每帧调用） */
  placeShell(s: Shell) {
    s.group.position.set(s.placed.pos[0], 0, s.placed.pos[1]);
    s.group.rotation.y = s.placed.rot * DEG;
    s.lot = placedLot(s.placed, s.doc);
  }

  updateTag(s: Shell) {
    const doc = s.doc, st = palaceStats(doc), due = this.dueOf?.(doc) || 0;
    const el = s.tag.element;
    el.style.setProperty('--c', s.placed.roofColor || palaceColor(doc));
    const order = this.journeyOf?.(doc.id) || [];
    el.innerHTML = `${order.length ? `<span class="kp-jorder" title="${t('旅程第 {list} 段', { list: order.join(t('、')) })}">${order.join('·')}</span>` : ''}<i></i><b></b><span class="kp-more">📌 ${st.loci}</span>${due ? `<span class="kp-due" title="${t('待复习')}">${due}</span>` : ''}`;
    el.classList.toggle('kp-in-journey', order.length > 0);
    el.querySelector('b').textContent = doc.name;
    el.title = [doc.name, t('{n} 个房间', { n: st.rooms }), t('{n} 个物件', { n: st.items }), t('{n} 个记忆桩', { n: st.loci }), ...(due ? [t('{n} 个待复习', { n: due })] : [])].join(' · ');
    const rects = indoorRects(doc);
    const bb = bboxOf(rects.length ? rects : [palaceLot(doc)]);
    const [x, z] = rectCenter(bb);
    s.tag.position.set(x, s.top + .7, z);
  }

  regionOfShell(id: string) {
    const s = this.shells.get(id);
    return s ? this.regions.get(s.regionId) : undefined;
  }

  // =====================================================================
  // 拾取
  // =====================================================================

  /** 射线拾取宫殿外壳 */
  pick(ray: THREE.Raycaster): { id: string; point: THREE.Vector3 } | null {
    const list: THREE.Object3D[] = [];
    for (const s of this.shells.values()) if (s.group.visible) list.push(s.body, s.roof);
    const hits = ray.intersectObjects(list, true);
    for (const h of hits) {
      let o: THREE.Object3D = h.object, vis = true;
      while (o && !o.userData.palaceId) { if (!o.visible) vis = false; o = o.parent; }
      if (o && vis) return { id: o.userData.palaceId, point: h.point };
    }
    return null;
  }

  /** 射线与某座岛草地平面的交点（区域局部坐标） */
  groundOf(ray: THREE.Raycaster, layer: RegionLayer): Vec2 | null {
    const inv = this.group.matrixWorld.clone().invert();
    const r = ray.ray.clone().applyMatrix4(inv);
    // 星球模式下地面是弯的：先打在球面上，再展开回平面地图
    const out = BEND.k.value > 0 ? unbendRay(r, layer.lift) : r.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -layer.lift), new THREE.Vector3());
    if (!out) return null;
    return layer.toLocal(out.x, out.z);
  }

  /** 星球模式：海面跟着焦点走（海面是均匀的，移动它看不出来，但能保证整颗星球都被海包住） */
  setOceanCenter(x: number, z: number, reach: number) {
    // 海面要从北极一直铺到南极（弧长 πR），否则星球下半边会露出空洞
    const span = Math.min(40000, Math.max(900, reach * 2.2));
    this.ocean.scale.set(span, span, 1);
    this.ocean.position.x = x;
    this.ocean.position.z = z;
  }

  /** 射线落在哪座宫殿的地块上 */
  pickLot(ray: THREE.Raycaster): string | null {
    for (const layer of this.regions.values()) {
      const g = this.groundOf(ray, layer);
      if (!g) continue;
      for (const s of this.shells.values()) {
        if (s.regionId !== layer.region.id || !s.group.visible) continue;
        const [x0, z0, x1, z1] = s.lot;
        if (g[0] > x0 && g[0] < x1 && g[1] > z0 && g[1] < z1) return s.id;
      }
    }
    return null;
  }

  /** 射线落在哪座岛上（浮空岛优先：它在上面） */
  pickRegion(ray: THREE.Raycaster): string | null {
    const layers = [...this.regions.values()].sort((a, b) => b.lift - a.lift);
    for (const layer of layers) {
      const g = this.groundOf(ray, layer);
      if (g && layer.onLand(g[0], g[1], -3)) return layer.region.id;
    }
    return null;
  }

  // =====================================================================
  // 动画 / 灯光
  // =====================================================================

  /** 屋顶掀起 / 放下动画；返回是否还在动 */
  update(dt: number) {
    let moving = false;
    for (const s of this.shells.values()) {
      if (s.lift === s.liftTarget) continue;
      moving = true;
      const k = Math.min(1, dt * 5);
      s.lift += (s.liftTarget - s.lift) * k;
      if (Math.abs(s.lift - s.liftTarget) < .004) s.lift = s.liftTarget;
      this.applyLift(s);
    }
    return moving;
  }

  applyLift(s: Shell) {
    const t = s.lift, e = t * t * (3 - 2 * t);
    s.roof.position.set(s.liftDir.x * e * 2.2, e * 2.6, s.liftDir.y * e * 2.2);
    s.roof.rotation.set(s.liftDir.y * e * .12, 0, -s.liftDir.x * e * .12);
    s.roof.visible = t < .995;
    const fade = THREE.MathUtils.smoothstep(t, .25, .95);
    for (const m of s.roofMats) {
      const tr = fade > 0;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      m.opacity = 1 - fade;
    }
    s.roof.traverse((o: any) => { if (o.isMesh) o.castShadow = t < .05; });
  }

  /** 立即设定屋顶状态（无动画） */
  setLift(id: string, v: number) {
    const s = this.shells.get(id);
    if (!s) return;
    s.lift = s.liftTarget = v;
    this.applyLift(s);
  }

  /**
   * 点光源池：小镇里的路灯、灯塔只点亮离镜头焦点最近的若干盏。
   * 数量固定，岛越来越多也不会拖慢着色；看远处的岛时它们靠发光材质「亮着」。
   */
  updateLightPool(target: THREE.Vector3, force = false) {
    const now = performance.now();
    if (!force && now - this.lightTick < 400) return;
    this.lightTick = now;
    const lights: { l: THREE.PointLight; d: number }[] = [];
    const p = new THREE.Vector3();
    for (const layer of this.regions.values()) {
      layer.land.traverse((o: any) => {
        if (o.isPointLight) lights.push({ l: o, d: o.getWorldPosition(p).distanceToSquared(target) });
      });
    }
    lights.sort((a, b) => a.d - b.d);
    lights.forEach((e, i) => { e.l.visible = i < LIGHT_POOL; });
  }

  dispose() {
    for (const id of [...this.shells.keys()]) this.removeShell(id);
    for (const id of [...this.regions.keys()]) this.removeRegion(id);
    for (const mats of this.themeMats.values()) {
      for (const m of Object.values(mats)) {
        if (Object.values(this.common).includes(m)) continue;
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      }
    }
    Object.values(this.common).forEach(m => m.dispose());
    this.ocean.geometry.dispose();
    this.oceanMat.dispose();
    this.group.removeFromParent();
  }
}

/** 所有主题（选择器用） */
export { THEMES };

/** 航线上的小帆船（局部 +z 朝航向） */
function sailboat(K: Kit, m: Mats, x: number, z: number, rot: number) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-.55, -1.4); s.lineTo(.55, -1.4); s.quadraticCurveTo(.6, .4, 0, 1.6); s.quadraticCurveTo(-.6, .4, -.55, -1.4);
  const hull = K.mesh(new THREE.ExtrudeGeometry(s, { depth: .4, bevelEnabled: true, bevelThickness: .06, bevelSize: .06, bevelSegments: 1, curveSegments: 10 }), [m.hull, m.red]);
  hull.rotation.x = -Math.PI / 2; g.add(hull);
  const mast = K.mesh(new THREE.CylinderGeometry(.04, .05, 2.6, 6), m.woodDark); mast.position.set(0, 1.7, .2); g.add(mast);
  const sail = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, 2.2), new THREE.Vector2(1.1, .1)]);
  const sm = K.mesh(new THREE.ShapeGeometry(sail), m.hull); sm.position.set(.05, .55, .2); sm.rotation.y = -Math.PI / 2; g.add(sm);
  g.position.set(x, WATER_Y - .15, z);
  g.rotation.y = rot;
  return g;
}

// =====================================================================
// 小工具
// =====================================================================

/**
 * 岛的轮廓：以所有地块（和广场）角点的「支撑函数」为基础外扩，再叠加低频噪声。
 * 宫殿越多、摆得越开，岛就越大；同一个种子的海岸线形状稳定。
 */
function islandRadial(ext: Rect, lots: Rect[], seed: number, c: Vec2, margin: number, minR: number) {
  const N = 180;
  const corners: Vec2[] = [];
  for (const r of [...lots, ext]) corners.push([r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]);
  const circle = PLAZA_R + 2;
  const base = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2, ux = Math.cos(a), uz = Math.sin(a);
    let h = -c[0] * ux - c[1] * uz + circle;
    for (const [x, z] of corners) h = Math.max(h, (x - c[0]) * ux + (z - c[1]) * uz);
    base[i] = Math.max(h + margin, minR);
  }
  // 平滑支撑函数的折角
  const smooth = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0, w = 0;
    for (let k = -6; k <= 6; k++) { const wk = 7 - Math.abs(k); s += base[(i + k + N) % N] * wk; w += wk; }
    smooth[i] = Math.max(base[i], s / w);
  }
  const p1 = seed * .37 % 6.28, p2 = seed * .71 % 6.28, p3 = seed * 1.13 % 6.28;
  return (a: number) => {
    a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const f = a / (Math.PI * 2) * N, i = Math.floor(f) % N, t = f - Math.floor(f);
    const b = smooth[i] * (1 - t) + smooth[(i + 1) % N] * t;
    return b * (1 + .045 * Math.sin(3 * a + p1) + .03 * Math.sin(5 * a + p2) + .018 * Math.sin(9 * a + p3));
  };
}

function mergeBoxes(geos: THREE.BufferGeometry[]) {
  const nonIdx = geos.map(g => { const n = g.toNonIndexed(); g.dispose(); return n; });
  let count = 0;
  for (const g of nonIdx) count += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const size = nonIdx[0].attributes[name].itemSize;
    const arr = new Float32Array(count * size);
    let off = 0;
    for (const g of nonIdx) { arr.set(g.attributes[name].array as Float32Array, off); off += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  nonIdx.forEach(g => g.dispose());
  out.computeBoundingSphere();
  return out;
}
