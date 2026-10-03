import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Kit } from './kit';
import { UNKNOWN_TYPE, type Catalog } from './catalog';
import type { PalaceDoc, PalaceItem, PalaceRoom, Rect } from './schema';
import { Wall } from './walls';
import { seedFromString } from './random';
import { palaceLot } from './world';
import { mergeInPlace } from './merge';
import { t } from './i18n';
import { html } from './dom';

/* =====================================================================
 * 把一份 PalaceDoc 变成 three.js 场景（与视图 / 宿主无关）。
 * 场景分两层：
 *   structure  地基、地面、房间标签、天花板、墙体与门窗 —— 编辑房间 / 墙体时整层快速重建
 *   items      物件 —— 支持单个增删改（编辑物件、撤销、同步）
 * ===================================================================== */

export interface ColliderRect { x0: number; z0: number; x1: number; z1: number }

export interface BuildOptions {
  /** 放在小镇里：不画自己的地基和草坪（由岛屿提供地面），始终画房屋地坪 */
  inWorld?: boolean;
}

export interface BuiltPalace {
  root: THREE.Group;
  inWorld: boolean;
  structure: THREE.Group;
  itemsRoot: THREE.Group;
  wallH: number;
  walls: Wall[];
  wallById: Record<string, Wall>;
  /** 可点选的物件根节点（userData.item 指向 PalaceItem） */
  pickables: THREE.Object3D[];
  itemObjects: Map<string, THREE.Object3D>;
  floors: THREE.Mesh[];
  /** 可以放东西的地面：房间地板、草地、楼板 */
  grounds: THREE.Mesh[];
  labels: CSS2DObject[];
  indoorOnly: THREE.Object3D[];
  colliders: ColliderRect[];
  bounds: THREE.Box3;
  roomOf(id?: string): PalaceRoom | undefined;
}

const DEG = Math.PI / 180;

const FLOOR_SCALE: Record<string, number> = { tileLarge: 2.4, tileBath: 1.2, cement: 1.0, deck: 1.6 };

export function buildPalace(doc: PalaceDoc, K: Kit, catalog: Catalog, opts: BuildOptions = {}): BuiltPalace {
  const root = new THREE.Group();
  root.name = 'palace';
  const itemsRoot = new THREE.Group();
  itemsRoot.name = 'items';
  root.add(itemsRoot);
  const b: BuiltPalace = {
    root, inWorld: !!opts.inWorld, structure: null, itemsRoot, wallH: doc.wallHeight ?? 2.8, walls: [], wallById: {}, pickables: [], itemObjects: new Map(),
    floors: [], grounds: [], labels: [], indoorOnly: [], colliders: [], bounds: new THREE.Box3(), roomOf: () => undefined,
  };
  buildStructure(b, doc, K);
  for (const item of doc.items) spawnItem(b, item, catalog);
  if (!doc.ground && !b.inWorld) b.bounds.setFromObject(root);
  b.colliders = computeColliders(b, catalog);
  return b;
}

