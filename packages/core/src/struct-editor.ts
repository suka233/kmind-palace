import * as THREE from 'three';
import type { PalaceView } from './view';
import type { Editor } from './editor';
import type { FloorKind, PalaceRoom, PalaceWall, Rect, WallOpening } from './schema';
import {
  wallLine, roomEdgeLine, moveWall, moveRoomEdge, setWallEnd, addWall, addRoom, deleteWall, deleteRoom,
  computeWallNormals, normalizeStructure, faceSegment, facePaint, setFacePaint, addOpening, updateOpening,
  deleteOpening, snapPlan, wallThickness, OPENING_DEFAULTS, EDGES, type Edge,
} from './structure';
import { despawnItem } from './build';
import { t } from './i18n';

/* =====================================================================
 * 房间 / 墙体 / 门窗编辑（搭建模式的两个子模式）
 * 交互约定：先点选，再拖动；拖动空白处仍然平移视角。
 * ===================================================================== */

type SSel =
  | { kind: 'room'; id: string }
  | { kind: 'wall'; id: string; side: 1 | -1; seg: [number, number]; s: number }
  | { kind: 'opening'; wall: string; index: number };

type SDrag =
  | { kind: 'edge'; room: string; edge: Edge; off: number }
  | { kind: 'label'; room: string; off: [number, number] }
  | { kind: 'wallMove'; wall: string; off: number }
  | { kind: 'wallEnd'; wall: string; end: 'lo' | 'hi' }
  | { kind: 'opening'; wall: string; index: number; off: number }
  | { kind: 'newRoom'; start: [number, number]; end: [number, number] };

const FLOORS: [FloorKind | null, string][] = [['oak', '橡木地板'], ['oakWarm', '深色橡木'], ['deck', '防腐木'], ['tileLarge', '大地砖'], ['tileBath', '小方砖'], ['cement', '花砖'], [null, '无地面']];
const PAINTS: [string, string][] = [
  ['none', '默认白墙'], ['#e6dccd', '米色'], ['#efe2c8', '奶油黄'], ['#b9c2b0', '鼠尾草绿'], ['#aebac0', '雾蓝'],
  ['#dcc0b2', '陶土粉'], ['#6f8075', '墨绿'], ['#3e4d66', '藏青'], ['#8c6b52', '胡桃木色'], ['#3b3733', '炭黑'],
  ['tex:subway', '白色地铁砖'], ['tex:bathWall', '浅绿瓷砖'],
];
const KINDS: [WallOpening['kind'], string][] = [['door', '室内门'], ['window', '窗'], ['slide', '推拉门'], ['front', '入户门']];

