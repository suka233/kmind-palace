/* =====================================================================
 * 宫殿数据格式（与宿主无关）
 * 单位：米。平面坐标 x 向东、z 向南，y 向上。旋转角度单位：度（绕 y 轴）。
 * 物件构建函数以「底部中心为原点、正面朝 +z」建模。
 * ===================================================================== */

import { materializeDecor } from './decor';
import type { NumberSet } from './pao';
import { t } from './i18n';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Rect = [number, number, number, number]; // x0, z0, x1, z1

export const PALACE_FORMAT = 'kmind-palace';
/**
 * 数据版本。读到更高版本时拒绝加载（提示升级插件），读到低版本时在 normalizePalace 里逐级迁移。
 *   1  初版
 *   2  物件可以挂在父物件上（parent，pos / rot 相对父物件）；绑定按部件存（bindings）；记忆路线（routes）
 *   3  家具默认的摆件（茶几上的书、餐桌上的花瓶……）变成真正的子物件，家具标 params.decor = false
 *   4  compat（最低可读版本）；笔记来源 src；绑定可以公开（share）；媒体 id 改为内容哈希
 *   5  数字组 numbers（数字记忆）；只是新增可选字段，compat 仍为 4
 *
 * 兼容规则：读取时只看 compat（旧数据没有 compat 时看 version）。
 * 只新增可选字段的改动只提高 PALACE_VERSION；会让旧版本读错的改动才提高 PALACE_COMPAT。
 * 这样好友之间插件版本不一样时，串门大多数情况下仍然打得开。
 */
export const PALACE_VERSION = 5;
/** 读取本版本写出的数据，至少需要的版本 */
export const PALACE_COMPAT = 4;

export type FloorKind = 'oak' | 'oakWarm' | 'deck' | 'tileLarge' | 'tileBath' | 'cement';

export interface PalaceRoom {
  id: string;
  name: string;
  en?: string;
  rect: Rect;
  /** 地面材质；不填则不铺地面（例如庭院） */
  floor?: FloorKind;
  /** 房间名标签位置（平面坐标）；null 表示不显示标签 */
  label?: Vec2 | null;
  /** 室外区域：漫游时不加天花板 */
  outdoor?: boolean;
}

export interface WallOpening {
  /** 沿墙方向的起止坐标（x 向墙用 x，z 向墙用 z） */
  s0: number;
  s1: number;
  y0: number;
  y1: number;
  kind: 'window' | 'door' | 'front' | 'slide';
  /** 门的开启方向：+1 / -1（沿墙的法线方向） */
  swing?: 1 | -1;
  curtain?: boolean;
  curtainColor?: string;
}

export interface WallPaint {
  /** 刷在墙的哪一侧：+1 = +z/+x 一侧，-1 = 另一侧 */
  side: 1 | -1;
  s0: number;
  s1: number;
  y0?: number;
  y1?: number;
  color?: string;
  texture?: 'subway' | 'bathWall';
  /** 贴图平铺尺寸（米） */
  tile?: number;
}

export interface PalaceWall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness?: number;
  /** 外墙朝外的法线；内墙不填 */
  normal?: Vec2;
  openings?: WallOpening[];
  paint?: WallPaint[];
}

/** 记忆桩绑定：物件（或物件的一个部件）→ 宿主中的一个笔记块 */
export interface LocusBinding {
  blockId: string;
  title?: string;
  boundAt?: number;
  /** 记忆故事：把笔记内容变成发生在这个位置上的一个小场景（自己写或 AI 编） */
  story?: string;
  /** 故事配图（媒体 id） */
  image?: string;
  /** 故事写回笔记后，笔记里那一块的 id（再写一次时更新它） */
  storyNote?: string;
  /** 笔记来源（见 PalaceDoc.src）；不填表示和宫殿相同 */
  src?: string;
  /** 公开这个记忆桩：发布 / 串门时访客能看到它的标题和记忆故事（笔记本身永远不会离开本机） */
  share?: boolean;
}

export interface PalaceItem {
  id: string;
  /** 物件类型，对应 catalog 中的构建函数 */
  type: string;
  name?: string;
  /** 所在房间 id */
  room?: string;
  /** 父物件 id：放在另一件物件上（书架上的花瓶、茶几上的托盘），随父物件移动；pos / rot 是相对父物件的 */
  parent?: string;
  pos: Vec3;
  rot?: number;
  params?: Record<string, any>;
  /** 挂在哪面墙上（墙被剖切时随墙隐藏） */
  wall?: string;
  solid?: boolean;
  pickable?: boolean;
  /**
   * 记忆桩绑定，按部件存：键是部件编号（slot），'' 表示整件物件。
   * 部件编号由物件的构建函数定义，例如书架上的一本书 'b:2:5'（第 2 层第 5 本，从下往上、从左往右数，从 0 开始）。
   */
  bindings?: Record<string, LocusBinding>;
}