/** 构建（或重建）结构层：地基、房间、墙体。物件保持不动，挂墙物件重新挂到新墙上 */
export function buildStructure(b: BuiltPalace, doc: PalaceDoc, K: Kit) {
  if (b.structure) disposeStructure(b);
  const H = b.wallH = doc.wallHeight ?? 2.8;
  const structure = b.structure = new THREE.Group();
  structure.name = 'structure';
  b.root.add(structure);
  const floors: THREE.Mesh[] = b.floors = [];
  const grounds: THREE.Mesh[] = b.grounds = [];
  const labels: CSS2DObject[] = b.labels = [];
  const indoorOnly: THREE.Object3D[] = b.indoorOnly = [];

  // ---------- 地基 / 草地 / 楼板（楼板按有地面的房间自动生成） ----------
  if (doc.ground && !b.inWorld) {
    const [px0, pz0, px1, pz1] = doc.ground.plinth;
    const pw = px1 - px0, pd = pz1 - pz0;
    const plinth = K.mesh(new RoundedBoxGeometry(pw, .5, pd, 3, .18), K.M.plinth);
    plinth.position.set((px0 + px1) / 2, -.4, (pz0 + pz1) / 2);
    structure.add(plinth);
    K.TEX.lawn.repeat.set(pw / 2.8, pd / 2.8);
    grounds.push(K.plane(structure, pw - .2, pd - .2, K.M.lawn, (px0 + px1) / 2, -.149, (pz0 + pz1) / 2, -Math.PI / 2));
  }
  if (b.inWorld) {
    // 岛上的草地由小镇绘制；这里放一块不可见的「地面」，供摆放庭院物件时射线落地
    const [lx0, lz0, lx1, lz1] = palaceLot(doc);
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(lx1 - lx0 + 8, lz1 - lz0 + 8), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    (catcher.material as THREE.Material).userData.owned = true;
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.set((lx0 + lx1) / 2, -.15, (lz0 + lz1) / 2);
    structure.add(catcher);
    grounds.push(catcher);
  }
  if (doc.ground || b.inWorld) {
    for (const r of doc.rooms) {
      if (!r.floor) continue;
      const [x0, z0, x1, z1] = r.rect;
      const slab = K.box(structure, x1 - x0 + .2, .15, z1 - z0 + .2, K.M.slab, (x0 + x1) / 2, -.152, (z0 + z1) / 2, .01);
      slab.castShadow = false;
      grounds.push(slab);
    }
  }

  // ---------- 房间：地面 + 标签 + 天花板 ----------
  for (const r of doc.rooms) {
    const [x0, z0, x1, z1] = r.rect;
    const w = x1 - x0, d = z1 - z0;
    if (w < .05 || d < .05) continue;
    if (r.floor) {
      const geo = new THREE.PlaneGeometry(w, d);
      const scale = FLOOR_SCALE[r.floor] || 1.8;
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (x0 + uv.getX(i) * w) / scale, (z0 + uv.getY(i) * d) / scale);
      const tex = (K.TEX as any)[r.floor] || K.TEX.oak;
      const f = K.mesh(geo, K.texturedMat('floor:' + r.floor, tex, r.floor.startsWith('tile') ? .35 : .6), false);
      f.rotation.x = -Math.PI / 2; f.position.set(x0 + w / 2, 0, z0 + d / 2);
      f.userData.room = r;
      structure.add(f); floors.push(f); grounds.push(f);
    }
    if (r.label !== null) {
      const el = document.createElement('div');
      el.className = 'kp-room-label';
      el.replaceChildren(html`${r.name}${r.en ? html`<small>${r.en}</small>` : ''}`);
      const lab = new CSS2DObject(el);
      const [lx, lz] = r.label || [x0 + w / 2, z0 + d / 2];
      lab.position.set(lx, .05, lz);
      lab.userData.room = r;
      structure.add(lab);
      labels.push(lab);
    }
    if (!r.outdoor && r.floor) {
      const ceil = K.mesh(new THREE.PlaneGeometry(w, d), K.G.ceiling, false);
      ceil.rotation.x = Math.PI / 2; ceil.position.set(x0 + w / 2, H, z0 + d / 2);
      ceil.visible = false;
      structure.add(ceil); indoorOnly.push(ceil);
    }
  }

  // ---------- 墙体 ----------
  b.walls = [];
  b.wallById = {};
  for (const def of doc.walls) {
    const w = new Wall(K, def, structure, H);
    b.walls.push(w); b.wallById[w.id] = w;
  }

  b.bounds = new THREE.Box3();
  if (doc.ground || b.inWorld) {
    const [x0, z0, x1, z1] = palaceLot(doc);
    b.bounds.set(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, H, z1));
  }
  const rooms = [...doc.rooms].sort((p, q) => area(p) - area(q));
  b.roomOf = (id?: string) => rooms.find(r => r.id === id);

  // 挂墙物件重新挂到新墙体上
  for (const obj of b.itemObjects.values()) placeItem(b, obj.userData.item);
}

function disposeStructure(b: BuiltPalace) {
  b.labels.forEach(l => l.element.remove());
  b.structure.traverse((o: any) => {
    if (!o.isMesh) return;
    if (!o.geometry.userData.shared) o.geometry.dispose();
    for (const m of [].concat(o.material)) if (m?.userData?.owned) m.dispose();
  });
  b.structure.removeFromParent();
  b.structure = null;
}

/** 构建一个物件并登记到场景；挂在它上面、先前已生成的子物件会重新挂回来 */
export function spawnItem(b: BuiltPalace, item: PalaceItem, catalog: Catalog) {
  // 不认识的类型（更新版本的插件加的）：用占位纸箱，数据原样保留，子物件和绑定照常
  const entry = catalog[item.type] || catalog[UNKNOWN_TYPE];
  if (!entry) { console.warn(t('[kmind-palace] 未知物件类型'), item.type); return null; }
  seedFromString(item.id);
  const obj = entry.build(item.params || {});
  mergeInPlace(obj);
  obj.userData.item = item;
  obj.name = item.id;
  b.itemsRoot.add(obj);
  b.itemObjects.set(item.id, obj);
  for (const o of b.itemObjects.values()) if (o !== obj && (o.userData.item as PalaceItem).parent === item.id) obj.add(o);
  if (item.pickable ?? entry.pickable ?? true) b.pickables.push(obj);
  placeItem(b, item);
  return obj;
}

