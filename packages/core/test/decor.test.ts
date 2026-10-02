import { describe, it, expect } from 'vitest';
import { materializeDecor, DECOR } from '../src/decor';
import { PALACE_FORMAT, normalizePalace, itemPose, subtree, type PalaceItem } from '../src/schema';
import { createHomePalace } from '../src/templates/home';

const v2 = (items: any[]) => ({ format: PALACE_FORMAT, version: 2, id: 'p', name: 'p', createdAt: 0, updatedAt: 0, rooms: [], walls: [], items });

describe('摆件 → 子物件', () => {
  it('v2 → v3：茶几上的书、托盘、杯子、干花变成子物件，杯子放在托盘上', () => {
    const d = normalizePalace(v2([{ id: 'ct', type: 'coffeeTable', room: 'living', pos: [2, 0, 3], rot: 90 }]));
    const table = d.items[0];
    expect(table.params.decor).toBe(false);
    const tree = subtree(d.items, 'ct');
    expect(tree.map(i => i.type)).toEqual(['coffeeTable', 'bookStack', 'tray', 'plant', 'cup', 'cup']);
    const tray = tree.find(i => i.type === 'tray');
    expect(tree.filter(i => i.type === 'cup').every(c => c.parent === tray.id)).toBe(true);
    expect(tree.slice(1).every(i => i.room === 'living')).toBe(true);
    // 局部坐标换算到宫殿里：茶几转了 90°，托盘在 (.15, .38, −.1) → (2 − .1, .38, 3 − .15)
    const p = itemPose(d.items, tray).pos;
    expect(p[0]).toBeCloseTo(1.9, 3); expect(p[1]).toBeCloseTo(.38, 3); expect(p[2]).toBeCloseTo(2.85, 3);
  });

  it('子物件 id 固定（多台设备各自迁移结果一致），重复执行不会再加', () => {
    const a = normalizePalace(v2([{ id: 'dt', type: 'diningTable', pos: [0, 0, 0] }]));
    const b = normalizePalace(v2([{ id: 'dt', type: 'diningTable', pos: [0, 0, 0] }]));
    expect(a.items.map(i => i.id)).toEqual(b.items.map(i => i.id));
    expect(a.items).toHaveLength(1 + DECOR.diningTable({}).length);
    const n = a.items.length;
    expect(materializeDecor(a.items)).toBe(false);
    expect(a.items).toHaveLength(n);
  });

  it('用户删掉的摆件不会回来', () => {
    const d = normalizePalace(v2([{ id: 'desk', type: 'desk', pos: [0, 0, 0] }]));
    d.items = d.items.filter(i => i.type !== 'cup');
    const again = normalizePalace(d);
    expect(again.items.some(i => i.type === 'cup')).toBe(false);
  });

  it('按家具参数摆放（电视柜的宽度）', () => {
    const items: PalaceItem[] = [{ id: 'tv', type: 'mediaConsole', pos: [0, 0, 0], params: { w: 2.4 } }];
    materializeDecor(items);
    expect(items.find(i => i.type === 'vase').pos[0]).toBeCloseTo(1.08, 3);
  });

  it('新建的「我的家」已经带着子物件', () => {
    const d = createHomePalace();
    expect(d.items.some(i => i.parent === 'coffee-table')).toBe(true);
    expect(d.items.find(i => i.id === 'coffee-table').params.decor).toBe(false);
  });
});
