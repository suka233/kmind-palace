import { uid, type PalaceDoc, type PalaceRoom, type PalaceWall, type Rect, type WallOpening, type WallPaint } from './schema';
import { t } from './i18n';

/* =====================================================================
 * 结构编辑的纯数据操作（不涉及 three.js），全部直接修改 doc。
 * 约定：墙体都是轴对齐的线段；axis 'x' 表示沿 x 方向的墙（z 恒定 = c），
 * axis 'z' 表示沿 z 方向的墙（x 恒定 = c）；lo / hi 为沿墙方向的起止坐标。
 * ===================================================================== */

export interface Line { axis: 'x' | 'z'; c: number; lo: number; hi: number }
export type Edge = 'x0' | 'x1' | 'z0' | 'z1';
export const EDGES: Edge[] = ['x0', 'x1', 'z0', 'z1'];

/** 坐标相等的容差 */
const EPS = .02;
/** 墙端与其他墙 / 房间边缘相接的容差（模板里的内墙会多伸出半个墙厚） */
const TOL = .16;
const INT_T = .12;
const EXT_T = .2;
const MIN_ROOM = .6;
const MIN_WALL = .3;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function wallLine(w: PalaceWall): Line {
  const [x1, z1] = w.a, [x2, z2] = w.b;
  if (Math.abs(z1 - z2) < 1e-6) return { axis: 'x', c: z1, lo: Math.min(x1, x2), hi: Math.max(x1, x2) };
  return { axis: 'z', c: x1, lo: Math.min(z1, z2), hi: Math.max(z1, z2) };
}

export function setWallLine(w: PalaceWall, L: Line) {
  const lo = r3(Math.min(L.lo, L.hi)), hi = r3(Math.max(L.lo, L.hi)), c = r3(L.c);
  if (L.axis === 'x') { w.a = [lo, c]; w.b = [hi, c]; } else { w.a = [c, lo]; w.b = [c, hi]; }
}

export function wallThickness(w: PalaceWall) {
  return w.thickness ?? (w.normal ? EXT_T : INT_T);
}

export function roomEdgeLine(r: PalaceRoom, e: Edge): Line {
  const [x0, z0, x1, z1] = r.rect;
  switch (e) {
    case 'x0': return { axis: 'z', c: x0, lo: z0, hi: z1 };
    case 'x1': return { axis: 'z', c: x1, lo: z0, hi: z1 };
    case 'z0': return { axis: 'x', c: z0, lo: x0, hi: x1 };
    default: return { axis: 'x', c: z1, lo: x0, hi: x1 };
  }
}

const EDGE_INDEX: Record<Edge, number> = { x0: 0, z0: 1, x1: 2, z1: 3 };

function setEdge(r: PalaceRoom, e: Edge, v: number) {
  const rect = [...r.rect] as Rect;
  rect[EDGE_INDEX[e]] = r3(v);
  r.rect = rect;
  // 标签跑出房间时回到中心
  if (r.label) {
    const [x0, z0, x1, z1] = rect;
    const [lx, lz] = r.label;
    if (lx < x0 || lx > x1 || lz < z0 || lz > z1) r.label = [r3((x0 + x1) / 2), r3((z0 + z1) / 2)];
  }
}

/** 房间某条边允许移动到的范围（保证房间不小于 MIN_ROOM） */
export function clampEdge(r: PalaceRoom, e: Edge, v: number) {
  const [x0, z0, x1, z1] = r.rect;
  switch (e) {
    case 'x0': return Math.min(v, x1 - MIN_ROOM);
    case 'x1': return Math.max(v, x0 + MIN_ROOM);
    case 'z0': return Math.min(v, z1 - MIN_ROOM);
    default: return Math.max(v, z0 + MIN_ROOM);
  }
}

const overlap = (a: Line, b: Line) => Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);