/** 按 item 的 pos / rot / parent / wall 更新物件位置、父物件与挂墙关系 */
export function placeItem(b: BuiltPalace, item: PalaceItem) {
  const obj = b.itemObjects.get(item.id);
  if (!obj) return;
  obj.userData.item = item;
  // 父物件还没生成时先放在根节点下，等父物件生成时再挂过去
  const parent = (item.parent && b.itemObjects.get(item.parent)) || b.itemsRoot;
  if (obj.parent !== parent) parent.add(obj);
  obj.position.set(item.pos[0], item.pos[1], item.pos[2]);
  obj.rotation.set(0, (item.rot || 0) * DEG, 0);
  for (const w of b.walls) {
    const i = w.attach.indexOf(obj);
    if (i >= 0) w.attach.splice(i, 1);
  }
  const wall = item.wall && parent === b.itemsRoot ? b.wallById[item.wall] : null;
  if (wall) {
    wall.attach.push(obj);
    obj.visible = wall.cur > b.wallH - .08;
  } else obj.visible = true;
}

/** 从 Kit 的灯光登记表中移除一棵物体树里的点光源（整座宫殿卸载时） */
export function releaseLamps(root: THREE.Object3D, K: Kit) {
  const lamps = K.LAMPS;
  root.traverse((o: any) => {
    if (!o.isPointLight) return;
    const i = lamps.findIndex(l => l.l === o);
    if (i >= 0) lamps.splice(i, 1);
  });
}

/** 移除物件并释放它独占的几何体与灯光；挂在它上面的子物件先移到根节点下（由调用方决定删除还是重新挂回） */
export function despawnItem(b: BuiltPalace, id: string, K: Kit) {
  const obj = b.itemObjects.get(id);
  if (!obj) return;
  for (const c of [...obj.children]) if (c.userData.item) b.itemsRoot.add(c);
  b.itemObjects.delete(id);
  obj.removeFromParent();
  const pi = b.pickables.indexOf(obj);
  if (pi >= 0) b.pickables.splice(pi, 1);
  for (const w of b.walls) {
    const i = w.attach.indexOf(obj);
    if (i >= 0) w.attach.splice(i, 1);
  }
  const lamps = K.LAMPS;
  obj.traverse((o: any) => {
    if (o.isPointLight) {
      const i = lamps.findIndex(l => l.l === o);
      if (i >= 0) lamps.splice(i, 1);
    }
    if (o.isMesh && !o.userData.overlay) {
      if (!o.geometry.userData.shared) o.geometry.dispose();
      if (o.isInstancedMesh) o.dispose();
      // 物件独占的材质（书脊贴图集）
      for (const m of [].concat(o.material)) if (m?.userData?.owned) { m.map?.dispose(); m.dispose(); }
    }
  });
}

// =====================================================================
// 物件自身（不含挂在上面的子物件）与部件
// =====================================================================

/** 物件自身的节点：跳过挂在上面的子物件和图钉、书签这类叠加标记 */
export function traverseOwn(obj: THREE.Object3D, fn: (o: THREE.Object3D) => void) {
  const visit = (o: THREE.Object3D) => {
    if (o !== obj && (o.userData.item || o.userData.overlay)) return;
    fn(o);
    for (const c of o.children) visit(c);
  };
  visit(obj);
}

const _box = new THREE.Box3();

const _inv = new THREE.Matrix4(), _rel = new THREE.Matrix4();

/** 物件自身的包围盒（默认世界坐标；local 时为物件自身的局部坐标），不含子物件 */
export function ownBox(obj: THREE.Object3D, out = new THREE.Box3(), local = false) {
  out.makeEmpty();
  obj.updateWorldMatrix(true, true);
  if (local) _inv.copy(obj.matrixWorld).invert();
  traverseOwn(obj, (o: any) => {
    if (!o.isMesh || !o.geometry) return;
    if (o.isInstancedMesh) {
      if (!o.count) return;
      if (!o.boundingBox) o.computeBoundingBox();
      _box.copy(o.boundingBox);
    } else {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      _box.copy(o.geometry.boundingBox);
    }
    out.union(_box.applyMatrix4(local ? _rel.multiplyMatrices(_inv, o.matrixWorld) : o.matrixWorld));
  });
  return out;
}

/** 部件所在的网格（InstancedMesh 时还有实例编号） */
export interface SlotRef { mesh: THREE.Mesh; instanceId?: number }

