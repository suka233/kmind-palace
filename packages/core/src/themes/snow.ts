import * as THREE from 'three';
import { rand, rr, seed, seedFromString } from '../random';
import {
  GRASS_Y, type ThemePack, type ThemeCtx, outline, flatPatch, extrudeLand, plazaBase, plazaBenches, fountain, edgeSpot, innerSpot,
  lampPosts, scatter, conifer, alongShore, jitter,
} from './common';

/** 雪山：冰岸、积雪的针叶林、海边的雪山、冰冻的喷泉、雪人、冰屋、浮冰 */
export const snow: ThemePack = {
  id: 'snow',
  name: '雪山',
  desc: '雪山、冰屋和浮冰',
  icon: '🏔',
  colors: ['#eef3f7', '#cfe4ec', '#44694f'],
  margin: 9,
  roofSnow: true,

  materials(K) {
    const std = (color: string, roughness = .9, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
    const tex = snowTexture();
    const snowMat = std('#ffffff', .92, { map: tex });
    snowMat.userData.ownedMap = tex;
    return {
      snow: snowMat,
      cliff: std('#c3d2dd', .8, { flatShading: true }),
      ice: std('#dbeef5', .18, { metalness: .05 }),
      shallow: std('#c3e3ea', .25),
      paver: std('#cdd5de', .9),
      curb: std('#a9b4bf', .9),
      frozen: std('#cfe8f0', .05, { metalness: .1 }),
      mountain: std('#ffffff', .95, { flatShading: true, vertexColors: true }),
      floe: std('#f2f8fb', .5, { flatShading: true }),
      carrot: std('#e07a2e', .7),
      scarf: std('#c4553d', .9),
      coal: std('#2b2b2b', .6),
    };
  },

  terrain(ctx) {
    const { mats } = ctx;
    flatPatch(ctx, outline(ctx, 10), ctx.seaY + .02, mats.shallow);
    extrudeLand(ctx, outline(ctx, 2.8), -.62, .6, [mats.ice, mats.ice], .5);
    extrudeLand(ctx, outline(ctx, 0), GRASS_Y, .75, [mats.snow, mats.cliff]);
  },

  plaza(ctx) {
    plazaBase(ctx);
    fountain(ctx, ctx.mats.frozen);
    plazaBenches(ctx, false);
    snowman(ctx, 3.3, -1.6);
  },

  decorate(ctx) {
    const { K, mats } = ctx;
    const m = edgeSpot(ctx, -140, 5.5, 7);
    if (m) mountain(ctx, m.x, m.z);
    const ig = innerSpot(ctx, 2.6, 'igloo');
    if (ig) igloo(ctx, ig.x, ig.z);
    lampPosts(ctx, 6);
    scatter(ctx, {
      key: 'pine', spacing: 4, max: 220, pad: 1.8, keep: c => .5 + c * .22,
      place: (x, z) => {
        if (rand() < .86) conifer(ctx, x, z, rr(2.8, 4.8), true);
        else {
          const s = rr(.35, .7);
          const r = K.mesh(new THREE.DodecahedronGeometry(s, 0), mats.floe);
          r.position.set(x, GRASS_Y + s * .3, z); r.scale.y = .6; ctx.raw.add(r);
        }
      },
    });
    alongShore(ctx, 'snowdrift', 3.6, [.5, 1.3], (x, z) => {
      if (rand() < .4) return;
      const s = rr(.4, .8);
      const d = K.mesh(new THREE.SphereGeometry(s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mats.floe);
      d.position.set(x, GRASS_Y - .02, z); d.scale.set(1.4, .45, 1); d.rotation.y = rr(0, 3); ctx.raw.add(d);
    });
    floes(ctx);
  },
};

function snowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f5f8'; g.fillRect(0, 0, 256, 256);
  seed(4242);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rand() < .5 ? `rgba(170,190,212,${rr(.05, .16)})` : `rgba(255,255,255,${rr(.4, .9)})`;
    const s = rr(1, 3);
    g.fillRect(rand() * 256, rand() * 256, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(.3, .3);
  return t;
}

/** 海边的雪山：一大一小两座低多边形山峰；按面片高度上色，雪线参差不齐 */
function mountain(ctx: ThemeCtx, x: number, z: number) {
  const { K, mats } = ctx;
  seedFromString('mountain:' + ctx.region.seed);
  const rock = new THREE.Color('#7d8791'), rock2 = new THREE.Color('#6b7580'), snowC = new THREE.Color('#f4f7fa');
  const peak = (px: number, pz: number, r: number, h: number) => {
    const geo = jitter(new THREE.ConeGeometry(r, h, 9, 5), r * .08, -h / 2).toNonIndexed();
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 3) {
      const t = ((pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3 + h / 2) / h;
      const c = t > .5 + rr(-.1, .08) ? snowC : rand() < .3 ? rock2 : rock;
      for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const m = K.mesh(geo, mats.mountain);
    m.position.set(px, GRASS_Y + h / 2 - .3, pz); m.rotation.y = rr(0, 1);
    ctx.raw.add(m);
  };
  peak(x, z, 8.5, 12);
  const a = Math.atan2(z - ctx.center[1], x - ctx.center[0]) + .9;
  peak(x + Math.cos(a) * 7.5, z + Math.sin(a) * 7.5, 5.2, 7.2);
  ctx.blockers.push({ x, z, r: 10 });
  ctx.landmarks.push({ kind: 'mountain', x, z, angle: 0 });
}

function igloo(ctx: ThemeCtx, x: number, z: number) {
  const { K, mats } = ctx;
  const dome = K.mesh(new THREE.SphereGeometry(1.6, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.floe);
  dome.position.set(x, GRASS_Y, z); ctx.raw.add(dome);
  const tunnel = K.mesh(new THREE.CylinderGeometry(.7, .7, 1.4, 14, 1, false, -Math.PI / 2, Math.PI), mats.floe);
  tunnel.rotation.x = Math.PI / 2; tunnel.position.set(x, GRASS_Y, z + 1.6); ctx.raw.add(tunnel);
  const door = K.mesh(new THREE.CircleGeometry(.5, 14, 0, Math.PI), mats.coal, false);
  door.position.set(x, GRASS_Y + .01, z + 2.31); ctx.raw.add(door);
  ctx.blockers.push({ x, z, r: 2.6 });
  ctx.landmarks.push({ kind: 'igloo', x, z, angle: 0 });
}

function snowman(ctx: ThemeCtx, x: number, z: number) {
  const { K, mats } = ctx;
  const g = new THREE.Group();
  const ball = (r: number, y: number) => { const m = K.mesh(new THREE.SphereGeometry(r, 16, 12), mats.floe); m.position.y = y; g.add(m); };
  ball(.42, .38); ball(.3, .98); ball(.21, 1.42);
  const nose = K.mesh(new THREE.ConeGeometry(.05, .26, 8), mats.carrot); nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.43, .3); g.add(nose);
  for (const s of [-1, 1]) { const e = K.mesh(new THREE.SphereGeometry(.028, 8, 6), mats.coal); e.position.set(s * .07, 1.5, .18); g.add(e); }
  const scarf = K.mesh(new THREE.TorusGeometry(.22, .05, 6, 18), mats.scarf); scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.23; g.add(scarf);
  g.position.set(x, GRASS_Y + .06, z);
  g.rotation.y = Math.atan2(4, 4);
  ctx.raw.add(g);
}

/** 海面上的浮冰 */
function floes(ctx: ThemeCtx) {
  const { K, mats } = ctx, [cx, cz] = ctx.center;
  seedFromString('floes:' + ctx.region.seed);
  for (let i = 0; i < 16; i++) {
    const a = rr(0, Math.PI * 2), r = ctx.R(a) + rr(4, 13);
    const s = rr(.8, 2.2);
    const f = K.mesh(jitter(new THREE.CylinderGeometry(s, s * 1.08, .3, 6), s * .12), mats.floe);
    f.position.set(cx + Math.cos(a) * r, ctx.seaY + .06, cz + Math.sin(a) * r); f.rotation.y = rr(0, 3);
    ctx.raw.add(f);
  }
}
