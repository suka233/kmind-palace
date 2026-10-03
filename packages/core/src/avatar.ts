import * as THREE from 'three';
import { cleanLook, DEFAULT_LOOK, type Look, type Species } from './look';

/* =====================================================================
 * 角色（宠物 / 串门时的小人）：程序化拼出来的 Q 版小动物，和宫殿一样的低多边形画风。
 * 统一的骨架：身体、头、两只手（猫头鹰是翅膀）、两条腿、尾巴，外加挂点（头顶、脖子、脸、背）。
 * 外观是一份很小的 JSON（物种、三种颜色、配饰），串门时传给别人、AI 也能生成。
 * 动作只靠转动部件：站着呼吸、走路、挥手、跳一下、坐下。
 * ===================================================================== */

export type Anim = 'idle' | 'walk' | 'wave' | 'sit' | 'hop' | 'look';

const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, rough = .8) {
  const k = color + rough;
  let m = mats.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true }); mats.set(k, m); }
  return m;
}

const geos = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry) {
  let g = geos.get(key);
  if (!g) { g = make(); g.userData.shared = true; geos.set(key, g); }
  return g;
}
const sphere = (d = 1) => geo('s' + d, () => new THREE.IcosahedronGeometry(.5, d));
const cone = () => geo('cone', () => new THREE.ConeGeometry(.5, 1, 7));
const cyl = () => geo('cyl', () => new THREE.CylinderGeometry(.5, .5, 1, 10));
const box = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const torus = () => geo('torus', () => new THREE.TorusGeometry(.5, .16, 6, 14));

function part(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number], scale: [number, number, number], rot: [number, number, number] = [0, 0, 0]) {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(...pos);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rot);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function pivot(parent: THREE.Object3D, pos: [number, number, number]) {
  const p = new THREE.Group();
  p.position.set(...pos);
  parent.add(p);
  return p;
}

/**
 * 一个角色。root 放在脚下（y = 0 是地面），正面朝 +z。高约 0.45 米。
 */
export class Character {
  readonly root = new THREE.Group();
  look: Look;
  private body!: THREE.Group;
  private head!: THREE.Group;
  private armL!: THREE.Group;
  private armR!: THREE.Group;
  private legL!: THREE.Group;
  private legR!: THREE.Group;
  private tail!: THREE.Group;
  private eyes: THREE.Object3D[] = [];
  private rig: THREE.Group | null = null;
  private t = Math.random() * 10;
  private anim: Anim = 'idle';
  private animT = 0;
  private blinkAt = 2 + Math.random() * 3;

  constructor(look: Look = DEFAULT_LOOK, readonly scale = 1) {
    this.look = cleanLook(look);
    this.build();
  }

  setLook(look: Look) {
    this.look = cleanLook(look);
    // 只换掉身体；挂在 root 上的其他东西（名牌、气泡、点击球）保留
    this.rig?.removeFromParent();
    this.eyes = [];
    this.build();
  }

  private build() {
    const L = this.look, c = L.colors, sp = L.species as Species;
    const body = mat(c.body), belly = mat(c.belly), accent = mat(c.accent);
    const dark = mat('#2a211c', .5), white = mat('#ffffff', .4);
    const s = this.scale;
    const rig = this.rig = pivot(this.root, [0, 0, 0]);
    rig.scale.setScalar(s);

    // 腿（髋关节处转动）
    const legColor = sp === 'owl' ? accent : body;
    this.legL = pivot(rig, [-.055, .1, 0]);
    this.legR = pivot(rig, [.055, .1, 0]);
    for (const leg of [this.legL, this.legR]) {
      part(leg, cyl(), legColor, [0, -.05, 0], [.05, .1, .05]);
      part(leg, sphere(0), legColor, [0, -.095, .02], [.07, .04, .09]);
    }

    // 身体（上下起伏的中心）
    this.body = pivot(rig, [0, .1, 0]);
    part(this.body, sphere(1), body, [0, .1, 0], [.21, .22, .18]);
    part(this.body, sphere(1), belly, [0, .085, .045], [.15, .16, .11]);

    // 手 / 翅膀（肩处转动）
    this.armL = pivot(this.body, [-.1, .15, 0]);
    this.armR = pivot(this.body, [.1, .15, 0]);
    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      if (sp === 'owl') part(arm, sphere(1), body, [side * .025, -.05, -.005], [.06, .14, .1], [0, 0, side * .15]);
      else part(arm, sphere(0), body, [side * .015, -.05, .01], [.05, .11, .05], [0, 0, side * .2]);
    }

    // 尾巴
    this.tail = pivot(this.body, [0, .06, -.085]);
    if (sp === 'fox') {
      part(this.tail, sphere(1), body, [0, .02, -.08], [.09, .09, .18], [.5, 0, 0]);
      part(this.tail, sphere(1), belly, [0, .06, -.16], [.06, .06, .07]);
    } else if (sp === 'cat') {
      part(this.tail, cyl(), body, [0, .07, -.05], [.03, .17, .03], [-.7, 0, 0]);
    } else if (sp === 'rabbit' || sp === 'bear') {
      part(this.tail, sphere(0), sp === 'rabbit' ? belly : body, [0, 0, -.01], [.06, .06, .06]);
    } else {
      part(this.tail, cone(), body, [0, -.01, -.02], [.08, .06, .03], [-1.9, 0, 0]);
    }

