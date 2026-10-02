import { cleanLook, type Look } from './look';
import { gid, boundLoci, type PalaceDoc, type Rect, type Vec2 } from './schema';
import type { PaoTable } from './pao';
import { t } from './i18n';

/* =====================================================================
 * 世界数据：宫殿摆在哪里。
 *   PalaceWorld  一个人的整个记忆世界（将来：群岛 / 小星球）
 *   WorldRegion  一块区域（一期只有一座岛）；theme 决定地形与装饰风格
 *   PlacedPalace 一座宫殿在区域里的位置与朝向
 * 宫殿自身的数据仍然在各自的 PalaceDoc 里，世界只记录摆放关系，
 * 所以删除 / 同步世界文件不会影响宫殿内容。
 * 坐标：区域平面坐标（米），x 向东、z 向南；rot 为绕 y 轴的角度（0 / 90 / 180 / 270）。
 *
 * 版本：
 *   1  区域 + 宫殿摆放
 *   2  旅程 journeys（跨宫殿路线）、数字编码表 pao、小管家 pet；只是新增可选字段，compat 仍为 1
 * ===================================================================== */

export const WORLD_FORMAT = 'kmind-palace-world';
export const WORLD_VERSION = 2;
/** 读取本版本写出的世界数据至少需要的版本（规则同 PALACE_COMPAT） */
export const WORLD_COMPAT = 1;

/** 小管家的默认名字 */
export const PET_NAME = '豆豆';

export type RoofKind = 'auto' | 'flat' | 'gable' | 'none';

export interface PlacedPalace {
  palaceId: string;
  /** 宫殿局部坐标原点在区域中的位置 */
  pos: Vec2;
  rot: number;
  roof?: RoofKind;
  /** 屋顶颜色；不填则用宫殿主题色 */
  roofColor?: string;
}

export interface WorldRegion {
  id: string;
  name: string;
  /** 场景主题：island 海岛 / forest 森林 / snow 雪山 / sky 浮空岛 */
  theme: string;
  /** 地形、树木等随机装饰的种子：同一个种子每次生成的样子都一样 */
  seed: number;
  /** 区域原点（广场中心）在世界中的位置 */
  origin?: Vec2;
  createdAt?: number;
  palaces: PlacedPalace[];
}

export interface PalaceWorld {
  format: typeof WORLD_FORMAT;
  version: number;
  compat?: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  regions: WorldRegion[];
  /** 旅程：把几座宫殿里的路线按顺序串起来，回忆时一座走完接着去下一座 */
  journeys?: PalaceJourney[];
  /** 数字编码表（00–99 的人物 / 动作 / 物件），只存改过的 */
  pao?: PaoTable;
  /** 小管家（宠物）：名字、外观；hidden 时不在宫殿里出现 */
  pet?: { name: string; look: Look; hidden?: boolean };
}

/** 旅程的一段：某座宫殿里的一条路线（routeId 为 'auto' 时是那座宫殿的「全部记忆桩」默认路线） */
export interface JourneyLeg {
  palaceId: string;
  routeId: string;
}

export interface PalaceJourney {
  id: string;
  name: string;
  legs: JourneyLeg[];
}

/** 宫殿主题色（名牌圆点、屋顶） */
export const PALACE_COLORS = ['#c46d4d', '#3e4d66', '#5f7a6c', '#b8563c', '#6d4a3a', '#8a6aa0', '#c9973f', '#4f7f8a', '#9a5b6e', '#6b7a3e'];

/** 小镇中心广场的半径（宫殿不能压到广场） */
export const PLAZA_R = 6;
/** 两座宫殿地块之间至少留出的路宽 */
export const LOT_GAP = 3;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function palaceColor(doc: Pick<PalaceDoc, 'id' | 'color'>) {
  return doc.color || PALACE_COLORS[hash(doc.id) % PALACE_COLORS.length];
}

export function createWorld(): PalaceWorld {
  const now = Date.now();
  return {
    format: WORLD_FORMAT, version: WORLD_VERSION, compat: WORLD_COMPAT, id: gid('world-'), name: t('记忆世界'), createdAt: now, updatedAt: now,
    regions: [createRegion()],
  };
}

