import * as THREE from 'three';
import { rand, rr, seedFromString } from '../random';
import {
  GRASS_Y, type ThemePack, type ThemeCtx, outline, flatPatch, extrudeLand, plazaBase, plazaBenches, edgeSpot, innerSpot,
  lampPosts, scatter, leafyTree, conifer, alongShore, shrub, seaRocks, jitter,
} from './common';

/** 森林：卵石滩、茂密的针叶林、古树广场、瞭望塔、林间池塘 */
export const forest: ThemePack = {
  id: 'forest',
  name: '森林',
  desc: '古树、瞭望塔和林间池塘',
  icon: '🌲',
  colors: ['#7f9a5c', '#a39b8e', '#44694f'],
  margin: 9,

  materials(K) {
    const std = (color: string, roughness = .9, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
    const lawn = K.TEX.lawn.clone();
    lawn.needsUpdate = true;
    lawn.repeat.set(.36, .36);
    return {
      grass: std('#b3c98f', 1, { map: lawn }),
      cliff: std('#7b7163', .95),
      pebble: std('#a39b8e', .95),
      shallow: std('#86c0b0', .3),
      paver: std('#cfc2aa', .95),
      curb: std('#a99a82', .95),
      pond: std('#5f9c96', .06, { metalness: .1 }),
      lily: std('#6f9a4e', .8, { side: THREE.DoubleSide }),
      boulder: std('#8f877b', .95, { flatShading: true }),
      moss: std('#6e8c4a', .95, { flatShading: true }),
    };
  },

  terrain(ctx) {
    const { mats } = ctx;
    flatPatch(ctx, outline(ctx, 7), ctx.seaY + .02, mats.shallow);
    extrudeLand(ctx, outline(ctx, 2.0), -.62, .6, [mats.pebble, mats.pebble], .4);
    extrudeLand(ctx, outline(ctx, 0), GRASS_Y, .75, [mats.grass, mats.cliff]);
  },

  plaza(ctx) {
    const { K, mats, raw } = ctx;
    plazaBase(ctx);
    // 古树：一圈石头围着一棵大树
    seedFromString('old-tree:' + ctx.region.seed);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, s = rr(.28, .42);
      const m = K.mesh(new THREE.DodecahedronGeometry(s, 0), mats.boulder);
      m.position.set(Math.cos(a) * 2.1, GRASS_Y + .1 + s * .4, Math.sin(a) * 2.1); m.scale.y = .7; m.rotation.set(rr(0, 3), rr(0, 3), 0);
      raw.add(m);
    }
    const soil = K.mesh(new THREE.CylinderGeometry(1.9, 1.9, .08, 32), mats.moss, false); soil.position.y = GRASS_Y + .1; raw.add(soil);
    leafyTree(ctx, 0, 0, 7.4, 2);
    plazaBenches(ctx, false);
  },

  decorate(ctx) {
    const { K, mats } = ctx;
    const t = edgeSpot(ctx, -35, 3.2, 3.5);
    if (t) watchtower(ctx, t.x, t.z);
    const pond = innerSpot(ctx, 4.2, 'pond');
    if (pond) makePond(ctx, pond.x, pond.z);
    lampPosts(ctx, 6);
    const leaves = [K.M.leaf, K.M.leafDark, K.M.leafOlive];
    scatter(ctx, {
      key: 'forest', spacing: 3.6, max: 280, pad: 1.8, keep: c => .64 + c * .18,
      place: (x, z) => {
        const k = rand();
        if (k < .56) conifer(ctx, x, z, rr(3.2, 5.4));
        else if (k < .86) leafyTree(ctx, x, z, rr(2.8, 4.4), rand() < .5 ? 0 : 2);
        else shrub(ctx, x, z, rr(.35, .55), [leaves[1], leaves[2]]);
      },
    });
    // 倒下的原木
    seedFromString('logs:' + ctx.region.seed);
    for (let i = 0; i < 3; i++) {
      const s = innerSpot(ctx, 1.6, 'log' + i);
      if (!s) continue;
      const log = K.mesh(new THREE.CylinderGeometry(.22, .26, 2.6, 10), K.M.bark);
      log.rotation.set(0, rr(0, 3), Math.PI / 2); log.position.set(s.x, GRASS_Y + .22, s.z);
      ctx.raw.add(log);
      ctx.blockers.push({ x: s.x, z: s.z, r: 1.6 });
    }
    alongShore(ctx, 'boulders', 3.4, [.4, 1.2], (x, z, i) => {
      if (rand() < .35) return;
      const s = rr(.35, .8);
      const m = K.mesh(new THREE.DodecahedronGeometry(s, 0), mats.boulder);
      m.position.set(x, GRASS_Y + s * .25, z); m.scale.y = .65; m.rotation.set(rr(0, 3), rr(0, 3), 0);
      ctx.raw.add(m);
      if (i % 3 === 0) shrub(ctx, x + .8, z + .3, rr(.3, .45), [K.M.leafDark, K.M.leaf]);
    });
    seaRocks(ctx, 12, mats.boulder);
  },
};