/**
 * 平移一面墙（垂直于墙的方向）：
 * - 端点落在这条线上的垂直墙会被拉长 / 缩短
 * - 落在墙体范围内、与墙重合的房间边一起移动
 * - 挂在这面墙上的物件跟着移动
 */
export function moveWall(doc: PalaceDoc, wallId: string, nc: number) {
  const w = doc.walls.find(x => x.id === wallId);
  if (!w) return;
  const L = wallLine(w), oc = L.c, d = nc - oc;
  if (Math.abs(d) < 1e-6) return;
  for (const o of doc.walls) {
    if (o === w) continue;
    const M = wallLine(o);
    if (M.axis === L.axis || M.c < L.lo - TOL || M.c > L.hi + TOL) continue;
    if (Math.abs(M.lo - oc) <= TOL) M.lo += d;
    else if (Math.abs(M.hi - oc) <= TOL) M.hi += d;
    else continue;
    if (M.hi - M.lo < MIN_WALL) continue;
    setWallLine(o, M);
  }
  for (const r of doc.rooms) {
    for (const e of EDGES) {
      const E = roomEdgeLine(r, e);
      if (E.axis !== L.axis || Math.abs(E.c - oc) > EPS) continue;
      if (E.lo < L.lo - TOL || E.hi > L.hi + TOL) continue;
      setEdge(r, e, clampEdge(r, e, nc));
    }
  }
  for (const it of doc.items) {
    if (it.wall !== w.id) continue;
    if (L.axis === 'x') it.pos[2] = r3(it.pos[2] + d); else it.pos[0] = r3(it.pos[0] + d);
  }
  L.c = nc;
  setWallLine(w, L);
}

/**
 * 拖动房间的一条边：
 * - 这条边上有墙 → 平移那面墙（墙会带上所有与之重合的房间边）
 * - 没有墙 → 只移动这条边，以及与它完全重合的相邻房间边
 */
export function moveRoomEdge(doc: PalaceDoc, roomId: string, e: Edge, nv: number) {
  const r = doc.rooms.find(x => x.id === roomId);
  if (!r) return;
  nv = clampEdge(r, e, nv);
  const E = roomEdgeLine(r, e);
  const walls = doc.walls.filter(w => {
    const L = wallLine(w);
    return L.axis === E.axis && Math.abs(L.c - E.c) < EPS && overlap(L, E) > MIN_WALL;
  });
  if (walls.length) {
    for (const w of walls) moveWall(doc, w.id, nv);
  } else {
    for (const o of doc.rooms) {
      if (o === r) continue;
      for (const oe of EDGES) {
        const O = roomEdgeLine(o, oe);
        if (O.axis === E.axis && Math.abs(O.c - E.c) < EPS && Math.abs(O.lo - E.lo) < TOL && Math.abs(O.hi - E.hi) < TOL) setEdge(o, oe, clampEdge(o, oe, nv));
      }
    }
  }
  setEdge(r, e, nv);
}

/** 拖动墙的一端，改变长度 */
export function setWallEnd(doc: PalaceDoc, wallId: string, end: 'lo' | 'hi', v: number) {
  const w = doc.walls.find(x => x.id === wallId);
  if (!w) return;
  const L = wallLine(w);
  if (end === 'lo') L.lo = Math.min(v, L.hi - MIN_WALL); else L.hi = Math.max(v, L.lo + MIN_WALL);
  setWallLine(w, L);
}

/** 新建一面墙（两端各多伸出半个内墙厚，保证转角闭合） */
export function addWall(doc: PalaceDoc, a: [number, number], b: [number, number]) {
  const axis: 'x' | 'z' = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 'x' : 'z';
  const L: Line = axis === 'x'
    ? { axis, c: a[1], lo: Math.min(a[0], b[0]), hi: Math.max(a[0], b[0]) }
    : { axis, c: a[0], lo: Math.min(a[1], b[1]), hi: Math.max(a[1], b[1]) };
  if (L.hi - L.lo < MIN_WALL) return null;
  const w: PalaceWall = { id: uid('wall-'), a: [0, 0], b: [0, 0] };
  setWallLine(w, L);
  doc.walls.push(w);
  return w;
}

