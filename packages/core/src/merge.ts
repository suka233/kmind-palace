import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* =====================================================================
 * 静态合并：把一棵由许多小网格组成的物体树，按材质合并成少量大网格。
 * 小镇里的树、路灯、宫殿外壳都是静态的，合并后绘制调用从上千降到几十。
 * - 变换烘焙到 root 的局部坐标（root 自身的变换保留在返回的 group 上由调用者设置）
 * - 隐藏的网格（例如碰撞体）跳过
 * - 点光源原样搬到结果里（仍在 Kit 的灯光登记表中）
 * ===================================================================== */

const KEEP = ['position', 'normal', 'uv', 'color'];

export function mergeStatic(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  const out = new THREE.Group();
  const lights: THREE.Light[] = [];
  const mtx = new THREE.Matrix4();

  const visit = (o: THREE.Object3D) => {
    if (!o.visible) return;
    if ((o as THREE.Light).isLight) { lights.push(o as THREE.Light); return; }
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as any).isInstancedMesh && m.geometry?.attributes.position) {
      mtx.multiplyMatrices(inv, m.matrixWorld);
      const mats = ([] as THREE.Material[]).concat(m.material);
      const src = prepare(m.geometry, mtx);
      const parts: [THREE.Material, THREE.BufferGeometry][] = [];
      if (Array.isArray(m.material) && src.groups.length) {
        for (const g of src.groups) {
          const mat = mats[g.materialIndex ?? 0];
          if (mat) parts.push([mat, slice(src, g.start, g.count)]);
        }
        src.dispose();
      } else {
        src.clearGroups();
        parts.push([mats[0], src]);
      }
      for (const [mat, geo] of parts) {
        const key = mat.uuid + (m.castShadow ? '|c' : '|n');
        let b = buckets.get(key);
        if (!b) buckets.set(key, b = { mat, cast: m.castShadow, geos: [] });
        b.geos.push(geo);
      }
    }
    for (const c of o.children) visit(c);
  };
  for (const c of root.children) visit(c);

  for (const { mat, cast, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  for (const l of lights) {
    l.updateMatrixWorld(true);
    const p = new THREE.Vector3().setFromMatrixPosition(l.matrixWorld).applyMatrix4(inv);
    l.removeFromParent();
    l.position.copy(p);
    out.add(l);
  }
  return out;
}

// =====================================================================
// 物件内部合批
// =====================================================================

/** 带这些标记的节点连同子树原样保留：部件、碰撞体、子物件、叠加标记、之后会被替换的占位（keep） */
const PINNED = ['slot', 'slots', 'faceSlots', 'slotVerts', 'collider', 'keep', 'item', 'overlay'];
const isPinned = (o: THREE.Object3D) => PINNED.some(k => o.userData[k] !== undefined);

function mergeable(m: THREE.Mesh) {
  const g = m.geometry;
  if ((m as any).isInstancedMesh || (m as any).isSkinnedMesh || Array.isArray(m.material)) return false;
  if (m.children.length || m.renderOrder !== 0 || !m.frustumCulled || m.layers.mask !== 1 || m.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return false;
  if (!g?.attributes.position || Object.keys(g.morphAttributes).length) return false;
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false;
  return Object.values(g.attributes).every(a => !(a as any).isInterleavedBufferAttribute);
}

/** 合并时属性要一致：按材质、阴影设置和顶点色分组 */
function bucketKey(m: THREE.Mesh) {
  const col = m.geometry.attributes.color as THREE.BufferAttribute | undefined;
  const mat = m.material as THREE.Material;
  return `${mat.uuid}|${+m.castShadow}${+m.receiveShadow}|${col ? `${col.itemSize}${col.array.constructor.name}${+col.normalized}` : '-'}`;
}

/**
 * 物件内部合批（原地修改）：一件家具通常由十几个小网格拼成（腿、面板、把手……），
 * 把其中静态的按材质合并成一个，宫殿里的绘制调用（以及阴影、GTAO 的重复绘制）随之大幅减少。
 * 保持原样的：PINNED 标记的节点及其子树、InstancedMesh、隐藏的节点、多材质 / 有子节点 / 特殊渲染设置的网格。
 * 合并结果烘焙到 root 的局部坐标，直接挂在 root 下；保持索引，共享几何体不释放。
 * 返回减少的网格数。
 */
export function mergeInPlace(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map<string, THREE.Mesh[]>();
  const visit = (o: THREE.Object3D) => {
    if (!o.visible || (o !== root && isPinned(o))) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && mergeable(m)) {
      const key = bucketKey(m);
      const list = buckets.get(key);
      if (list) list.push(m); else buckets.set(key, [m]);
    }
    for (const c of o.children) visit(c);
  };
  visit(root);

  let saved = 0;
  const mtx = new THREE.Matrix4();
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const geos = meshes.map(m => bake(m.geometry, mtx.multiplyMatrices(inv, m.matrixWorld)));
    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const first = meshes[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    root.add(mesh);
    for (const m of meshes) {
      m.removeFromParent();
      if (!m.geometry.userData.shared) m.geometry.dispose();
    }
    saved += meshes.length - 1;
  }
  if (saved) prune(root, root);
  return saved;
}

/** 去掉合并后变空的分组 */
function prune(o: THREE.Object3D, root: THREE.Object3D) {
  for (const c of [...o.children]) prune(c, root);
  if (o !== root && !o.children.length && (o as any).type === 'Group' && !Object.keys(o.userData).length) o.removeFromParent();
}

/** 保持索引的烘焙：只留 position / normal / uv / color，补齐 uv / normal / 索引；镜像变换时翻转索引里的绕序 */
function bake(g: THREE.BufferGeometry, m: THREE.Matrix4) {
  const src = new THREE.BufferGeometry();
  for (const name of KEEP) if (g.attributes[name]) src.setAttribute(name, (g.attributes[name] as THREE.BufferAttribute).clone());
  const n = src.attributes.position.count;
  if (g.index) {
    src.setIndex(g.index.clone());
  } else {
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    src.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  if (!src.attributes.uv) src.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!src.attributes.normal) src.computeVertexNormals();
  src.applyMatrix4(m);
  if (m.determinant() < 0) {
    const a = src.index.array;
    for (let i = 0; i + 2 < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
  }
  return src;
}

/** 非索引化、只保留 position / normal / uv，烘焙变换；镜像变换时翻转三角形绕序 */
function prepare(g: THREE.BufferGeometry, m: THREE.Matrix4) {
  const src = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(src.attributes)) if (!KEEP.includes(name)) src.deleteAttribute(name);
  src.morphAttributes = {};
  const n = src.attributes.position.count;
  if (!src.attributes.uv) src.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!src.attributes.normal) src.computeVertexNormals();
  src.applyMatrix4(m);
  if (m.determinant() < 0) {
    for (const name of KEEP) {
      const a = src.attributes[name] as THREE.BufferAttribute;
      if (!a) continue;
      const s = a.itemSize, arr = a.array as Float32Array;
      for (let i = 0; i + 2 < n; i += 3) {
        for (let k = 0; k < s; k++) {
          const p = (i + 1) * s + k, q = (i + 2) * s + k, t = arr[p];
          arr[p] = arr[q]; arr[q] = t;
        }
      }
    }
  }
  return src;
}

function slice(src: THREE.BufferGeometry, start: number, count: number) {
  const g = new THREE.BufferGeometry();
  const end = Math.min(start + count, src.attributes.position.count);
  for (const name of KEEP) {
    const a = src.attributes[name] as THREE.BufferAttribute;
    if (!a) continue;
    g.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(start * a.itemSize, end * a.itemSize), a.itemSize));
  }
  return g;
}

/** 释放一棵物体树里的几何体（跳过 Kit 缓存的共享几何体）；ownedMaterials 为真时连同材质一起释放 */
export function disposeTree(root: THREE.Object3D, ownedMaterials = false) {
  root.traverse((o: any) => {
    if (o.isMesh || o.isInstancedMesh) {
      if (!o.geometry?.userData?.shared) o.geometry?.dispose();
      if (o.isInstancedMesh) o.dispose();
      if (ownedMaterials) for (const m of [].concat(o.material)) m?.dispose?.();
    }
  });
}