export interface PalaceGround {
  plinth: Rect;
  slabs: Rect[];
}

export interface PalaceDoc {
  format: typeof PALACE_FORMAT;
  version: number;
  /** 读取这份数据至少需要的版本 */
  compat?: number;
  /**
   * 绑定的笔记默认来自哪里：'siyuan'（思源）、以后还有 'obsidian:<库名>' 等。
   * 块 id 在不同的工作空间之间本来就不会重复，所以这里只区分笔记软件；绑定上可以单独覆盖。
   */
  src?: string;
  id: string;
  name: string;
  /** 主题色（小镇里的名牌、屋顶）；不填则按 id 从调色板里取 */
  color?: string;
  createdAt: number;
  updatedAt: number;
  wallHeight?: number;
  ground?: PalaceGround;
  rooms: PalaceRoom[];
  walls: PalaceWall[];
  items: PalaceItem[];
  /** 记忆路线：按顺序经过的记忆桩 */
  routes?: PalaceRoute[];
  /** 数字组：一串要背的数字沿路线摆成一个个画面（见 pao.ts） */
  numbers?: NumberSet[];
}

export interface PalaceRoute {
  id: string;
  name: string;
  /** 依次经过的记忆桩（locusKey：物件 id，或「物件 id#部件编号」） */
  stops: string[];
}

/** 笔记来源的显示名 */
export function noteSourceName(src: string | undefined) {
  if (!src) return t('其他笔记软件');
  if (src === 'siyuan') return t('思源笔记');
  if (src.startsWith('obsidian')) return src.includes(':') ? t('Obsidian（{vault}）', { vault: src.slice(src.indexOf(':') + 1) }) : 'Obsidian';
  return src;
}

/** 宫殿内唯一的 id（物件、房间、墙体） */
export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
/** 全局唯一的 id（宫殿、岛、世界、路线）：16 位加密随机数 */
export function gid(prefix = '') {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ID_CHARS[b % 36];
  return prefix + s;
}

/** 从版本 n 升到 n + 1 */
const MIGRATIONS: Record<number, (d: any) => void> = {
  2(d) {
    // 家具写死的摆件 → 子物件（旧版插件会把它们画两遍，所以要升版本）
    materializeDecor(d.items);
  },
  3(d) {
    // 之前的宫殿都是在思源插件里建的
    if (!d.src) d.src = 'siyuan';
  },
  1(d) {
    // 单个 binding → 按部件的 bindings（'' = 整件物件）
    for (const it of d.items) {
      if (it.binding?.blockId) it.bindings = { '': it.binding };
      delete it.binding;
    }
  },
};

/** 校验并规范化外部数据（返回新对象，不改动传入的数据）；低版本逐级迁移；无法识别时抛出错误 */
/** 数据是更新版本的插件写的（错误对象上的 code）：调用方据此提示升级，不靠匹配错误文字 */
export const NEWER_VERSION = 'kp-newer-version';

export function normalizePalace(raw: unknown): PalaceDoc {
  const src = raw as PalaceDoc;
  if (!src || typeof src !== 'object' || src.format !== PALACE_FORMAT) throw new Error(t('不是有效的宫殿数据'));
  const version = Number(src.version) || 1;
  // 旧数据没有 compat：按 version 判断
  const compat = Number(src.compat) || version;
  if (compat > PALACE_VERSION) throw Object.assign(new Error(t('这座宫殿需要更新版本的插件才能打开（数据要求 {need}，当前支持 {have}），请升级插件', { need: compat, have: PALACE_VERSION })), { code: NEWER_VERSION });
  const d: PalaceDoc = JSON.parse(JSON.stringify(src));
  d.rooms = Array.isArray(d.rooms) ? d.rooms : [];
  d.walls = Array.isArray(d.walls) ? d.walls : [];
  d.items = Array.isArray(d.items) ? d.items.filter(i => i && typeof i === 'object' && i.id && i.type && Array.isArray(i.pos)) : [];
  for (let v = version; v < PALACE_VERSION; v++) MIGRATIONS[v]?.(d);
  // 更新版本写的、但声明兼容的数据：原样保留它的版本号和不认识的字段
  d.version = Math.max(version, PALACE_VERSION);
  d.compat = Math.max(Number(src.compat) || 0, PALACE_COMPAT);
  for (const it of d.items) {
    if (!it.bindings) continue;
    for (const [slot, b] of Object.entries(it.bindings)) if (!b?.blockId) delete it.bindings[slot];
    if (!Object.keys(it.bindings).length) delete it.bindings;
  }
  repairTree(d.items);
  if (d.routes !== undefined) {
    d.routes = Array.isArray(d.routes) ? d.routes.filter(r => r && r.id && Array.isArray(r.stops)) : [];
  }
  if (d.numbers !== undefined) {
    d.numbers = (Array.isArray(d.numbers) ? d.numbers : [])
      .filter(n => n && typeof n.id === 'string' && typeof n.digits === 'string')
      .map(n => ({ ...n, digits: n.digits.replace(/\D+/g, ''), mode: n.mode === 'images' ? 'images' : 'pao', route: typeof n.route === 'string' ? n.route : 'all' }));
    if (!d.numbers.length) delete d.numbers;
  }
  return d;
}

