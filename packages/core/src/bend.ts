import * as THREE from 'three';

/* =====================================================================
 * 弯曲世界（小王子星球）
 * 世界数据始终是平面地图；在顶点着色器里以平面上的一点 P 为「北极」，
 * 把平面卷到一个半径 R 的球面上：距 P 为 d 的点落在球面上角度 d / R 处（方位等距投影的逆）。
 *   R → ∞  平面（曲率 k = 1/R = 0，着色器直接跳过）
 *   R 变小  地平线下弯 → 群岛卷成一颗小星球
 * 北极放在镜头焦点 T 的「背后」，距离正好让 T 落在正对镜头的那一面正中；
 * 再整体平移，让 T 弯曲前后在屏幕上的位置不变——拉远时群岛始终在画面中央。
 * 拖动地图 = 移动 T（北极跟着走）= 星球在转；变形都藏在背面。
 * 名牌定位、射线拾取在 JS 里用同一套公式（bendPoint / unbendRay）。
 * ===================================================================== */

export const BEND = {
  /** 曲率 1/R；0 表示平面 */
  k: { value: 0 },
  /** 北极在平面地图上的位置 */
  pole: { value: new THREE.Vector3() },
  /** 弯曲后的整体平移 */
  offset: { value: new THREE.Vector3() },
};

const GLSL = /* glsl */`
uniform float kpBendK;
uniform vec3 kpBendPole;
uniform vec3 kpBendOffset;
vec3 kpBend(vec3 p) {
  if (kpBendK <= 0.0) return p;
  float R = 1.0 / kpBendK;
  vec2 d = p.xz - kpBendPole.xz;
  float dist = length(d);
  float th = min(dist * kpBendK, 3.14159);
  vec2 u = dist > 1e-5 ? d / dist : vec2(0.0);
  float r = R + p.y;
  return vec3(r * sin(th) * u.x, r * cos(th) - R, r * sin(th) * u.y) + vec3(kpBendPole.x, 0.0, kpBendPole.z) + kpBendOffset;
}
vec3 kpBendNormal(vec3 n, vec3 p) {
  if (kpBendK <= 0.0) return n;
  vec2 d = p.xz - kpBendPole.xz;
  float dist = length(d);
  if (dist < 1e-5) return n;
  float th = min(dist * kpBendK, 3.14159);
  vec3 k = vec3(d.y, 0.0, -d.x) / dist;
  float c = cos(th), s = sin(th);
  return n * c + cross(k, n) * s + k * dot(k, n) * (1.0 - c);
}
`;

const PROJECT = /* glsl */`
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
vec4 kpWorld = modelMatrix * mvPosition;
kpWorld.xyz = kpBend( kpWorld.xyz );
mvPosition = viewMatrix * kpWorld;
gl_Position = projectionMatrix * mvPosition;
`;

const NORMAL = /* glsl */`
#include <defaultnormal_vertex>
if ( kpBendK > 0.0 ) {
	vec3 kpN = transpose( mat3( viewMatrix ) ) * transformedNormal;
	vec3 kpP = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
	transformedNormal = normalize( mat3( viewMatrix ) * kpBendNormal( kpN, kpP ) );
}
`;

/** 标记挂在材质上（而不是模块内的 WeakSet）：页面里即使加载了两份代码也不会重复打补丁 */
const MARK = '__kpBend';
const isPatched = (m: THREE.Material) => !!(m as any)[MARK];

/** 给一个材质接上弯曲（只接一次；曲率为 0 时和原来完全一样） */
export function bendMaterial(m: THREE.Material) {
  if (!m || isPatched(m) || (m as any).isShaderMaterial || m.userData?.noBend) return;
  (m as any)[MARK] = true;
  const prev = m.onBeforeCompile?.bind(m);
  m.onBeforeCompile = function (shader, renderer) {
    prev?.(shader, renderer);
    if (shader.vertexShader.includes('kpBend(')) return;
    shader.uniforms.kpBendK = BEND.k;
    shader.uniforms.kpBendPole = BEND.pole;
    shader.uniforms.kpBendOffset = BEND.offset;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + GLSL)
      .replace('#include <project_vertex>', PROJECT)
      .replace('#include <defaultnormal_vertex>', NORMAL);
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = function () { return prevKey() + '|kpbend'; };
  m.needsUpdate = true;
}

