import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { rand, rr, pick, seed } from './random';
import type { DocEntry, DocSource } from './host';
import { t } from './i18n';

/* =====================================================================
 * Kit：一个视图（PalaceView）独享的贴图、材质、灯光登记表与几何小工具。
 * 视图销毁时调用 kit.dispose() 统一释放 GPU 资源。
 * ===================================================================== */

export type Mat = THREE.Material | THREE.Material[];

export interface GlowEntry { m: THREE.MeshStandardMaterial; day: number; night: number }
export interface LampEntry { l: THREE.PointLight; intensity: number }

// ---------------- 程序化贴图 ----------------
function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
const tint = (hex: string, dl = 0, ds = 0) => '#' + new THREE.Color(hex).offsetHSL(0, ds, dl).getHexString();

function noise(g: CanvasRenderingContext2D, w: number, h: number, n: number, colorFn: () => string) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colorFn();
    g.fillRect(rand() * w, rand() * h, rr(1, 2.4), rr(1, 2.4));
  }
}

export function createKit({ maxAniso = 8 }: { maxAniso?: number } = {}) {
  const textures: THREE.Texture[] = [];
  const materials: THREE.Material[] = [];
  const GLOWS: GlowEntry[] = [];
  let LAMPS: LampEntry[] = [];

  function toTex(c: HTMLCanvasElement, { wrap = true, srgb = true } = {}) {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    textures.push(t);
    return t;
  }

  function texWood(base: string, { rows = 8, size = 1024, gap = 'rgba(70,45,28,.42)', grain = 'rgba(95,62,36,' } = {}) {
    const [c, g] = makeCanvas(size, size);
    const rh = size / rows;
    for (let r = 0; r < rows; r++) {
      const n = 2 + Math.floor(rand() * 2);
      const start = rand() * size;
      const joints: number[] = [];
      for (let i = 0; i < n; i++) joints.push((start + i * size / n + rr(-60, 60) + size) % size);
      joints.sort((a, b) => a - b);
      for (let i = 0; i < n; i++) {
        const a = joints[i], b = i + 1 < n ? joints[i + 1] : joints[0] + size;
        const len = b - a;
        const col = tint(base, rr(-.045, .045), rr(-.05, .05));
        const lines = [];
        for (let k = 0; k < 11; k++) lines.push({ y: r * rh + rr(3, rh - 3), ph: rr(0, 6), amp: rr(.4, 2.4), a: rr(.04, .13), w: rr(.6, 1.8) });
        const knot = rand() < .3 ? { x: rr(30, Math.max(31, len - 30)), rx: rr(6, 14), ry: rr(3, 6) } : null;
        for (const ox of [a, a - size]) {
          g.fillStyle = col; g.fillRect(ox, r * rh, len, rh);
          for (const L of lines) {
            g.strokeStyle = grain + L.a + ')'; g.lineWidth = L.w; g.beginPath();
            for (let xx = 0; xx <= len; xx += 16) {
              const px = ox + xx, py = L.y + Math.sin(xx * .012 + L.ph) * L.amp;
              if (xx) g.lineTo(px, py); else g.moveTo(px, py);
            }
            g.stroke();
          }
          if (knot) {
            g.fillStyle = 'rgba(90,55,30,.16)';
            g.beginPath(); g.ellipse(ox + knot.x, r * rh + rh / 2, knot.rx, knot.ry, 0, 0, Math.PI * 2); g.fill();
          }
          g.fillStyle = gap; g.fillRect(ox, r * rh, 2, rh);
        }
      }
      g.fillStyle = gap; g.fillRect(0, r * rh, size, 2);
    }
    return toTex(c);
  }

  function texTiles(base: string, grout: string, n = 4, { size = 512, vary = .025, gw = 3, speck = true } = {}) {
    const [c, g] = makeCanvas(size, size);
    g.fillStyle = grout; g.fillRect(0, 0, size, size);
    const s = size / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = tint(base, rr(-vary, vary));
      g.fillRect(i * s + gw / 2, j * s + gw / 2, s - gw, s - gw);
    }
    if (speck) noise(g, size, size, 2500, () => `rgba(${rand() < .5 ? '255,255,255' : '90,80,70'},${rr(.03, .09)})`);
    return toTex(c);
  }

  function texSubway(base = '#f4f1ec', grout = '#d9d3ca') {
    const [c, g] = makeCanvas(512, 512);
    g.fillStyle = grout; g.fillRect(0, 0, 512, 512);
    const tw = 128, th = 64;
    for (let r = 0; r < 8; r++) {
      const off = r % 2 ? tw / 2 : 0;
      for (let i = -1; i < 5; i++) {
        const x = i * tw + off;
        const grd = g.createLinearGradient(0, r * th, 0, r * th + th);
        const col = tint(base, rr(-.02, .02));
        grd.addColorStop(0, tint(col, .02)); grd.addColorStop(1, tint(col, -.03));
        g.fillStyle = grd; g.fillRect(x + 2, r * th + 2, tw - 4, th - 4);
      }
    }
    return toTex(c);
  }

  function texCement() {
    const [c, g] = makeCanvas(512, 512);
    const s = 128;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const x = i * s, y = j * s;
      g.fillStyle = '#efe7da'; g.fillRect(x, y, s, s);
      g.fillStyle = '#3f5068';
      for (const [cx, cy] of [[0, 0], [s, 0], [0, s], [s, s]]) { g.beginPath(); g.arc(x + cx, y + cy, s * .36, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#efe7da';
      for (const [cx, cy] of [[0, 0], [s, 0], [0, s], [s, s]]) { g.beginPath(); g.arc(x + cx, y + cy, s * .22, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#c98f4e';
      for (let k = 0; k < 4; k++) {
        g.save(); g.translate(x + s / 2, y + s / 2); g.rotate(k * Math.PI / 2 + Math.PI / 4);
        g.beginPath(); g.ellipse(0, -s * .17, s * .07, s * .15, 0, 0, Math.PI * 2); g.fill(); g.restore();
      }
      g.fillStyle = '#3f5068'; g.beginPath(); g.arc(x + s / 2, y + s / 2, s * .06, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(80,70,60,.35)'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, s - 2, s - 2);
    }
    noise(g, 512, 512, 3000, () => `rgba(80,70,60,${rr(.03, .08)})`);
    return toTex(c);
  }

  function texTerrazzo() {
    const [c, g] = makeCanvas(512, 512);
    g.fillStyle = '#f0ece5'; g.fillRect(0, 0, 512, 512);
    const cols = ['#c9b8a6', '#a3aba0', '#d9a88f', '#8f8b86', '#e2d7c8', '#b7c2c4'];
    for (let i = 0; i < 700; i++) {
      g.fillStyle = pick(cols);
      const x = rand() * 512, y = rand() * 512, r = rr(1.5, 5.5);
      g.beginPath();
      for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + rr(-.4, .4), rad = r * rr(.6, 1.2); g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
      g.fill();
    }
    return toTex(c);
  }

  function texLawn() {
    const [c, g] = makeCanvas(512, 512);
    g.fillStyle = '#a4b27f'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) {
      g.strokeStyle = `hsla(${rr(70, 100)},${rr(20, 38)}%,${rr(38, 62)}%,${rr(.25, .6)})`;
      g.lineWidth = rr(.8, 1.6);
      const x = rand() * 512, y = rand() * 512;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rr(-2, 2), y - rr(3, 7)); g.stroke();
    }
    return toTex(c);
  }

  const rugCache = new Map<string, THREE.Texture>();
  function texRug(kind: string) {
    if (rugCache.has(kind)) return rugCache.get(kind);
    seed(kind.length * 7919 + 17);
    const [c, g] = makeCanvas(1024, 768);
    const W = 1024, H = 768;
    const fiber = (n: number, a = .06) => noise(g, W, H, n, () => `rgba(${rand() < .5 ? '255,255,255' : '40,30,20'},${rr(.02, a)})`);
    if (kind === 'living') {
      g.fillStyle = '#efe5d3'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#3f4e67'; g.lineWidth = 26; g.strokeRect(46, 46, W - 92, H - 92);
      g.strokeStyle = '#c46d4d'; g.lineWidth = 6; g.strokeRect(84, 84, W - 168, H - 168);
      g.save(); g.beginPath(); g.rect(100, 100, W - 200, H - 200); g.clip();
      g.strokeStyle = 'rgba(63,78,103,.55)'; g.lineWidth = 3;
      for (let k = -H; k < W + H; k += 70) {
        g.beginPath(); g.moveTo(k, 0); g.lineTo(k + H, H); g.stroke();
        g.beginPath(); g.moveTo(k, H); g.lineTo(k + H, 0); g.stroke();
      }
      g.fillStyle = '#c46d4d';
      for (let x = 100; x < W; x += 70) for (let y = 100 + ((x / 70) % 2 ? 35 : 0); y < H; y += 70) { g.beginPath(); g.arc(x + 35, y, 4, 0, 7); g.fill(); }
      g.restore();
      fiber(26000);
    } else if (kind === 'bedroom') {
      g.fillStyle = '#ddd4c6'; g.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 48) { g.fillStyle = 'rgba(160,145,125,.28)'; g.fillRect(0, y, W, 20); g.fillStyle = 'rgba(120,105,90,.35)'; g.fillRect(0, y + 30, W, 3); }
      fiber(30000, .08);
    } else if (kind === 'study') {
      g.fillStyle = '#8a3f31'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#2f3d52'; g.lineWidth = 34; g.strokeRect(40, 40, W - 80, H - 80);
      const cols = ['#d9a441', '#efe3cf', '#2f3d52', '#c46d4d'];
      for (let row = 0; row < 6; row++) {
        const y = 130 + row * 95;
        for (let x = 140; x < W - 120; x += 90) {
          g.fillStyle = cols[(row + (x / 90 | 0)) % cols.length];
          g.beginPath(); g.moveTo(x, y - 34); g.lineTo(x + 28, y); g.lineTo(x, y + 34); g.lineTo(x - 28, y); g.fill();
          g.fillStyle = '#8a3f31'; g.beginPath(); g.moveTo(x, y - 12); g.lineTo(x + 10, y); g.lineTo(x, y + 12); g.lineTo(x - 10, y); g.fill();
        }
      }
      fiber(30000, .09);
    } else if (kind === 'jute') {
      g.fillStyle = '#c9ae86'; g.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) {
        g.fillStyle = ((x + y) / 8) % 2 ? 'rgba(120,90,50,.18)' : 'rgba(255,240,210,.12)';
        g.fillRect(x, y, 8, 8);
      }
      g.strokeStyle = 'rgba(110,80,45,.5)'; g.lineWidth = 10; g.strokeRect(20, 20, W - 40, H - 40);
      fiber(20000, .1);
    } else if (kind === 'bath') {
      g.fillStyle = '#c9d4cc'; g.fillRect(0, 0, W, H); fiber(40000, .12);
    } else {
      for (let x = 0; x < W; x += 64) { g.fillStyle = (x / 64) % 2 ? '#f1ebe0' : '#3e4d66'; g.fillRect(x, 0, 64, H); }
      fiber(20000, .08);
    }
    const t = toTex(c, { wrap: false });
    rugCache.set(kind, t);
    return t;
  }

  const artCache = new Map<string, THREE.Texture>();
  function texArt(kind: string) {
    if (artCache.has(kind)) return artCache.get(kind);
    seed(kind.length * 104729 + 3);
    const [c, g] = makeCanvas(512, 640);
    const W = 512, H = 640;
    if (kind === 'arch') {
      g.fillStyle = '#efe4d2'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#c46d4d'; g.beginPath(); g.moveTo(110, 520); g.lineTo(110, 300); g.arc(256, 300, 146, Math.PI, 0); g.lineTo(402, 520); g.fill();
      g.fillStyle = '#9cab97'; g.beginPath(); g.arc(256, 520, 120, Math.PI, 0); g.fill();
      g.fillStyle = '#d7a342'; g.beginPath(); g.arc(340, 170, 42, 0, 7); g.fill();
      g.fillStyle = '#3e4d66'; g.fillRect(110, 520, 292, 10);
    } else if (kind === 'mountain') {
      const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#f4dcc0'); sky.addColorStop(1, '#e8b89a');
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      g.fillStyle = '#fbf2e4'; g.beginPath(); g.arc(330, 230, 60, 0, 7); g.fill();
      const layers: [string, number][] = [['#a7b5a0', 360], ['#7f978b', 430], ['#56706b', 500], ['#3b5250', 570]];
      for (const [col, base] of layers) {
        g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
        for (let x = 0; x <= W; x += 32) g.lineTo(x, base - Math.sin(x * .012 + base) * 40 - rand() * 18);
        g.lineTo(W, H); g.fill();
      }
    } else if (kind === 'lines') {
      g.fillStyle = '#f5f1e9'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#e3b79f'; g.beginPath(); g.arc(300, 250, 110, 0, 7); g.fill();
      g.strokeStyle = '#2b2825'; g.lineWidth = 6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(90, 520); g.bezierCurveTo(150, 200, 330, 560, 420, 130); g.stroke();
      g.lineWidth = 3; g.beginPath(); g.moveTo(120, 140); g.bezierCurveTo(260, 90, 200, 400, 400, 470); g.stroke();
    } else if (kind === 'botanical') {
      g.fillStyle = '#ebe3d3'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#4f6b4a'; g.fillStyle = '#6d8a62'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(256, 590); g.quadraticCurveTo(240, 330, 270, 80); g.stroke();
      for (let i = 0; i < 9; i++) {
        const t = i / 9, y = 540 - t * 440, x = 256 - t * 8, side = i % 2 ? 1 : -1;
        g.save(); g.translate(x, y); g.rotate(side * (0.9 - t * .4));
        g.beginPath(); g.ellipse(0, -45, 20 - t * 6, 52 - t * 16, 0, 0, 7); g.fill(); g.restore();
      }
    } else if (kind === 'blocks') {
      g.fillStyle = '#f0e9dd'; g.fillRect(0, 0, W, H);
      const cols = ['#3e4d66', '#d7a342', '#c46d4d', '#9cab97', '#e8d8c3'];
      for (let i = 0; i < 7; i++) { g.fillStyle = cols[i % 5]; g.fillRect(rr(40, 320), rr(40, 460), rr(80, 180), rr(60, 160)); }
      g.strokeStyle = '#2b2825'; g.lineWidth = 5; g.beginPath(); g.arc(256, 320, 150, 0, 7); g.stroke();
    } else {
      const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#dbe6ea'); sky.addColorStop(.55, '#f1e6d6'); sky.addColorStop(.56, '#7ea0ad'); sky.addColorStop(1, '#3f6475');
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,.6)'; for (let i = 0; i < 30; i++) g.fillRect(rr(0, W), rr(370, H), rr(20, 80), 2);
    }
    noise(g, W, H, 4000, () => `rgba(60,50,40,${rr(.02, .06)})`);
    const t = toTex(c, { wrap: false });
    artCache.set(kind, t);
    return t;
  }

  function texTV() {
    const [c, g] = makeCanvas(768, 432);
    const sky = g.createLinearGradient(0, 0, 0, 432);
    sky.addColorStop(0, '#2d3b66'); sky.addColorStop(.45, '#c96d5a'); sky.addColorStop(.7, '#f2b86b'); sky.addColorStop(1, '#f7d9a0');
    g.fillStyle = sky; g.fillRect(0, 0, 768, 432);
    g.fillStyle = '#fff1cc'; g.beginPath(); g.arc(470, 260, 44, 0, 7); g.fill();
    const layers: [string, number][] = [['#6b4a5e', 280], ['#4a3550', 320], ['#2c2338', 370]];
    for (const [col, base] of layers) {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, 432);
      for (let x = 0; x <= 768; x += 24) g.lineTo(x, base - Math.abs(Math.sin(x * .01 + base)) * 60);
      g.lineTo(768, 432); g.fill();
    }
    return toTex(c, { wrap: false });
  }

  function texMonitor() {
    // 屏幕上是一张知识图谱 —— 致敬笔记软件
    const [c, g] = makeCanvas(640, 380);
    g.fillStyle = '#1f2430'; g.fillRect(0, 0, 640, 380);
    g.fillStyle = '#262c3a'; g.fillRect(0, 0, 150, 380);
    for (let i = 0; i < 12; i++) { g.fillStyle = `rgba(220,210,190,${i === 3 ? .8 : .28})`; g.fillRect(18, 26 + i * 26, rr(60, 110), 7); }
    const nodes: [number, number, number, string][] = [];
    for (let i = 0; i < 26; i++) nodes.push([rr(190, 610), rr(30, 350), rr(4, 11), pick(['#e9b872', '#8fb8a8', '#d98b73', '#9fb3d9', '#e8e2d4'])]);
    g.strokeStyle = 'rgba(200,190,170,.28)'; g.lineWidth = 1.5;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]);
      if (d < 120) { g.beginPath(); g.moveTo(nodes[i][0], nodes[i][1]); g.lineTo(nodes[j][0], nodes[j][1]); g.stroke(); }
    }
    for (const [x, y, r, col] of nodes) { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    return toTex(c, { wrap: false });
  }

  function texGlobe() {
    const [c, g] = makeCanvas(512, 256);
    g.fillStyle = '#7fa6b8'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#c9c08f';
    const blobs = [[90, 90, 60, 40], [120, 170, 30, 50], [250, 80, 50, 30], [270, 150, 35, 50], [370, 90, 80, 40], [420, 180, 30, 20]];
    for (const [x, y, rx, ry] of blobs) { g.beginPath(); g.ellipse(x, y, rx, ry, rr(-.5, .5), 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1;
    for (let y = 32; y < 256; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
    return toTex(c, { wrap: false });
  }

  function texBackground(stops: [number, string][]) {
    const [c, g] = makeCanvas(1024, 1024);
    const grd = g.createRadialGradient(512, 430, 40, 512, 512, 760);
    stops.forEach(([p, col]) => grd.addColorStop(p, col));
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 1024);
    return toTex(c, { wrap: false });
  }

  function texPin() {
    const [c, g] = makeCanvas(128, 160);
    g.shadowColor = 'rgba(60,30,10,.35)'; g.shadowBlur = 10; g.shadowOffsetY = 4;
    g.fillStyle = '#ef8235';
    g.beginPath(); g.arc(64, 58, 44, Math.PI * .8, Math.PI * .2); g.lineTo(64, 150); g.closePath(); g.fill();
    g.shadowColor = 'transparent';
    g.fillStyle = '#fff8ef'; g.beginPath(); g.arc(64, 58, 18, 0, 7); g.fill();
    return toTex(c, { wrap: false });
  }

  seed(20260930);
  const TEX = {
    oak: texWood('#d2ad83'),
    oakWarm: texWood('#b98c62'),
    deck: texWood('#94705a', { rows: 10, gap: 'rgba(40,25,15,.55)' }),
    tileLarge: texTiles('#e7e2da', '#cfc8be', 4),
    tileBath: texTiles('#dfe7e4', '#c3ccc9', 6, { vary: .015 }),
    cement: texCement(),
    subway: texSubway(),
    bathWall: texSubway('#eef2f0', '#cdd5d2'),
    terrazzo: texTerrazzo(),
    lawn: texLawn(),
    tv: texTV(),
    monitor: texMonitor(),
    globe: texGlobe(),
    pin: texPin(),
    bgDay: texBackground([[0, '#f8f2ea'], [.55, '#eadfd0'], [1, '#d3c3ae']]),
    bgNight: texBackground([[0, '#2c3244'], [.6, '#1b1f2c'], [1, '#10121a']]),
  };

  // ---------------- 材质 ----------------
  const std = (color: string, roughness = .8, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    materials.push(m);
    return m;
  };
  const physical = (p: THREE.MeshPhysicalMaterialParameters) => {
    const m = new THREE.MeshPhysicalMaterial(p);
    materials.push(m);
    return m;
  };
  const colorCache = new Map<string, THREE.MeshStandardMaterial>();
  // 按颜色复用的纯色材质（墙漆、窗帘等来自数据的颜色）
  const solid = (color: string, roughness = .95) => {
    const key = color + '|' + roughness;
    if (!colorCache.has(key)) colorCache.set(key, std(color, roughness));
    return colorCache.get(key);
  };

  const M = {
    wall: std('#f3eee7', .95),
    exterior: std('#e6ddd0', .95),
    cap: std('#3b3733', .9),
    baseboard: std('#fbf9f5', .5),
    slab: std('#d8d0c4', .95),
    plinth: std('#bfae98', .95),
    lawn: std('#ffffff', 1, 0, { map: TEX.lawn }),
    oak: std('#c9a47c', .55), oakLight: std('#e0c8a8', .6), walnut: std('#7a5238', .5), walnutDark: std('#4f3526', .55),
    white: std('#f6f3ee', .45), cream: std('#ece4d6', .7), black: std('#2a2826', .45, .2), charcoal: std('#3d3b39', .7),
    steel: std('#c3c6c9', .3, .85), brass: std('#c9a15b', .3, .9), chrome: std('#e2e5e8', .1, 1),
    ceramic: std('#f8f7f4', .15), porcelain: std('#fdfdfc', .08),
    sage: std('#9cab97', .92), sand: std('#d8cab4', .95), terracotta: std('#c46d4d', .95), mustard: std('#d7a342', .95),
    navy: std('#3e4d66', .95), rose: std('#d9a79a', .95), olive: std('#7d8455', .95), linen: std('#ede6da', 1),
    grey: std('#a9a49d', .95), charcoalFab: std('#55524e', .95), rust: std('#a8583b', .95), cushion: std('#f4efe6', 1),
    leaf: std('#5f8c4f', .75, 0, { flatShading: true }), leafDark: std('#46703f', .75, 0, { flatShading: true }),
    leafLight: std('#86a960', .75, 0, { flatShading: true }), leafOlive: std('#8d9c66', .8, 0, { flatShading: true }),
    leafBlade: std('#557a45', .7), leafFlat: std('#4f7f47', .7, 0, { side: THREE.DoubleSide }),
    trunk: std('#6d5240', .9), pampas: std('#e6d6b8', 1),
    pot: std('#bb6a4b', .85), potWhite: std('#ede8e0', .55), potGrey: std('#8d8983', .8), soil: std('#46372a', 1),
    glass: physical({ color: '#e3f0f3', roughness: .04, transparent: true, opacity: .22, depthWrite: false }),
    mirror: std('#dfe7ea', .02, 1),
    water: std('#a9d3dc', .05, .1),
    frame: std('#2b2a28', .5, .3),
    door: std('#f1ece4', .6), frontDoor: std('#35504a', .5),
    cabinet: std('#93a491', .55), cabinetUp: std('#f2eee7', .5), quartz: std('#f0ece5', .3, 0, { map: TEX.terrazzo }),
    fridge: std('#ebe6de', .35), seam: std('#6f6a63', .8), blackGlass: std('#161616', .12, .2),
    sinkInner: std('#8d9296', .35, .8), burner: std('#55504b', .5),
    paper: std('#fbf8f2', .9), book: std('#ffffff', .8),
    fruitO: std('#e0913a', .6), fruitR: std('#b43d33', .5), fruitY: std('#e5c957', .6), bread: std('#c98d4f', .9),
    fur: std('#d99b5c', 1), furWhite: std('#f3ece2', 1),
    bark: std('#7a5c46', .95), stone: std('#bdb7ad', .95),
    subway: std('#ffffff', .2, 0, { map: TEX.subway }),
    bathWall: std('#ffffff', .25, 0, { map: TEX.bathWall }),
    globe: std('#ffffff', .6, 0, { map: TEX.globe }),
  };

  function glow(base = '#f3ead9', emissive = '#ffd49a', night = 1.6, day = 0) {
    const m = std(base, .9, 0, { emissive, emissiveIntensity: day });
    GLOWS.push({ m, day, night });
    return m;
  }
  const G = {
    shade: glow('#efe6d6', '#ffcf8f', 1.3),
    shadeWarm: glow('#e9dcc6', '#ffc27a', 1.2),
    bulb: glow('#fff6e6', '#ffe2b0', 3.2, .15),
    ceiling: glow('#f7f4ef', '#fbf6ee', .03, .3),
    screen: std('#111', .25, 0, { emissive: '#ffffff', emissiveMap: TEX.tv, emissiveIntensity: .95 }),
    monitor: std('#111', .25, 0, { emissive: '#ffffff', emissiveMap: TEX.monitor, emissiveIntensity: .9 }),
  };
  G.shade.side = THREE.DoubleSide;
  G.shadeWarm.side = THREE.DoubleSide;

  const texturedCache = new Map<string, THREE.MeshStandardMaterial>();
  const texturedMat = (key: string, tex: THREE.Texture, roughness = 1) => {
    if (!texturedCache.has(key)) texturedCache.set(key, std('#ffffff', roughness, 0, { map: tex }));
    return texturedCache.get(key);
  };

  function addLight(parent: THREE.Object3D, x: number, y: number, z: number, intensity = 2.5, distance = 5, color = '#ffc88a') {
    const l = new THREE.PointLight(color, 0, distance, 2);
    l.position.set(x, y, z);
    parent.add(l);
    LAMPS.push({ l, intensity });
    return l;
  }

  // ---------------- 几何小工具（底部锚定） ----------------
  const geoCache = new Map<string, THREE.BufferGeometry>();
  function rbGeo(w: number, h: number, d: number, r: number) {
    r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(3)}`;
    let g = geoCache.get(key);
    if (!g) {
      g = r > .004 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
      g.userData.shared = true;
      geoCache.set(key, g);
    }
    return g;
  }
  function mesh(geo: THREE.BufferGeometry, mat: Mat, cast = true) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = true;
    return m;
  }
  function box(p: THREE.Object3D, w: number, h: number, d: number, mat: Mat, x = 0, y = 0, z = 0, r = .012) {
    const m = mesh(rbGeo(w, h, d, r), mat);
    m.position.set(x, y + h / 2, z); p.add(m); return m;
  }
  function cyl(p: THREE.Object3D, rt: number, rb: number, h: number, mat: Mat, x = 0, y = 0, z = 0, seg = 24, open = false) {
    const m = mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), mat);
    m.position.set(x, y + h / 2, z); p.add(m); return m;
  }
  function ball(p: THREE.Object3D, r: number, mat: Mat, x = 0, y = 0, z = 0, s: [number, number, number] = [1, 1, 1], seg = 20) {
    const m = mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg * .6 | 0)), mat);
    m.position.set(x, y, z); m.scale.set(s[0], s[1], s[2]); p.add(m); return m;
  }
  function lathe(p: THREE.Object3D, pts: number[][], mat: Mat, x = 0, y = 0, z = 0, seg = 28) {
    const m = mesh(new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), seg), mat);
    m.position.set(x, y, z); p.add(m); return m;
  }
  function ico(p: THREE.Object3D, r: number, mat: Mat, x: number, y: number, z: number, detail = 1) {
    const m = mesh(new THREE.IcosahedronGeometry(r, detail), mat);
    m.position.set(x, y, z); p.add(m); return m;
  }
  function plane(p: THREE.Object3D, w: number, h: number, mat: Mat, x: number, y: number, z: number, rx = 0, ry = 0, cast = false) {
    const m = mesh(new THREE.PlaneGeometry(w, h), mat, cast);
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); p.add(m); return m;
  }
  function torus(p: THREE.Object3D, R: number, r: number, mat: Mat, x: number, y: number, z: number, arc = Math.PI * 2, rot: [number, number, number] = [0, 0, 0]) {
    const m = mesh(new THREE.TorusGeometry(R, r, 10, 32, arc), mat);
    m.position.set(x, y, z); m.rotation.set(rot[0], rot[1], rot[2]); p.add(m); return m;
  }

  function dispose() {
    for (const p of models.values()) {
      void p.then(scene => scene.traverse((o: any) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of [].concat(o.material)) { for (const v of Object.values(m)) if ((v as any)?.isTexture) (v as THREE.Texture).dispose(); m.dispose(); }
      })).catch(() => { /* 没加载成功 */ });
    }
    models.clear();
    textures.forEach(t => t.dispose());
    materials.forEach(m => m.dispose());
    geoCache.forEach(g => g.dispose());
    geoCache.clear();
  }

  // ---------------- 运行时数据：由视图接上宿主（书架书目、用户照片） ----------------
  const runtime: {
    /** 书架书目（已拉取的缓存；还没拉到时返回 null） */
    shelfDocs?: (src: DocSource) => DocEntry[] | null;
    /** 读取用户照片，返回 <img src> 地址 */
    loadMedia?: (id: string) => Promise<string>;
    /** 异步资源（照片、模型）加载完成：视图更新图钉、碰撞体并重新渲染 */
    onLoaded?: () => void;
  } = {};

  const models = new Map<string, Promise<THREE.Object3D>>();
  /**
   * 导入的 3D 模型（glb）：每个文件只加载一次，物件各自克隆（共用几何体和材质，卸载物件时不释放）。
   */
  function loadModel(id: string): Promise<THREE.Object3D> {
    let p = models.get(id);
    if (p !== undefined) return p;
    const load = runtime.loadMedia;
    if (!load) return Promise.reject(new Error(t('当前环境不能读取模型')));
    p = load(id).then(url => new GLTFLoader().loadAsync(url)).then((gltf) => {
      const scene = gltf.scene;
      scene.traverse((o: any) => {
        if (!o.isMesh) return;
        o.geometry.userData.shared = true;
        o.castShadow = o.receiveShadow = true;
      });
      return scene;
    });
    models.set(id, p);
    p.catch(() => models.delete(id));
    return p;
  }

  const mediaMats = new Map<string, THREE.MeshStandardMaterial>();
  /**
   * 用户照片材质：先是浅灰占位，照片加载完换上（按 aspect 居中裁切铺满）。
   * 同一张照片、同一个比例的画框共用一个材质。screen 时是发光的屏幕（电视）：照片当自发光贴图，夜里更亮。
   */
  function mediaMat(id: string, aspect: number, screen = false) {
    const key = id + '@' + aspect.toFixed(2) + (screen ? '@screen' : '');
    const hit = mediaMats.get(key);
    if (hit) return hit;
    const mat = screen ? std('#111', .25, 0, { emissive: '#3a3a3a', emissiveIntensity: .95 }) : std('#d8d1c6', .75);
    if (screen) GLOWS.push({ m: mat, day: .95, night: 1.25 });
    mediaMats.set(key, mat);
    const load = runtime.loadMedia;
    if (load) {
      void load(id).then((url) => new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const tex = new THREE.Texture(img);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = maxAniso;
          const ia = img.width / img.height;
          if (ia > aspect) { tex.repeat.set(aspect / ia, 1); tex.offset.set((1 - aspect / ia) / 2, 0); }
          else { tex.repeat.set(1, ia / aspect); tex.offset.set(0, (1 - ia / aspect) / 2); }
          tex.needsUpdate = true;
          textures.push(tex);
          if (screen) { mat.emissiveMap = tex; mat.emissive.set('#ffffff'); } else { mat.map = tex; mat.color.set('#ffffff'); }
          mat.needsUpdate = true;
          runtime.onLoaded?.();
          resolve();
        };
        img.onerror = () => resolve();
        img.src = url;
      })).catch(e => console.warn(t('[kmind-palace] 读取照片失败'), id, e));
    }
    return mat;
  }

  return {
    TEX, M, G, GLOWS,
    get LAMPS() { return LAMPS; },
    resetLamps() { LAMPS = []; },
    std, solid, glow, texturedMat, texRug, texArt, addLight, runtime, mediaMat, loadModel, makeCanvas, toTex,
    rbGeo, mesh, box, cyl, ball, lathe, ico, plane, torus,
    dispose,
  };
}

export type Kit = ReturnType<typeof createKit>;