export function clonePalace(d: PalaceDoc): PalaceDoc {
  return JSON.parse(JSON.stringify(d));
}

// =====================================================================
// 记忆桩：物件 + 部件
// =====================================================================

/** 记忆桩的键：整件物件就是物件 id，部件是「物件 id#部件编号」 */
export function locusKey(itemId: string, slot = '') {
  return slot ? `${itemId}#${slot}` : itemId;
}

export function parseLocus(key: string): { itemId: string; slot: string } {
  const i = key.indexOf('#');
  return i < 0 ? { itemId: key, slot: '' } : { itemId: key.slice(0, i), slot: key.slice(i + 1) };
}

export function getBinding(item: PalaceItem | null | undefined, slot = ''): LocusBinding | null {
  const b = item?.bindings?.[slot];
  return b?.blockId ? b : null;
}

/** 绑定 / 解绑（b 为 null）一个部件；没有任何绑定时去掉 bindings 字段 */
export function setBinding(item: PalaceItem, slot: string, b: LocusBinding | null) {
  if (b) {
    item.bindings = { ...(item.bindings || {}), [slot]: b };
  } else if (item.bindings) {
    delete item.bindings[slot];
    if (!Object.keys(item.bindings).length) delete item.bindings;
  }
}

export interface BoundLocus {
  item: PalaceItem;
  /** 部件编号；'' 表示整件物件 */
  slot: string;
  binding: LocusBinding;
}

const slotOrder = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** 一件物件上的全部绑定：整件在前，部件按编号排序 */
export function itemLoci(item: PalaceItem): BoundLocus[] {
  if (!item.bindings) return [];
  return Object.keys(item.bindings).filter(s => item.bindings[s]?.blockId).sort(slotOrder)
    .map(slot => ({ item, slot, binding: item.bindings[slot] }));
}

/** 宫殿里的全部记忆桩（按物件顺序） */
export function boundLoci(d: PalaceDoc): BoundLocus[] {
  return d.items.flatMap(itemLoci);
}

/**
 * 笔记 id 变了（Obsidian 里文件 / 文件夹改名时，路径就是 id）：改写宫殿里所有引用笔记的地方——
 * 绑定的块和写回的笔记、笔记本书架上「文档书」的部件编号（doc:<id>）、路线里的这些部件、书架的书目文件夹。
 * f 返回新的 id，不变时返回 null。返回是否有改动。
 */
export function remapNoteIds(d: PalaceDoc, f: (id: string) => string | null): boolean {
  let changed = false;
  const map = (id: string | undefined) => {
    if (!id) return id;
    const to = f(id);
    if (to && to !== id) { changed = true; return to; }
    return id;
  };
  const mapSlot = (slot: string) => (slot.startsWith('doc:') ? 'doc:' + map(slot.slice(4)) : slot);
  for (const it of d.items) {
    if (it.bindings) {
      const next: Record<string, LocusBinding> = {};
      for (const [slot, b] of Object.entries(it.bindings)) {
        if (b) { b.blockId = map(b.blockId); if (b.storyNote) b.storyNote = map(b.storyNote); }
        next[mapSlot(slot)] = b;
      }
      it.bindings = next;
    }
    const src = it.params?.source;
    if (src && typeof src.path === 'string' && src.path !== '/') src.path = map(src.path);
    // 书架上单本书的覆盖（doc:<id>）
    const books = it.params?.books;
    if (books && typeof books === 'object') it.params.books = Object.fromEntries(Object.entries(books).map(([k, v]) => [mapSlot(k), v]));
  }
  for (const r of d.routes || []) {
    r.stops = r.stops.map(k => { const { itemId, slot } = parseLocus(k); return locusKey(itemId, mapSlot(slot)); });
  }
  return changed;
}

/** 物件参数里引用媒体文件的键（照片、模型），按物件类型 */
export const MEDIA_PARAMS: Record<string, string[]> = { painting: ['photo'], photoFrame: ['photo'], model: ['src'], rug: ['photo'], poster: ['photo'], mediaConsole: ['photo'] };

