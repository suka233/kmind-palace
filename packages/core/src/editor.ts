import * as THREE from 'three';
import type { PalaceView } from './view';
import type { PalaceItem } from './schema';
import { uid, getBinding, itemLoci, subtree, itemPose, setItemPose } from './schema';
import { materializeDecor } from './decor';
import { pickImageFile, pickFile, compressImage, blobToDataUrl, storeMedia } from './media';
import { recognizeMessages, parseRecognition } from './recognize';
import { sanitizeParts, countParts } from './blocks';
import { CATEGORIES, PRESETS, isHexColor, type ParamSpec, type Preset } from './catalog';
import { spawnItem, despawnItem, placeItem, roomAt, itemDisplayName, ownBox } from './build';
import { ThumbnailRenderer } from './thumbs';
import { StructEditor } from './struct-editor';
import { t } from './i18n';

export type EditMode = 'items' | 'rooms' | 'walls';

const HINTS: Record<EditMode, string> = {
  items: '拖动物件移动（小物件可以放到家具上，随家具一起移动）· 拖动橙色圆点旋转 · <b>R</b> 旋转 90° · <b>[ ]</b> 微调角度 · 方向键微移 · <b>Delete</b> 删除 · <b>⌘D</b> 复制 · <b>⌘Z</b> 撤销 · 按住 <b>Alt</b> 关闭吸附',
  rooms: '单击地面选中房间 · 拖动橙色把手调整大小 · 「新建房间」后在地面上拖出矩形 · <b>Delete</b> 删除 · <b>⌘Z</b> 撤销 · 按住 <b>Alt</b> 关闭吸附',
  walls: '单击墙体选中（选中的墙会完整显示）· 拖动平移 · 拖动两端圆点改长度 · 单击门窗后可沿墙拖动 · 「画墙」连续画墙 · <b>Delete</b> 删除 · <b>⌘Z</b> 撤销',
};

/* =====================================================================
 * 编辑模式（手动搭建）
 * - 拖动物件：落地物件在地面上移动，小物件可以叠放到家具表面；挂墙物件吸附墙面
 * - 拖动橙色圆点旋转；网格 / 角度吸附（按住 Alt 临时关闭）
 * - 添加物件（目录 + 缩略图）、复制、删除、改名、调整参数
 * - 撤销 / 重做；每次提交都会通知宿主保存
 * ===================================================================== */

const DEG = Math.PI / 180;
const GRID = .05;
const ANGLE = 15;
const MAX_UNDO = 120;

type DragKind = 'move' | 'rotate';

interface Drag {
  kind: DragKind;
  obj: THREE.Object3D;
  item: PalaceItem;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  before: string;
  offset: THREE.Vector3;
  wall: boolean;
  stack: boolean;
  fixedY: number | null;
  /** 叠放拖动：指针与物件底部中心在屏幕上的偏移（像素） */
  screenOff?: THREE.Vector2;
}

interface Placing {
  preset: Preset;
  item: PalaceItem;
  obj: THREE.Object3D;
  before: string;
  valid: boolean;
  down: { x: number; y: number } | null;
}

export class Editor {
  active = false;
  snap = true;
  emode: EditMode = 'items';
  struct: StructEditor;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private drag: Drag | null = null;
  private placing: Placing | null = null;
  private pendingParam: string | null = null;
  private liveRaf = 0;
  private ring = new THREE.Group();
  private knob: THREE.Mesh;
  private ringMesh: THREE.Mesh;
  private ringMat = new THREE.MeshBasicMaterial({ color: '#ef8235', transparent: true, opacity: .75, depthWrite: false, toneMapped: false });
  private knobMat = new THREE.MeshBasicMaterial({ color: '#ef8235', toneMapped: false });
  private grid: THREE.GridHelper | null = null;
  private thumbs: ThumbnailRenderer | null = null;
  private category = CATEGORIES[0];
  /** 拍照识物 / 导入模型进行中的提示 */
  private busy = '';
  /** 卡片里正在编辑积木 JSON */
  private editingBlocks = false;
  private ray = new THREE.Raycaster();
  private altKey = false;

  constructor(private v: PalaceView) {
    this.ringMesh = new THREE.Mesh(new THREE.TorusGeometry(1, .012, 6, 64), this.ringMat);
    this.ringMesh.rotation.x = Math.PI / 2;
    this.knob = new THREE.Mesh(new THREE.SphereGeometry(.07, 16, 12), this.knobMat);
    this.knob.userData.handle = 'rotate';
    this.ring.add(this.ringMesh, this.knob);
    this.ring.visible = false;
    this.ring.renderOrder = 11;
    v.scene.add(this.ring);
    this.struct = new StructEditor(v, this);
  }

  /** 切换搭建子模式：物件 / 房间 / 墙体 */
  setEmode(m: EditMode) {
    if (m === this.emode) return;
    this.cancelPlacing();
    this.setDrawer(false);
    this.struct.clear();
    if (this.v.selected) this.v.select(null);
    this.emode = m;
    const root = this.v.root;
    for (const k of ['items', 'rooms', 'walls']) root.classList.toggle('kp-emode-' + k, k === m);
    root.querySelectorAll('[data-act="emode"]').forEach(b => b.classList.toggle('kp-on', (b as HTMLElement).dataset.mode === m));
    this.v.ui.editHint.innerHTML = t(HINTS[m]);
    this.updateRing();
    this.v.applyHighlight();
    this.v.invalidate();
  }

  /** 结构层重建后同步选中框等 */
  onStructureRebuilt() {
    this.struct.onStructureRebuilt();
    this.ensureGrid(true);
  }

  // =====================================================================
  // 开关 / 状态
  // =====================================================================

  toggle(on = !this.active) {
    if (on === this.active) return;
    if (on && this.v.readonly) return;
    this.active = on;
    if (on) { this.v.recall.stop(); if (this.v.recall.panelOpen) this.v.recall.togglePanel(false); }
    this.cancelPlacing();
    this.struct.clear();
    this.v.root.classList.toggle('kp-editing', on);
    this.v.root.classList.toggle('kp-emode-' + this.emode, on);
    if (on) {
      this.ensureGrid();
      this.v.ui.loci.classList.add('kp-hidden');
    } else {
      this.setDrawer(false);
    }
    if (this.grid) this.grid.visible = on;
    this.v.showCard(this.v.selected);
    this.updateRing();
    this.updateUndoButtons();
    this.v.invalidate();
  }

