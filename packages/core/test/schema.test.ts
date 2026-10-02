import { describe, it, expect } from 'vitest';
import {
  PALACE_FORMAT, PALACE_VERSION, normalizePalace, clonePalace,
  locusKey, parseLocus, getBinding, setBinding, boundLoci, itemLoci, hasBindings,
  itemPose, setItemPose, setItemParent, subtree, isInSubtree, repairTree,
  type PalaceDoc, type PalaceItem,
} from '../src/schema';

/** 一份 v1 数据（与旧版插件保存的格式一致） */
function v1Doc(): any {
  return {
    format: PALACE_FORMAT, version: 1, id: 'palace-a', name: '旧宫殿', createdAt: 1, updatedAt: 2,
    rooms: [{ id: 'r1', name: '客厅', rect: [0, 0, 5, 4], floor: 'oak' }],
    walls: [],
    items: [
      { id: 'sofa-1', type: 'sofa', pos: [1, 0, 1], rot: 90, binding: { blockId: '20260101000000-aaaaaaa', title: '费曼学习法', boundAt: 5 } },
      { id: 'shelf-1', type: 'bookshelf', pos: [3, 0, .2], binding: null },
      { id: 'lamp-1', type: 'floorLamp', pos: [4, 0, 3] },
    ],
  };
}

const item = (id: string, pos: [number, number, number], rot = 0, parent?: string): PalaceItem => ({ id, type: 'box', pos, rot, ...(parent ? { parent } : {}) });

