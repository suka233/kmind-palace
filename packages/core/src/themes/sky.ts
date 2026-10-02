import * as THREE from 'three';
import { rand, rr, seedFromString } from '../random';
import {
  GRASS_Y, type ThemePack, type ThemeCtx, outline, extrudeLand, addLand, plazaBase, plazaBenches, fountain, edgeSpot,
  lampPosts, scatter, leafyTree, alongShore, shrub, jitter,
} from './common';

/** 浮空岛：整座岛悬在海面上方，岛底是倒垂的岩体，边缘有瀑布，四周飘着云；地标是风车和热气球 */
export const sky: ThemePack = {
  id: 'sky',
  name: '浮空岛',
  desc: '悬在云上，瀑布、风车和热气球',
  icon: '☁️',
  colors: ['#b7d58f', '#ffffff', '#8fd0e6'],
  lift: 14,
  margin: 7,
  minR: 20,

  materials(K) {
    const std = (color: string, roughness = .9, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
    const lawn = K.TEX.lawn.clone();
    lawn.needsUpdate = true;
    lawn.repeat.set(.36, .36);
    return {
      grass: std('#eef8d8', 1, { map: lawn }),
      rim: std('#a08f7a', .95, { flatShading: true }),
      under: std('#8b7e6f', .95, { flatShading: true }),
      paver: std('#e4d8c6', .95),
      curb: std('#cdbfa9', .95),
      stream: std('#8fd0e6', .08, { metalness: .1 }),
      fall: std('#e6f6ff', .3, { emissive: '#bfe6ff', emissiveIntensity: .3, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false }),
      cloud: std('#ffffff', 1, { flatShading: true, emissive: '#ffffff', emissiveIntensity: .12 }),
      blossom: std('#f2b8c6', .8, { flatShading: true }),
      balloon: std('#d7a342', .7),
      balloonBand: std('#c4553d', .7),
    };
  },

  terrain(ctx) {
    const { mats } = ctx;
    // 厚厚的一层岩壁 + 较平的岛底 + 岛边一圈倒垂的石笋（从斜上方俯视时，平缓的岛底是看不见的，石笋够陡才看得见）
    extrudeLand(ctx, outline(ctx, 0), GRASS_Y, 2.2, [mats.grass, mats.rim], .5);
    addLand(ctx, new THREE.Mesh(undersideGeometry(ctx), mats.under), true);
    hangingRocks(ctx);
  },

  plaza(ctx) {
    plazaBase(ctx);
    fountain(ctx, ctx.mats.fountain);
    plazaBenches(ctx);
  },

  decorate(ctx) {
    const { K, mats } = ctx;
    const w = edgeSpot(ctx, -30, 3, 3.5);
    if (w) windmill(ctx, w.x, w.z);
    const f = edgeSpot(ctx, 70, .2, 3);
    if (f) waterfall(ctx, f.a);
    lampPosts(ctx, 6);
    const leaves = [K.M.leafLight, K.M.leaf, K.M.leafOlive];
    scatter(ctx, {
      key: 'sky-tree', spacing: 4.4, max: 150, pad: 2, keep: c => .45 + c * .22,
      place: (x, z) => {
        const k = rand();
        if (k < .55) leafyTree(ctx, x, z, rr(2.4, 3.6), 1);
        else if (k < .82) blossomTree(ctx, x, z, rr(2.2, 3.2));
        else shrub(ctx, x, z, rr(.35, .55), [leaves[0], leaves[2]]);
      },
    });
    const flowers = [mats.blossom, K.M.mustard, K.M.rose];
    alongShore(ctx, 'flowers', 3.8, [.8, 1.6], (x, z, i) => {
      if (rand() < .35) return;
      shrub(ctx, x, z, rr(.3, .5), [leaves[i % 3], leaves[(i + 1) % 3]]);
      if (rand() < .6) K.ball(ctx.raw, .1, flowers[i % 3], x + .15, GRASS_Y + .5, z + .1, [1, 1, 1], 10);
    });
    clouds(ctx);
    balloon(ctx);
  },
};

/** 岛底：从轮廓向下收成一个参差的尖，低多边形岩石 */
function undersideGeometry(ctx: ThemeCtx) {
  seedFromString('under:' + ctx.region.seed);
  const [cx, cz] = ctx.center;
  const N = 56, K = 5, top = GRASS_Y - 2.3, tip = top - (ctx.maxR * .22 + 3);
  const rings: THREE.Vector3[][] = [];
  for (let k = 0; k <= K; k++) {
    const t = k / K, ring: THREE.Vector3[] = [];
    const shrink = 1 - Math.pow(t, .75);
    const y = top + (tip - top) * Math.pow(t, 1.25);
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2;
      const r = k === 0 ? ctx.R(a) - .2 : ctx.R(a) * shrink * rr(.82, 1.08);
      ring.push(new THREE.Vector3(cx + Math.cos(a) * r, y + (k && k < K ? rr(-.8, .8) : 0), cz + Math.sin(a) * r));
    }
    rings.push(ring);
  }
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let k = 0; k < K; k++) {
    for (let i = 0; i < N; i++) {
      const a = rings[k][i], b = rings[k][(i + 1) % N], c = rings[k + 1][i], d = rings[k + 1][(i + 1) % N];
      // 法线朝外、朝下（从侧面和下方看得见）
      tri(a, b, c); tri(b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  g.computeVertexNormals();
  return g;
}

/** 岛底倒垂的石笋：中间一根大的，边缘一圈小的，越靠外越短 */
function hangingRocks(ctx: ThemeCtx) {
  const { K, mats } = ctx, [cx, cz] = ctx.center;
  seedFromString('spikes:' + ctx.region.seed);
  const top = GRASS_Y - 2.1, maxDepth = -ctx.seaY - 4;
  const spike = (x: number, z: number, r: number, depth: number) => {
    const geo = jitter(new THREE.ConeGeometry(r, depth, 7, 3), r * .12, -depth / 2);
    const m = K.mesh(geo, mats.under);
    m.rotation.x = Math.PI; m.rotation.y = rr(0, 3);
    m.position.set(x, top - depth / 2, z);
    ctx.raw.add(m);
  };
  spike(cx, cz, ctx.maxR * .42, Math.min(maxDepth, ctx.maxR * .55 + 6));
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + rr(-.12, .12), R = ctx.R(a);
    const r = rr(2.8, 5.6), d = R * rr(.45, .8);
    if (d + r > R - .5) continue;
    const depth = Math.min(maxDepth, rr(5, 10) + (1 - d / R) * 9);
    spike(cx + Math.cos(a) * d, cz + Math.sin(a) * d, r, depth);
  }
}

function windmill(ctx: ThemeCtx, x: number, z: number) {
  const { K, mats } = ctx;
  const g = new THREE.Group();
  const tower = K.mesh(new THREE.CylinderGeometry(.85, 1.45, 5.6, 8), mats.white); tower.position.y = 2.8; g.add(tower);
  const cap = K.mesh(new THREE.ConeGeometry(1.15, 1.3, 8), mats.red); cap.position.y = 6.25; g.add(cap);
  const door = K.mesh(new THREE.BoxGeometry(.7, 1.2, .1), mats.woodDark, false); door.position.set(0, .6, 1.38); door.rotation.x = -.1; g.add(door);
  const hub = new THREE.Group(); hub.position.set(0, 5.3, 1.05); g.add(hub);
  const axle = K.mesh(new THREE.CylinderGeometry(.14, .14, .5, 10), mats.dark); axle.rotation.x = Math.PI / 2; hub.add(axle);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2 + .3; hub.add(arm);
    const spar = K.mesh(new THREE.BoxGeometry(.1, 3.2, .06), mats.woodDark); spar.position.y = 1.6; arm.add(spar);
    const sail = K.mesh(new THREE.BoxGeometry(.7, 2.4, .03), mats.hull); sail.position.set(.4, 1.9, .03); arm.add(sail);
  }
  g.position.set(x, GRASS_Y, z);
  // 叶片朝向镜头所在的东南方
  g.rotation.y = Math.PI / 4;
  ctx.raw.add(g);
  ctx.blockers.push({ x, z, r: 3 });
  ctx.landmarks.push({ kind: 'windmill', x, z, angle: 0 });
}