/** 给一棵物体树里所有网格的材质接上弯曲 */
export function bendScene(root: THREE.Object3D) {
  let n = 0;
  root.traverse((o: any) => {
    if (!o.isMesh || !o.material) return;
    for (const m of ([] as THREE.Material[]).concat(o.material)) {
      if (!isPatched(m)) { bendMaterial(m); n++; }
    }
  });
  return n;
}

// =====================================================================
// JS 版本：名牌定位、拾取
// =====================================================================

/** 平面世界坐标 → 弯曲后的位置（与着色器一致）；raw 时不加整体平移 */
export function bendPoint(p: THREE.Vector3, out = new THREE.Vector3(), raw = false) {
  const k = BEND.k.value;
  if (k <= 0) return out.copy(p);
  const R = 1 / k, P = BEND.pole.value;
  const dx = p.x - P.x, dz = p.z - P.z, dist = Math.hypot(dx, dz);
  const th = Math.min(dist * k, Math.PI);
  const ux = dist > 1e-5 ? dx / dist : 0, uz = dist > 1e-5 ? dz / dist : 0;
  const r = R + p.y;
  out.set(r * Math.sin(th) * ux + P.x, r * Math.cos(th) - R, r * Math.sin(th) * uz + P.z);
  if (!raw) out.add(BEND.offset.value);
  return out;
}

/** 弯曲后某点的球面法线（判断在不在星球背面） */
export function bendNormal(p: THREE.Vector3, out = new THREE.Vector3()) {
  const k = BEND.k.value;
  if (k <= 0) return out.set(0, 1, 0);
  const P = BEND.pole.value;
  const dx = p.x - P.x, dz = p.z - P.z, dist = Math.hypot(dx, dz);
  const th = Math.min(dist * k, Math.PI);
  const ux = dist > 1e-5 ? dx / dist : 0, uz = dist > 1e-5 ? dz / dist : 0;
  return out.set(Math.sin(th) * ux, Math.cos(th), Math.sin(th) * uz);
}

/** 星球球心（弯曲后的世界坐标） */
export function bendCenter(out = new THREE.Vector3()) {
  const k = BEND.k.value, P = BEND.pole.value;
  return out.set(P.x, -1 / Math.max(k, 1e-9), P.z).add(BEND.offset.value);
}

/**
 * 设置弯曲：曲率 k，镜头焦点 target，镜头方向（从焦点指向相机）camDir。
 * 北极放在焦点背后 tilt · (90° − 仰角) 的弧长处，再平移让焦点保持原位。
 * tilt 随星球化程度从 0 增到 1：刚开始卷时焦点附近仍是熟悉的斜俯视，
 * 完全卷起时焦点正好落在星球正对镜头的那一面正中。
 */
export function setBend(k: number, target: THREE.Vector3, camDir: THREE.Vector3, tilt = 1) {
  BEND.k.value = k;
  if (k <= 0) { BEND.offset.value.set(0, 0, 0); return; }
  const R = 1 / k;
  const h = Math.hypot(camDir.x, camDir.z) || 1;
  const el = Math.atan2(camDir.y, h);
  const a0 = (Math.PI / 2 - el) * tilt;
  BEND.pole.value.set(target.x - camDir.x / h * a0 * R, 0, target.z - camDir.z / h * a0 * R);
  const t = new THREE.Vector3(target.x, 0, target.z);
  const bt = bendPoint(t, new THREE.Vector3(), true);
  BEND.offset.value.copy(t).sub(bt);
}

/**
 * 射线打在「高度 h 的球面」上，再展开回平面地图坐标（y = h）。
 * 没打中返回 null。
 */
export function unbendRay(ray: THREE.Ray, h: number, out = new THREE.Vector3()) {
  const k = BEND.k.value;
  if (k <= 0) return ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h), out);
  const R = 1 / k, C = bendCenter(new THREE.Vector3());
  const hit = ray.intersectSphere(new THREE.Sphere(C, R + h), new THREE.Vector3());
  if (!hit) return null;
  const v = hit.sub(C);
  const len = v.length();
  const th = Math.acos(THREE.MathUtils.clamp(v.y / len, -1, 1));
  const hx = Math.hypot(v.x, v.z);
  const ux = hx > 1e-6 ? v.x / hx : 0, uz = hx > 1e-6 ? v.z / hx : 0;
  const P = BEND.pole.value;
  return out.set(P.x + ux * th * R, h, P.z + uz * th * R);
}