export class StructEditor {
  sel: SSel | null = null;
  tool: 'room' | 'wall' | null = null;
  autoWalls = true;
  private drag: (SDrag & { before: string; moved: boolean; x: number; y: number; id: number; snapDoc?: any; origin?: number }) | null = null;
  private wallStart: [number, number] | null = null;
  private wallEnd: [number, number] | null = null;
  private overlay = new THREE.Group();
  private preview = new THREE.Group();
  private handles: THREE.Mesh[] = [];
  private liveRaf = 0;
  private pendingInput: string | null = null;
  private ray = new THREE.Raycaster();
  private matHandle = new THREE.MeshBasicMaterial({ color: '#ef8235', toneMapped: false, depthTest: false, transparent: true });
  private matFill = new THREE.MeshBasicMaterial({ color: '#ff7a1f', transparent: true, opacity: .16, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  private matLine = new THREE.MeshBasicMaterial({ color: '#ef8235', transparent: true, opacity: .9, depthWrite: false, toneMapped: false });

  constructor(private v: PalaceView, private ed: Editor) {
    this.overlay.renderOrder = 12;
    this.preview.renderOrder = 12;
    v.scene.add(this.overlay, this.preview);
  }

  get doc() { return this.v.doc; }
  get H() { return this.v.built?.wallH ?? 2.8; }

  dispose() {
    this.clearGroup(this.overlay);
    this.clearGroup(this.preview);
    this.matHandle.dispose(); this.matFill.dispose(); this.matLine.dispose();
  }

  // =====================================================================
  // 选择 / 状态
  // =====================================================================

  clear() {
    this.setTool(null);
    this.select(null);
  }

  select(sel: SSel | null) {
    this.sel = sel;
    this.v.applyHighlight();
    this.refreshOverlay();
    this.renderCard();
    this.v.invalidate();
  }

  /** 选中墙 / 门窗时让那面墙保持全高，方便看到并编辑门窗 */
  forceFull(wallId: string) {
    const s = this.sel;
    return !!s && ((s.kind === 'wall' && s.id === wallId) || (s.kind === 'opening' && s.wall === wallId));
  }

  /** 需要高亮的对象（墙体 / 门窗） */
  highlights(): THREE.Object3D[] {
    const s = this.sel, b = this.v.built;
    if (!s || !b) return [];
    if (s.kind === 'wall') return b.wallById[s.id] ? [b.wallById[s.id].group] : [];
    if (s.kind === 'opening') {
      const g = b.wallById[s.wall]?.attach.find(a => a.userData.opening?.index === s.index);
      return g ? [g] : [];
    }
    return [];
  }

  setTool(tool: 'room' | 'wall' | null) {
    this.tool = tool;
    this.wallStart = this.wallEnd = null;
    this.clearGroup(this.preview);
    const root = this.v.root;
    root.classList.toggle('kp-placing', !!tool);
    root.querySelectorAll('[data-act="toolRoom"], [data-act="toolWall"]').forEach(b => b.classList.remove('kp-on'));
    if (tool) {
      root.querySelector(`[data-act="${tool === 'room' ? 'toolRoom' : 'toolWall'}"]`)?.classList.add('kp-on');
      this.v.ui.placeHint.innerHTML = tool === 'room'
        ? `${t('在地面上拖出一个矩形新建房间')} · <label class="kp-check"><input type="checkbox" data-sedit="autoWalls"${this.autoWalls ? ' checked' : ''}> ${t('同时砌墙')}</label>`
        : t('单击起点、再单击终点画墙（可以连续画），会自动对齐已有的墙 · 按住 Alt 自由放置');
      this.select(null);
    }
    this.v.invalidate();
  }

  onStructureRebuilt() {
    // 选中的对象可能已不存在（撤销 / 删除）
    const s = this.sel;
    if (s?.kind === 'room' && !this.doc.rooms.some(r => r.id === s.id)) this.sel = null;
    if (s?.kind === 'wall' && !this.doc.walls.some(w => w.id === s.id)) this.sel = null;
    if (s?.kind === 'opening' && !this.doc.walls.find(w => w.id === s.wall)?.openings?.[s.index]) this.sel = null;
    this.refreshOverlay();
  }

  // =====================================================================
  // 覆盖层：选中框、把手、预览
  // =====================================================================

  private clearGroup(g: THREE.Group) {
    g.traverse((o: any) => { if (o.isMesh) o.geometry.dispose(); });
    g.clear();
  }

  private bar(g: THREE.Group, x0: number, z0: number, x1: number, z1: number, y: number, w: number, mat: THREE.Material, h = .02) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, w), mat);
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    m.renderOrder = 12;
    g.add(m);
    return m;
  }

  refreshOverlay() {
    this.clearGroup(this.overlay);
    this.handles = [];
    const s = this.sel, b = this.v.built;
    if (!s || !b || !this.ed.active) return;
    if (s.kind === 'room') {
      const r = this.doc.rooms.find(x => x.id === s.id);
      if (!r) return;
      const [x0, z0, x1, z1] = r.rect;
      // 外框内缩到墙的内侧，避免被墙体挡住
      const y = .03, i = .13, bw = .07;
      this.bar(this.overlay, x0 + i, z0 + i, x1 - i, z0 + i, y, bw, this.matLine);
      this.bar(this.overlay, x0 + i, z1 - i, x1 - i, z1 - i, y, bw, this.matLine);
      this.bar(this.overlay, x0 + i, z0 + i, x0 + i, z1 - i, y, bw, this.matLine);
      this.bar(this.overlay, x1 - i, z0 + i, x1 - i, z1 - i, y, bw, this.matLine);
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), this.matFill);
      fill.rotation.x = -Math.PI / 2; fill.position.set((x0 + x1) / 2, .015, (z0 + z1) / 2);
      this.overlay.add(fill);
      for (const e of EDGES) {
        const E = roomEdgeLine(r, e);
        const len = Math.min(.8, (E.hi - E.lo) * .4), mid = (E.lo + E.hi) / 2;
        const h = E.axis === 'x'
          ? this.bar(this.overlay, mid - len / 2, E.c, mid + len / 2, E.c, .12, .16, this.matHandle, .12)
          : this.bar(this.overlay, E.c, mid - len / 2, E.c, mid + len / 2, .12, .16, this.matHandle, .12);
        h.userData.handle = { kind: 'edge', edge: e };
        this.handles.push(h);
      }
    } else if (s.kind === 'wall') {
      const w = this.doc.walls.find(x => x.id === s.id);
      if (!w) return;
      const L = wallLine(w), t = wallThickness(w), H = this.H;
      const [s0, s1] = s.seg;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(.05, s1 - s0), H - .02), this.matFill);
      const off = s.side * (t / 2 + .012);
      if (L.axis === 'x') face.position.set((s0 + s1) / 2, H / 2, L.c + off);
      else { face.position.set(L.c + off, H / 2, (s0 + s1) / 2); face.rotation.y = Math.PI / 2; }
      face.renderOrder = 12;
      this.overlay.add(face);
      for (const end of ['lo', 'hi'] as const) {
        const sv = L[end];
        const m = new THREE.Mesh(new THREE.SphereGeometry(.11, 20, 14), this.matHandle);
        if (L.axis === 'x') m.position.set(sv, H + .18, L.c); else m.position.set(L.c, H + .18, sv);
        m.renderOrder = 13;
        m.userData.handle = { kind: 'end', end };
        this.overlay.add(m);
        this.handles.push(m);
        this.bar(this.overlay, m.position.x, m.position.z, m.position.x + .001, m.position.z, H + .09, .02, this.matLine, .18);
      }
    }
  }

  private previewRoom(a: [number, number], b: [number, number]) {
    this.clearGroup(this.preview);
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
    if (x1 - x0 < .01 || z1 - z0 < .01) return;
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), this.matFill);
    fill.rotation.x = -Math.PI / 2; fill.position.set((x0 + x1) / 2, .02, (z0 + z1) / 2);
    this.preview.add(fill);
    for (const [p, q] of [[[x0, z0], [x1, z0]], [[x0, z1], [x1, z1]], [[x0, z0], [x0, z1]], [[x1, z0], [x1, z1]]] as [number, number][][]) {
      this.bar(this.preview, p[0], p[1], q[0], q[1], .03, .05, this.matLine);
    }
    this.v.ui.placeHint.textContent = t('{w} × {d} m · 松开完成', { w: (x1 - x0).toFixed(1), d: (z1 - z0).toFixed(1) });
  }

  private previewWall() {
    this.clearGroup(this.preview);
    const a = this.wallStart, b = this.wallEnd;
    if (a) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(.09, 16, 12), this.matHandle);
      dot.position.set(a[0], .15, a[1]); dot.renderOrder = 13;
      this.preview.add(dot);
    }
    if (a && b) {
      const m = this.bar(this.preview, a[0], a[1], b[0], b[1], this.H / 2, .12, this.matFill, this.H);
      m.renderOrder = 12;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      this.v.ui.placeHint.textContent = t('墙长 {len} m · 单击确定，Esc 结束', { len: len.toFixed(2) });
    }
  }

  // =====================================================================
  // 指针
  // =====================================================================

  private setRay(e: { clientX: number; clientY: number }) {
    this.ray.setFromCamera(this.v.ndc(e.clientX, e.clientY), this.v.isoCam);
    return this.ray;
  }

  private ground(e: { clientX: number; clientY: number }) {
    const p = new THREE.Vector3();
    return this.setRay(e).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }

  private snapPoint(p: THREE.Vector3, free: boolean): [number, number] {
    if (free) return [Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100];
    return [snapPlan(this.doc, p.x, 'x'), snapPlan(this.doc, p.z, 'z')];
  }

  private pickHandle(e: PointerEvent) {
    if (!this.handles.length) return null;
    return this.setRay(e).intersectObjects(this.handles, false)[0]?.object.userData.handle || null;
  }

  private pickFloor(e: { clientX: number; clientY: number }) {
    const b = this.v.built;
    const hit = this.setRay(e).intersectObjects(b.floors, false)[0];
    return hit ? { room: hit.object.userData.room as PalaceRoom, point: hit.point } : null;
  }

  private pickWall(e: { clientX: number; clientY: number }) {
    const b = this.v.built;
    const meshes: THREE.Object3D[] = [];
    for (const w of b.walls) for (const p of w.pieces) if (p.mesh.visible) meshes.push(p.mesh);
    const hit = this.setRay(e).intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const wall = hit.object.userData.wall;
    const def = this.doc.walls.find(w => w.id === wall.id);
    if (!def) return null;
    const L = wallLine(def);
    const n = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld);
    let side: 1 | -1;
    if (n && Math.abs(n.y) < .5) side = (L.axis === 'x' ? n.z : n.x) >= 0 ? 1 : -1;
    else {
      const cam = this.v.isoCam.position;
      side = (L.axis === 'x' ? cam.z - L.c : cam.x - L.c) >= 0 ? 1 : -1;
    }
    const s = L.axis === 'x' ? hit.point.x : hit.point.z;
    return { wall: def, side, s, point: hit.point };
  }

  private pickOpening(e: { clientX: number; clientY: number }) {
    const b = this.v.built;
    const groups: THREE.Object3D[] = [];
    for (const w of b.walls) for (const a of w.attach) if (a.userData.opening && a.visible) groups.push(a);
    for (const h of this.setRay(e).intersectObjects(groups, true)) {
      let o: THREE.Object3D = h.object;
      while (o && !o.userData.opening) o = o.parent;
      if (o) return { ...o.userData.opening as { wall: string; index: number }, point: h.point };
    }
    return null;
  }

  /** 沿墙方向的坐标（用墙所在的竖直平面求交） */
  private alongWall(e: { clientX: number; clientY: number }, w: PalaceWall) {
    const L = wallLine(w);
    const plane = L.axis === 'x' ? new THREE.Plane(new THREE.Vector3(0, 0, 1), -L.c) : new THREE.Plane(new THREE.Vector3(1, 0, 0), -L.c);
    const p = new THREE.Vector3();
    if (!this.setRay(e).ray.intersectPlane(plane, p)) return null;
    return L.axis === 'x' ? p.x : p.z;
  }

  onPointerDown(e: PointerEvent): boolean {
    if (e.button !== 0 || !this.v.built) return false;
    const cvs = this.v.renderer.domElement;
    const start = (d: SDrag, origin?: number) => {
      const before = this.ed.snapshot();
      // 吸附目标取自拖动开始时的结构，拖动过程中不变
      this.drag = { ...d, before, snapDoc: JSON.parse(before), origin, moved: false, x: e.clientX, y: e.clientY, id: e.pointerId } as any;
      capture(cvs, e.pointerId);
      return true;
    };
    if (this.tool === 'room') {
      const g = this.ground(e);
      if (!g) return true;
      const p = this.snapPoint(g, e.altKey);
      return start({ kind: 'newRoom', start: p, end: p });
    }
    if (this.tool === 'wall') {
      this.drag = { kind: 'newRoom', start: [0, 0], end: [0, 0], before: '', moved: false, x: e.clientX, y: e.clientY, id: e.pointerId } as any;
      (this.drag as any).wallClick = true;
      return true;
    }
    const h = this.pickHandle(e);
    const s = this.sel;
    if (h && s?.kind === 'room') {
      const r = this.doc.rooms.find(x => x.id === s.id);
      const g = this.ground(e);
      const E = roomEdgeLine(r, h.edge);
      return start({ kind: 'edge', room: r.id, edge: h.edge, off: g ? E.c - (E.axis === 'x' ? g.z : g.x) : 0 }, E.c);
    }
    if (h && s?.kind === 'wall') {
      const L = wallLine(this.doc.walls.find(x => x.id === s.id));
      return start({ kind: 'wallEnd', wall: s.id, end: h.end }, L[h.end as 'lo' | 'hi']);
    }
    if (s?.kind === 'room') {
      const f = this.pickFloor(e);
      const r = this.doc.rooms.find(x => x.id === s.id);
      if (f && f.room.id === s.id && r) {
        const [lx, lz] = r.label || [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2];
        return start({ kind: 'label', room: s.id, off: [lx - f.point.x, lz - f.point.z] });
      }
    }
    if (s?.kind === 'opening') {
      const o = this.pickOpening(e);
      if (o && o.wall === s.wall && o.index === s.index) {
        const w = this.doc.walls.find(x => x.id === s.wall);
        const op = w.openings[s.index];
        const a = this.alongWall(e, w);
        return start({ kind: 'opening', wall: w.id, index: s.index, off: a === null ? 0 : (op.s0 + op.s1) / 2 - a });
      }
    }
    if (s?.kind === 'wall' && !this.pickOpening(e)) {
      const hit = this.pickWall(e);
      if (hit && hit.wall.id === s.id) {
        const g = this.ground(e);
        const L = wallLine(hit.wall);
        return start({ kind: 'wallMove', wall: s.id, off: g ? L.c - (L.axis === 'x' ? g.z : g.x) : 0 }, L.c);
      }
    }
    return false;
  }

  onPointerMove(e: PointerEvent): boolean {
    if (this.tool === 'wall' && !this.drag) {
      const g = this.ground(e);
      if (!g) return true;
      let p = this.snapPoint(g, e.altKey);
      if (this.wallStart) {
        const a = this.wallStart;
        p = Math.abs(p[0] - a[0]) >= Math.abs(p[1] - a[1]) ? [p[0], a[1]] : [a[0], p[1]];
        this.wallEnd = p;
      }
      this.previewWall();
      if (!this.wallStart) {
        this.clearGroup(this.preview);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(.09, 16, 12), this.matHandle);
        dot.position.set(p[0], .15, p[1]); dot.renderOrder = 13;
        this.preview.add(dot);
      }
      this.v.invalidate();
      return true;
    }
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return false;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return true;
    d.moved = true;
    if ((d as any).wallClick) return true;
    const free = e.altKey;
    const g = this.ground(e);
    switch (d.kind) {
      case 'newRoom': {
        if (!g) return true;
        d.end = this.snapPoint(g, free);
        this.previewRoom(d.start, d.end);
        break;
      }
      case 'label': {
        if (!g) return true;
        const r = this.doc.rooms.find(x => x.id === d.room);
        const [x0, z0, x1, z1] = r.rect;
        const x = THREE.MathUtils.clamp(g.x + d.off[0], x0 + .3, x1 - .3), z = THREE.MathUtils.clamp(g.z + d.off[1], z0 + .2, z1 - .2);
        r.label = [Math.round(x * 20) / 20, Math.round(z * 20) / 20];
        const lab = this.v.built.labels.find(l => l.userData.room === r);
        lab?.position.set(r.label[0], .05, r.label[1]);
        break;
      }
      case 'edge': {
        if (!g) return true;
        const r = this.doc.rooms.find(x => x.id === d.room);
        const E = roomEdgeLine(r, d.edge);
        const raw = (E.axis === 'x' ? g.z : g.x) + d.off;
        const v = free ? Math.round(raw * 100) / 100 : snapPlan(d.snapDoc, raw, E.axis === 'x' ? 'z' : 'x', { excludeNear: d.origin });
        if (Math.abs(v - E.c) > 1e-6) { moveRoomEdge(this.doc, d.room, d.edge, v); this.live(); }
        break;
      }
      case 'wallMove': {
        if (!g) return true;
        const w = this.doc.walls.find(x => x.id === d.wall);
        const L = wallLine(w);
        const raw = (L.axis === 'x' ? g.z : g.x) + d.off;
        const v = free ? Math.round(raw * 100) / 100 : snapPlan(d.snapDoc, raw, L.axis === 'x' ? 'z' : 'x', { excludeNear: d.origin });
        if (Math.abs(v - L.c) > 1e-6) { moveWall(this.doc, d.wall, v); this.live(); }
        break;
      }
      case 'wallEnd': {
        if (!g) return true;
        const w = this.doc.walls.find(x => x.id === d.wall);
        const L = wallLine(w);
        const raw = L.axis === 'x' ? g.x : g.z;
        const v = free ? Math.round(raw * 100) / 100 : snapPlan(d.snapDoc, raw, L.axis === 'x' ? 'x' : 'z', { excludeNear: d.origin });
        setWallEnd(this.doc, d.wall, d.end, v);
        this.live();
        break;
      }
      case 'opening': {
        const w = this.doc.walls.find(x => x.id === d.wall);
        const a = this.alongWall(e, w);
        if (a === null) return true;
        const o = w.openings[d.index];
        const width = o.s1 - o.s0;
        let c = a + d.off;
        c = free ? Math.round(c * 100) / 100 : Math.round(c / .05) * .05;
        updateOpening(w, d.index, { s0: c - width / 2, s1: c + width / 2 }, this.H);
        this.live();
        break;
      }
    }
    this.v.invalidate();
    return true;
  }

  onPointerUp(e: PointerEvent): boolean {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) {
      return false;
    }
    this.drag = null;
    if ((d as any).wallClick) {
      if (!d.moved) this.wallClick(e);
      return true;
    }
    if (d.kind === 'newRoom') {
      this.clearGroup(this.preview);
      const [ax, az] = d.start, [bx, bz] = d.end;
      const rect: Rect = [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)];
      if (rect[2] - rect[0] < .8 || rect[3] - rect[1] < .8) {
        this.v.host.notify?.(t('房间至少要 0.8 × 0.8 米，请拖出更大的矩形'));
        return true;
      }
      const room = addRoom(this.doc, rect, this.autoWalls);
      this.commit(d.before);
      this.setTool(null);
      this.select({ kind: 'room', id: room.id });
      return true;
    }
    if (d.moved) this.commit(d.before);
    return true;
  }

  private wallClick(e: PointerEvent) {
    const g = this.ground(e);
    if (!g) return;
    let p = this.snapPoint(g, e.altKey);
    if (!this.wallStart) { this.wallStart = p; this.previewWall(); return; }
    const a = this.wallStart;
    p = Math.abs(p[0] - a[0]) >= Math.abs(p[1] - a[1]) ? [p[0], a[1]] : [a[0], p[1]];
    const before = this.ed.snapshot();
    const w = addWall(this.doc, a, p);
    if (!w) { this.v.host.notify?.(t('墙太短了，至少 0.3 米')); return; }
    this.commit(before);
    this.wallStart = p;
    this.wallEnd = null;
    this.previewWall();
  }

  /** 单击（没有拖动）时选择房间 / 墙 / 门窗 */
  onClick(e: PointerEvent) {
    if (this.tool) return;
    if (this.ed.emode === 'rooms') {
      const f = this.pickFloor(e);
      this.select(f && f.room.floor ? { kind: 'room', id: f.room.id } : null);
      return;
    }
    const o = this.pickOpening(e);
    if (o) { this.select({ kind: 'opening', wall: o.wall, index: o.index }); return; }
    const hit = this.pickWall(e);
    if (!hit) { this.select(null); return; }
    const seg = faceSegment(this.doc, hit.wall, hit.side, hit.s);
    this.select({ kind: 'wall', id: hit.wall.id, side: hit.side, seg, s: hit.s });
  }

  // =====================================================================
  // 提交 / 实时预览
  // =====================================================================

  private live() {
    if (this.liveRaf) return;
    this.liveRaf = requestAnimationFrame(() => {
      this.liveRaf = 0;
      computeWallNormals(this.doc);
      this.v.rebuildStructure();
      this.refreshSelSegment();
      this.refreshOverlay();
    });
  }

  private refreshSelSegment() {
    const s = this.sel;
    if (s?.kind !== 'wall') return;
    const w = this.doc.walls.find(x => x.id === s.id);
    if (!w) return;
    const L = wallLine(w);
    s.s = Math.min(Math.max(s.s, L.lo + .01), L.hi - .01);
    s.seg = faceSegment(this.doc, w, s.side, s.s);
  }

  private commit(before: string) {
    cancelAnimationFrame(this.liveRaf); this.liveRaf = 0;
    normalizeStructure(this.doc);
    this.v.rebuildStructure();
    this.refreshSelSegment();
    this.ed.commit(before);
    this.refreshOverlay();
    this.renderCard();
  }

  // =====================================================================
  // 键盘 / 按钮 / 面板
  // =====================================================================

  onKey(e: KeyboardEvent): boolean {
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (this.tool === 'wall' && this.wallStart) { this.wallStart = this.wallEnd = null; this.clearGroup(this.preview); this.v.invalidate(); return true; }
      if (this.tool) { this.setTool(null); return true; }
      if (this.sel) { this.select(null); return true; }
      return false;
    }
    if ((k === 'delete' || k === 'backspace') && this.sel) { this.deleteSelected(); return true; }
    return false;
  }

  onAction(act: string, el: HTMLElement): boolean {
    switch (act) {
      case 'toolRoom': this.setTool(this.tool === 'room' ? null : 'room'); return true;
      case 'toolWall': this.setTool(this.tool === 'wall' ? null : 'wall'); return true;
      case 'sDelete': this.deleteSelected(); return true;
      case 'labelCenter': {
        const s = this.sel;
        if (s?.kind !== 'room') return true;
        const before = this.ed.snapshot();
        const r = this.doc.rooms.find(x => x.id === s.id);
        r.label = [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2];
        this.commit(before);
        return true;
      }
      case 'facePaint': {
        const s = this.sel;
        if (s?.kind !== 'wall') return true;
        const w = this.doc.walls.find(x => x.id === s.id);
        const before = this.ed.snapshot();
        const val = el.dataset.paint;
        const paint = val === 'none' ? null : val.startsWith('tex:') ? { texture: val.slice(4) as any, tile: .6 } : { color: val };
        setFacePaint(w, s.side, s.seg[0], s.seg[1], paint);
        this.commit(before);
        return true;
      }
      case 'addOpening': {
        const s = this.sel;
        if (s?.kind !== 'wall') return true;
        const w = this.doc.walls.find(x => x.id === s.id);
        const before = this.ed.snapshot();
        const idx = addOpening(this.doc, w, el.dataset.kind as WallOpening['kind'], s.s, this.H);
        if (idx < 0) { this.v.host.notify?.(t('这面墙上放不下了')); return true; }
        this.commit(before);
        this.select({ kind: 'opening', wall: w.id, index: idx });
        return true;
      }
      case 'flipSwing': {
        const s = this.sel;
        if (s?.kind !== 'opening') return true;
        const w = this.doc.walls.find(x => x.id === s.wall);
        const before = this.ed.snapshot();
        const o = w.openings[s.index];
        o.swing = o.swing === -1 ? 1 : -1;
        this.commit(before);
        return true;
      }
      case 'toggleCurtain': {
        const s = this.sel;
        if (s?.kind !== 'opening') return true;
        const w = this.doc.walls.find(x => x.id === s.wall);
        const before = this.ed.snapshot();
        const o = w.openings[s.index];
        o.curtain = !o.curtain;
        this.commit(before);
        return true;
      }
    }
    return false;
  }

  private deleteSelected() {
    const s = this.sel;
    if (!s) return;
    const before = this.ed.snapshot();
    if (s.kind === 'room') {
      const r = this.doc.rooms.find(x => x.id === s.id);
      deleteRoom(this.doc, s.id);
      this.sel = null;
      this.commit(before);
      this.v.host.notify?.(t('已删除房间「{name}」（墙体保留），可撤销', { name: t(r?.name ?? '') }));
    } else if (s.kind === 'wall') {
      const mounted = this.doc.items.filter(i => i.wall === s.id).map(i => i.id);
      const n = deleteWall(this.doc, s.id);
      for (const id of mounted) despawnItem(this.v.built, id, this.v.kit);
      this.sel = null;
      this.commit(before);
      this.v.host.notify?.(n ? t('已删除墙体和挂在上面的 {n} 个物件，可撤销', { n }) : t('已删除墙体，可撤销'));
    } else {
      const w = this.doc.walls.find(x => x.id === s.wall);
      deleteOpening(w, s.index);
      this.sel = null;
      this.commit(before);
    }
  }

  onInput(e: Event, commit: boolean) {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const key = el.dataset.sedit;
    if (!key) return false;
    if (key === 'autoWalls') { this.autoWalls = (el as HTMLInputElement).checked; return true; }
    const s = this.sel;
    if (!s) return true;
    if (this.pendingInput === null) this.pendingInput = this.ed.snapshot();
    const num = Number(el.value);
    const out = el.parentElement?.querySelector('output');
    if (s.kind === 'room') {
      const r = this.doc.rooms.find(x => x.id === s.id);
      if (key === 'name') { if (!commit) return true; r.name = el.value.trim() || r.name; }
      else if (key === 'en') { if (!commit) return true; r.en = el.value.trim() || undefined; }
      else if (key === 'floor') { if (!commit) return true; r.floor = FLOORS[num]?.[0] ?? undefined; if (!r.floor) delete r.floor; }
      else if (key === 'outdoor') { if (!commit) return true; r.outdoor = (el as HTMLInputElement).checked || undefined; }
    } else if (s.kind === 'wall') {
      const w = this.doc.walls.find(x => x.id === s.id);
      if (key === 'thickness') { w.thickness = num; if (out) out.textContent = `${Math.round(num * 100)} cm`; }
    } else {
      const w = this.doc.walls.find(x => x.id === s.wall);
      const o = w.openings[s.index];
      const c = (o.s0 + o.s1) / 2;
      if (key === 'kind') {
        if (!commit) return true;
        const kind = KINDS[num][0], def = OPENING_DEFAULTS[kind];
        updateOpening(w, s.index, { kind, y0: def.y0, y1: def.y1 }, this.H);
      } else if (key === 'width') updateOpening(w, s.index, { s0: c - num / 2, s1: c + num / 2 }, this.H);
      else if (key === 'height') updateOpening(w, s.index, { y1: o.y0 + num }, this.H);
      else if (key === 'sill') { const h = o.y1 - o.y0; updateOpening(w, s.index, { y0: num, y1: num + h }, this.H); }
      if (out) out.textContent = `${num.toFixed(2)} m`;
    }
    if (!commit) { this.live(); return true; }
    const before = this.pendingInput;
    this.pendingInput = null;
    this.commit(before);
    return true;
  }

  renderCard() {
    const card = this.v.ui.card;
    const s = this.sel;
    if (!s || !this.ed.active) { card.classList.add('kp-hidden'); return; }
    if (s.kind === 'room') {
      const r = this.doc.rooms.find(x => x.id === s.id);
      if (!r) { card.classList.add('kp-hidden'); return; }
      const w = r.rect[2] - r.rect[0], d = r.rect[3] - r.rect[1];
      const fi = Math.max(0, FLOORS.findIndex(([f]) => (f ?? undefined) === r.floor));
      card.innerHTML = `
        <button class="kp-close" data-act="closeCard">×</button>
        <div class="kp-room">${t('房间')} · ${w.toFixed(1)} × ${d.toFixed(1)} m · ${(w * d).toFixed(1)} m²</div>
        <input class="kp-name" data-sedit="name" maxlength="20">
        <div class="kp-params">
          <label class="kp-field"><span>${t('英文名')}</span><input class="kp-text" data-sedit="en" maxlength="20" placeholder="${t('可选')}"></label>
          <label class="kp-field"><span>${t('地面')}</span><select data-sedit="floor">${FLOORS.map(([, l], i) => `<option value="${i}"${i === fi ? ' selected' : ''}>${t(l)}</option>`).join('')}</select></label>
          <label class="kp-field"><span>${t('室外')}</span><span class="kp-inline"><input type="checkbox" data-sedit="outdoor"${r.outdoor ? ' checked' : ''}> ${t('阳台 / 庭院（漫游时没有天花板）')}</span></label>
        </div>
        <div class="kp-tools" style="margin-top:10px"><button data-act="labelCenter">${t('标签居中')}</button><button class="kp-danger" data-act="sDelete">${t('删除房间')}</button></div>
        <div class="kp-tip">${t('拖动橙色把手调整大小，边上的墙和相邻房间会一起移动；拖动房间内部可以移动名称标签。')}</div>`;
      (card.querySelector('[data-sedit="name"]') as HTMLInputElement).value = t(r.name);
      (card.querySelector('[data-sedit="en"]') as HTMLInputElement).value = r.en || '';
    } else if (s.kind === 'wall') {
      const w = this.doc.walls.find(x => x.id === s.id);
      if (!w) { card.classList.add('kp-hidden'); return; }
      const L = wallLine(w), thick = wallThickness(w);
      const cur = facePaint(w, s.side, s.seg[0], s.seg[1]);
      const curKey = cur ? (cur.texture ? 'tex:' + cur.texture : cur.color) : 'none';
      card.innerHTML = `
        <button class="kp-close" data-act="closeCard">×</button>
        <div class="kp-room">${w.normal ? t('外墙') : t('内墙')} · ${t('长 {len} m', { len: (L.hi - L.lo).toFixed(2) })}</div>
        <h3>${t('墙体')}</h3>
        <div class="kp-params">
          <label class="kp-field"><span>${t('厚度')}</span><input type="range" data-sedit="thickness" min="0.06" max="0.4" step="0.01" value="${thick}"><output>${Math.round(thick * 100)} cm</output></label>
        </div>
        <div class="kp-subtitle">${t('这一面墙（{len} m）', { len: (s.seg[1] - s.seg[0]).toFixed(2) })}</div>
        <div class="kp-swatches">${PAINTS.map(([val, label]) => `<button class="kp-swatch${val === curKey ? ' kp-on' : ''}" data-act="facePaint" data-paint="${val}" title="${t(label)}" style="${swatchStyle(val)}"></button>`).join('')}</div>
        <div class="kp-subtitle">${t('在点击的位置开门窗')}</div>
        <div class="kp-tools">${KINDS.map(([k, l]) => `<button data-act="addOpening" data-kind="${k}">+ ${t(l)}</button>`).join('')}</div>
        <div class="kp-tools" style="margin-top:8px"><button class="kp-danger" data-act="sDelete">${t('删除这面墙')}</button></div>
        <div class="kp-tip">${t('拖动墙体平移，相连的墙会跟着伸缩、重合的房间边一起移动；拖动两端的圆点改变长度。')}</div>`;
    } else {
      const w = this.doc.walls.find(x => x.id === s.wall);
      const o = w?.openings?.[s.index];
      if (!o) { card.classList.add('kp-hidden'); return; }
      const ki = Math.max(0, KINDS.findIndex(([k]) => k === o.kind));
      const width = o.s1 - o.s0, height = o.y1 - o.y0;
      card.innerHTML = `
        <button class="kp-close" data-act="closeCard">×</button>
        <div class="kp-room">${t('门窗')} · ${t('宽 {w} m', { w: width.toFixed(2) })}</div>
        <h3>${t(KINDS[ki][1])}</h3>
        <div class="kp-params">
          <label class="kp-field"><span>${t('类型')}</span><select data-sedit="kind">${KINDS.map(([, l], i) => `<option value="${i}"${i === ki ? ' selected' : ''}>${t(l)}</option>`).join('')}</select></label>
          <label class="kp-field"><span>${t('宽度')}</span><input type="range" data-sedit="width" min="0.4" max="4" step="0.05" value="${width}"><output>${width.toFixed(2)} m</output></label>
          <label class="kp-field"><span>${t('高度')}</span><input type="range" data-sedit="height" min="0.3" max="${(this.H - .1).toFixed(2)}" step="0.05" value="${height}"><output>${height.toFixed(2)} m</output></label>
          ${o.kind === 'window' ? `<label class="kp-field"><span>${t('离地')}</span><input type="range" data-sedit="sill" min="0" max="2" step="0.05" value="${o.y0}"><output>${o.y0.toFixed(2)} m</output></label>` : ''}
        </div>
        <div class="kp-tools" style="margin-top:10px">
          ${o.kind === 'door' ? `<button data-act="flipSwing">${t('翻转开向')}</button>` : ''}
          ${o.kind === 'window' || o.kind === 'slide' ? `<button data-act="toggleCurtain">${o.curtain ? t('去掉窗帘') : t('加窗帘')}</button>` : ''}
          <button class="kp-danger" data-act="sDelete">${t('删除')}</button>
        </div>
        <div class="kp-tip">${t('拖动门窗可以沿墙移动。')}</div>`;
    }
    card.classList.remove('kp-hidden');
  }
}

function swatchStyle(val: string) {
  if (val === 'none') return 'background:#f3eee7';
  if (val === 'tex:subway') return 'background:repeating-linear-gradient(0deg,#f4f1ec 0 5px,#d9d3ca 5px 6px)';
  if (val === 'tex:bathWall') return 'background:repeating-linear-gradient(0deg,#eef2f0 0 5px,#cdd5d2 5px 6px)';
  return `background:${val}`;
}

/** 捕获指针；合成事件或指针已抬起时 setPointerCapture 会抛错，忽略即可 */
function capture(el: Element, id: number) {
  try { el.setPointerCapture(id); } catch { /* ignore */ }
}
