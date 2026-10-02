/* =====================================================================
 * 宫殿里的步行网格（纯数据，与 three.js 无关）
 * 把墙体、实心家具当作障碍，在 0.2 m 的网格上用 A* 找路，再拉直成折线。
 * 记忆路线在地上画的线、以后沿路线漫游，都走这条路：从门过、绕开家具。
 * ===================================================================== */

export interface Rect4 { x0: number; z0: number; x1: number; z1: number }
export type P2 = [number, number];

const SQRT2 = Math.SQRT2;

export class WalkGrid {
  readonly nx: number;
  readonly nz: number;
  private blocked: Uint8Array;

  /**
   * bounds：网格范围；blockers：障碍物（平面矩形）；pad：障碍物向外扩多少（人的半径）
   */
  constructor(readonly bounds: Rect4, blockers: Rect4[], readonly cell = .2, pad = .16) {
    this.nx = Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / cell));
    this.nz = Math.max(1, Math.ceil((bounds.z1 - bounds.z0) / cell));
    this.blocked = new Uint8Array(this.nx * this.nz);
    for (const r of blockers) {
      const [i0, k0] = this.toCell(r.x0 - pad, r.z0 - pad), [i1, k1] = this.toCell(r.x1 + pad, r.z1 + pad);
      for (let k = Math.max(0, k0); k <= Math.min(this.nz - 1, k1); k++) {
        for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) {
          // 只有格子中心真的落在（扩大后的）障碍里才算堵住，避免细墙把门缝也堵上
          const [cx, cz] = this.toWorld(i, k);
          if (cx >= r.x0 - pad && cx <= r.x1 + pad && cz >= r.z0 - pad && cz <= r.z1 + pad) this.blocked[k * this.nx + i] = 1;
        }
      }
    }
  }

  toCell(x: number, z: number): P2 {
    return [Math.floor((x - this.bounds.x0) / this.cell), Math.floor((z - this.bounds.z0) / this.cell)];
  }

  toWorld(i: number, k: number): P2 {
    return [this.bounds.x0 + (i + .5) * this.cell, this.bounds.z0 + (k + .5) * this.cell];
  }

  free(i: number, k: number) {
    return i >= 0 && k >= 0 && i < this.nx && k < this.nz && !this.blocked[k * this.nx + i];
  }

  freeAt(x: number, z: number) {
    const [i, k] = this.toCell(x, z);
    return this.free(i, k);
  }

  /** 离 (x, z) 最近的可站立点（由近到远一圈圈找）；maxR 米内都没有时返回 null */
  nearestFree(x: number, z: number, maxR = 2.5): P2 | null {
    const [ci, ck] = this.toCell(x, z);
    const R = Math.ceil(maxR / this.cell);
    let best: P2 | null = null, bestD = Infinity;
    for (let r = 0; r <= R; r++) {
      // 第 r 圈的格子离 (x, z) 至少 (r − 1) 格远：已经找到更近的就不用再往外找
      if (best && (r - 1) * this.cell > bestD) break;
      for (let k = ck - r; k <= ck + r; k++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(k - ck)) !== r || !this.free(i, k)) continue;
          const [wx, wz] = this.toWorld(i, k);
          const d = Math.hypot(wx - x, wz - z);
          if (d < bestD) { bestD = d; best = [wx, wz]; }
        }
      }
    }
    return best;
  }

  /** 两点之间的直线是否一路畅通（按半格步长采样） */
  lineFree(a: P2, b: P2) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(d / (this.cell * .5)));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      if (!this.freeAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false;
    }
    return true;
  }

  /**
   * A*（8 邻接，斜走不能切墙角），再拉直成折线。
   * 起点、终点所在格子被堵时先挪到最近的空格。找不到路时返回 null。
   */
  path(a: P2, b: P2): P2[] | null {
    const sa = this.freeAt(a[0], a[1]) ? a : this.nearestFree(a[0], a[1]);
    const sb = this.freeAt(b[0], b[1]) ? b : this.nearestFree(b[0], b[1]);
    if (!sa || !sb) return null;
    const [si, sk] = this.toCell(sa[0], sa[1]), [ti, tk] = this.toCell(sb[0], sb[1]);
    const N = this.nx * this.nz, start = sk * this.nx + si, goal = tk * this.nx + ti;
    const g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const h = (c: number) => {
      const dx = Math.abs((c % this.nx) - ti), dz = Math.abs(Math.floor(c / this.nx) - tk);
      return (dx + dz + (SQRT2 - 2) * Math.min(dx, dz));
    };
    const heap = new MinHeap();
    g[start] = 0;
    heap.push(start, h(start));
    const dirs: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];
    let found = start === goal;
    while (!found && heap.size) {
      const c = heap.pop();
      if (closed[c]) continue;
      closed[c] = 1;
      if (c === goal) { found = true; break; }
      const ci = c % this.nx, ck = Math.floor(c / this.nx);
      for (const [di, dk, w] of dirs) {
        const ni = ci + di, nk = ck + dk;
        if (!this.free(ni, nk)) continue;
        if (di && dk && (!this.free(ci + di, ck) || !this.free(ci, ck + dk))) continue;
        const n = nk * this.nx + ni;
        const ng = g[c] + w;
        if (ng < g[n]) { g[n] = ng; from[n] = c; heap.push(n, ng + h(n)); }
      }
    }
    if (!found) return null;
    const cells: P2[] = [];
    for (let c = goal; c !== -1; c = from[c]) {
      cells.push(this.toWorld(c % this.nx, Math.floor(c / this.nx)));
      if (c === start) break;
    }
    cells.reverse();
    cells[0] = sa;
    cells[cells.length - 1] = sb;
    return this.pull(cells);
  }

  /** 拉直：能直接看到的点就跳过中间的格子 */
  private pull(pts: P2[]): P2[] {
    if (pts.length <= 2) return pts;
    const out: P2[] = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.lineFree(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}

/** 折线总长 */
export function pathLength(pts: P2[]) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }

  push(id: number, key: number) {
    const a = this.ids, k = this.keys;
    a.push(id); k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]]; [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }

  pop() {
    const a = this.ids, k = this.keys;
    const top = a[0];
    const lastId = a.pop(), lastKey = k.pop();
    if (a.length) {
      a[0] = lastId; k[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}