export function createRegion(name = t('岛上小镇'), theme = 'island', origin: Vec2 = [0, 0]): WorldRegion {
  return { id: gid('region-'), name, theme, seed: Math.floor(Math.random() * 1e6), origin, createdAt: Date.now(), palaces: [] };
}

/** 各主题的默认岛名（模块常量，显示 / 使用时再 t()） */
export const THEME_NAMES: Record<string, string> = { island: '岛上小镇', forest: '林间小岛', snow: '雪山小岛', sky: '浮空小岛' };

/** 浮空岛整体悬在海面上方 */
const THEME_LIFT: Record<string, number> = { sky: 14 };
export function regionLift(r: Pick<WorldRegion, 'theme'>) {
  return THEME_LIFT[r.theme] || 0;
}

export function regionOrigin(r: WorldRegion): Vec2 {
  return r.origin || [0, 0];
}

/** 校验并规范化外部数据；无法识别时抛出错误 */
export function normalizeWorld(raw: unknown): PalaceWorld {
  const w = raw as PalaceWorld;
  if (!w || typeof w !== 'object' || w.format !== WORLD_FORMAT) throw new Error(t('不是有效的世界数据'));
  const version = Number(w.version) || 1, compat = Number(w.compat) || version;
  if (compat > WORLD_VERSION) throw new Error(t('世界数据需要更新版本的插件才能打开（数据要求 {need}，当前支持 {have}），请升级插件', { need: compat, have: WORLD_VERSION }));
  const regions: WorldRegion[] = (Array.isArray(w.regions) ? w.regions : []).map(r => ({
    ...r,
    theme: r.theme || 'island',
    seed: Number.isFinite(r.seed) ? r.seed : 1,
    origin: (Array.isArray(r.origin) ? r.origin : [0, 0]) as Vec2,
    palaces: (Array.isArray(r.palaces) ? r.palaces : []).filter(p => p && p.palaceId && Array.isArray(p.pos)).map(p => ({ ...p, rot: normRot(p.rot) })),
  }));
  if (!regions.length) regions.push(createRegion());
  const out: PalaceWorld = { ...w, version: Math.max(version, WORLD_VERSION), compat: Math.max(Number(w.compat) || 0, WORLD_COMPAT), regions };
  const journeys = (Array.isArray(w.journeys) ? w.journeys : [])
    .filter(j => j && typeof j.id === 'string' && Array.isArray(j.legs))
    .map(j => ({ ...j, name: typeof j.name === 'string' && j.name ? j.name : t('旅程'), legs: j.legs.filter(l => l && typeof l.palaceId === 'string' && typeof l.routeId === 'string').map(l => ({ ...l })) }));
  if (journeys.length) out.journeys = journeys; else delete out.journeys;
  const codes: PaoTable['codes'] = {};
  for (const [k, e] of Object.entries((w.pao && typeof w.pao === 'object' && w.pao.codes) || {})) {
    if (!/^\d\d$/.test(k) || !e || typeof e !== 'object') continue;
    const c: Record<string, string> = {};
    for (const f of ['p', 'a', 'o'] as const) if (typeof e[f] === 'string' && e[f].trim()) c[f] = e[f].trim().slice(0, 20);
    if (Object.keys(c).length) codes[k] = c;
  }
  if (Object.keys(codes).length) out.pao = { codes }; else delete out.pao;
  if (w.pet && typeof w.pet === 'object') {
    out.pet = { name: typeof w.pet.name === 'string' && w.pet.name.trim() ? w.pet.name.trim().slice(0, 20) : t(PET_NAME), look: cleanLook(w.pet.look) };
    if (w.pet.hidden) out.pet.hidden = true;
  } else delete out.pet;
  return out;
}

export function cloneWorld(w: PalaceWorld): PalaceWorld {
  return JSON.parse(JSON.stringify(w));
}

export function normRot(r: number) {
  return ((Math.round((r || 0) / 90) * 90) % 360 + 360) % 360;
}

// =====================================================================
// 坐标变换：宫殿局部 ↔ 区域
// =====================================================================

/** 与 three.js 的 rotation.y 一致：x' = x·cos + z·sin，z' = −x·sin + z·cos */
function cs(rot: number): [number, number] {
  switch (normRot(rot)) {
    case 90: return [0, 1];
    case 180: return [-1, 0];
    case 270: return [0, -1];
    default: return [1, 0];
  }
}

