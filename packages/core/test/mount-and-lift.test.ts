import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { computeColliders, spawnItem, type BuiltPalace } from '../src/build';
import { createCatalog, isWallMounted } from '../src/catalog';
import { clampLift } from '../src/editor';
import type { Kit } from '../src/kit';
import type { PalaceItem } from '../src/schema';

function testCatalog(scene = new THREE.Group()) {
  return createCatalog({
    std: () => new THREE.MeshBasicMaterial(),
    box: (g, w, h, d, mat, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y + h / 2, z);
      g.add(mesh);
      return mesh;
    },
    loadModel: async () => scene,
    runtime: {},
  } as unknown as Kit);
}

describe('摆放方式与离地高度', () => {
  it('识别目录挂墙物件和显式选择挂墙的模型', () => {
    const catalog = testCatalog();
    expect(isWallMounted({ type: 'painting', params: { mount: 'floor' } }, catalog)).toBe(true);
    expect(isWallMounted({ type: 'model', params: { mount: 'wall' } }, catalog)).toBe(true);
    expect(isWallMounted({ type: 'model', params: { mount: 'floor' } }, catalog)).toBe(false);
    expect(isWallMounted({ type: 'model' }, catalog)).toBe(false);
    expect(isWallMounted({ type: 'cup', params: { mount: 'wall' } }, catalog)).toBe(false);
  });

  it('离地高度夹到零和墙顶下 0.05 米之间', () => {
    expect(clampLift(-1, 2.8)).toBe(0);
    expect(clampLift(0, 2.8)).toBe(0);
    expect(clampLift(.123, 2.8)).toBe(.123);
    expect(clampLift(2.75, 2.8)).toBe(2.75);
    expect(clampLift(3, 2.8)).toBe(2.75);
    expect(clampLift(1.5, 1.2)).toBeCloseTo(1.15);
  });

  it('挂墙时模型和占位盒都以高度中心及背面为原点，旧模型仍落地居中', async () => {
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2));
    mesh.position.set(3, 9, -4);
    scene.add(mesh);
    const catalog = testCatalog(scene);
    const wall = catalog.model.build({ src: 'picture.glb', h: 2, mount: 'wall' });
    const floor = catalog.model.build({ src: 'picture.glb', h: 2 });
    const bounds = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
    expect(bounds(wall).min.y).toBeCloseTo(-1);
    expect(bounds(wall).min.z).toBeCloseTo(0);
    expect(bounds(floor).min.y).toBeCloseTo(0);
    await Promise.resolve();
    expect(bounds(wall).min.toArray()).toEqual([-.5, -1, 0]);
    expect(bounds(wall).max.toArray()).toEqual([.5, 1, 1]);
    expect(bounds(floor).min.toArray()).toEqual([-.5, 0, -.5]);
    expect(bounds(floor).max.toArray()).toEqual([.5, 2, .5]);
  });

  it('低挂的大模型不生成行走碰撞体，落地模型照常生成', () => {
    const catalog = testCatalog();
    const root = new THREE.Group(), itemsRoot = new THREE.Group();
    root.add(itemsRoot);
    const built = { root, itemsRoot, walls: [], itemObjects: new Map(), pickables: [] } as BuiltPalace;
    const item: PalaceItem = { id: 'pic', type: 'model', pos: [0, .5, 0], params: { h: 2, mount: 'wall' } };
    const obj = spawnItem(built, item, catalog);
    expect(new THREE.Box3().setFromObject(obj).min.y).toBeCloseTo(-.5);
    expect(computeColliders(built, catalog)).toEqual([]);
    spawnItem(built, { id: 'floor', type: 'model', pos: [3, 0, 0] }, catalog);
    expect(computeColliders(built, catalog)).toHaveLength(1);
  });
});
