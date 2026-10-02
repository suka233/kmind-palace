import type { Rect, Vec2 } from './schema';

/* =====================================================================
 * 小镇道路：从每座宫殿的入户门出发，在 1 m 网格上用 A* 找到通往广场的路。
 * - 已经铺好的路代价更低 → 后来的路会并进已有的路，自然长出主干道
 * - 转弯有额外代价 → 路尽量笔直
 * - 被多座宫殿共用的路段更宽
 * 纯数据计算，不涉及 three.js。
 * ===================================================================== */

export interface RoadSource {
  id: string;
  /** 门洞中心（墙外表面，区域坐标）与朝外的法线 */
  door: { x: number; z: number; nx: number; nz: number; w: number } | null;
  /** 这座宫殿的地块（区域坐标） */
  lot: Rect;
}

export interface RoadInput {
  bounds: Rect;
  /** 可以铺路的陆地 */
  land: (x: number, z: number) => boolean;
  lots: Rect[];
  plaza: { x: number; z: number; r: number };
  sources: RoadSource[];
}

export interface RoadRun { pts: Vec2[]; width: number }
export interface Walkway { a: Vec2; b: Vec2; width: number }

export interface RoadNet {
  runs: RoadRun[];
  walkways: Walkway[];
  /** 判断某点是否在路上（摆放树木、路灯时避让） */
  onRoad(x: number, z: number, pad?: number): boolean;
}

const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
const WIDE = 2.4, NARROW = 1.6;