  /** 换了一份宫殿数据：清空撤销历史 */
  reset() {
    this.cancelPlacing();
    this.struct.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.grid?.removeFromParent();
    this.grid?.dispose();
    this.grid = null;
    if (this.active) this.ensureGrid();
    this.updateRing();
    this.updateUndoButtons();
  }

  private ensureGrid(refit = false) {
    const b = this.v.built;
    if (refit && this.grid) { this.grid.removeFromParent(); this.grid.dispose(); this.grid = null; if (!this.active) return; }
    if (this.grid || !b) return;
    const size = b.bounds.getSize(new THREE.Vector3()), c = b.bounds.getCenter(new THREE.Vector3());
    const span = Math.ceil(Math.max(size.x, size.z) / .5) * .5;
    const grid = this.grid = new THREE.GridHelper(span, Math.round(span / .5), '#9a8a76', '#9a8a76');
    const m = grid.material as THREE.LineBasicMaterial;
    m.transparent = true; m.opacity = .16; m.depthWrite = false;
    grid.position.set(Math.round(c.x * 2) / 2, .004, Math.round(c.z * 2) / 2);
    grid.visible = this.active;
    this.v.scene.add(grid);
  }

  dispose() {
    this.cancelPlacing();
    this.struct.dispose();
    this.thumbs?.dispose();
    this.grid?.dispose();
    this.ringMesh.geometry.dispose(); this.knob.geometry.dispose();
    this.ringMat.dispose(); this.knobMat.dispose();
  }

  // =====================================================================
  // 撤销 / 提交
  // =====================================================================

  /** 可撤销的完整状态：物件 + 房间 + 墙体 + 地基 */
  snapshot() {
    const d = this.v.doc;
    return JSON.stringify({ items: d.items, rooms: d.rooms, walls: d.walls, ground: d.ground });
  }

  /** 把一次修改记入历史并保存 */
  commit(before: string) {
    if (before === this.snapshot()) return;
    this.undoStack.push(before);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.v.afterItemsChanged();
    this.updateUndoButtons();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.cancelPlacing();
    this.redoStack.push(this.snapshot());
    this.v.applyState(JSON.parse(prev));
    this.updateUndoButtons();
    this.v.host.notify?.(t('已撤销'));
  }

  redo() {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.cancelPlacing();
    this.undoStack.push(this.snapshot());
    this.v.applyState(JSON.parse(next));
    this.updateUndoButtons();
  }

  private updateUndoButtons() {
    const u = this.v.ui.undo, r = this.v.ui.redo;
    if (u) u.toggleAttribute('disabled', !this.undoStack.length);
    if (r) r.toggleAttribute('disabled', !this.redoStack.length);
  }

  // =====================================================================
  // 对选中物件的操作
  // =====================================================================

  private selectedItem() {
    return this.v.selected?.userData.item as PalaceItem | undefined;
  }

  private isWallItem(item: PalaceItem) {
    return this.v.catalog[item.type]?.mount === 'wall';
  }

  rotateSelected(deg: number) {
    const item = this.selectedItem();
    if (!item || this.isWallItem(item)) return;
    const before = this.snapshot();
    item.rot = normDeg((item.rot || 0) + deg);
    placeItem(this.v.built, item);
    this.afterTransform();
    this.commit(before);
  }

  nudge(screenDx: number, screenDy: number, big: boolean) {
    const item = this.selectedItem();
    if (!item) return;
    const step = big ? .5 : GRID;
    const before = this.snapshot();
    const items = this.v.doc.items;
    const pose = itemPose(items, item);
    const p = new THREE.Vector3(...pose.pos);
    if (this.isWallItem(item)) {
      const n = this.wallNormal(item);
      const tangent = new THREE.Vector3(n.z, 0, -n.x);
      const axes = [tangent, tangent.clone().negate(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)];
      const pick = this.bestScreenAxis(p, axes, screenDx, screenDy);
      if (pick.y !== 0 && this.v.catalog[item.type]?.fixedY) return;
      p.addScaledVector(pick, step);
    } else {
      const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
      p.addScaledVector(this.bestScreenAxis(p, axes, screenDx, screenDy), step);
    }
    setItemPose(items, item, [p.x, p.y, p.z], pose.rot, item.parent);
    item.room = roomAt(this.v.doc, p.x, p.z)?.id ?? item.room;
    placeItem(this.v.built, item);
    this.afterTransform();
    this.commit(before);
  }

  /** 找出屏幕上最接近方向键方向的世界坐标轴 */
  private bestScreenAxis(origin: THREE.Vector3, axes: THREE.Vector3[], dx: number, dy: number) {
    const cam = this.v.isoCam;
    const o = origin.clone().project(cam);
    let best = axes[0], bestDot = -Infinity;
    for (const a of axes) {
      const s = origin.clone().add(a).project(cam).sub(o);
      const len = Math.hypot(s.x, s.y) || 1;
      const d = (s.x * dx + s.y * dy) / len;
      if (d > bestDot) { bestDot = d; best = a; }
    }
    return best;
  }

  /** 复制选中的物件，连同放在它上面的东西；副本不带绑定 */
  duplicateSelected() {
    const item = this.selectedItem();
    if (!item) return;
    const before = this.snapshot();
    const tree = subtree(this.v.doc.items, item.id);
    const ids = new Map(tree.map(it => [it.id, uid(it.type + '-')]));
    const copies: PalaceItem[] = tree.map(it => {
      const c: PalaceItem = JSON.parse(JSON.stringify(it));
      c.id = ids.get(it.id);
      if (c.parent && ids.has(c.parent)) c.parent = ids.get(c.parent);
      delete c.bindings;
      return c;
    });
    const copy = copies[0];
    if (copy.name && !/副本|copy/i.test(copy.name)) copy.name = t('{name} · 副本', { name: t(copy.name) });
    if (this.isWallItem(item)) {
      const n = this.wallNormal(item);
      copy.pos = [round(item.pos[0] + n.z * .4), item.pos[1], round(item.pos[2] - n.x * .4)];
    } else {
      copy.pos = [round(item.pos[0] + .4), item.pos[1], round(item.pos[2] + .4)];
    }
    this.v.doc.items.push(...copies);
    let obj: THREE.Object3D | null = null;
    for (const c of copies) { const o = spawnItem(this.v.built, c, this.v.catalog); if (c === copy) obj = o; }
    this.v.applyNightToNew();
    this.commit(before);
    if (obj) this.v.select(obj);
  }