    // 头
    this.head = pivot(this.body, [0, .22, 0]);
    const headR = sp === 'owl' ? .21 : .19;
    part(this.head, sphere(1), body, [0, .09, 0], [headR, headR * .95, headR * .92]);
    if (sp === 'owl') {
      part(this.head, sphere(1), belly, [0, .085, .055], [.17, .14, .08]);
      for (const side of [-1, 1]) part(this.head, cone(), body, [side * .07, .2, -.01], [.04, .07, .04], [0, 0, -side * .35]);
      part(this.head, cone(), accent, [0, .065, .1], [.03, .045, .03], [Math.PI, 0, 0]);
    } else {
      // 吻部
      const snout = sp === 'fox' ? [.07, .055, .1] as [number, number, number] : [.08, .05, .05] as [number, number, number];
      part(this.head, sphere(1), belly, [0, .055, .075], snout);
      part(this.head, sphere(0), dark, [0, .07, sp === 'fox' ? .125 : .1], [.022, .016, .016]);
      // 耳朵
      for (const side of [-1, 1]) {
        if (sp === 'rabbit') {
          const ear = pivot(this.head, [side * .045, .17, -.01]);
          ear.rotation.z = -side * .12;
          part(ear, sphere(1), body, [0, .09, 0], [.05, .18, .035]);
          part(ear, sphere(1), accent, [0, .09, .012], [.025, .13, .02]);
        } else if (sp === 'bear') {
          part(this.head, sphere(0), body, [side * .08, .17, -.01], [.06, .06, .04]);
        } else {
          const big = sp === 'fox' ? 1.25 : 1;
          part(this.head, cone(), body, [side * .065, .19, -.005], [.065 * big, .09 * big, .03], [0, 0, -side * .3]);
          part(this.head, cone(), sp === 'fox' ? dark : accent, [side * .065, .188, .008], [.035 * big, .055 * big, .01], [0, 0, -side * .3]);
        }
      }
    }
    // 眼睛（眨眼时压扁）
    const eyeY = sp === 'owl' ? .1 : .11, eyeZ = sp === 'owl' ? .085 : .075, eyeX = sp === 'owl' ? .05 : .045;
    for (const side of [-1, 1]) {
      const eye = pivot(this.head, [side * eyeX, eyeY, eyeZ]);
      if (sp === 'owl') part(eye, cyl(), white, [0, 0, 0], [.055, .01, .055], [Math.PI / 2, 0, 0]);
      part(eye, sphere(0), dark, [0, 0, .006], [sp === 'owl' ? .03 : .028, sp === 'owl' ? .03 : .034, .02]);
      part(eye, sphere(0), white, [side * -.006, .008, .016], [.008, .008, .006]);
      this.eyes.push(eye);
    }
    // 腮红
    if (sp !== 'owl') for (const side of [-1, 1]) part(this.head, sphere(0), mat('#f2a7a0', .9), [side * .085, .07, .06], [.03, .018, .01]);