/** 瞭望塔：四根木柱 + 斜撑 + 顶部小屋 + 四坡顶 */
function watchtower(ctx: ThemeCtx, x: number, z: number) {
  const { K, mats } = ctx;
  const g = new THREE.Group();
  const H = 5.6, s = 1.05;
  for (const [dx, dz] of [[-s, -s], [s, -s], [-s, s], [s, s]]) {
    const leg = K.mesh(new THREE.CylinderGeometry(.1, .14, H, 8), mats.woodDark);
    leg.position.set(dx, H / 2, dz); g.add(leg);
  }
  for (const y of [1.6, 3.4]) {
    for (const [ax, az, len, rot] of [[0, -s, s * 2, 0], [0, s, s * 2, 0], [-s, 0, s * 2, Math.PI / 2], [s, 0, s * 2, Math.PI / 2]] as [number, number, number, number][]) {
      const b = K.mesh(new THREE.BoxGeometry(len, .1, .1), mats.wood); b.position.set(ax, y, az); b.rotation.y = rot; g.add(b);
    }
  }
  const deck = K.mesh(new THREE.BoxGeometry(3, .16, 3), mats.wood); deck.position.y = H; g.add(deck);
  const cabin = K.mesh(new THREE.BoxGeometry(2.4, 1.3, 2.4), mats.wood); cabin.position.y = H + .8; g.add(cabin);
  for (const [dx, dz, w, d] of [[0, 1.21, 1.3, .02], [0, -1.21, 1.3, .02], [1.21, 0, .02, 1.3], [-1.21, 0, .02, 1.3]]) {
    const win = K.mesh(new THREE.BoxGeometry(w, .55, d), mats.dark, false); win.position.set(dx, H + 1, dz); g.add(win);
  }
  const roof = K.mesh(new THREE.ConeGeometry(2.3, 1.3, 4), mats.red); roof.rotation.y = Math.PI / 4; roof.position.y = H + 2.1; g.add(roof);
  const ladder = K.mesh(new THREE.BoxGeometry(.5, H, .06), mats.woodDark); ladder.position.set(0, H / 2, s + .25); ladder.rotation.x = -.12; g.add(ladder);
  g.position.set(x, GRASS_Y, z);
  g.rotation.y = rand() * Math.PI;
  ctx.raw.add(g);
  ctx.blockers.push({ x, z, r: 3 });
  ctx.landmarks.push({ kind: 'watchtower', x, z, angle: 0 });
}

/** 林间池塘：水面 + 卵石岸 + 睡莲 + 芦苇 */
function makePond(ctx: ThemeCtx, x: number, z: number) {
  const { K, mats } = ctx;
  seedFromString('pond:' + ctx.region.seed);
  const r = rr(2.6, 3.4);
  const water = K.mesh(new THREE.CylinderGeometry(r, r, .06, 40), mats.pond, false);
  water.position.set(x, GRASS_Y + .01, z); water.scale.z = .75; ctx.raw.add(water);
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2, s = rr(.18, .32);
    const m = K.mesh(jitter(new THREE.DodecahedronGeometry(s, 0), .04), mats.pebble);
    m.position.set(x + Math.cos(a) * r * 1.03, GRASS_Y + .06, z + Math.sin(a) * r * .78); m.scale.y = .55;
    ctx.raw.add(m);
  }
  for (let i = 0; i < 6; i++) {
    const a = rr(0, Math.PI * 2), d = rr(.3, .75) * r;
    const pad = K.mesh(new THREE.CylinderGeometry(rr(.22, .34), rr(.22, .34), .02, 12, 1, false, .3, Math.PI * 1.8), mats.lily, false);
    pad.position.set(x + Math.cos(a) * d, GRASS_Y + .05, z + Math.sin(a) * d * .75); ctx.raw.add(pad);
  }
  for (let i = 0; i < 10; i++) {
    const a = rr(-.8, .8) + Math.PI * .75, d = r * rr(.9, 1.05);
    const reed = K.mesh(new THREE.ConeGeometry(.03, rr(.6, 1.1), 4), K.M.leafOlive);
    reed.position.set(x + Math.cos(a) * d, GRASS_Y + .4, z + Math.sin(a) * d * .78); ctx.raw.add(reed);
  }
  ctx.blockers.push({ x, z, r: r + 1.2 });
  ctx.landmarks.push({ kind: 'pond', x, z, angle: 0 });
}