  deleteSelected() {
    const item = this.selectedItem();
    if (!item) return;
    const before = this.snapshot();
    const name = itemDisplayName(item, this.v.catalog);
    this.v.select(null);
    this.v.hovered = null;
    this.v.clearTint();
    // 放在它上面的东西一起删
    const tree = subtree(this.v.doc.items, item.id);
    const gone = new Set(tree.map(i => i.id));
    this.v.doc.items = this.v.doc.items.filter(i => !gone.has(i.id));
    for (const it of tree.reverse()) despawnItem(this.v.built, it.id, this.v.kit);
    this.commit(before);
    this.v.host.notify?.(gone.size > 1
      ? t('已删除「{name}」及放在上面的 {n} 件物品，可按 ⌘Z / Ctrl+Z 撤销', { name, n: gone.size - 1 })
      : t('已删除「{name}」，可按 ⌘Z / Ctrl+Z 撤销', { name }));
  }

  private rename(name: string) {
    const item = this.selectedItem();
    if (!item) return;
    const before = this.snapshot();
    const clean = name.trim();
    item.name = clean || undefined;
    this.commit(before);
  }

  /** 修改参数：live 时只重建预览，提交时记入历史 */
  private setParam(key: string, value: any, live: boolean) {
    const item = this.selectedItem();
    if (!item) return;
    if (this.pendingParam === null) this.pendingParam = this.snapshot();
    item.params = { ...(item.params || {}), [key]: value };
    const rebuild = () => {
      this.liveRaf = 0;
      this.v.respawn(item);
    };
    if (live) {
      if (!this.liveRaf) this.liveRaf = requestAnimationFrame(rebuild);
      return;
    }
    cancelAnimationFrame(this.liveRaf); this.liveRaf = 0;
    const lostBefore = this.v.orphans.size;
    rebuild();
    const before = this.pendingParam;
    this.pendingParam = null;
    this.commit(before);
    this.renderCard(this.v.selected);
    const lost = this.v.orphans.size - lostBefore;
    if (lost > 0) this.v.host.notify?.(t('有 {n} 个绑定的部件放不下了（绑定还在），调回尺寸即可恢复', { n: lost }));
  }

  /** 一次改几个参数（照片连同画框比例），记一步撤销 */
  private setParams(patch: Record<string, any>) {
    const item = this.selectedItem();
    if (!item) return;
    const before = this.snapshot();
    const params = { ...(item.params || {}), ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === null || v === undefined) delete params[k];
    item.params = params;
    this.v.respawn(item);
    this.commit(before);
    this.renderCard(this.v.selected);
  }

  /** 书架书目：选一个笔记本或文档（它的子文档摆上书架） */
  private async pickSource() {
    const item = this.selectedItem(), host = this.v.host;
    if (!item || !host.pickDocSource) return;
    const src = await host.pickDocSource({ current: item.params?.source });
    if (!src || this.selectedItem() !== item) return;
    this.setParams({ source: this.v.stampSource({ ...src }) });
  }

  private setBusy(text: string) {
    this.busy = text;
    if (!this.v.ui.drawer.classList.contains('kp-hidden')) this.renderDrawer();
  }

  /** 拍照识物：视觉模型看照片，给出目录类型 + 参数（或积木），然后进入放置 */
  private async recognizePhoto() {
    const ai = this.v.host.ai;
    if (!ai || this.busy) return;
    const file = await pickImageFile();
    if (!file) return;
    this.setBusy(t('正在识别照片…'));
    try {
      const { blob } = await compressImage(file, 768, .8);
      const url = await blobToDataUrl(blob);
      const text = await ai.chat(recognizeMessages(this.v.catalog, url), { temperature: .2 });
      const r = parseRecognition(text, this.v.catalog);
      this.setBusy('');
      this.startPlacing({ id: 'photo:' + r.type, type: r.type, name: r.name, category: '', params: r.params, y: this.v.catalog[r.type]?.mount === 'wall' ? 1.5 : undefined });
      this.v.host.notify?.(t(r.type === 'blocks' ? '识别为「{name}」（用积木拼的），单击放下' : '识别为「{name}」，单击放下', { name: t(r.name) }) + (r.warnings.length ? t('；') + r.warnings[0] : ''));
    } catch (e) {
      this.setBusy('');
      this.v.host.notify?.(t('没能识别：{msg}', { msg: String((e as Error)?.message || e) }), 'error');
    }
  }

  /** 导入 glb 模型（replace：替换选中模型物件的文件） */
  private async importModel(replace = false) {
    const host = this.v.host;
    if (!host.saveMedia || this.busy) return;
    const file = await pickFile('.glb,model/gltf-binary');
    if (!file) return;
    if (!/\.glb$/i.test(file.name)) { host.notify?.(t('只支持 .glb 格式（把贴图打包在一起的 glTF）'), 'error'); return; }
    if (file.size > 30 * 1024 * 1024) { host.notify?.(t('模型超过 30 MB，请先压缩（例如 gltf-transform）'), 'error'); return; }
    this.setBusy(t('正在导入模型…'));
    try {
      const id = await storeMedia(host, file, 'glb');
      this.setBusy('');
      if (replace && this.selectedItem()?.type === 'model') { this.setParams({ src: id }); return; }
      const name = file.name.replace(/\.glb$/i, '').slice(0, 20) || t('3D 模型');
      this.startPlacing({ id: 'model:' + id, type: 'model', name, category: '', params: { src: id, h: 1 } });
    } catch (e) {
      this.setBusy('');
      host.notify?.(t('模型没有导入成功：{msg}', { msg: String((e as Error)?.message || e) }), 'error');
    }
  }

  /** 保存卡片里编辑的积木 JSON */
  private saveBlocks() {
    const ta = this.v.ui.card.querySelector<HTMLTextAreaElement>('textarea[data-field="blocks"]');
    if (!ta) return;
    let parsed: unknown;
    try { parsed = JSON.parse(ta.value); } catch (e) { this.v.host.notify?.(t('JSON 格式不对：{msg}', { msg: (e as Error).message }), 'error'); return; }
    const r = sanitizeParts(Array.isArray(parsed) ? parsed : (parsed as any)?.parts);
    if (!r.parts.length) { this.v.host.notify?.(t('没有可用的形体'), 'error'); return; }
    this.editingBlocks = false;
    this.setParams({ parts: r.parts });
    if (r.warnings.length) this.v.host.notify?.(r.warnings.join(t('；')));
  }

