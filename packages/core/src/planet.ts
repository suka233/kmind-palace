import * as THREE from 'three';
import { BEND, bendCenter } from './bend';

/* =====================================================================
 * 星球模式的氛围：星空背景 + 大气光晕。
 * p（0..1）是星球化程度：0 = 平面群岛，1 = 完全卷成小星球。
 * ===================================================================== */

const BG_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = position.xy * .5 + .5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const BG_FRAG = /* glsl */`
uniform float uP;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uDayIn;
uniform vec3 uDayOut;
uniform vec2 uRes;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // normal background (radial gradient, bright centre, dark edges) -> starry sky (dark top, lighter bottom)
  float r = length((vUv - vec2(.5, .58)) * vec2(uRes.x / uRes.y, 1.0));
  vec3 day = mix(uDayIn, uDayOut, smoothstep(.05, .85, r));
  vec3 space = mix(uBottom, uTop, smoothstep(0.0, 1.0, vUv.y));
  // stars: 4px screen grid, a star in a few cells, random brightness and size
  vec2 g = vUv * uRes / 4.0;
  vec2 cell = floor(g), f = fract(g);
  float h = hash(cell);
  vec2 c = vec2(hash(cell + 1.7), hash(cell + 4.1));
  float size = mix(.18, .42, hash(cell + 9.3));
  float star = step(.984, h) * smoothstep(size, 0.0, length(f - c));
  space += star * (.55 + .45 * hash(cell + 2.9)) * vec3(1.0, .96, .9);
  gl_FragColor = vec4(mix(day, space, uP), 1.0);
}`;

const ATMO_VERT = /* glsl */`
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ATMO_FRAG = /* glsl */`
uniform float uP;
uniform vec3 uColor;
varying vec3 vN;
void main() {
  // orthographic camera: view direction is always +z in view space
  float rim = pow(1.0 - abs(vN.z), 2.2);
  gl_FragColor = vec4(uColor * rim * 1.3, rim * uP);
}`;

export class PlanetFx {
  readonly bg: THREE.Mesh;
  readonly atmo: THREE.Mesh;
  private bgMat: THREE.ShaderMaterial;
  private atmoMat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    this.bgMat = new THREE.ShaderMaterial({
      vertexShader: BG_VERT, fragmentShader: BG_FRAG,
      uniforms: {
        uP: { value: 0 },
        uTop: { value: new THREE.Color('#1d2447') },
        uBottom: { value: new THREE.Color('#4a3f6b') },
        uDayIn: { value: new THREE.Color('#f8f2ea') },
        uDayOut: { value: new THREE.Color('#d3c3ae') },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      // 不透明、最先画（renderOrder），不做深度测试：相当于一张会变化的背景
      depthTest: false, depthWrite: false,
    });
    this.bgMat.userData.noBend = true;
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMat);
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -1000;
    this.bg.visible = false;
    this.bg.name = 'planet-sky';

    this.atmoMat = new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
      uniforms: { uP: { value: 0 }, uColor: { value: new THREE.Color('#9fd8ff') } },
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.atmoMat.userData.noBend = true;
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), this.atmoMat);
    this.atmo.visible = false;
    this.atmo.frustumCulled = false;
    this.atmo.name = 'planet-atmosphere';
    scene.add(this.bg, this.atmo);
  }

  /** p：星球化程度；R：星球半径；night：夜晚程度；w/h：画布尺寸（星星大小按像素） */
  update(p: number, R: number, night: number, w: number, h: number, scene?: THREE.Scene, fallback?: THREE.Texture) {
    const on = p > .001;
    this.bg.visible = this.atmo.visible = on;
    if (scene) scene.background = on ? null : fallback;
    if (!on) return;
    const u = this.bgMat.uniforms;
    (u.uDayIn.value as THREE.Color).set('#f8f2ea').lerp(new THREE.Color('#2c3244'), night);
    (u.uDayOut.value as THREE.Color).set('#d3c3ae').lerp(new THREE.Color('#10121a'), night);
    u.uP.value = THREE.MathUtils.smoothstep(p, .08, .6);
    u.uRes.value.set(w, h);
    (u.uTop.value as THREE.Color).set('#1d2447').lerp(new THREE.Color('#0c0f1f'), night);
    (u.uBottom.value as THREE.Color).set('#5a4b7a').lerp(new THREE.Color('#1c1b33'), night);
    this.atmoMat.uniforms.uP.value = THREE.MathUtils.smoothstep(p, .35, 1) * (1 - night * .4);
    bendCenter(this.atmo.position);
    // 光晕要把浮空岛（海面上方 14 m）也包进去
    this.atmo.scale.setScalar(R + Math.max(R * .09, 20));
    void BEND;
  }

  dispose() {
    this.bg.removeFromParent();
    this.atmo.removeFromParent();
    this.bg.geometry.dispose(); this.atmo.geometry.dispose();
    this.bgMat.dispose(); this.atmoMat.dispose();
  }
}