/** 新建房间；autoWalls 时给四条边上还没有墙的部分补墙 */
export function addRoom(doc: PalaceDoc, rect: Rect, autoWalls: boolean) {
  const [x0, z0, x1, z1] = rect.map(r3) as Rect;
  const n = doc.rooms.filter(r => r.floor).length + 1;
  const room: PalaceRoom = { id: uid('room-'), name: t('房间 {n}', { n }), rect: [x0, z0, x1, z1], floor: 'oak', label: [r3((x0 + x1) / 2), r3((z0 + z1) / 2)] };
  doc.rooms.push(room);
  if (autoWalls) {
    for (const e of EDGES) {
      const E = roomEdgeLine(room, e);
      let free: [number, number][] = [[E.lo, E.hi]];
      for (const w of doc.walls) {
        const L = wallLine(w);
        if (L.axis !== E.axis || Math.abs(L.c - E.c) > EPS) continue;
        free = free.flatMap(([lo, hi]) => {
          const out: [number, number][] = [];
          if (L.lo - TOL > lo) out.push([lo, Math.min(hi, L.lo)]);
          if (L.hi + TOL < hi) out.push([Math.max(lo, L.hi), hi]);
          return out;
        });
      }
      for (const [lo, hi] of free) {
        if (hi - lo < MIN_WALL) continue;
        const ext = INT_T / 2;
        const w: PalaceWall = { id: uid('wall-'), a: [0, 0], b: [0, 0] };
        setWallLine(w, { axis: E.axis, c: E.c, lo: lo - ext, hi: hi + ext });
        doc.walls.push(w);
      }
    }
  }
  return room;
}

/** 删除墙，同时删掉挂在它上面的物件；返回删掉的物件数 */
export function deleteWall(doc: PalaceDoc, wallId: string) {
  doc.walls = doc.walls.filter(w => w.id !== wallId);
  const before = doc.items.length;
  doc.items = doc.items.filter(i => i.wall !== wallId);
  return before - doc.items.length;
}

export function deleteRoom(doc: PalaceDoc, roomId: string) {
  doc.rooms = doc.rooms.filter(r => r.id !== roomId);
}

const isIndoorAt = (doc: PalaceDoc, x: number, z: number) =>
  doc.rooms.some(r => r.floor && !r.outdoor && x > r.rect[0] && x < r.rect[2] && z > r.rect[1] && z < r.rect[3]);

/**
 * 自动判断外墙：一侧是室内房间、另一侧不是 → 外墙，法线指向室外。
 * 外墙决定了俯视时哪些墙保持全高（剖切）。
 */
export function computeWallNormals(doc: PalaceDoc) {
  for (const w of doc.walls) {
    const L = wallLine(w);
    const t = wallThickness(w);
    const off = t / 2 + .3;
    let plus = 0, minus = 0, n = 0;
    for (const f of [.2, .5, .8]) {
      const s = L.lo + (L.hi - L.lo) * f;
      const [px, pz, mx, mz] = L.axis === 'x' ? [s, L.c + off, s, L.c - off] : [L.c + off, s, L.c - off, s];
      if (isIndoorAt(doc, px, pz)) plus++;
      if (isIndoorAt(doc, mx, mz)) minus++;
      n++;
    }
    const plusIn = plus > n / 2, minusIn = minus > n / 2;
    if (plusIn !== minusIn) {
      const s = plusIn ? -1 : 1;
      w.normal = L.axis === 'x' ? [0, s] : [s, 0];
    } else delete w.normal;
    // 新墙第一次判定时按内外墙给默认厚度，之后保持用户设置
    w.thickness ??= w.normal ? EXT_T : INT_T;
  }
}