  /** 换成自己的照片（画作、相框、海报、地毯、电视）：压缩后交给宿主保存，画框高度 / 地毯宽度按照片比例调整 */
  private async pickPhoto() {
    const item = this.selectedItem(), host = this.v.host;
    if (!item || !host.saveMedia) return;
    const file = await pickImageFile();
    if (!file) return;
    try {
      const { blob, ext, w, h } = await compressImage(file);
      const id = await storeMedia(host, blob, ext);
      if (this.selectedItem() !== item) return;
      const patch: Record<string, any> = { photo: id };
      const specs = this.v.catalog[item.type]?.params || [];
      const W = specs.find(p => p.key === 'w'), H = specs.find(p => p.key === 'h' || (item.type === 'rug' && p.key === 'd'));
      if (W && H) {
        // 照片区域 = 画框减去边（装饰画 0.1 m，相框 0.036 m，海报 0.04 m，地毯没有边）
        const border = ({ painting: .1, photoFrame: .036, poster: .04 } as Record<string, number>)[item.type] ?? 0;
        const fw = item.params?.w ?? W.def;
        patch[H.key] = Math.round(THREE.MathUtils.clamp((fw - border) * h / w + border, H.min, H.max) * 100) / 100;
      }
      this.setParams(patch);
    } catch (e) {
      host.notify?.(t('照片没有保存成功：{msg}', { msg: String((e as Error)?.message || e) }), 'error');
    }
  }

  private afterTransform() {
    this.v.updateMarker();
    this.updateRing();
    this.v.rebuildPins();
    this.v.invalidate();
  }

  // =====================================================================
  // 拖动 / 旋转 / 放置
  // =====================================================================

  private setRay(e: { clientX: number; clientY: number }) {
    this.ray.setFromCamera(this.v.ndc(e.clientX, e.clientY), this.v.isoCam);
    return this.ray;
  }

