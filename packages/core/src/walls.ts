import * as THREE from 'three';
import type { Kit } from './kit';
import type { PalaceWall, WallOpening } from './schema';

/* =====================================================================
 * 墙体：按门窗洞口切块、踢脚线、墙漆 / 瓷砖，支持动态剖切（cur 高度）。
 * ===================================================================== */

const INT_T = .12;

interface Piece { mesh: THREE.Mesh; y0: number; y1: number }
type IndexedOpening = WallOpening & { index: number };
interface Span { s0: number; s1: number; y0: number; y1: number }

export class Wall {
  id: string;
  axis: 'x' | 'z';
  c: number;
  s0: number;
  s1: number;
  t: number;
  normal: { x: number; z: number } | null;
  openings: IndexedOpening[];
  def: PalaceWall;
  pieces: Piece[] = [];
  attach: THREE.Object3D[] = [];
  rects: Span[] = [];
  cur: number;
  target: number;
  group = new THREE.Group();
  colliders: THREE.Object3D[] = [];

  constructor(private K: Kit, def: PalaceWall, parent: THREE.Object3D, private H: number) {
    const [x1, z1] = def.a, [x2, z2] = def.b;
    this.id = def.id;
    this.def = def;
    this.axis = Math.abs(z1 - z2) < 1e-6 ? 'x' : 'z';
    this.c = this.axis === 'x' ? z1 : x1;
    const a = this.axis === 'x' ? x1 : z1, b = this.axis === 'x' ? x2 : z2;
    this.t = def.thickness ?? (def.normal ? .2 : INT_T);
    this.normal = def.normal ? { x: def.normal[0], z: def.normal[1] } : null;
    const ext = this.normal ? this.t / 2 : 0;
    this.s0 = Math.min(a, b) - ext; this.s1 = Math.max(a, b) + ext;
    // 只保留落在墙体范围内、互不重叠的洞口（墙被缩短 / 拖动后可能越界）
    const lo = Math.min(a, b), hi = Math.max(a, b);
    let last = -Infinity;
    this.openings = (def.openings || [])
      .map((o, index) => ({ ...o, index }))
      .filter(o => o.s1 - o.s0 > .1 && o.s0 >= lo + .02 && o.s1 <= hi - .02 && o.y1 > o.y0)
      .sort((p, q) => p.s0 - q.s0)
      .filter(o => { const ok = o.s0 >= last; if (ok) last = o.s1; return ok; });
    this.cur = this.target = H;
    parent.add(this.group);
    this.build(def);
  }

  /** 墙面的室内方向：外墙指向室内；内墙默认 +1 */
  get inSign() { return this.normal ? -(this.axis === 'x' ? this.normal.z : this.normal.x) : 1; }
  worldPos(s: number, y: number, off: number) { return this.axis === 'x' ? new THREE.Vector3(s, y, this.c + off) : new THREE.Vector3(this.c + off, y, s); }
  rotFor(sign: number) { return this.axis === 'x' ? (sign > 0 ? 0 : Math.PI) : (sign > 0 ? Math.PI / 2 : -Math.PI / 2); }

  private rectsIn(s0: number, s1: number, y0: number, y1: number) {
    const out: Span[] = [];
    for (const r of this.rects) {
      const a = Math.max(r.s0, s0), b = Math.min(r.s1, s1), c = Math.max(r.y0, y0), d = Math.min(r.y1, y1);
      if (b - a > .005 && d - c > .005) out.push({ s0: a, s1: b, y0: c, y1: d });
    }
    return out;
  }

