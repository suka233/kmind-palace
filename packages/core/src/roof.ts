import * as THREE from 'three';
import type { Kit } from './kit';
import type { PalaceDoc } from './schema';
import { seedFromString, rand, rr } from './random';
import { bboxOf, indoorRects, type RoofKind } from './world';

// =====================================================================
// 屋顶：按占地自动选择（小而方正 → 坡顶；大或不规则 → 平顶），颜色取宫殿主题色
// =====================================================================

export function roofKindFor(doc: PalaceDoc, kind: RoofKind = 'auto'): Exclude<RoofKind, 'auto'> {
  if (kind !== 'auto') return kind;
  const rects = indoorRects(doc);
  const bb = bboxOf(rects);
  if (!bb) return 'none';
  const bw = bb[2] - bb[0], bd = bb[3] - bb[1];
  const area = rects.reduce((s, r) => s + (r[2] - r[0]) * (r[3] - r[1]), 0);
  const fill = area / (bw * bd);
  return fill > .9 && Math.min(bw, bd) <= 8.5 && area <= 90 ? 'gable' : 'flat';
}

export function buildRoof(K: Kit, doc: PalaceDoc, H: number, color: string, kindIn: RoofKind, snow = false) {
  const group = new THREE.Group();
  group.name = 'roof';
  const mats: THREE.MeshStandardMaterial[] = [];
  const std = (c: string, r = .85, extra: THREE.MeshStandardMaterialParameters = {}) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: r, ...extra }); mats.push(m); return m; };
  const rects = indoorRects(doc);
  const bb = bboxOf(rects);
  const kind = roofKindFor(doc, kindIn);
  if (!bb || kind === 'none') return { group, mats, top: H };
  seedFromString('roof:' + doc.id);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = K.mesh(geo, mat); m.position.set(x, y, z); group.add(m); return m;
  };
  const roofMat = std(color, .72, { flatShading: true });
  const snowMat = std('#f5f8fb', .75, { flatShading: true });
  const [x0, z0, x1, z1] = bb, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, bw = x1 - x0, bd = z1 - z0;
  let top = H;

  if (kind === 'gable') {
    const along = bw >= bd; // 屋脊沿 x 方向
    const span = along ? bd : bw, len = along ? bw : bd;
    const ov = .38, h = span * .36, a = Math.atan2(h, span / 2);
    const wallMat = std('#e6ddd0', .95), trim = std('#3b2f28', .7), chim = std('#b79c83', .85);
    // 山墙（三角柱，不含出檐）
    const prof = new THREE.Shape([new THREE.Vector2(-span / 2 - .1, 0), new THREE.Vector2(span / 2 + .1, 0), new THREE.Vector2(0, h + .05)]);
    const gable = new THREE.ExtrudeGeometry(prof, { depth: len + .2, bevelEnabled: false });
    gable.translate(0, 0, -(len + .2) / 2);
    const gm = add(gable, wallMat, cx, H, cz);
    if (along) gm.rotation.y = Math.PI / 2;
    // 两片屋面：下表面贴着屋面线，从屋脊一直伸到出檐
    const run = span / 2 + ov, slope = run / Math.cos(a), th = .12;
    const yMid = H + h - run / 2 * Math.tan(a);
    for (const side of [-1, 1]) {
      const geo = along ? new THREE.BoxGeometry(len + ov * 2, th, slope) : new THREE.BoxGeometry(slope, th, len + ov * 2);
      const m = K.mesh(geo, roofMat);
      const nUp = Math.cos(a) * th / 2, nOut = Math.sin(a) * th / 2 * side;
      if (along) {
        m.rotation.x = side * a;
        m.position.set(cx, yMid + nUp, cz + side * run / 2 + nOut);
      } else {
        m.rotation.z = -side * a;
        m.position.set(cx + side * run / 2 + nOut, yMid + nUp, cz);
      }
      group.add(m);
      if (snow) {
        // 积雪：贴在屋面上的一层白色厚板，略短于屋面
        const sg = along ? new THREE.BoxGeometry(len + ov * 2 - .12, .1, slope - .18) : new THREE.BoxGeometry(slope - .18, .1, len + ov * 2 - .12);
        const sm = K.mesh(sg, snowMat);
        sm.rotation.copy(m.rotation);
        const up = Math.cos(a) * (th / 2 + .05), out = Math.sin(a) * (th / 2 + .05) * side;
        if (along) sm.position.set(cx, m.position.y + up, m.position.z + out);
        else sm.position.set(m.position.x + out, m.position.y + up, cz);
        group.add(sm);
      }
    }
    // 屋脊
    add(along ? new THREE.BoxGeometry(len + ov * 2 + .06, .12, .2) : new THREE.BoxGeometry(.2, .12, len + ov * 2 + .06), trim, cx, H + h + th + .02, cz);
    // 烟囱
    const t = rr(-.3, .3) * len, s = rr(.15, .3) * span * (rand() < .5 ? -1 : 1);
    const cxh = along ? cx + t : cx + s, czh = along ? cz + s : cz + t;
    const yBase = H + h * (1 - Math.abs(s) / (span / 2));
    add(new THREE.BoxGeometry(.5, 1.1, .5), chim, cxh, yBase + .35, czh);
    add(new THREE.BoxGeometry(.6, .08, .6), trim, cxh, yBase + .92, czh);
    top = H + h + .2;
  } else {
    const slab = std('#efe8dd', .9), lip = std('#f7f3ec', .8), sky = std('#bfe0e8', .1, { metalness: .2 }), ac = std('#c9c4bb', .6);
    const rect = rects.length === 1 || rects.reduce((s, r) => s + (r[2] - r[0]) * (r[3] - r[1]), 0) / (bw * bd) > .9;
    for (const r of rects) {
      const w = r[2] - r[0] + .3, d = r[3] - r[1] + .3, x = (r[0] + r[2]) / 2, z = (r[1] + r[3]) / 2;
      add(new THREE.BoxGeometry(w, .22, d), slab, x, H + .11, z);
      add(new THREE.BoxGeometry(Math.max(.1, w - .5), .04, Math.max(.1, d - .5)), snow ? snowMat : roofMat, x, H + .24, z);
      if (snow) add(new THREE.BoxGeometry(Math.max(.1, w - .7), .1, Math.max(.1, d - .7)), snowMat, x, H + .31, z);
    }
    if (rect) {
      const W = bw + .3, D = bd + .3;
      for (const [px, pz, sw, sd] of [[0, -D / 2 + .1, W, .2], [0, D / 2 - .1, W, .2], [-W / 2 + .1, 0, .2, D], [W / 2 - .1, 0, .2, D]]) {
        add(new THREE.BoxGeometry(sw, .32, sd), lip, cx + px, H + .38, cz + pz);
      }
    }
    // 屋顶小物件：天窗、空调外机、几丛绿植（放在最大的房间上）
    const big = [...rects].sort((a, b) => (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]))[0];
    const [bx0, bz0, bx1, bz1] = big, w = bx1 - bx0, d = bz1 - bz0;
    if (w > 2.4 && d > 2.2) add(new THREE.BoxGeometry(Math.min(1.4, w * .3), .22, Math.min(1, d * .3)), sky, bx0 + w * .3, H + .36, bz0 + d * .35);
    if (w > 2 && d > 1.6) add(new THREE.BoxGeometry(.9, .5, .6), ac, bx0 + w * .72, H + .51, bz0 + d * .62);
    if (w > 3.5) for (let i = 0; i < 3; i++) {
      const s = K.mesh(new THREE.IcosahedronGeometry(.32 + (i % 2) * .1, 1), K.M.leaf);
      s.position.set(bx0 + .7 + i * .65, H + .5, bz1 - .6); group.add(s);
    }
    top = H + .6;
  }
  return { group, mats, top };
}