  /** 指针射线与水平面 y 的交点 */
  private planeHit(e: { clientX: number; clientY: number }, y = 0) {
    const out = new THREE.Vector3();
    return this.setRay(e).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), out) ? out : null;
  }

  /**
   * 竖直向下找支撑面：地面，或（小物件时）家具顶面。
   * 放在家具上时返回这件家具，小物件就挂在它下面、随它移动（地毯这类扁平物件除外）。
   */
  private support(x: number, z: number, self: THREE.Object3D, stack: boolean): { y: number; parent: PalaceItem | null } {
    const b = this.v.built;
    const r = new THREE.Raycaster(new THREE.Vector3(x, 8, z), new THREE.Vector3(0, -1, 0));
    const targets: THREE.Object3D[] = [...b.grounds];
    if (stack) for (const o of b.pickables) if (o.visible && !isInside(o, self)) targets.push(o);
    for (const h of r.intersectObjects(targets, true)) {
      if (isOverlay(h.object) || !isVisible(h.object) || isInside(h.object, self)) continue;
      if (b.grounds.includes(h.object as THREE.Mesh)) return { y: h.point.y, parent: null };
      const n = h.face?.normal.clone().transformDirection(h.object.matrixWorld);
      if (n && n.y > .7) {
        const host = itemOf(h.object);
        return { y: h.point.y, parent: host && !this.v.catalog[host.type]?.flat ? host : null };
      }
    }
    return { y: 0, parent: null };
  }

  /** 屏幕上一点的射线打到的第一个可以放东西的面：地面，或家具顶面（跳过自己和放在自己上面的东西） */
  private surfaceHit(e: { clientX: number; clientY: number }, self: THREE.Object3D) {
    const b = this.v.built;
    const targets: THREE.Object3D[] = [...b.grounds];
    for (const o of b.pickables) if (o.visible && !isInside(o, self)) targets.push(o);
    for (const h of this.setRay(e).intersectObjects(targets, true)) {
      if (isOverlay(h.object) || !isVisible(h.object) || isInside(h.object, self)) continue;
      if (b.grounds.includes(h.object as THREE.Mesh)) return h.point;
      const n = h.face?.normal.clone().transformDirection(h.object.matrixWorld);
      if (n && n.y > .7) return h.point;
    }
    return this.planeHit(e, 0);
  }

  /** 指针下方的墙面（只认全高显示的墙） */
  private wallHit(e: PointerEvent | MouseEvent) {
    const b = this.v.built;
    const meshes: THREE.Object3D[] = [];
    for (const w of b.walls) if (w.cur > b.wallH - .08) for (const p of w.pieces) if (p.mesh.visible) meshes.push(p.mesh);
    for (const h of this.setRay(e).intersectObjects(meshes, false)) {
      const n = h.face?.normal.clone().transformDirection(h.object.matrixWorld);
      if (!n || Math.abs(n.y) > .5) continue;
      return { point: h.point, normal: n.setY(0).normalize(), wall: h.object.userData.wall };
    }
    return null;
  }

  private wallNormal(item: PalaceItem) {
    const r = (item.rot || 0) * DEG;
    return new THREE.Vector3(Math.sin(r), 0, Math.cos(r));
  }

  /** 按指针位置计算物件的新位置（落地 / 挂墙） */
  private follow(e: PointerEvent | MouseEvent, item: PalaceItem, obj: THREE.Object3D, d: { offset: THREE.Vector3; wall: boolean; stack: boolean; fixedY: number | null; screenOff?: THREE.Vector2 }) {
    const snap = this.snap && !e.altKey;
    if (d.wall) {
      const h = this.wallHit(e);
      if (!h) return false;
      const n = h.normal;
      const p = h.point.clone().addScaledVector(n, .005);
      const H = this.v.built.wallH;
      let y = d.fixedY ?? THREE.MathUtils.clamp(h.point.y + d.offset.y, .05, H - .05);
      if (snap && d.fixedY === null) y = snapTo(y, GRID);
      if (snap) { if (Math.abs(n.x) > Math.abs(n.z)) p.z = snapTo(p.z, GRID); else p.x = snapTo(p.x, GRID); }
      delete item.parent;
      item.pos = [round(p.x), round(y), round(p.z)];
      item.rot = Math.round(Math.atan2(n.x, n.z) / DEG);
      item.wall = h.wall?.id;
    } else {
      // 小物件：物件底部中心（按屏幕偏移换算）下方的面（桌面、柜顶）；大件家具在地面上平移
      const so = d.screenOff;
      const g = d.stack ? this.surfaceHit(so ? { clientX: e.clientX - so.x, clientY: e.clientY - so.y } : e, obj) : this.planeHit(e, 0);
      if (!g) return false;
      let x = g.x + (d.stack ? 0 : d.offset.x), z = g.z + (d.stack ? 0 : d.offset.z);
      if (snap) { x = snapTo(x, GRID); z = snapTo(z, GRID); }
      const bb = this.v.built.bounds;
      x = THREE.MathUtils.clamp(x, bb.min.x, bb.max.x);
      z = THREE.MathUtils.clamp(z, bb.min.z, bb.max.z);
      const sup = this.support(x, z, obj, d.stack);
      const items = this.v.doc.items;
      setItemPose(items, item, [x, sup.y, z], itemPose(items, item).rot, sup.parent?.id ?? null);
      item.wall = undefined;
    }
    placeItem(this.v.built, item);
    return true;
  }

  /** 编辑模式下的 pointerdown（捕获阶段）；返回 true 表示由编辑器接管 */
  onPointerDown(e: PointerEvent): boolean {
    if (!this.active || e.button !== 0) return false;
    this.altKey = e.altKey;
    if (this.emode !== 'items') return this.struct.onPointerDown(e);
    if (this.placing) {
      this.placing.down = { x: e.clientX, y: e.clientY };
      return false; // 允许拖动平移视角；抬起时若没移动则放下物件
    }
    const cvs = this.v.renderer.domElement;
    // 旋转手柄优先
    if (this.ring.visible && this.v.selected) {
      const hit = this.setRay(e).intersectObject(this.knob, false)[0];
      if (hit) {
        const item = this.selectedItem();
        this.drag = { kind: 'rotate', obj: this.v.selected, item, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false, before: this.snapshot(), offset: new THREE.Vector3(), wall: false, stack: false, fixedY: null };
        capture(cvs, e.pointerId);
        return true;
      }
    }
    const hit = this.v.pickAt(e.clientX, e.clientY);
    if (!hit) return false;
    const obj = hit.obj, item = obj.userData.item as PalaceItem;
    if (obj !== this.v.selected) this.v.select(obj);
    const entry = this.v.catalog[item.type];
    const wall = entry?.mount === 'wall';
    const offset = new THREE.Vector3();
    if (wall) {
      const wh = this.wallHit(e);
      if (wh) offset.y = item.pos[1] - wh.point.y;
    }
    const size = ownBox(obj).getSize(new THREE.Vector3());
    const stack = !wall && item.type !== 'rug' && Math.max(size.x, size.z) < .9;
    let screenOff: THREE.Vector2 | undefined;
    if (stack) {
      const p = itemPose(this.v.doc.items, item).pos;
      const s = new THREE.Vector3(...p).project(this.v.isoCam);
      const r = this.v.renderer.domElement.getBoundingClientRect();
      screenOff = new THREE.Vector2(e.clientX - (r.left + (s.x + 1) / 2 * r.width), e.clientY - (r.top + (1 - s.y) / 2 * r.height));
    } else if (!wall) {
      const g = this.planeHit(e, 0), p = itemPose(this.v.doc.items, item).pos;
      if (g) offset.set(p[0] - g.x, 0, p[2] - g.z);
    }
    this.drag = {
      kind: 'move', obj, item, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false,
      before: this.snapshot(), offset, wall, stack, screenOff,
      fixedY: wall && entry?.fixedY ? item.pos[1] : null,
    };
    capture(cvs, e.pointerId);
    return true;
  }

  onPointerMove(e: PointerEvent): boolean {
    if (this.active && this.emode !== 'items') return this.struct.onPointerMove(e);
    if (this.placing) {
      const p = this.placing;
      const entry = this.v.catalog[p.item.type];
      p.valid = this.follow(e, p.item, p.obj, { offset: new THREE.Vector3(), wall: entry?.mount === 'wall', stack: this.isSmall(p.obj) && p.item.type !== 'rug', fixedY: entry?.mount === 'wall' && entry.fixedY ? p.item.pos[1] : null });
      p.obj.visible = p.valid || entry?.mount !== 'wall';
      this.v.invalidate();
      return true;
    }
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return false;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return true;
    d.moved = true;
    if (d.kind === 'rotate') {
      const c = d.obj.getWorldPosition(new THREE.Vector3());
      const g = this.planeHit(e, c.y);
      if (g) {
        let deg = Math.atan2(g.x - c.x, g.z - c.z) / DEG;
        if (this.snap && !e.altKey) deg = Math.round(deg / ANGLE) * ANGLE;
        // 手柄给的是宫殿里的朝向；放在家具上的物件存的是相对家具的角度
        const items = this.v.doc.items, parent = d.item.parent && items.find(i => i.id === d.item.parent);
        d.item.rot = normDeg(deg - (parent ? itemPose(items, parent).rot : 0));
        placeItem(this.v.built, d.item);
      }
    } else {
      this.follow(e, d.item, d.obj, d);
    }
    this.v.renderer.domElement.style.cursor = 'grabbing';
    this.afterTransform();
    return true;
  }

  onPointerUp(e: PointerEvent): boolean {
    if (this.active && this.emode !== 'items') return this.struct.onPointerUp(e);
    if (this.placing) {
      const p = this.placing;
      const down = p.down;
      p.down = null;
      if (!down || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return false;
      // 触屏没有悬停：先把物件移到点按的位置
      this.onPointerMove(e);
      this.finishPlacing(e.shiftKey);
      return true;
    }
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return false;
    this.drag = null;
    this.v.renderer.domElement.style.cursor = '';
    if (d.moved) {
      const p = itemPose(this.v.doc.items, d.item).pos;
      d.item.room = roomAt(this.v.doc, p[0], p[2])?.id ?? d.item.room;
      this.commit(d.before);
      this.renderCard(this.v.selected);
    }
    return true;
  }

  private isSmall(obj: THREE.Object3D) {
    const s = ownBox(obj).getSize(new THREE.Vector3());
    return Math.max(s.x, s.z) < .9;
  }

  /** 开始放置：目录里的预设（id），或拍照识物 / 导入模型得到的物件描述 */
  startPlacing(presetOrId: string | Preset) {
    const preset = typeof presetOrId === 'string' ? PRESETS.find(p => p.id === presetOrId) : presetOrId;
    const b = this.v.built;
    if (!preset || !b) return;
    this.cancelPlacing();
    this.v.select(null);
    const target = this.v.orbit.target;
    const off = new THREE.Vector3().subVectors(this.v.isoCam.position, target);
    const facing = Math.round(Math.atan2(off.x, off.z) / DEG / 90) * 90;
    const item: PalaceItem = {
      id: uid(preset.type + '-'),
      type: preset.type,
      name: preset.name,
      pos: [round(target.x), preset.y ?? 0, round(target.z)],
      rot: normDeg(facing),
      params: preset.params ? JSON.parse(JSON.stringify(preset.params)) : undefined,
    };
    const before = this.snapshot();
    const obj = spawnItem(b, item, this.v.catalog);
    if (!obj) return;
    this.v.applyNightToNew();
    const wall = this.v.catalog[item.type]?.mount === 'wall';
    obj.visible = !wall;
    this.placing = { preset, item, obj, before, valid: !wall, down: null };
    this.setDrawer(false);
    this.v.root.classList.add('kp-placing');
    this.v.ui.placeHint.textContent = wall
      ? t('把「{name}」移到一面墙上，单击放置 · 按住 Shift 连续放置 · Esc 取消', { name: t(preset.name) })
      : t('单击放置「{name}」 · R 旋转 · 按住 Shift 连续放置 · Esc 取消', { name: t(preset.name) });
    this.v.invalidate();
  }

  private finishPlacing(keepGoing: boolean) {
    const p = this.placing;
    if (!p) return;
    if (!p.valid) { this.v.host.notify?.(t('请把它放到一面完整显示的墙上')); return; }
    this.placing = null;
    this.v.root.classList.remove('kp-placing');
    const at = itemPose(this.v.doc.items, p.item).pos;
    p.item.room = roomAt(this.v.doc, at[0], at[2])?.id;
    this.v.doc.items.push(p.item);
    // 家具默认的摆件变成子物件（放置预览时画的是一体的样子）
    if (materializeDecor(this.v.doc.items, p.item)) {
      this.v.respawn(p.item);
      for (const c of subtree(this.v.doc.items, p.item.id).slice(1)) spawnItem(this.v.built, c, this.v.catalog);
      this.v.applyNightToNew();
    }
    this.commit(p.before);
    this.v.select(this.v.built.itemObjects.get(p.item.id) || p.obj);
    if (keepGoing) this.startPlacing(p.preset);
  }

  cancelPlacing() {
    const p = this.placing;
    if (!p) return;
    this.placing = null;
    this.v.root.classList.remove('kp-placing');
    despawnItem(this.v.built, p.item.id, this.v.kit);
    this.v.invalidate();
  }

  /** 旋转手柄：落地物件脚下的圆环 + 圆点 */
  updateRing() {
    const obj = this.v.selected;
    const item = obj?.userData.item as PalaceItem | undefined;
    if (!this.active || this.emode !== 'items' || !obj || !item || this.isWallItem(item) || this.v.mode !== 'iso') { this.ring.visible = false; return; }
    const size = ownBox(obj).getSize(new THREE.Vector3());
    const R = Math.max(size.x, size.z) / 2 + .28;
    this.ringMesh.scale.setScalar(R);
    const pose = itemPose(this.v.doc.items, item);
    const r = pose.rot * DEG;
    this.knob.position.set(Math.sin(r) * R, 0, Math.cos(r) * R);
    this.ring.position.set(pose.pos[0], Math.max(pose.pos[1], 0) + .03, pose.pos[2]);
    this.ring.visible = true;
  }

  // =====================================================================
  // 键盘
  // =====================================================================

  onKey(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    const k = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey;
    if (mod && k === 'z') { e.shiftKey ? this.redo() : this.undo(); return true; }
    if (mod && k === 'y') { this.redo(); return true; }
    if (mod && k === 'd') { this.duplicateSelected(); return true; }
    if (mod) return false;
    if (this.emode !== 'items') {
      if (this.struct.onKey(e)) return true;
      if (k === 'escape') { this.toggle(false); return true; }
      return false;
    }
    if (k === 'escape') {
      if (this.placing) this.cancelPlacing();
      else if (!this.v.ui.drawer.classList.contains('kp-hidden')) this.setDrawer(false);
      else if (this.v.selected) this.v.select(null);
      else this.toggle(false);
      return true;
    }
    if (this.placing && k === 'r') {
      const p = this.placing;
      if (this.isWallItem(p.item)) return true;
      p.item.rot = normDeg((p.item.rot || 0) + (e.shiftKey ? -90 : 90));
      placeItem(this.v.built, p.item);
      this.v.invalidate();
      return true;
    }
    if (!this.v.selected) return false;
    if (k === 'delete' || k === 'backspace') { this.deleteSelected(); return true; }
    if (k === 'r') { this.rotateSelected(e.shiftKey ? -90 : 90); return true; }
    if (k === '[') { this.rotateSelected(-ANGLE); return true; }
    if (k === ']') { this.rotateSelected(ANGLE); return true; }
    const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, 1], arrowdown: [0, -1] };
    if (arrows[k]) { this.nudge(arrows[k][0], arrows[k][1], e.shiftKey); return true; }
    return false;
  }

  // =====================================================================
  // UI：编辑卡片 / 目录面板
  // =====================================================================

  onAction(act: string, el: HTMLElement): boolean {
    if (act === 'emode') { this.setEmode(el.dataset.mode as EditMode); return true; }
    if (this.active && this.struct.onAction(act, el)) return true;
    if (act === 'closeCard' && this.active && this.emode !== 'items') { this.struct.select(null); return true; }
    switch (act) {
      case 'edit': this.toggle(); return true;
      case 'editDone': this.toggle(false); return true;
      case 'undo': this.undo(); return true;
      case 'redo': this.redo(); return true;
      case 'snap':
        this.snap = !this.snap;
        this.v.ui.snapText.textContent = this.snap ? t('吸附：开') : t('吸附：关');
        return true;
      case 'addItem': this.setDrawer(this.v.ui.drawer.classList.contains('kp-hidden')); return true;
      case 'closeDrawer': this.setDrawer(false); return true;
      case 'cat': this.category = el.dataset.cat; this.renderDrawer(); return true;
      case 'place': this.startPlacing(el.dataset.preset); return true;
      case 'cancelPlace': this.cancelPlacing(); return true;
      case 'rotItem': this.rotateSelected(Number(el.dataset.deg)); return true;
      case 'dupItem': this.duplicateSelected(); return true;
      case 'delItem': this.deleteSelected(); return true;
      case 'pickSource': void this.pickSource(); return true;
      case 'clearSource': this.setParams({ source: null }); return true;
      case 'pickPhoto': void this.pickPhoto(); return true;
      case 'recognize': void this.recognizePhoto(); return true;
      case 'importModel': void this.importModel(); return true;
      case 'replaceModel': void this.importModel(true); return true;
      case 'editBlocks': this.editingBlocks = true; this.renderCard(this.v.selected); return true;
      case 'blocksCancel': this.editingBlocks = false; this.renderCard(this.v.selected); return true;
      case 'blocksSave': this.saveBlocks(); return true;
      case 'clearPhoto': this.setParams({ photo: null }); return true;
    }
    return false;
  }

  /** 编辑卡片里的输入框：input = 实时预览，change = 提交 */
  onInput(e: Event, commit: boolean) {
    if (this.struct.onInput(e, commit)) return;
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.dataset.edit === 'name') { if (commit) this.rename(el.value); return; }
    // 自定义颜色的取色器：拖动时实时预览，松开时记一步
    const colorKey = el.dataset.paramColor;
    if (colorKey) { this.setParam(colorKey, el.value, !commit); return; }
    const key = el.dataset.param;
    if (!key) return;
    const item = this.selectedItem();
    const spec = this.v.catalog[item?.type]?.params?.find(p => p.key === key);
    if (!spec) return;
    let value: any;
    if (spec.options && el.value === 'custom') {
      // 选了「自定义颜色」：先用当前颜色（或一个中性灰），卡片重绘后出现取色器
      if (!commit) return;
      const cur = item.params?.[key];
      value = isHexColor(cur) ? cur : '#8a8078';
    } else if (spec.options) value = spec.options[Number(el.value)]?.[0];
    else {
      value = Number(el.value);
      const out = el.parentElement?.querySelector('output');
      if (out) out.textContent = fmt(value, spec);
    }
    if (spec.options && !commit) return;
    this.setParam(key, value, !commit);
  }

  renderCard(obj: THREE.Object3D | null) {
    if (this.emode !== 'items') return this.struct.renderCard();
    const card = this.v.ui.card;
    if (!obj) { card.classList.add('kp-hidden'); return; }
    const item = obj.userData.item as PalaceItem;
    const entry = this.v.catalog[item.type];
    const room = t(this.v.built?.roomOf(item.room)?.name || '');
    const wall = entry?.mount === 'wall';
    const host = this.v.host;
    if (this.editingBlocks && item.type === 'blocks') {
      card.innerHTML = `
        <button class="kp-close" data-act="closeCard">×</button>
        <div class="kp-room">${t('积木')} · ${esc(itemDisplayName(item, this.v.catalog))}</div>
        <div class="kp-blocks-help">${t('形体：box / cyl / cone / sphere / torus / lathe / extrude / group；单位米，pos 是中心，rot 为度；mirror、repeat 复制；slot + name 的部件可以单独绑定。')}</div>
        <textarea class="kp-blocks-json" data-field="blocks" spellcheck="false"></textarea>
        <div class="kp-story-tools"><button data-act="blocksCancel">${t('取消')}</button><button class="kp-primary" data-act="blocksSave">${t('保存')}</button></div>`;
      (card.querySelector('textarea') as HTMLTextAreaElement).value = JSON.stringify(item.params?.parts || [], null, 1);
      card.classList.remove('kp-hidden');
      return;
    }
    this.editingBlocks = false;
    const params = (entry?.params || [])
      .filter(spec => spec.kind === 'docSource' ? !!host.pickDocSource : spec.kind === 'photo' || spec.kind === 'model' ? !!host.saveMedia : true)
      .map(spec => paramField(spec, item.params?.[spec.key] ?? spec.def)).join('');
    const b = getBinding(item);
    const parts = itemLoci(item).filter(l => l.slot).length;
    card.innerHTML = `
      <button class="kp-close" data-act="closeCard">×</button>
      <div class="kp-room">${esc([room, entry ? t(entry.name) : ''].filter(Boolean).join(' · ').toUpperCase())}</div>
      <input class="kp-name" data-edit="name" maxlength="40" placeholder="${esc(entry ? t(entry.name) : '')}">
      ${entry ? '' : `<div class="kp-shelf-src">📦 ${t('「{type}」需要更新版本的插件才能显示，先用纸箱占位，数据不会丢', { type: esc(item.type) })}</div>`}
      <div class="kp-tools">
        ${wall ? '' : `<button data-act="rotItem" data-deg="-${ANGLE}" title="${t('逆时针 {deg}°（[）', { deg: ANGLE })}">↺ ${ANGLE}°</button>
        <button data-act="rotItem" data-deg="${ANGLE}" title="${t('顺时针 {deg}°（]）', { deg: ANGLE })}">↻ ${ANGLE}°</button>
        <button data-act="rotItem" data-deg="90" title="${t('旋转 90°（R）')}">↻ 90°</button>`}
        <button data-act="dupItem" title="${t('复制（⌘D / Ctrl+D）')}">${t('复制')}</button>
        <button class="kp-danger" data-act="delItem" title="${t('删除（Delete）')}">${t('删除')}</button>
      </div>
      ${params ? `<div class="kp-params">${params}</div>` : ''}
      <div class="kp-bindline">
        <span>${b?.blockId ? `📌 <b></b>` : `<i>${t('未绑定笔记')}</i>`}${parts ? ` · ${t('另有 {n} 个部件记忆桩', { n: parts })}` : ''}</span>
        ${this.v.host.pickBlock ? `<button data-act="bind">${b?.blockId ? t('更换') : t('绑定')}</button>` : ''}
        ${b?.blockId ? `<button class="kp-danger" data-act="unbind">${t('解绑')}</button>` : ''}
      </div>`;
    (card.querySelector('.kp-name') as HTMLInputElement).value = item.name ? t(item.name) : '';
    const bt = card.querySelector('.kp-bindline b');
    if (bt) bt.textContent = b.title || b.blockId;
    card.classList.remove('kp-hidden');
  }

  private setDrawer(open: boolean) {
    this.v.ui.drawer.classList.toggle('kp-hidden', !open);
    this.v.root.classList.toggle('kp-drawer-open', open);
    if (open) this.renderDrawer();
  }

  private renderDrawer() {
    if (!this.thumbs) this.thumbs = new ThumbnailRenderer(this.v.renderer, this.v.kit, this.v.catalog, this.v.scene.environment);
    const d = this.v.ui.drawer;
    const presets = PRESETS.filter(p => p.category === this.category && this.v.catalog[p.type]);
    d.innerHTML = `
      <div class="kp-drawer-head"><b>${t('添加物件')}</b>
        ${this.v.host.ai?.visionEnabled?.() ? `<button class="kp-drawer-tool" data-act="recognize"${this.busy ? ' disabled' : ''} title="${t('拍一张家具或物品的照片，让模型把它变成宫殿里的物件')}">📷 ${t('拍照识物')}</button>` : ''}
        ${this.v.host.saveMedia ? `<button class="kp-drawer-tool" data-act="importModel"${this.busy ? ' disabled' : ''} title="${t('导入 .glb 格式的 3D 模型')}">${t('导入 .glb')}</button>` : ''}
        <button class="kp-close" data-act="closeDrawer">×</button></div>
      ${this.busy ? `<div class="kp-drawer-status">${esc(this.busy)}</div>` : ''}
      <div class="kp-chips">${CATEGORIES.map(c => `<button class="kp-chip${c === this.category ? ' kp-on' : ''}" data-act="cat" data-cat="${esc(c)}">${esc(t(c))}</button>`).join('')}</div>
      <div class="kp-tiles">${presets.map(p => `
        <button class="kp-tile" data-act="place" data-preset="${esc(p.id)}" title="${esc(t(p.name))}">
          <span class="kp-thumb"><img alt="" data-thumb="${esc(p.id)}"></span><span class="kp-tile-name">${esc(t(p.name))}</span>
        </button>`).join('')}</div>`;
    for (const p of presets) {
      void this.thumbs.get(p).then(url => {
        const img = d.querySelector<HTMLImageElement>(`img[data-thumb="${CSS.escape(p.id)}"]`);
        if (img && url) { img.src = url; img.classList.add('kp-loaded'); }
      });
    }
  }
}