/** 小溪流到岛边，瀑布一直落进海里，底部一团水雾 */
function waterfall(ctx: ThemeCtx, a: number) {
  const { K, mats } = ctx;
  const [cx, cz] = ctx.center;
  const r = ctx.R(a), ux = Math.cos(a), uz = Math.sin(a);
  const len = 8, rot = Math.atan2(ux, uz);
  const sx = cx + ux * (r - len / 2), sz = cz + uz * (r - len / 2);
  const stream = K.mesh(new THREE.BoxGeometry(1.3, .05, len + .8), mats.stream, false);
  stream.position.set(sx, GRASS_Y + .02, sz); stream.rotation.y = rot; ctx.raw.add(stream);
  const pondR = 1.5;
  const pond = K.mesh(new THREE.CylinderGeometry(pondR, pondR, .05, 24), mats.stream, false);
  pond.position.set(cx + ux * (r - len), GRASS_Y + .02, cz + uz * (r - len)); ctx.raw.add(pond);
  const drop = GRASS_Y - ctx.seaY;
  for (const [w, off] of [[1.5, .7], [1.0, .9]] as [number, number][]) {
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(w, drop), mats.fall);
    fall.position.set(cx + ux * (r + off), GRASS_Y - drop / 2, cz + uz * (r + off));
    fall.rotation.y = rot + Math.PI / 2;
    fall.renderOrder = 2;
    ctx.raw.add(fall);
  }
  for (let i = 0; i < 7; i++) {
    const m = K.mesh(new THREE.IcosahedronGeometry(rr(.6, 1.2), 1), mats.cloud, false);
    m.position.set(cx + ux * (r + 1) + rr(-1.2, 1.2), ctx.seaY + rr(.2, .9), cz + uz * (r + 1) + rr(-1.2, 1.2));
    ctx.raw.add(m);
  }
  ctx.blockers.push({ x: sx, z: sz, r: 2 }, { x: cx + ux * (r - len), z: cz + uz * (r - len), r: pondR + 1 });
  ctx.landmarks.push({ kind: 'waterfall', x: cx + ux * r, z: cz + uz * r, angle: a });
}