export function rotateVec(rot: number, x: number, z: number): Vec2 {
  const [c, s] = cs(rot);
  return [x * c + z * s, -x * s + z * c];
}

export function toRegion(p: Pick<PlacedPalace, 'pos' | 'rot'>, x: number, z: number): Vec2 {
  const [rx, rz] = rotateVec(p.rot, x, z);
  return [p.pos[0] + rx, p.pos[1] + rz];
}

export function toLocal(p: Pick<PlacedPalace, 'pos' | 'rot'>, x: number, z: number): Vec2 {
  return rotateVec(-p.rot, x - p.pos[0], z - p.pos[1]);
}

export function rectToRegion(p: Pick<PlacedPalace, 'pos' | 'rot'>, r: Rect): Rect {
  const [ax, az] = toRegion(p, r[0], r[1]), [bx, bz] = toRegion(p, r[2], r[3]);
  return [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)];
}

// =====================================================================
// 宫殿的占地
// =====================================================================

/** 室内房间（有地面、非室外） */
export function indoorRects(doc: PalaceDoc): Rect[] {
  return doc.rooms.filter(r => r.floor && !r.outdoor).map(r => r.rect);
}

export function bboxOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  return [
    Math.min(...rects.map(r => r[0])), Math.min(...rects.map(r => r[1])),
    Math.max(...rects.map(r => r[2])), Math.max(...rects.map(r => r[3])),
  ];
}

/** 宫殿的地块（局部坐标）：有地基就用地基，否则房间外扩 1.2 m */
export function palaceLot(doc: PalaceDoc): Rect {
  if (doc.ground?.plinth) return [...doc.ground.plinth] as Rect;
  const b = bboxOf(doc.rooms.filter(r => r.floor).map(r => r.rect));
  if (!b) return [-3, -3, 3, 3];
  return [b[0] - 1.2, b[1] - 1.2, b[2] + 1.2, b[3] + 1.2];
}

export function rectCenter(r: Rect): Vec2 {
  return [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0) {
  return a[0] < b[2] + gap && a[2] + gap > b[0] && a[1] < b[3] + gap && a[3] + gap > b[1];
}

function rectCircleDist(r: Rect, cx: number, cz: number) {
  const dx = Math.max(r[0] - cx, 0, cx - r[2]), dz = Math.max(r[1] - cz, 0, cz - r[3]);
  return Math.hypot(dx, dz);
}

/**
 * 入户门：优先 front，其次外墙上的普通门 / 推拉门。
 * 返回门洞中心（墙外表面上）与朝外的法线（局部坐标）。
 */
export function frontDoor(doc: PalaceDoc): { x: number; z: number; nx: number; nz: number; w: number } | null {
  for (const kinds of [['front'], ['door', 'slide']]) {
    for (const w of doc.walls) {
      if (!w.normal) continue;
      const o = w.openings?.find(o => kinds.includes(o.kind));
      if (!o) continue;
      const axisX = Math.abs(w.a[1] - w.b[1]) < 1e-6;
      const c = axisX ? w.a[1] : w.a[0], s = (o.s0 + o.s1) / 2, t = (w.thickness ?? .2) / 2;
      const [nx, nz] = w.normal;
      return axisX
        ? { x: s, z: c + nz * t, nx, nz, w: o.s1 - o.s0 }
        : { x: c + nx * t, z: s, nx, nz, w: o.s1 - o.s0 };
    }
  }
  return null;
}

export interface PalaceStats { rooms: number; items: number; loci: number }

export function palaceStats(doc: PalaceDoc): PalaceStats {
  return {
    rooms: doc.rooms.filter(r => r.floor).length,
    items: doc.items.length,
    loci: boundLoci(doc).length,
  };
}

// =====================================================================
// 摆放：碰撞检查、自动找空地、与宫殿列表同步
// =====================================================================

export function placedLot(p: PlacedPalace, doc: PalaceDoc): Rect {
  return rectToRegion(p, palaceLot(doc));
}

/** 这个摆放位置是否可用：不压广场、不和其他宫殿的地块（留出路宽）重叠 */
export function canPlace(region: WorldRegion, docs: Map<string, PalaceDoc>, p: PlacedPalace, doc: PalaceDoc, ignoreId = p.palaceId) {
  const lot = placedLot(p, doc);
  if (rectCircleDist(lot, 0, 0) < PLAZA_R + 2) return false;
  for (const q of region.palaces) {
    if (q.palaceId === ignoreId) continue;
    const d = docs.get(q.palaceId);
    if (d && rectsOverlap(lot, placedLot(q, d), LOT_GAP)) return false;
  }
  return true;
}

/** 让宫殿地块中心落在 (cx, cz) 附近时的 pos（取整到 1 m 网格） */
export function posForLotCenter(doc: PalaceDoc, rot: number, cx: number, cz: number): Vec2 {
  const [lx, lz] = rectCenter(palaceLot(doc));
  const [rx, rz] = rotateVec(rot, lx, lz);
  return [Math.round(cx - rx), Math.round(cz - rz)];
}

/** 以 near 为中心向外螺旋搜索第一个可用位置（1 m 网格） */
export function findFreeSpot(region: WorldRegion, docs: Map<string, PalaceDoc>, doc: PalaceDoc, rot = 0, near: Vec2 = [0, 0]): Vec2 {
  const test = (cx: number, cz: number) => {
    const pos = posForLotCenter(doc, rot, cx, cz);
    return canPlace(region, docs, { palaceId: doc.id, pos, rot }, doc) ? pos : null;
  };
  const hit = test(near[0], near[1]);
  if (hit) return hit;
  for (let r = 1; r < 400; r++) {
    // 同一圈里按角度从正北开始顺时针，结果稳定可预期
    const cands: [number, number, number][] = [];
    for (let i = -r; i <= r; i++) {
      for (const [dx, dz] of [[i, -r], [i, r], [-r, i], [r, i]] as [number, number][]) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        cands.push([dx, dz, Math.atan2(dx, -dz)]);
      }
    }
    const ang = (a: number) => (a + Math.PI * 2) % (Math.PI * 2);
    cands.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]) || ang(a[2]) - ang(b[2]));
    for (const [dx, dz] of cands) {
      const pos = test(near[0] + dx, near[1] + dz);
      if (pos) return pos;
    }
  }
  return [near[0], near[1]];
}

