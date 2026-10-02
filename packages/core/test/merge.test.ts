import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { mergeInPlace } from '../src/merge';

const wood = new THREE.MeshStandardMaterial({ color: '#a07040' });
const metal = new THREE.MeshStandardMaterial({ color: '#888888' });

function box(parent: THREE.Object3D, mat: THREE.Material, x: number, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(.2, .2, .2), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

const meshes = (o: THREE.Object3D) => { const out: THREE.Mesh[] = []; o.traverse((m: any) => { if (m.isMesh) out.push(m); }); return out; };
const bounds = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };

describe('物件内部合批', () => {
  it('按材质合并，包围盒不变，空分组去掉', () => {
    const root = new THREE.Group();
    const legs = new THREE.Group();
    legs.position.set(0, .5, 0);
    legs.rotation.y = .7;
    root.add(legs);
    for (let i = 0; i < 4; i++) box(legs, wood, i * .3);
    box(root, wood, 0, 1);
    box(root, metal, 1, 0);
    box(root, metal, -1, 0);
    const before = bounds(root);
    const saved = mergeInPlace(root);
    expect(saved).toBe(5);
    expect(meshes(root).length).toBe(2);
    expect(legs.parent).toBeNull();
    const after = bounds(root);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-6);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-6);
    // 合并后保持索引：顶点数 = 各自顶点数之和
    const woodMesh = meshes(root).find(m => m.material === wood);
    expect(woodMesh.geometry.index).not.toBeNull();
    expect(woodMesh.geometry.attributes.position.count).toBe(5 * 24);
    expect(woodMesh.castShadow).toBe(true);
  });

  it('部件、碰撞体、占位、实例化网格、灯光、隐藏的和子物件保持原样', () => {
    const root = new THREE.Group();
    box(root, wood, 0); box(root, wood, 1);
    const slot = box(root, wood, 2); slot.userData.slot = 'a';
    const slotGroup = new THREE.Group(); slotGroup.userData.slot = 'b'; root.add(slotGroup);
    box(slotGroup, wood, 0); box(slotGroup, wood, 1);
    const col = box(root, wood, 3); col.userData.collider = true;
    const keep = box(root, wood, 4); keep.userData.keep = true;
    const hidden = box(root, wood, 5); hidden.visible = false;
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(), wood, 3); root.add(inst);
    const lampGroup = new THREE.Group(); root.add(lampGroup);
    const light = new THREE.PointLight(); lampGroup.add(light);
    box(lampGroup, wood, 6);
    const child = new THREE.Group(); child.userData.item = { id: 'x' }; root.add(child);
    box(child, wood, 7);
    mergeInPlace(root);
    for (const o of [slot, slotGroup, col, keep, hidden, inst, light, child]) expect(o.parent).not.toBeNull();
    expect(slotGroup.children.length).toBe(2);
    expect(child.children.length).toBe(1);
    expect(lampGroup.parent).toBe(root);
    expect(lampGroup.children).toEqual([light]);
    // 0、1、灯旁边那块合成一个
    expect(root.children.filter((m: any) => m.isMesh && !m.isInstancedMesh && !Object.keys(m.userData).length && m.visible).length).toBe(1);
  });

  it('镜像（负缩放）时翻转绕序，法线朝外', () => {
    const root = new THREE.Group();
    const a = box(root, wood, 0), b = box(root, wood, 1);
    b.scale.x = -1;
    mergeInPlace(root);
    const g = meshes(root)[0].geometry;
    const pos = g.attributes.position, nor = g.attributes.normal, idx = g.index.array;
    const v = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);
    // 每个三角形按绕序算出的面法线和顶点法线同向
    for (let t = 0; t < idx.length; t += 3) {
      const [i, j, k] = [idx[t], idx[t + 1], idx[t + 2]];
      const face = v(j).sub(v(i)).cross(v(k).sub(v(i))).normalize();
      expect(face.dot(new THREE.Vector3().fromBufferAttribute(nor, i))).toBeGreaterThan(.9);
    }
    expect(a.parent).toBeNull();
  });

  it('只有一个网格的材质不动', () => {
    const root = new THREE.Group();
    const a = box(root, wood, 0), b = box(root, metal, 1);
    expect(mergeInPlace(root)).toBe(0);
    expect(a.parent).toBe(root);
    expect(b.parent).toBe(root);
  });
});