export function findSlot(obj: THREE.Object3D, slot: string): SlotRef | null {
  if (!slot) return null;
  let found: SlotRef | null = null;
  traverseOwn(obj, (o: any) => {
    if (found || !o.isMesh) return;
    if (o.userData.slot === slot) found = { mesh: o };
    else if (o.userData.slots) {
      const i = (o.userData.slots as string[]).indexOf(slot);
      if (i >= 0) found = { mesh: o, instanceId: i };
    }
  });
  return found;
}

/** 物件上登记过的全部部件编号 */
export function listSlots(obj: THREE.Object3D) {
  const out: string[] = [];
  traverseOwn(obj, (o: any) => {
    if (o.userData.slot) out.push(o.userData.slot);
    if (o.userData.slots) out.push(...o.userData.slots);
  });
  return out;
}

const _m4 = new THREE.Matrix4(), _m4b = new THREE.Matrix4();

/** 部件的包围盒（默认世界坐标；local 时为物件自身的局部坐标）；找不到这个部件时返回 null */
export function slotBox(obj: THREE.Object3D, slot: string, out = new THREE.Box3(), local = false) {
  const ref = findSlot(obj, slot);
  if (!ref) return null;
  const m = ref.mesh;
  m.updateWorldMatrix(true, false);
  if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
  out.copy(m.geometry.boundingBox);
  if (ref.instanceId !== undefined) {
    (m as THREE.InstancedMesh).getMatrixAt(ref.instanceId, _m4);
    out.applyMatrix4(_m4);
  }
  if (local) _m4b.copy(obj.matrixWorld).invert().multiply(m.matrixWorld);
  else _m4b.copy(m.matrixWorld);
  return out.applyMatrix4(_m4b);
}

/** 射线打中的网格属于物件的哪个部件；不是部件时返回 '' */
export function slotOfHit(hit: { object: THREE.Object3D; instanceId?: number; faceIndex?: number }, itemObj: THREE.Object3D) {
  const slots = hit.object.userData.slots as string[] | undefined;
  if (slots && hit.instanceId !== undefined) return slots[hit.instanceId] || '';
  // 合并成一个网格的书脊面片：按三角形查
  const faces = hit.object.userData.faceSlots as string[] | undefined;
  if (faces && hit.faceIndex !== undefined) return faces[hit.faceIndex] || '';
  for (let o: THREE.Object3D | null = hit.object; o && o !== itemObj; o = o.parent) if (o.userData.slot) return o.userData.slot as string;
  return '';
}

/** 漫游用的平面碰撞体：墙体 + 实心物件 */
export function computeColliders(b: BuiltPalace, catalog: Catalog): ColliderRect[] {
  b.root.updateMatrixWorld(true);
  const out: ColliderRect[] = [];
  const box = new THREE.Box3();
  const push = (o: THREE.Object3D, shrink = 0) => {
    box.setFromObject(o);
    out.push({ x0: box.min.x + shrink, z0: box.min.z + shrink, x1: box.max.x - shrink, z1: box.max.z - shrink });
  };
  for (const w of b.walls) {
    for (const p of w.pieces) if (p.y0 < 1.0) push(p.mesh);
    for (const c of w.colliders) push(c);
  }
  for (const obj of b.itemObjects.values()) {
    const item = obj.userData.item as PalaceItem;
    const entry = catalog[item.type] || catalog[UNKNOWN_TYPE];
    if (!(item.solid ?? entry?.solid ?? true)) continue;
    if (entry?.childColliders) { traverseOwn(obj, o => { if (o.userData.collider) push(o); }); continue; }
    ownBox(obj, box);
    if (box.min.y < .3 && box.max.y - box.min.y > .3) push(obj, .03);
  }
  return out;
}

/** 平面坐标落在哪个房间（优先面积最小的，庭院这类大区域兜底） */
export function roomAt(doc: PalaceDoc, x: number, z: number) {
  let best: PalaceRoom | undefined;
  for (const r of doc.rooms) {
    const [x0, z0, x1, z1] = r.rect;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && (!best || area(r) < area(best))) best = r;
  }
  return best;
}

export function itemDisplayName(item: PalaceItem, catalog: Catalog) {
  // 名字（含默认摆件存下的中文名「干花」等）和目录名都在显示时翻译；用户自己起的名字不在字典里，原样返回
  return (item.name && t(item.name)) || t(catalog[item.type]?.name) || item.type;
}

export function rectArea(r: Rect) {
  return (r[2] - r[0]) * (r[3] - r[1]);
}

function area(r: PalaceRoom) {
  return rectArea(r.rect);
}