function paramField(spec: ParamSpec, value: any) {
  if (spec.kind === 'docSource') {
    return `<div class="kp-field kp-field-src"><span>${esc(t(spec.label))}</span><div class="kp-src"><b>${value ? '📚 ' + esc(value.name || t('笔记本')) : t('随机的书')}</b>
      <button data-act="pickSource">${value ? t('更换') : t('摆上笔记本…')}</button>${value ? `<button data-act="clearSource" title="${t('换回随机的书')}">${t('随机')}</button>` : ''}</div></div>
      <div class="kp-field kp-field-src"><span>${t('单本')}</span><div class="kp-src"><b>${t('颜色、靠、抽出、空格')}</b><button data-act="shelfEdit">${t('逐本调整…')}</button></div></div>`;
  }
  if (spec.kind === 'blocks') {
    const n = countParts(sanitizeParts(value).parts);
    return `<div class="kp-field kp-field-src"><span>${esc(t(spec.label))}</span><div class="kp-src"><b>🧱 ${t('{n} 个形体', { n })}</b><button data-act="editBlocks">${t('编辑 JSON')}</button></div></div>`;
  }
  if (spec.kind === 'model') {
    return `<div class="kp-field kp-field-src"><span>${esc(t(spec.label))}</span><div class="kp-src"><b>📦 ${t('glb 模型')}</b><button data-act="replaceModel">${t('更换')}</button></div></div>`;
  }
  if (spec.kind === 'photo') {
    return `<div class="kp-field kp-field-src"><span>${esc(t(spec.label))}</span><div class="kp-src"><b>${value ? '🖼 ' + t('自己的照片') : t('（没有）')}</b>
      <button data-act="pickPhoto">${value ? t('更换') : t('选照片…')}</button>${value ? `<button data-act="clearPhoto">${t('移除')}</button>` : ''}</div></div>`;
  }
  if (spec.options) {
    const custom = spec.customColor && isHexColor(value);
    const idx = custom ? -1 : Math.max(0, spec.options.findIndex(([v]) => v === value));
    const opts = spec.options.map(([, label], i) => `<option value="${i}"${i === idx ? ' selected' : ''}>${esc(t(label))}</option>`).join('')
      + (spec.customColor ? `<option value="custom"${custom ? ' selected' : ''}>${t('自定义颜色…')}</option>` : '');
    const picker = custom ? `<input type="color" class="kp-color" data-param-color="${esc(spec.key)}" value="${esc(value)}">` : '';
    return `<label class="kp-field${custom ? ' kp-field-color' : ''}"><span>${esc(t(spec.label))}</span><select data-param="${esc(spec.key)}">${opts}</select>${picker}</label>`;
  }
  const v = Number(value ?? spec.def ?? 0);
  return `<label class="kp-field"><span>${esc(t(spec.label))}</span><input type="range" data-param="${esc(spec.key)}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${v}"><output>${fmt(v, spec)}</output></label>`;
}

function fmt(v: number, spec: ParamSpec) {
  return spec.step >= 1 ? String(Math.round(v)) : `${v.toFixed(spec.step < .05 ? 2 : 1)} m`;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const snapTo = (n: number, g: number) => Math.round(n / g) * g;
const normDeg = (d: number) => { const r = Math.round(((d % 360) + 540) % 360 - 180); return r === -180 ? 180 : r; };

function isVisible(o: THREE.Object3D) {
  while (o) { if (!o.visible) return false; o = o.parent; }
  return true;
}

/** o 是否在 root 里面（含 root 自己） */
function isInside(o: THREE.Object3D, root: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}

/** 图钉、书签这类叠加标记 */
function isOverlay(o: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) { if (p.userData.overlay) return true; if (p.userData.item) return false; }
  return false;
}

/** 网格所属的物件 */
function itemOf(o: THREE.Object3D): PalaceItem | null {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.item) return p.userData.item as PalaceItem;
  return null;
}

function esc(s: string) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 捕获指针；合成事件或指针已抬起时 setPointerCapture 会抛错，忽略即可 */
function capture(el: Element, id: number) {
  try { el.setPointerCapture(id); } catch { /* ignore */ }
}