function blossomTree(ctx: ThemeCtx, x: number, z: number, h: number) {
  const { K, mats } = ctx;
  const g = new THREE.Group();
  const trunk = K.mesh(new THREE.CylinderGeometry(.07, .12, h * .55, 8), K.M.bark); trunk.position.y = h * .27; g.add(trunk);
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2, d = rr(0, h * .2), s = rr(h * .13, h * .2);
    const c = K.mesh(new THREE.IcosahedronGeometry(s, 1), i % 3 ? mats.blossom : K.M.rose);
    c.position.set(Math.cos(a) * d, rr(h * .55, h * .85), Math.sin(a) * d); g.add(c);
  }
  g.position.set(x, GRASS_Y, z);
  ctx.raw.add(g);
}

/** 云：岛下方一圈，远处（画面上方）几朵略高 */
function clouds(ctx: ThemeCtx) {
  const { K, mats } = ctx, [cx, cz] = ctx.center;
  seedFromString('clouds:' + ctx.region.seed);
  for (let i = 0; i < 11; i++) {
    const a = i / 11 * Math.PI * 2 + rr(-.2, .2);
    const back = Math.sin(a + Math.PI / 4) < -.3; // 远离镜头的一侧
    const r = ctx.R(a) + rr(3, 12), y = back ? rr(-1, 2.5) : rr(-9, -4);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const n = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const s = rr(1.1, 2.2);
      const m = K.mesh(new THREE.IcosahedronGeometry(s, 1), mats.cloud, false);
      m.position.set(x + rr(-2, 2), y + rr(-.3, .5), z + rr(-1.4, 1.4)); m.scale.y = .62;
      ctx.raw.add(m);
    }
  }
}

function balloon(ctx: ThemeCtx) {
  const { K, mats } = ctx, [cx, cz] = ctx.center;
  const a = 150 * Math.PI / 180, r = ctx.R(a) + 5;
  const g = new THREE.Group();
  const env = K.mesh(new THREE.SphereGeometry(1.7, 20, 14), mats.balloon); env.scale.y = 1.18; env.position.y = 3.2; g.add(env);
  const band = K.mesh(new THREE.TorusGeometry(1.66, .12, 8, 28), mats.balloonBand); band.rotation.x = Math.PI / 2; band.position.y = 3.1; g.add(band);
  const neck = K.mesh(new THREE.ConeGeometry(.7, .9, 14), mats.balloon); neck.rotation.x = Math.PI; neck.position.y = 1.35; g.add(neck);
  const basket = K.mesh(new THREE.BoxGeometry(.7, .5, .7), mats.wood); basket.position.y = .25; g.add(basket);
  for (const [dx, dz] of [[-.3, -.3], [.3, -.3], [-.3, .3], [.3, .3]]) {
    const rope = K.mesh(new THREE.CylinderGeometry(.015, .015, 1.1, 4), mats.dark, false); rope.position.set(dx, .95, dz); g.add(rope);
  }
  g.position.set(cx + Math.cos(a) * r, 4, cz + Math.sin(a) * r);
  ctx.raw.add(g);
}