/** 主区域（第一座岛；新同步来的宫殿默认放这里） */
export function mainRegion(world: PalaceWorld): WorldRegion {
  if (!world.regions.length) world.regions.push(createRegion());
  return world.regions[0];
}

export function findPlacement(world: PalaceWorld, palaceId: string) {
  for (const region of world.regions) {
    const p = region.palaces.find(p => p.palaceId === palaceId);
    if (p) return { region, placed: p };
  }
  return null;
}

/**
 * 让世界和宫殿列表保持一致：
 * - 新出现的宫殿（例如老版本升级、其他端新建后同步过来）→ 自动找空地放下
 * - 重复的摆放记录 → 去重
 * - 世界里记着、但宫殿文件暂时读不到的 → 保留位置（可能正在同步），渲染时跳过
 *   （用户在界面里删除宫殿时会显式移除它的摆放）
 * 返回是否有改动。
 */
export function syncWorld(world: PalaceWorld, docs: Map<string, PalaceDoc>): boolean {
  let changed = false;
  const placed = new Set<string>();
  for (const region of world.regions) {
    const keep = region.palaces.filter(p => !placed.has(p.palaceId));
    if (keep.length !== region.palaces.length) { region.palaces = keep; changed = true; }
    keep.forEach(p => placed.add(p.palaceId));
  }
  const region = mainRegion(world);
  const fresh = [...docs.values()].filter(d => !placed.has(d.id)).sort((a, b) => a.createdAt - b.createdAt);
  for (const doc of fresh) {
    region.palaces.push({ palaceId: doc.id, pos: findFreeSpot(region, docs, doc), rot: 0 });
    changed = true;
  }
  if (changed) world.updatedAt = Date.now();
  return changed;
}

/** 区域里所有宫殿地块的外包矩形（含广场） */
export function regionExtent(region: WorldRegion, docs: Map<string, PalaceDoc>): Rect {
  const rects: Rect[] = [[-PLAZA_R, -PLAZA_R, PLAZA_R, PLAZA_R]];
  for (const p of region.palaces) {
    const d = docs.get(p.palaceId);
    if (d) rects.push(placedLot(p, d));
  }
  return bboxOf(rects).map(r3) as Rect;
}

