import { describe, it, expect } from 'vitest';
import * as W from '../src/world';
import { createFromTemplate } from '../src/templates/basic';
import { setBinding, type PalaceDoc } from '../src/schema';

function docsMap(...docs: PalaceDoc[]) {
  return new Map(docs.map(d => [d.id, d]));
}

describe('世界：摆放', () => {
  it('syncWorld 给新宫殿找空地，互不重叠', () => {
    const a = createFromTemplate('cottage', 'A'), b = createFromTemplate('twoRooms', 'B'), c = createFromTemplate('gallery', 'C');
    const docs = docsMap(a, b, c);
    const world = W.createWorld();
    expect(W.syncWorld(world, docs)).toBe(true);
    const region = W.mainRegion(world);
    expect(region.palaces.map(p => p.palaceId).sort()).toEqual([a.id, b.id, c.id].sort());
    for (const p of region.palaces) expect(W.canPlace(region, docs, p, docs.get(p.palaceId))).toBe(true);
    // 再同步一次没有改动
    expect(W.syncWorld(world, docs)).toBe(false);
  });

  it('settleRegions 把挤在一起的岛推开', () => {
    const a = createFromTemplate('cottage', 'A'), b = createFromTemplate('cottage', 'B');
    const docs = docsMap(a, b);
    const world = W.createWorld();
    world.regions = [W.createRegion('一', 'island'), W.createRegion('二', 'forest')];
    world.regions[0].palaces.push({ palaceId: a.id, pos: W.findFreeSpot(world.regions[0], docs, a), rot: 0 });
    world.regions[1].palaces.push({ palaceId: b.id, pos: W.findFreeSpot(world.regions[1], docs, b), rot: 0 });
    world.regions[1].origin = [5, 0];
    expect(W.settleRegions(world, docs)).toBe(true);
    const [c0, c1] = world.regions.map(r => W.regionCircle(r, docs));
    expect(Math.hypot(c1.x - c0.x, c1.z - c0.z)).toBeGreaterThanOrEqual(c0.r + c1.r + W.SEA_GAP - .5);
  });

  it('palaceStats 统计整件和部件的记忆桩', () => {
    const d = createFromTemplate('cottage', 'A');
    d.items.push({ id: 's', type: 'bookshelf', pos: [0, 0, 0] });
    setBinding(d.items[d.items.length - 1], '', { blockId: 'x' });
    setBinding(d.items[d.items.length - 1], 'b:0:1', { blockId: 'y' });
    expect(W.palaceStats(d).loci).toBe(2);
  });
});