/** 地基（及庭院这类无地面的室外区域）只扩不缩，始终包住所有房间和墙 */
export function fitGround(doc: PalaceDoc) {
  if (!doc.ground) return;
  let [x0, z0, x1, z1] = doc.ground.plinth;
  const margin = 1.2;
  const grow = (x: number, z: number) => {
    x0 = Math.min(x0, x - margin); x1 = Math.max(x1, x + margin);
    z0 = Math.min(z0, z - margin); z1 = Math.max(z1, z + margin);
  };
  for (const r of doc.rooms) if (r.floor) { grow(r.rect[0], r.rect[1]); grow(r.rect[2], r.rect[3]); }
  for (const w of doc.walls) { grow(w.a[0], w.a[1]); grow(w.b[0], w.b[1]); }
  const plinth: Rect = [r3(x0), r3(z0), r3(x1), r3(z1)];
  doc.ground.plinth = plinth;
  for (const r of doc.rooms) if (!r.floor && r.outdoor) r.rect = [...plinth] as Rect;
}

/**
 * 一面墙在某一侧被垂直墙分隔出的「墙面」：返回包含 s 的那一段 [s0, s1]。
 * 用于只给一个房间的那一面刷漆。
 */
export function faceSegment(doc: PalaceDoc, wall: PalaceWall, side: 1 | -1, s: number): [number, number] {
  const L = wallLine(wall);
  let s0 = L.lo, s1 = L.hi;
  for (const o of doc.walls) {
    if (o === wall) continue;
    const M = wallLine(o);
    if (M.axis === L.axis || M.c <= L.lo || M.c >= L.hi) continue;
    const touchLo = Math.abs(M.lo - L.c) <= TOL, touchHi = Math.abs(M.hi - L.c) <= TOL;
    const crosses = M.lo < L.c - TOL && M.hi > L.c + TOL;
    // 只算落在这一侧的分隔墙
    const onSide = crosses || (touchLo && side > 0) || (touchHi && side < 0);
    if (!onSide) continue;
    const half = wallThickness(o) / 2;
    if (M.c <= s) s0 = Math.max(s0, M.c + half);
    else s1 = Math.min(s1, M.c - half);
  }
  return [r3(s0), r3(s1)];
}

/** 当前这段墙面上的整面涂装（用于编辑面板显示当前选择） */
export function facePaint(wall: PalaceWall, side: 1 | -1, s0: number, s1: number) {
  const mid = (s0 + s1) / 2;
  return (wall.paint || []).find(p => p.side === side && p.s0 <= mid && p.s1 >= mid && (p.y0 ?? .09) <= .1);
}

/** 给一段墙面刷漆 / 贴砖；paint 为 null 时恢复默认墙色 */
export function setFacePaint(wall: PalaceWall, side: 1 | -1, s0: number, s1: number, paint: Partial<WallPaint> | null) {
  const out: WallPaint[] = [];
  for (const p of wall.paint || []) {
    const full = (p.y0 ?? .09) <= .1;
    if (p.side !== side || p.s1 <= s0 || p.s0 >= s1 || !full) { out.push(p); continue; }
    if (p.s0 < s0) out.push({ ...p, s1: s0 });
    if (p.s1 > s1) out.push({ ...p, s0: s1 });
  }
  if (paint) out.push({ side, s0, s1, ...paint });
  wall.paint = out;
}

export const OPENING_DEFAULTS: Record<WallOpening['kind'], { w: number; y0: number; y1: number }> = {
  door: { w: .85, y0: 0, y1: 2.1 },
  window: { w: 1.2, y0: .9, y1: 2.2 },
  slide: { w: 2.4, y0: 0, y1: 2.35 },
  front: { w: .95, y0: 0, y1: 2.15 },
};

