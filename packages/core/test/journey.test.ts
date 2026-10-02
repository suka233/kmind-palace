import { describe, it, expect } from 'vitest';
import { PALACE_FORMAT, normalizePalace, type PalaceDoc } from '../src/schema';
import { createWorld, normalizeWorld, WORLD_VERSION, WORLD_COMPAT } from '../src/world';
import { resolveJourney, createJourney, deleteJourney, journeysWith, pruneJourneys, legRoute } from '../src/journey';
import { AUTO_ROUTE_ID } from '../src/route';

const B = (n: number) => ({ blockId: `2026010100000${n}-aaaaaaa`, title: `笔记 ${n}` });

function palace(id: string, routes?: any[]): PalaceDoc {
  return normalizePalace({
    format: PALACE_FORMAT, version: 4, compat: 4, id, name: id, createdAt: 0, updatedAt: 0, rooms: [], walls: [],
    items: [
      { id: 'a', type: 'sofa', pos: [1, 0, 1], bindings: { '': B(1) } },
      { id: 'b', type: 'sofa', pos: [5, 0, 1], bindings: { '': B(2) } },
      { id: 'c', type: 'sofa', pos: [9, 0, 1] },
    ],
    ...(routes ? { routes } : {}),
  });
}

describe('旅程', () => {
  it('解析：每段是一座宫殿里的一条路线；auto 是默认路线；宫殿 / 路线不在了的段为空', () => {
    const docs = new Map([['p1', palace('p1', [{ id: 'r1', name: '复习', stops: ['b', 'a'] }])], ['p2', palace('p2')]]);
    const w = createWorld();
    const j = createJourney(w, '整门课');
    j.legs.push({ palaceId: 'p1', routeId: 'r1' }, { palaceId: 'p2', routeId: AUTO_ROUTE_ID }, { palaceId: 'gone', routeId: 'r1' }, { palaceId: 'p1', routeId: 'deleted' });
    const legs = resolveJourney(j, docs);
    expect(legs.map(l => l.stops.map(s => s.key))).toEqual([['b', 'a'], ['a', 'b'], [], []]);
    expect(legs[1].route.name).toBe('全部记忆桩');
    expect(legs[2].doc).toBeNull();
    expect(legs[3].doc).not.toBeNull();
    expect(legs[3].route).toBeNull();
    // 宫殿保存过路线时，auto 仍然可用
    expect(legRoute(docs.get('p1'), AUTO_ROUTE_ID).stops).toEqual(['a', 'b']);
  });

  it('清理：删掉宫殿或路线时，对应的段去掉', () => {
    const w = createWorld();
    const j = createJourney(w);
    j.legs.push({ palaceId: 'p1', routeId: 'r1' }, { palaceId: 'p2', routeId: 'r2' }, { palaceId: 'p1', routeId: 'r3' });
    expect(journeysWith(w, 'p2')).toEqual([j]);
    expect(pruneJourneys(w, id => id !== 'p2')).toBe(true);
    expect(j.legs.map(l => l.routeId)).toEqual(['r1', 'r3']);
    expect(pruneJourneys(w, () => true, { palaceId: 'p1', routeId: 'r1' })).toBe(true);
    expect(j.legs.map(l => l.routeId)).toEqual(['r3']);
    expect(pruneJourneys(w, () => true)).toBe(false);
    deleteJourney(w, j.id);
    expect(w.journeys).toBeUndefined();
  });

  it('世界数据 v2：旅程是可选字段，compat 不变，坏数据清掉', () => {
    expect(WORLD_VERSION).toBe(2);
    expect(WORLD_COMPAT).toBe(1);
    const w = createWorld();
    const raw = { ...w, journeys: [{ id: 'j1', name: '', legs: [{ palaceId: 'p', routeId: 'auto' }, { palaceId: 3 }, null] }, { name: '没有 id' }] };
    const n = normalizeWorld(JSON.parse(JSON.stringify(raw)));
    expect(n.journeys).toEqual([{ id: 'j1', name: '旅程', legs: [{ palaceId: 'p', routeId: 'auto' }] }]);
    expect(normalizeWorld({ ...w, version: 1 }).journeys).toBeUndefined();
  });
});
