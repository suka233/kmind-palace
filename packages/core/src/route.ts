import { boundLoci, getBinding, itemPose, locusKey, parseLocus, type LocusBinding, type PalaceDoc, type PalaceItem, type PalaceRoute } from './schema';
import { frontDoor } from './world';
import type { ReviewState } from './host';
import { t } from './i18n';

/* =====================================================================
 * 记忆路线与复习状态（纯数据，与 three.js 无关）
 * 路线就是按顺序经过的记忆桩；没有保存过路线时，用「按位置自动排」的默认路线：
 * 从正门出发，每次走到最近的下一个记忆桩（换房间多算几米），再用 2-opt 去掉交叉。
 * ===================================================================== */

export interface RouteStop {
  key: string;
  item: PalaceItem;
  slot: string;
  /** 这一站目前绑定的笔记；解绑后仍留在路线里，回忆时跳过 */
  binding: LocusBinding | null;
}

/** 默认路线（不保存，随记忆桩变化）的 id */
export const AUTO_ROUTE_ID = 'auto';

/** 同一件物件上部件的先后（书架：从上往下、从左往右） */
export type SlotSort = (item: PalaceItem, a: string, b: string) => number;

/** 换房间多算的距离（米）：让路线先走完一个房间再去下一个 */
const ROOM_PENALTY = 3;

/** 把路线解析成一站站：跳过已删除的物件和重复的站 */
export function resolveRoute(doc: PalaceDoc, route: Pick<PalaceRoute, 'stops'>): RouteStop[] {
  const byId = new Map(doc.items.map(i => [i.id, i]));
  const seen = new Set<string>();
  const out: RouteStop[] = [];
  for (const key of route.stops) {
    if (seen.has(key)) continue;
    seen.add(key);
    const { itemId, slot } = parseLocus(key);
    const item = byId.get(itemId);
    if (item) out.push({ key, item, slot, binding: getBinding(item, slot) });
  }
  return out;
}

/** 宫殿的路线：保存过的路线；一条都没有时是默认路线 */
export function routesOf(doc: PalaceDoc, slotSort?: SlotSort): PalaceRoute[] {
  if (doc.routes?.length) return doc.routes;
  return [{ id: AUTO_ROUTE_ID, name: t('全部记忆桩'), stops: autoRoute(doc, slotSort) }];
}

/** 按位置给全部记忆桩排一条路线 */
export function autoRoute(doc: PalaceDoc, slotSort?: SlotSort): string[] {
  const groups = new Map<string, { item: PalaceItem; slots: string[] }>();
  for (const l of boundLoci(doc)) {
    const g = groups.get(l.item.id) || { item: l.item, slots: [] };
    g.slots.push(l.slot);
    groups.set(l.item.id, g);
  }
  if (!groups.size) return [];
  const nodes = [...groups.values()].map(g => {
    const p = itemPose(doc.items, g.item).pos;
    const slots = [...g.slots].sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0) || (slotSort ? slotSort(g.item, a, b) : a.localeCompare(b, 'en', { numeric: true })));
    return { x: p[0], z: p[2], room: g.item.room, keys: slots.map(s => locusKey(g.item.id, s)) };
  });
  return orderByPosition(doc, nodes);
}

/** 不需要绑定笔记的物件也算：家具按位置排（数字桩用）；摆在别的家具上的小物件、台阶栏杆这类不算 */
const NOT_LOCUS = new Set(['step', 'railing', 'stringLights', 'rug']);
export function allItemsRoute(doc: PalaceDoc): string[] {
  const nodes = doc.items
    .filter(i => !i.parent && i.pickable !== false && !NOT_LOCUS.has(i.type))
    .map(i => ({ x: i.pos[0], z: i.pos[2], room: i.room, keys: [locusKey(i.id)] }));
  return orderByPosition(doc, nodes);
}

/** 从正门出发：最近邻 + 2-opt，换房间多算几米 */
function orderByPosition(doc: PalaceDoc, nodes: { x: number; z: number; room?: string; keys: string[] }[]): string[] {
  if (!nodes.length) return [];
  type N = { x: number; z: number; room?: string; start?: boolean };
  // 对称的代价（2-opt 翻转一段时段内的边方向会变）
  const cost = (a: N, b: N) => Math.hypot(a.x - b.x, a.z - b.z) + (!a.start && !b.start && (a.room ?? '') !== (b.room ?? '') ? ROOM_PENALTY : 0);
  // 起点：正门往里一点；没有门时从最靠西北的地方开始
  const door = frontDoor(doc);
  const start: N = door
    ? { x: door.x - door.nx * .6, z: door.z - door.nz * .6, start: true }
    : { x: Math.min(...nodes.map(n => n.x)), z: Math.min(...nodes.map(n => n.z)), start: true };
  // 最近邻
  const rest = [...nodes], order: typeof nodes = [];
  let cur: N = start;
  while (rest.length) {
    let bi = 0;
    for (let i = 1; i < rest.length; i++) if (cost(cur, rest[i]) < cost(cur, rest[bi])) bi = i;
    cur = rest.splice(bi, 1)[0];
    order.push(cur as typeof nodes[number]);
  }
  // 2-opt：起点固定，终点自由
  const at = (i: number): N => (i < 0 ? start : order[i]);
  for (let pass = 0, improved = true; improved && pass < 50; pass++) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const before = cost(at(i - 1), order[i]) + (j + 1 < order.length ? cost(order[j], order[j + 1]) : 0);
        const after = cost(at(i - 1), order[j]) + (j + 1 < order.length ? cost(order[i], order[j + 1]) : 0);
        if (after < before - 1e-6) {
          order.splice(i, j - i + 1, ...order.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return order.flatMap(n => n.keys);
}

// =====================================================================
// 复习状态 → 记忆程度
// =====================================================================

/**
 * none   还不是闪卡（从没回忆过）
 * new    是闪卡但还没复习过
 * learning 刚学 / 刚忘了正在重学：几分钟到几小时后要再看一次
 * fresh  记得牢：还没到复习时间
 * due    该复习了
 * stale  过了很久没复习（落灰、结蛛网）
 */
export type MemoryLevel = 'none' | 'new' | 'learning' | 'fresh' | 'due' | 'stale';

/** 过期多久算「落灰」 */
export const STALE_MS = 3 * 86400e3;

export function memoryLevel(s: ReviewState | undefined, now = Date.now()): MemoryLevel {
  if (!s?.card) return 'none';
  if (!s.reps || s.state === 0) return 'new';
  if (s.due !== undefined && s.due <= now) return now - s.due > STALE_MS ? 'stale' : 'due';
  // 学习中 / 忘了之后重新学习：还没到点，但不算记得牢
  return s.state === 1 || s.state === 3 ? 'learning' : 'fresh';
}

/** 该复习了（小镇名牌、宫殿里的「待复习」计数） */
export const isDue = (m: MemoryLevel) => m === 'due' || m === 'stale';

/** 回忆时「只练该练的」：除了记得牢的都算 */
export const needsPractice = (m: MemoryLevel) => m !== 'fresh';

/** 几个记忆程度里最差的一个（一件物件上有多个记忆桩时，图钉按最差的显示） */
export function worstLevel(levels: MemoryLevel[]): MemoryLevel {
  const rank: MemoryLevel[] = ['stale', 'due', 'learning', 'new', 'none', 'fresh'];
  for (const r of rank) if (levels.includes(r)) return r;
  return 'none';
}