/** 宫殿引用的全部媒体 id（物件的照片 / 模型、记忆故事的配图），去重 */
export function palaceMedia(d: PalaceDoc): string[] {
  const out = new Set<string>();
  for (const it of d.items) {
    for (const k of MEDIA_PARAMS[it.type] || []) if (typeof it.params?.[k] === 'string' && it.params[k]) out.add(it.params[k]);
    for (const b of Object.values(it.bindings || {})) if (b?.image) out.add(b.image);
  }
  return [...out];
}

export function hasBindings(item: PalaceItem) {
  return !!item.bindings && Object.values(item.bindings).some(b => b?.blockId);
}

// =====================================================================
// 物件树：父物件 / 子物件
// 旋转只绕 y 轴；与 three.js 一致，rot = θ 时局部 (x, z) → 父坐标 (x cosθ + z sinθ, −x sinθ + z cosθ)
// =====================================================================

const DEG = Math.PI / 180;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** 角度归一到 (−180, 180]，取整到 1° */
export const normDeg = (d: number) => { const r = Math.round(((d % 360) + 540) % 360 - 180); return r === -180 ? 180 : r; };

function rotY(x: number, z: number, deg: number): [number, number] {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [x * c + z * s, -x * s + z * c];
}

function itemMap(items: PalaceItem[]) {
  return new Map(items.map(i => [i.id, i]));
}

/** 去掉指向不存在物件的 parent，并打断环（数据损坏或手工编辑时） */
export function repairTree(items: PalaceItem[]) {
  const byId = itemMap(items);
  for (const it of items) {
    if (it.parent !== undefined && (!it.parent || !byId.has(it.parent) || it.parent === it.id)) delete it.parent;
  }
  for (const it of items) {
    const seen = new Set<string>([it.id]);
    let p = it.parent && byId.get(it.parent);
    while (p) {
      if (seen.has(p.id)) { delete it.parent; break; }
      seen.add(p.id);
      p = p.parent && byId.get(p.parent);
    }
  }
}

export function childrenOf(items: PalaceItem[], id: string) {
  return items.filter(i => i.parent === id);
}

/** 物件自己 + 全部子孙（父在前） */
export function subtree(items: PalaceItem[], id: string): PalaceItem[] {
  const root = items.find(i => i.id === id);
  if (!root) return [];
  const out = [root];
  for (let k = 0; k < out.length; k++) out.push(...childrenOf(items, out[k].id));
  return out;
}

/** a 是否是 b 自己或 b 的子孙 */
export function isInSubtree(items: PalaceItem[], a: string, b: string) {
  const byId = itemMap(items);
  let p = byId.get(a);
  for (let guard = 0; p && guard < 1000; guard++) {
    if (p.id === b) return true;
    p = p.parent ? byId.get(p.parent) : undefined;
  }
  return false;
}

/** 物件在宫殿坐标系里的位置和朝向（沿父物件链换算） */
export function itemPose(items: PalaceItem[], item: PalaceItem): { pos: Vec3; rot: number } {
  const byId = itemMap(items);
  let [x, y, z] = item.pos, rot = item.rot || 0;
  let p = item.parent ? byId.get(item.parent) : undefined;
  for (let guard = 0; p && guard < 1000; guard++) {
    const [rx, rz] = rotY(x, z, p.rot || 0);
    x = rx + p.pos[0]; y += p.pos[1]; z = rz + p.pos[2];
    rot += p.rot || 0;
    p = p.parent ? byId.get(p.parent) : undefined;
  }
  return { pos: [x, y, z], rot: normDeg(rot) };
}

/**
 * 按宫殿坐标摆放物件，并挂到 parentId 下（null / undefined = 直接放在地面上）。
 * 存进数据的是相对父物件的局部坐标。父物件不能是自己或自己的子孙（返回 false，不做改动）。
 */
export function setItemPose(items: PalaceItem[], item: PalaceItem, pos: Vec3, rot: number, parentId?: string | null) {
  const parent = parentId ? items.find(i => i.id === parentId) : undefined;
  if (parentId && (!parent || isInSubtree(items, parentId, item.id))) return false;
  let [x, y, z] = pos, r = rot;
  if (parent) {
    const pp = itemPose(items, parent);
    [x, z] = rotY(x - pp.pos[0], z - pp.pos[2], -pp.rot);
    y -= pp.pos[1];
    r -= pp.rot;
    item.parent = parent.id;
  } else delete item.parent;
  item.pos = [round3(x), round3(y), round3(z)];
  item.rot = normDeg(r);
  return true;
}

/** 换父物件（或放回地面），保持物件在宫殿里的位置和朝向不变 */
export function setItemParent(items: PalaceItem[], item: PalaceItem, parentId: string | null) {
  const pose = itemPose(items, item);
  return setItemPose(items, item, pose.pos, pose.rot, parentId);
}