describe('normalizePalace / 迁移', () => {
  it('v1 → v2：binding 搬到 bindings[""]，空绑定去掉', () => {
    const d = normalizePalace(v1Doc());
    expect(d.version).toBe(PALACE_VERSION);
    const [sofa, shelf, lamp] = d.items;
    expect(sofa.bindings).toEqual({ '': { blockId: '20260101000000-aaaaaaa', title: '费曼学习法', boundAt: 5 } });
    expect('binding' in sofa).toBe(false);
    expect('binding' in shelf).toBe(false);
    expect(shelf.bindings).toBeUndefined();
    expect(lamp.bindings).toBeUndefined();
    // 其余字段原样保留
    expect(sofa.pos).toEqual([1, 0, 1]);
    expect(sofa.rot).toBe(90);
    expect(d.rooms).toEqual(v1Doc().rooms);
  });

  it('不改动传入的数据', () => {
    const raw = v1Doc();
    const before = JSON.stringify(raw);
    normalizePalace(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('幂等：v2 再规范化一次不变', () => {
    const once = normalizePalace(v1Doc());
    expect(normalizePalace(clonePalace(once))).toEqual(once);
  });

  it('没有 version 的数据按 v1 处理', () => {
    const raw = v1Doc();
    delete raw.version;
    expect(normalizePalace(raw).items[0].bindings?.['']?.blockId).toBe('20260101000000-aaaaaaa');
  });

  it('拒绝更高版本和无法识别的数据', () => {
    expect(() => normalizePalace({ ...v1Doc(), version: PALACE_VERSION + 1 })).toThrow(/请升级插件/);
    expect(() => normalizePalace({ ...v1Doc(), format: 'other' })).toThrow();
    expect(() => normalizePalace(null)).toThrow();
  });

  it('清理：无效物件、空 blockId 的绑定、悬空 parent、环', () => {
    const raw = v1Doc();
    raw.version = 2;
    raw.items = [
      { id: 'a', type: 'box', pos: [0, 0, 0], parent: 'ghost', bindings: { '': { blockId: '' }, 'b:0:1': { blockId: 'x' } } },
      { id: 'b', type: 'box', pos: [0, 0, 0], parent: 'c' },
      { id: 'c', type: 'box', pos: [0, 0, 0], parent: 'b' },
      { id: 'd', type: 'box', pos: [0, 0, 0], parent: 'd' },
      { type: 'box', pos: [0, 0, 0] },
      null,
    ];
    const d = normalizePalace(raw);
    expect(d.items.map(i => i.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(d.items[0].parent).toBeUndefined();
    expect(d.items[0].bindings).toEqual({ 'b:0:1': { blockId: 'x' } });
    // 环被打断：b、c 至少有一个不再有父物件，且不再互相指向
    const b = d.items[1], c = d.items[2];
    expect(!(b.parent === 'c' && c.parent === 'b')).toBe(true);
    expect(d.items[3].parent).toBeUndefined();
  });
});

describe('记忆桩：物件 + 部件', () => {
  it('locusKey / parseLocus 互逆', () => {
    expect(locusKey('shelf-1')).toBe('shelf-1');
    expect(locusKey('shelf-1', 'b:2:5')).toBe('shelf-1#b:2:5');
    expect(parseLocus('shelf-1#b:2:5')).toEqual({ itemId: 'shelf-1', slot: 'b:2:5' });
    expect(parseLocus('shelf-1')).toEqual({ itemId: 'shelf-1', slot: '' });
  });

  it('绑定、解绑、排序', () => {
    const it: PalaceItem = item('shelf', [0, 0, 0]);
    expect(hasBindings(it)).toBe(false);
    setBinding(it, 'b:0:10', { blockId: 'k10' });
    setBinding(it, 'b:0:2', { blockId: 'k2' });
    setBinding(it, '', { blockId: 'whole' });
    expect(getBinding(it)?.blockId).toBe('whole');
    expect(getBinding(it, 'b:0:2')?.blockId).toBe('k2');
    expect(getBinding(it, 'b:9:9')).toBeNull();
    expect(itemLoci(it).map(l => l.slot)).toEqual(['', 'b:0:2', 'b:0:10']);
    setBinding(it, '', null);
    setBinding(it, 'b:0:2', null);
    setBinding(it, 'b:0:10', null);
    expect(it.bindings).toBeUndefined();
    expect(hasBindings(it)).toBe(false);
  });

  it('boundLoci 汇总整座宫殿', () => {
    const d = normalizePalace(v1Doc());
    setBinding(d.items[1], 'b:1:3', { blockId: 'book' });
    expect(boundLoci(d).map(l => locusKey(l.item.id, l.slot))).toEqual(['sofa-1', 'shelf-1#b:1:3']);
  });
});

describe('物件树', () => {
  const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 3));

  it('itemPose 沿父物件链换算（与 three.js 的 rotation.y 一致）', () => {
    const items = [
      item('table', [2, 0, 3], 90),
      item('tray', [.5, .45, 0], 0, 'table'),
      item('cup', [.1, .02, 0], 180, 'tray'),
    ];
    // rot 90：局部 +x → 父坐标 −z
    close(itemPose(items, items[1]).pos, [2, .45, 2.5]);
    close(itemPose(items, items[2]).pos, [2, .47, 2.4]);
    expect(itemPose(items, items[2]).rot).toBe(-90);
  });

  it('换父物件时保持在宫殿里的位置和朝向', () => {
    const items = [
      item('table', [2, 0, 3], 45),
      item('shelf', [-1, 0, 1], -90),
      item('vase', [2.3, .75, 3.1], 30),
    ];
    const vase = items[2];
    const before = itemPose(items, vase);
    expect(setItemParent(items, vase, 'table')).toBe(true);
    expect(vase.parent).toBe('table');
    close(itemPose(items, vase).pos, before.pos);
    expect(itemPose(items, vase).rot).toBe(before.rot);
    // 再换到另一个父物件、再放回地面
    setItemParent(items, vase, 'shelf');
    close(itemPose(items, vase).pos, before.pos);
    setItemParent(items, vase, null);
    expect(vase.parent).toBeUndefined();
    close(vase.pos, before.pos);
    expect(vase.rot).toBe(30);
  });

  it('不能挂到自己或自己的子孙上', () => {
    const items = [item('a', [0, 0, 0]), item('b', [0, 1, 0], 0, 'a'), item('c', [0, 1, 0], 0, 'b')];
    expect(setItemParent(items, items[0], 'c')).toBe(false);
    expect(setItemParent(items, items[0], 'a')).toBe(false);
    expect(items[0].parent).toBeUndefined();
    expect(isInSubtree(items, 'c', 'a')).toBe(true);
    expect(isInSubtree(items, 'a', 'c')).toBe(false);
  });

  it('subtree：父在前，包含全部子孙', () => {
    const items = [item('c', [0, 0, 0], 0, 'b'), item('a', [0, 0, 0]), item('b', [0, 0, 0], 0, 'a'), item('x', [0, 0, 0])];
    expect(subtree(items, 'a').map(i => i.id)).toEqual(['a', 'b', 'c']);
    expect(subtree(items, 'missing')).toEqual([]);
  });

  it('setItemPose 直接按宫殿坐标摆到父物件上', () => {
    const items = [item('t', [1, 0, 1], 90), item('v', [0, 0, 0])];
    setItemPose(items, items[1], [1, .7, 0], 90, 't');
    // 父物件转了 90°：宫殿里的 −z 方向就是它局部的 +x
    close(items[1].pos, [1, .7, 0]);
    close(itemPose(items, items[1]).pos, [1, .7, 0]);
    expect(items[1].rot).toBe(0);
  });

  it('repairTree 保留正常的父子关系', () => {
    const items = [item('a', [0, 0, 0]), item('b', [0, 0, 0], 0, 'a')];
    repairTree(items);
    expect(items[1].parent).toBe('a');
  });
});

describe('模板', () => {
  it('新建的宫殿是当前版本', async () => {
    const { createHomePalace } = await import('../src/templates/home');
    const d: PalaceDoc = createHomePalace();
    expect(d.version).toBe(PALACE_VERSION);
    expect(normalizePalace(d).items.length).toBe(d.items.length);
  });
});