export function planRoads(inp: RoadInput): RoadNet {
  const [bx0, bz0, bx1, bz1] = inp.bounds;
  const x0 = Math.floor(bx0), z0 = Math.floor(bz0);
  const W = Math.max(1, Math.ceil(bx1) - x0), H = Math.max(1, Math.ceil(bz1) - z0);
  const N = W * H;
  const cx = (i: number) => x0 + (i % W) + .5, cz = (i: number) => z0 + Math.floor(i / W) + .5;
  const cellOf = (x: number, z: number) => {
    const gx = Math.floor(x - x0), gz = Math.floor(z - z0);
    return gx < 0 || gz < 0 || gx >= W || gz >= H ? -1 : gz * W + gx;
  };
  const { plaza } = inp;
  const inLot = (x: number, z: number, pad: number) => inp.lots.some(r => x > r[0] - pad && x < r[2] + pad && z > r[1] - pad && z < r[3] + pad);

  const blocked = new Uint8Array(N), nearLot = new Uint8Array(N), goal = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const x = cx(i), z = cz(i), d = Math.hypot(x - plaza.x, z - plaza.z);
    if (!inp.land(x, z) || inLot(x, z, .3) || d < 2.8) blocked[i] = 1;
    else {
      if (inLot(x, z, 1.3)) nearLot[i] = 1;
      if (d <= plaza.r - .5) goal[i] = 1;
    }
  }

  const paved = new Uint16Array(N);
  const paths: number[][] = [];
  const walkways: Walkway[] = [];

  // 离广场近的宫殿先连：主干道从中心向外生长
  const srcs = [...inp.sources].sort((a, b) => distTo(a.lot, plaza) - distTo(b.lot, plaza));
  for (const s of srcs) {
    const start = exitOf(s);
    walkways.push(start.walk);
    let c0 = cellOf(start.x, start.z);
    if (c0 < 0) continue;
    if (blocked[c0]) c0 = nearestFree(c0);
    if (c0 < 0) continue;
    const path = astar(c0, start.dir);
    if (!path) continue;
    for (const c of path) paved[c]++;
    paths.push(path);
  }

  // 每条路径按路宽分段，化简成拐点
  const runs: RoadRun[] = [];
  for (const path of paths) {
    let cur: number[] = [];
    let curW = 0;
    const flush = () => { if (cur.length) runs.push({ pts: corners(cur), width: curW }); };
    for (const c of path) {
      const w = paved[c] >= 2 ? WIDE : NARROW;
      if (cur.length && w !== curW) {
        // 分段处共享一个格子，保证路面连续
        flush();
        cur = [cur[cur.length - 1]];
      }
      curW = w;
      cur.push(c);
    }
    flush();
  }

  return {
    runs, walkways,
    onRoad(x, z, pad = 0) {
      for (const r of runs) {
        const h = r.width / 2 + pad;
        for (let i = 0; i + 1 < r.pts.length; i++) {
          const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
          if (x > Math.min(ax, bx) - h && x < Math.max(ax, bx) + h && z > Math.min(az, bz) - h && z < Math.max(az, bz) + h) return true;
        }
      }
      for (const w of walkways) {
        const h = w.width / 2 + pad;
        if (x > Math.min(w.a[0], w.b[0]) - h && x < Math.max(w.a[0], w.b[0]) + h && z > Math.min(w.a[1], w.b[1]) - h && z < Math.max(w.a[1], w.b[1]) + h) return true;
      }
      return false;
    },
  };

  // ---------------------------------------------------------------
  /** 出门后沿法线走出地块，作为寻路起点；没有门就从地块离广场最近的一边出去 */
  function exitOf(s: RoadSource) {
    const [lx0, lz0, lx1, lz1] = s.lot;
    let x: number, z: number, nx: number, nz: number, w = 1.2;
    if (s.door) {
      ({ x, z, nx, nz } = s.door);
      w = Math.max(1.1, Math.min(1.6, s.door.w + .3));
    } else {
      const mx = (lx0 + lx1) / 2, mz = (lz0 + lz1) / 2;
      const cands: [number, number, number, number][] = [[mx, lz0, 0, -1], [mx, lz1, 0, 1], [lx0, mz, -1, 0], [lx1, mz, 1, 0]];
      cands.sort((a, b) => Math.hypot(a[0] - plaza.x, a[1] - plaza.z) - Math.hypot(b[0] - plaza.x, b[1] - plaza.z));
      [x, z, nx, nz] = cands[0];
    }
    // 走到地块外 0.8 m
    let t = 0;
    while (t < 60 && x + nx * t >= lx0 && x + nx * t <= lx1 && z + nz * t >= lz0 && z + nz * t <= lz1) t += .5;
    t += .8;
    const ex = x + nx * t, ez = z + nz * t;
    const dir = nx > .5 ? 0 : nz > .5 ? 1 : nx < -.5 ? 2 : 3;
    return { x: ex, z: ez, dir, walk: { a: [x, z] as Vec2, b: [ex, ez] as Vec2, width: w } };
  }

  function nearestFree(c: number) {
    const gx = c % W, gz = Math.floor(c / W);
    for (let r = 1; r <= 4; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const x = gx + dx, z = gz + dz;
        if (x < 0 || z < 0 || x >= W || z >= H) continue;
        const i = z * W + x;
        if (!blocked[i]) return i;
      }
    }
    return -1;
  }

  function astar(start: number, startDir: number): number[] | null {
    const S = N * 4;
    const g = new Float32Array(S).fill(Infinity);
    const from = new Int32Array(S).fill(-1);
    const heap = new Heap();
    const h = (i: number) => Math.max(0, Math.hypot(cx(i) - plaza.x, cz(i) - plaza.z) - (plaza.r - .5)) * .35;
    const s0 = start * 4 + startDir;
    g[s0] = 0;
    heap.push(s0, h(start));
    while (heap.size) {
      const s = heap.pop();
      const c = s >> 2, d = s & 3;
      if (goal[c]) {
        const out: number[] = [];
        for (let k = s; k >= 0; k = from[k]) out.push(k >> 2);
        return out.reverse();
      }
      const gx = c % W, gz = Math.floor(c / W);
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d + 2) % 4) continue;
        const x = gx + DX[nd], z = gz + DZ[nd];
        if (x < 0 || z < 0 || x >= W || z >= H) continue;
        const n = z * W + x;
        if (blocked[n]) continue;
        const cost = (paved[n] ? .35 : 1) + (nd !== d ? 1.2 : 0) + (nearLot[n] ? .6 : 0);
        const ns = n * 4 + nd, ng = g[s] + cost;
        if (ng < g[ns]) {
          g[ns] = ng; from[ns] = s;
          heap.push(ns, ng + h(n));
        }
      }
    }
    return null;
  }

  function corners(cells: number[]): Vec2[] {
    const pts: Vec2[] = cells.map(c => [cx(c), cz(c)]);
    if (pts.length < 3) return pts;
    const out: Vec2[] = [pts[0]];
    for (let i = 1; i + 1 < pts.length; i++) {
      const [ax, az] = out[out.length - 1], [bx, bz] = pts[i], [qx, qz] = pts[i + 1];
      const straight = (Math.abs(ax - bx) < 1e-6 && Math.abs(bx - qx) < 1e-6) || (Math.abs(az - bz) < 1e-6 && Math.abs(bz - qz) < 1e-6);
      if (!straight) out.push(pts[i]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
}

function distTo(r: Rect, p: { x: number; z: number }) {
  return Math.hypot((r[0] + r[2]) / 2 - p.x, (r[1] + r[3]) / 2 - p.z);
}

/** 最小堆（按优先级） */
class Heap {
  private ids: number[] = [];
  private pri: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, p: number) {
    const ids = this.ids, pri = this.pri;
    let i = ids.length;
    ids.push(id); pri.push(p);
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (pri[j] <= p) break;
      ids[i] = ids[j]; pri[i] = pri[j]; i = j;
    }
    ids[i] = id; pri[i] = p;
  }
  pop() {
    const ids = this.ids, pri = this.pri;
    const top = ids[0];
    const id = ids.pop(), p = pri.pop();
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= p) break;
        ids[i] = ids[c]; pri[i] = pri[c]; i = c;
      }
      ids[i] = id; pri[i] = p;
    }
    return top;
  }
}