/** 在墙上 s 附近开一个门 / 窗，自动避开已有洞口；放不下时返回 -1 */
export function addOpening(doc: PalaceDoc, wall: PalaceWall, kind: WallOpening['kind'], s: number, H = 2.8) {
  const L = wallLine(wall);
  const def = OPENING_DEFAULTS[kind];
  const width = Math.min(def.w, L.hi - L.lo - .3);
  if (width < .4) return -1;
  const taken = (wall.openings || []).map(o => [o.s0 - .1, o.s1 + .1]).sort((a, b) => a[0] - b[0]);
  const fits = (c: number) => {
    const a = c - width / 2, b = c + width / 2;
    return a >= L.lo + .15 && b <= L.hi - .15 && taken.every(([p, q]) => b <= p || a >= q);
  };
  let center = Math.min(Math.max(s, L.lo + .15 + width / 2), L.hi - .15 - width / 2);
  if (!fits(center)) {
    let found = NaN;
    for (let step = .05; step < L.hi - L.lo; step += .05) {
      if (fits(center + step)) { found = center + step; break; }
      if (fits(center - step)) { found = center - step; break; }
    }
    if (isNaN(found)) return -1;
    center = found;
  }
  const o: WallOpening = { kind, s0: r3(center - width / 2), s1: r3(center + width / 2), y0: def.y0, y1: Math.min(def.y1, H - .2) };
  if (kind === 'door') o.swing = 1;
  if (kind === 'slide') o.curtain = true;
  wall.openings = [...(wall.openings || []), o];
  void doc;
  return wall.openings.length - 1;
}

/** 修改洞口并夹紧到墙体范围内 */
export function updateOpening(wall: PalaceWall, index: number, patch: Partial<WallOpening>, H = 2.8) {
  const o = wall.openings?.[index];
  if (!o) return;
  Object.assign(o, patch);
  const L = wallLine(wall);
  const width = Math.min(Math.max(o.s1 - o.s0, .4), L.hi - L.lo - .3);
  let c = (o.s0 + o.s1) / 2;
  c = Math.min(Math.max(c, L.lo + .15 + width / 2), L.hi - .15 - width / 2);
  o.s0 = r3(c - width / 2); o.s1 = r3(c + width / 2);
  if (o.kind !== 'window') o.y0 = 0;
  o.y1 = r3(Math.min(Math.max(o.y1, o.y0 + .3), H - .1));
  o.y0 = r3(Math.max(0, Math.min(o.y0, o.y1 - .3)));
  if (o.kind === 'door' && !o.swing) o.swing = 1;
}

export function deleteOpening(wall: PalaceWall, index: number) {
  wall.openings = (wall.openings || []).filter((_, i) => i !== index);
}

/** 结构编辑后的统一整理：外墙判断 + 地基扩展 */
export function normalizeStructure(doc: PalaceDoc) {
  computeWallNormals(doc);
  fitGround(doc);
}

/** 结构吸附：靠近已有墙线 / 房间边（15 cm 内）就对齐，否则按网格取整 */
export function snapPlan(doc: Pick<PalaceDoc, 'walls' | 'rooms'>, v: number, coord: 'x' | 'z', opts: { grid?: number; exclude?: number[]; excludeNear?: number } = {}) {
  const grid = opts.grid ?? .1;
  let best = NaN, bestD = .15;
  const consider = (c: number) => {
    if (opts.exclude?.some(e => Math.abs(e - c) < 1e-6)) return;
    // 拖动时，原位置附近（含相连墙伸出的端点）不参与吸附，避免「追着自己跑」
    if (opts.excludeNear !== undefined && Math.abs(c - opts.excludeNear) < TOL + .01) return;
    const d = Math.abs(c - v);
    if (d < bestD) { bestD = d; best = c; }
  };
  for (const w of doc.walls) {
    const L = wallLine(w);
    if ((coord === 'x') === (L.axis === 'z')) consider(L.c);
    else { consider(L.lo); consider(L.hi); }
  }
  for (const r of doc.rooms) {
    if (!r.floor) continue;
    if (coord === 'x') { consider(r.rect[0]); consider(r.rect[2]); } else { consider(r.rect[1]); consider(r.rect[3]); }
  }
  return isNaN(best) ? r3(Math.round(v / grid) * grid) : best;
}
