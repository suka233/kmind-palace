import * as THREE from 'three';
import type { Kit } from './kit';
import type { Catalog, Preset } from './catalog';
import { seedFromString } from './random';
import { t } from './i18n';

/* =====================================================================
 * 物件缩略图：借用主渲染器画到离屏目标，读回像素转成 dataURL。
 * 逐帧少量生成，避免打开目录面板时卡顿。
 * ===================================================================== */

const SIZE = 256;
const OUT = 128;

export class ThumbnailRenderer {
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 200);
  private rt = new THREE.WebGLRenderTarget(SIZE, SIZE);
  private cache = new Map<string, string>();
  private queue: { preset: Preset; resolve: (url: string) => void }[] = [];
  private raf = 0;
  private disposed = false;
  private pixels = new Uint8Array(SIZE * SIZE * 4);

  constructor(private renderer: THREE.WebGLRenderer, private K: Kit, private catalog: Catalog, env: THREE.Texture) {
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.scene.environment = env;
    this.scene.environmentIntensity = .75;
    this.scene.add(new THREE.HemisphereLight('#fff6ea', '#b7a58e', 1.3));
    const key = new THREE.DirectionalLight('#fff3e0', 1.9);
    key.position.set(3, 6, 5);
    this.scene.add(key);
  }

  get(preset: Preset): Promise<string> {
    const hit = this.cache.get(preset.id);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve) => {
      this.queue.push({ preset, resolve });
      if (!this.raf) this.raf = window.requestAnimationFrame(() => this.pump());
    });
  }

  private pump() {
    this.raf = 0;
    if (this.disposed) return;
    const start = performance.now();
    while (this.queue.length && performance.now() - start < 12) {
      const { preset, resolve } = this.queue.shift();
      const cached = this.cache.get(preset.id);
      if (cached) { resolve(cached); continue; }
      let url = '';
      try { url = this.draw(preset); } catch (e) { console.warn(t('[kmind-palace] 缩略图生成失败'), preset.id, e); }
      if (url) this.cache.set(preset.id, url);
      resolve(url);
    }
    if (this.queue.length) this.raf = window.requestAnimationFrame(() => this.pump());
  }

  private draw(preset: Preset) {
    const entry = this.catalog[preset.type];
    if (!entry) return '';
    const lamps = this.K.LAMPS.length;
    seedFromString(preset.id);
    const obj = entry.build(preset.params || {});
    this.K.LAMPS.length = lamps;
    // 缩略图不需要点光源（也避免主场景材质因灯光数量不同而重新编译）
    const lights: THREE.Object3D[] = [];
    obj.traverse(o => { if ((o as THREE.PointLight).isPointLight) lights.push(o); });
    lights.forEach(l => l.removeFromParent());
    this.scene.add(obj);
    obj.updateMatrixWorld(true);

    // 等距视角，按包围盒在相机空间里的投影紧凑取景
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const dir = entry.mount === 'wall' ? new THREE.Vector3(.55, .35, 1) : new THREE.Vector3(1, .95, 1.3);
    this.cam.position.copy(center).addScaledVector(dir.normalize(), 30);
    this.cam.lookAt(center);
    this.cam.updateMatrixWorld(true);
    const inv = this.cam.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const half = Math.max(maxX - minX, maxY - minY) / 2 * 1.12;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    Object.assign(this.cam, { left: cx - half, right: cx + half, top: cy + half, bottom: cy - half, near: .01, far: 100 });
    this.cam.updateProjectionMatrix();

    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.cam);
    r.readRenderTargetPixels(this.rt, 0, 0, SIZE, SIZE, this.pixels);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);

    this.scene.remove(obj);
    obj.traverse((o: any) => { if (o.isMesh && !o.geometry.userData.shared) o.geometry.dispose(); });

    // 翻转 Y 并 2 倍降采样（抗锯齿）
    const big = document.createElement('canvas');
    big.width = big.height = SIZE;
    const g = big.getContext('2d');
    const img = g.createImageData(SIZE, SIZE);
    const row = SIZE * 4;
    for (let y = 0; y < SIZE; y++) img.data.set(this.pixels.subarray((SIZE - 1 - y) * row, (SIZE - y) * row), y * row);
    g.putImageData(img, 0, 0);
    const out = document.createElement('canvas');
    out.width = out.height = OUT;
    const og = out.getContext('2d');
    og.imageSmoothingQuality = 'high';
    og.drawImage(big, 0, 0, OUT, OUT);
    return out.toDataURL('image/png');
  }

  dispose() {
    this.disposed = true;
    window.cancelAnimationFrame(this.raf);
    this.queue = [];
    this.rt.dispose();
  }
}
