import * as THREE from 'three';
import { rand, rr } from '../random';
import {
  GRASS_Y, type ThemePack, outline, flatPatch, extrudeLand, plazaBase, plazaBenches, fountain, edgeSpot, lighthouse, pier,
  lampPosts, scatter, leafyTree, alongShore, shrub, seaRocks,
} from './common';

/** 海岛：沙滩、浅滩、灯塔、码头和小船 */
export const island: ThemePack = {
  id: 'island',
  name: '海岛',
  desc: '沙滩、灯塔和码头',
  icon: '🏝',
  colors: ['#a4b27f', '#ecd9b2', '#7cc4c0'],

  materials(K) {
    const std = (color: string, roughness = .9, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
    const lawn = K.TEX.lawn.clone();
    lawn.needsUpdate = true;
    lawn.repeat.set(.36, .36);
    return {
      grass: std('#ffffff', 1, { map: lawn }),
      cliff: std('#b39873', .95),
      sand: std('#ecd9b2', .95),
      shallow: std('#a6ddd2', .3),
      paver: std('#e4d8c6', .95),
      curb: std('#cdbfa9', .95),
    };
  },

  terrain(ctx) {
    const { mats } = ctx;
    flatPatch(ctx, outline(ctx, 9), ctx.seaY + .02, mats.shallow);
    extrudeLand(ctx, outline(ctx, 3.4), -.55, .7, [mats.sand, mats.sand]);
    extrudeLand(ctx, outline(ctx, 0), GRASS_Y, .75, [mats.grass, mats.cliff]);
  },

  plaza(ctx) {
    plazaBase(ctx);
    fountain(ctx, ctx.mats.fountain);
    plazaBenches(ctx);
  },

  decorate(ctx) {
    const { K, mats } = ctx;
    const lh = edgeSpot(ctx, -18, 2.6, 3);
    if (lh) lighthouse(ctx, lh.x, lh.z);
    const p = edgeSpot(ctx, 95, 1.2, 3);
    if (p) pier(ctx, p.x, p.z, p.a);
    lampPosts(ctx);
    const leaves = [K.M.leaf, K.M.leafLight, K.M.leafDark];
    scatter(ctx, {
      key: 'tree', spacing: 4.6, max: 160, pad: 2, keep: c => .42 + c * .24,
      place: (x, z) => {
        const h = rr(2.5, 3.9), variant = Math.floor(rand() * 3), kind = rand();
        if (kind < .72) leafyTree(ctx, x, z, h, variant);
        else shrub(ctx, x, z, rr(.35, .6), [leaves[variant], leaves[(variant + 1) % 3]]);
      },
    });
    const flowers = [K.M.terracotta, K.M.mustard, K.M.rose];
    alongShore(ctx, 'shore', 4.2, [1, 1.8], (x, z, i) => {
      if (rand() < .3) return;
      const s = rr(.35, .6);
      shrub(ctx, x, z, s, [leaves[i % 3], leaves[(i + 1) % 3]]);
      if (rand() < .35) K.ball(ctx.raw, .1, flowers[i % 3], x + .2, GRASS_Y + s * 1.1, z + .1, [1, 1, 1], 10);
    });
    seaRocks(ctx, 9, mats.rock);
  },
};