    this.accessories(accent);
  }

  private accessories(accent: THREE.Material) {
    const sp = this.look.species;
    const top = sp === 'owl' ? .21 : .2;
    for (const a of this.look.accessories || []) {
      if (a === 'scarf') {
        part(this.body, torus(), mat('#c4453a'), [0, .2, 0], [.19, .19, .2], [Math.PI / 2, 0, 0]);
        part(this.body, box(), mat('#c4453a'), [.05, .14, .07], [.04, .09, .015], [0, 0, .2]);
      } else if (a === 'party') {
        part(this.head, cone(), mat('#4f86c6'), [.02, top + .07, 0], [.08, .14, .08], [0, 0, -.15]);
        part(this.head, sphere(0), mat('#f2c94c'), [.032, top + .15, 0], [.03, .03, .03]);
      } else if (a === 'tophat') {
        part(this.head, cyl(), mat('#2a211c'), [0, top + .005, 0], [.16, .012, .16]);
        part(this.head, cyl(), mat('#2a211c'), [0, top + .055, 0], [.1, .1, .1]);
        part(this.head, cyl(), mat('#c4453a'), [0, top + .02, 0], [.103, .018, .103]);
      } else if (a === 'crown') {
        part(this.head, cyl(), mat('#e8b93c', .3), [0, top + .02, 0], [.12, .04, .12]);
        for (let i = 0; i < 5; i++) {
          const ang = i / 5 * Math.PI * 2;
          part(this.head, cone(), mat('#e8b93c', .3), [Math.sin(ang) * .05, top + .06, Math.cos(ang) * .05], [.03, .045, .03]);
        }
      } else if (a === 'glasses') {
        const y = sp === 'owl' ? .1 : .11, z = sp === 'owl' ? .1 : .095;
        for (const side of [-1, 1]) part(this.head, torus(), mat('#2a211c', .4), [side * .05, y, z], [.05, .05, .04]);
        part(this.head, box(), mat('#2a211c', .4), [0, y + .005, z], [.03, .006, .006]);
      } else if (a === 'bow') {
        for (const side of [-1, 1]) part(this.head, sphere(0), mat('#e87aa0'), [.07 + side * .025, top - .02, .02], [.04, .03, .02], [0, 0, side * .5]);
        part(this.head, sphere(0), mat('#c95c84'), [.07, top - .02, .022], [.018, .018, .018]);
      } else if (a === 'backpack') {
        part(this.body, box(), accent, [0, .11, -.105], [.15, .15, .07]);
        part(this.body, box(), mat('#2a211c', .6), [0, .14, -.142], [.1, .04, .01]);
      }
    }
  }

  /** 换一个动作（walk / idle 由移动状态决定，wave / hop 播一遍后回到 idle） */
  play(a: Anim) {
    if (a === this.anim && (a === 'walk' || a === 'idle' || a === 'sit')) return;
    this.anim = a;
    this.animT = 0;
  }

  get current() { return this.anim; }

  /** 每帧调用；返回 true 表示还在动（需要继续渲染） */
  update(dt: number): boolean {
    this.t += dt;
    this.animT += dt;
    const t = this.t, a = this.anim;
    const walk = a === 'walk';
    const sw = walk ? Math.sin(t * 9) : 0;
    this.legL.rotation.x = sw * .6;
    this.legR.rotation.x = -sw * .6;
    this.armL.rotation.x = -sw * .5;
    this.armR.rotation.x = sw * .5;
    this.armL.rotation.z = 0;
    this.armR.rotation.z = 0;
    this.body.position.y = .1 + (walk ? Math.abs(Math.sin(t * 9)) * .02 : Math.sin(t * 2) * .004);
    this.body.rotation.z = walk ? Math.sin(t * 9) * .05 : 0;
    this.body.rotation.x = 0;
    this.head.rotation.z = walk ? 0 : Math.sin(t * .7) * .06;
    this.head.rotation.y = 0;
    this.tail.rotation.y = Math.sin(t * (walk ? 9 : 2)) * .35;
    let busy = walk;
    if (a === 'wave') {
      const k = Math.min(1, this.animT * 4);
      this.armR.rotation.z = 2.4 * k;
      this.armR.rotation.x = Math.sin(this.animT * 14) * .35;
      busy = true;
      if (this.animT > 1.6) this.anim = 'idle';
    } else if (a === 'hop') {
      const h = Math.max(0, Math.sin(Math.min(1, this.animT / .45) * Math.PI));
      this.body.position.y = .1 + h * .12;
      this.legL.rotation.x = this.legR.rotation.x = -h * .4;
      this.armL.rotation.z = -h * 1.2;
      this.armR.rotation.z = h * 1.2;
      busy = true;
      if (this.animT > .5) this.anim = 'idle';
    } else if (a === 'look') {
      // 东张西望
      this.head.rotation.y = Math.sin(this.animT * 2.6) * .7 * Math.min(1, (1.8 - this.animT) * 3);
      busy = true;
      if (this.animT > 1.8) { this.anim = 'idle'; this.head.rotation.y = 0; }
    } else if (a === 'sit') {
      this.body.position.y = .045;
      this.legL.rotation.x = this.legR.rotation.x = -1.3;
    }
    // 眨眼
    this.blinkAt -= dt;
    const blink = this.blinkAt < 0 && this.blinkAt > -.12;
    for (const e of this.eyes) e.scale.y = blink ? .15 : 1;
    if (this.blinkAt < -.12) this.blinkAt = 2.5 + Math.random() * 4;
    return busy || blink;
  }

  dispose() {
    this.root.removeFromParent();
  }
}

/** 角色的缩略图（换装面板里预览）：离屏渲染一张图 */
export function renderLookThumb(renderer: THREE.WebGLRenderer, look: Look, size = 160): string {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff8ee', '#b9a58f', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.4);
  sun.position.set(1, 2, 2);
  scene.add(sun);
  const ch = new Character(look);
  ch.root.rotation.y = -.45;
  scene.add(ch.root);
  ch.update(0);
  const cam = new THREE.PerspectiveCamera(30, 1, .1, 10);
  cam.position.set(0, .42, 1.22);
  cam.lookAt(0, .3, 0);
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
  const prevRT = renderer.getRenderTarget(), prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor('#000000', 0);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevColor, prevAlpha);
  rt.dispose();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  // 渲染目标里是线性颜色：转成 sRGB 再画（alpha 不变），同时上下翻转
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; lut[i] = Math.round(255 * (c <= .0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - .055)); }
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4, dst = y * size * 4;
    for (let i = 0; i < size * 4; i += 4) {
      img.data[dst + i] = lut[px[src + i]]; img.data[dst + i + 1] = lut[px[src + i + 1]]; img.data[dst + i + 2] = lut[px[src + i + 2]]; img.data[dst + i + 3] = px[src + i + 3];
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