  private addPiece(r: Span, thick: number, off: number, mats: THREE.Material[], uvTile = 0) {
    const len = r.s1 - r.s0, h = r.y1 - r.y0;
    const geo = this.axis === 'x' ? new THREE.BoxGeometry(len, h, thick) : new THREE.BoxGeometry(thick, h, len);
    if (uvTile) {
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len + r.s0) / uvTile, (uv.getY(i) * h + r.y0) / uvTile);
    }
    const m = this.K.mesh(geo, mats);
    m.position.copy(this.worldPos((r.s0 + r.s1) / 2, (r.y0 + r.y1) / 2, off));
    m.userData.wall = this;
    this.group.add(m);
    this.pieces.push({ mesh: m, y0: r.y0, y1: r.y1 });
    return m;
  }

  private build(def: PalaceWall) {
    const { M } = this.K, H = this.H;
    let cur = this.s0;
    for (const o of this.openings) {
      if (o.s0 > cur) this.rects.push({ s0: cur, s1: o.s0, y0: 0, y1: H });
      if (o.y0 > 0) this.rects.push({ s0: o.s0, s1: o.s1, y0: 0, y1: o.y0 });
      if (o.y1 < H) this.rects.push({ s0: o.s0, s1: o.s1, y0: o.y1, y1: H });
      cur = o.s1;
    }
    if (cur < this.s1) this.rects.push({ s0: cur, s1: this.s1, y0: 0, y1: H });

    const inner = M.wall, outer = this.normal ? M.exterior : M.wall;
    const mats = [inner, inner, M.cap, inner, inner, inner];
    if (this.normal) {
      if (this.axis === 'x') mats[this.normal.z > 0 ? 4 : 5] = outer;
      else mats[this.normal.x > 0 ? 0 : 1] = outer;
    }
    for (const r of this.rects) this.addPiece(r, this.t, 0, mats);

    // 踢脚线
    const sides = this.normal ? [this.inSign] : [1, -1];
    const bbMats = Array(6).fill(M.baseboard);
    for (const side of sides) {
      for (const r of this.rectsIn(this.s0 + (this.normal ? this.t : 0), this.s1 - (this.normal ? this.t : 0), 0, .09)) {
        this.addPiece(r, .016, side * (this.t / 2 + .008), bbMats);
      }
    }
    // 墙漆 / 瓷砖
    for (const p of def.paint || []) {
      const mat = p.texture ? (p.texture === 'subway' ? M.subway : M.bathWall) : this.K.solid(p.color || '#e6dccd');
      const pm = [mat, mat, M.cap, mat, mat, mat];
      for (const r of this.rectsIn(p.s0, p.s1, p.y0 ?? .09, p.y1 ?? H)) {
        this.addPiece(r, .008, p.side * (this.t / 2 + .004), pm, p.tile || 0);
      }
    }
    for (const o of this.openings) this.buildOpening(o);
  }

  private buildOpening(o: WallOpening) {
    const { M, box, cyl, plane } = this.K;
    const w = o.s1 - o.s0, sc = (o.s0 + o.s1) / 2, t = this.t, inS = this.inSign;
    const DEG = Math.PI / 180;
    const g = new THREE.Group();
    g.position.copy(this.worldPos(sc, 0, 0));
    g.rotation.y = this.rotFor(1);
    g.userData.opening = { wall: this.id, index: (o as IndexedOpening).index };
    if (o.kind === 'window') {
      const fw = .05, fd = Math.min(.08, t * .6), h = o.y1 - o.y0;
      box(g, w, fw, fd, M.frame, 0, o.y0, 0, .004);
      box(g, w, fw, fd, M.frame, 0, o.y1 - fw, 0, .004);
      box(g, fw, h, fd, M.frame, -w / 2 + fw / 2, o.y0, 0, .004);
      box(g, fw, h, fd, M.frame, w / 2 - fw / 2, o.y0, 0, .004);
      if (w > .9) box(g, .03, h, fd * .8, M.frame, 0, o.y0, 0, .004);
      if (h > 1.1) box(g, w, .03, fd * .8, M.frame, 0, o.y1 - .45, 0, .004);
      plane(g, w - .06, h - .06, M.glass, 0, o.y0 + h / 2, 0).receiveShadow = false;
      box(g, w + .14, .03, t / 2 + .07, M.white, 0, o.y0 - .03, inS * (t / 4 + .03), .006);
      if (o.curtain) this.curtains(g, w, o, inS);
    } else if (o.kind === 'door') {
      for (const side of [1, -1]) {
        box(g, .07, o.y1 + .06, .02, M.white, -w / 2 - .02, 0, side * (t / 2 + .01), .005);
        box(g, .07, o.y1 + .06, .02, M.white, w / 2 + .02, 0, side * (t / 2 + .01), .005);
        box(g, w + .11, .07, .02, M.white, 0, o.y1, side * (t / 2 + .01), .005);
      }
      const swing = o.swing ?? 1;
      const pivot = new THREE.Group();
      pivot.position.set(-w / 2 + .02, 0, swing * (t / 2));
      pivot.rotation.y = -swing * 72 * DEG;
      g.add(pivot);
      box(pivot, w - .04, o.y1 - .02, .04, M.door, (w - .04) / 2, .005, 0, .006);
      for (const s of [1, -1]) cyl(pivot, .012, .012, .12, M.brass, w - .12, 1.0, s * .035).rotation.x = Math.PI / 2;
    } else if (o.kind === 'front') {
      for (const side of [1, -1]) {
        box(g, .08, o.y1 + .08, .025, M.white, -w / 2 - .025, 0, side * (t / 2 + .012), .005);
        box(g, .08, o.y1 + .08, .025, M.white, w / 2 + .025, 0, side * (t / 2 + .012), .005);
        box(g, w + .13, .08, .025, M.white, 0, o.y1, side * (t / 2 + .012), .005);
      }
      const leaf = box(g, w - .02, o.y1 - .02, .05, M.frontDoor, 0, .01, 0, .008);
      this.colliders.push(leaf);
      plane(g, .14, 1.2, M.glass, w / 2 - .2, 1.1, .03);
      for (const s of [1, -1]) box(g, .03, .3, .03, M.brass, -w / 2 + .12, .95, s * .045, .01);
    } else if (o.kind === 'slide') {
      const fw = .05, h = o.y1 - o.y0;
      box(g, w, fw, .1, M.frame, 0, 0, 0, .004);
      box(g, w, fw, .1, M.frame, 0, o.y1 - fw, 0, .004);
      const pw = w / 4;
      // 两侧固定扇 + 叠在其后的推拉扇，中间留出通道
      for (const [x, z, fixed] of [[-w / 2 + pw / 2, -.025, true], [w / 2 - pw / 2, -.025, true], [-w / 2 + pw * 1.35, .025, false], [w / 2 - pw * 1.35, .025, false]] as [number, number, boolean][]) {
        const pg = new THREE.Group(); pg.position.set(x, 0, z); g.add(pg);
        box(pg, fw, h, .04, M.frame, -pw / 2 + fw / 2, 0, 0, .004);
        box(pg, fw, h, .04, M.frame, pw / 2 - fw / 2, 0, 0, .004);
        plane(pg, pw - .08, h - .1, M.glass, 0, h / 2, 0);
        if (fixed) { const col = box(pg, pw, h, .03, M.glass, 0, 0, 0, 0); col.visible = false; this.colliders.push(col); }
      }
      if (o.curtain) this.curtains(g, w, o, inS);
    }
    this.group.parent.add(g);
    this.attach.push(g);
  }

  private curtains(g: THREE.Group, w: number, o: WallOpening, inS: number) {
    const { M, cyl, mesh } = this.K;
    const rodY = o.y1 + .14, off = inS * (this.t / 2 + .12);
    const rod = cyl(g, .012, .012, w + .7, M.brass, 0, 0, off);
    rod.rotation.z = Math.PI / 2; rod.position.y = rodY;
    const ch = rodY - .02, cw = Math.max(.45, w * .28);
    const base = o.curtainColor ? this.K.solid(o.curtainColor, 1) : M.linen;
    const mat = base.clone(); mat.side = THREE.DoubleSide;
    mat.userData.owned = true;
    for (const side of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(cw, ch, 28, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) / cw + .5) * Math.PI * 7) * .035);
      geo.computeVertexNormals();
      const cur = mesh(geo, mat);
      cur.position.set(side * (w / 2 + .3 - cw / 2), .02 + ch / 2, off);
      g.add(cur);
    }
  }

  /** 应用当前剖切高度 */
  apply() {
    for (const p of this.pieces) {
      const top = Math.min(p.y1, this.cur);
      if (top <= p.y0 + .001) { p.mesh.visible = false; continue; }
      p.mesh.visible = true;
      const h = top - p.y0;
      p.mesh.scale.y = h / (p.y1 - p.y0);
      p.mesh.position.y = p.y0 + h / 2;
    }
    const show = this.cur > this.H - .08;
    for (const a of this.attach) a.visible = show;
  }
}