// =====================================================================
// 群岛：多座岛在世界里的摆放
// =====================================================================

/** 岛之间至少留出的海面宽度 */
export const SEA_GAP = 16;

export function regionOfPalace(world: PalaceWorld, palaceId: string) {
  return world.regions.find(r => r.palaces.some(p => p.palaceId === palaceId)) || null;
}

/**
 * 岛的外接圆（世界坐标）。实际半径由地形生成后给出（radii），
 * 没有时按宫殿占地估算（与地形生成的外扩规则一致）。
 */
export function regionCircle(region: WorldRegion, docs: Map<string, PalaceDoc>, radii?: Map<string, number>) {
  const ext = regionExtent(region, docs);
  const [cx, cz] = rectCenter(ext);
  const [ox, oz] = regionOrigin(region);
  const est = Math.max(Math.hypot(ext[2] - ext[0], ext[3] - ext[1]) / 2 + 10, 24) + 9;
  return { x: ox + cx, z: oz + cz, r: radii?.get(region.id) ?? est };
}

/** 给一座新岛找位置：从已有岛群的中心向外螺旋搜索，不与其他岛重叠 */
export function findRegionSpot(world: PalaceWorld, docs: Map<string, PalaceDoc>, region: WorldRegion, radii?: Map<string, number>): Vec2 {
  const others = world.regions.filter(r => r !== region).map(r => regionCircle(r, docs, radii));
  if (!others.length) return [0, 0];
  const me = regionCircle({ ...region, origin: [0, 0] }, docs, radii);
  const cx = others.reduce((s, c) => s + c.x, 0) / others.length, cz = others.reduce((s, c) => s + c.z, 0) / others.length;
  for (let r = 0; r < 2000; r += 6) {
    const steps = Math.max(1, Math.round(r / 6));
    for (let i = 0; i < steps * 4; i++) {
      // 从东南方向（镜头朝向）开始，新岛更容易出现在视野里
      const a = Math.PI / 4 + i / (steps * 4) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (others.every(o => Math.hypot(o.x - x, o.z - z) >= o.r + me.r + SEA_GAP)) {
        return [Math.round(x - me.x), Math.round(z - me.z)];
      }
    }
  }
  return [0, 0];
}

/**
 * 岛长大后可能和邻岛挤在一起：把后建的岛沿连线方向推开。
 * 返回是否移动过（需要保存世界）。
 */
export function settleRegions(world: PalaceWorld, docs: Map<string, PalaceDoc>, radii?: Map<string, number>): boolean {
  let moved = false;
  for (let pass = 0; pass < 24; pass++) {
    let any = false;
    const cs = world.regions.map(r => regionCircle(r, docs, radii));
    for (let i = 0; i < world.regions.length; i++) {
      for (let j = i + 1; j < world.regions.length; j++) {
        const a = cs[i], b = cs[j];
        const need = a.r + b.r + SEA_GAP, d = Math.hypot(b.x - a.x, b.z - a.z);
        if (d >= need - .5) continue;
        const ux = d > .01 ? (b.x - a.x) / d : 1, uz = d > .01 ? (b.z - a.z) / d : 0;
        const push = need - d + 1;
        const o = regionOrigin(world.regions[j]);
        world.regions[j].origin = [Math.round(o[0] + ux * push), Math.round(o[1] + uz * push)];
        cs[j] = regionCircle(world.regions[j], docs, radii);
        any = moved = true;
      }
    }
    if (!any) break;
  }
  if (moved) world.updatedAt = Date.now();
  return moved;
}

/** 把一座宫殿搬到另一座岛上（自动找空地）；返回新的摆放 */
export function movePalaceToRegion(world: PalaceWorld, docs: Map<string, PalaceDoc>, palaceId: string, targetId: string): PlacedPalace | null {
  const from = regionOfPalace(world, palaceId), to = world.regions.find(r => r.id === targetId), doc = docs.get(palaceId);
  if (!from || !to || !doc || from === to) return null;
  const old = from.palaces.find(p => p.palaceId === palaceId);
  from.palaces = from.palaces.filter(p => p.palaceId !== palaceId);
  const placed: PlacedPalace = { ...old, palaceId, pos: findFreeSpot(to, docs, doc, 0), rot: 0 };
  to.palaces.push(placed);
  world.updatedAt = Date.now();
  return placed;
}
