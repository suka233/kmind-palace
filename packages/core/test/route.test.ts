import { describe, it, expect } from 'vitest';
import { WalkGrid, pathLength, type P2 } from '../src/path';
import { autoRoute, resolveRoute, routesOf, memoryLevel, worstLevel, isDue, STALE_MS, AUTO_ROUTE_ID } from '../src/route';
import { PALACE_FORMAT, PALACE_VERSION, setBinding, type PalaceDoc, type PalaceItem } from '../src/schema';

describe('步行网格', () => {
  // 10 × 6 的房间，x = 5 处一堵墙，门在 z 2.5 ~ 3.5
  const wall = [{ x0: 4.9, z0: 0, x1: 5.1, z1: 2.5 }, { x0: 4.9, z0: 3.5, x1: 5.1, z1: 6 }];
  const grid = new WalkGrid({ x0: 0, z0: 0, x1: 10, z1: 6 }, wall);

  it('绕墙从门过去，折线每一段都不穿墙', () => {
    const p = grid.path([1, 1], [9, 1]);
    expect(p).toBeTruthy();
    for (let i = 1; i < p.length; i++) expect(grid.lineFree(p[i - 1], p[i])).toBe(true);
    // 必经门洞
    expect(p.some(([x, z]) => Math.abs(x - 5) < .6 && z > 2.4 && z < 3.6) || p.some((q, i) => i > 0 && crossesDoor(p[i - 1], q))).toBe(true);
    expect(pathLength(p)).toBeGreaterThan(8);
    // 拉直后点数很少
    expect(p.length).toBeLessThan(8);
  });

  it('被完全隔开时找不到路', () => {
    const closed = new WalkGrid({ x0: 0, z0: 0, x1: 10, z1: 6 }, [{ x0: 4.9, z0: 0, x1: 5.1, z1: 6 }]);
    expect(closed.path([1, 1], [9, 1])).toBeNull();
  });

  it('起终点在家具里时挪到最近的空地', () => {
    const g = new WalkGrid({ x0: 0, z0: 0, x1: 6, z1: 6 }, [{ x0: 2, z0: 2, x1: 3, z1: 3 }]);
    const n = g.nearestFree(2.5, 2.5);
    expect(n).toBeTruthy();
    expect(g.freeAt(n[0], n[1])).toBe(true);
    expect(Math.hypot(n[0] - 2.5, n[1] - 2.5)).toBeLessThan(1.1);
    expect(g.path([2.5, 2.5], [5, 5])).toBeTruthy();
  });
});

function crossesDoor(a: P2, b: P2) {
  if ((a[0] - 5) * (b[0] - 5) > 0) return false;
  const t = (5 - a[0]) / (b[0] - a[0]);
  const z = a[1] + (b[1] - a[1]) * t;
  return z > 2.5 && z < 3.5;
}

function doc(items: PalaceItem[]): PalaceDoc {
  return {
    format: PALACE_FORMAT, version: PALACE_VERSION, id: 'p', name: 'p', createdAt: 0, updatedAt: 0,
    rooms: [{ id: 'a', name: 'A', rect: [0, 0, 5, 6], floor: 'oak' }, { id: 'b', name: 'B', rect: [5, 0, 10, 6], floor: 'oak' }],
    walls: [{ id: 'w', a: [0, 0], b: [0, 6], normal: [-1, 0], openings: [{ s0: .5, s1: 1.5, y0: 0, y1: 2.1, kind: 'front' }] }],
    items,
  };
}
const it2 = (id: string, x: number, z: number, room: string): PalaceItem => {
  const i: PalaceItem = { id, type: 'box', pos: [x, 0, z], room };
  setBinding(i, '', { blockId: 'b-' + id });
  return i;
};

describe('自动路线', () => {
  it('从正门出发，先走完一个房间再去下一个', () => {
    const d = doc([it2('far-b', 9, 5, 'b'), it2('near-a', 1, 1.5, 'a'), it2('mid-a', 3, 4, 'a'), it2('near-b', 6, 1, 'b')]);
    const r = autoRoute(d);
    expect(r[0]).toBe('near-a');
    expect(r.slice(0, 2).sort()).toEqual(['mid-a', 'near-a']);
    expect(r.slice(2).sort()).toEqual(['far-b', 'near-b']);
  });

  it('同一件物件上的部件连着走，整件在前', () => {
    const shelf: PalaceItem = { id: 'shelf', type: 'bookshelf', pos: [2, 0, 2], room: 'a' };
    setBinding(shelf, 'b:0:3', { blockId: 'x3' });
    setBinding(shelf, 'b:4:1', { blockId: 'x41' });
    setBinding(shelf, '', { blockId: 'whole' });
    const d = doc([it2('lamp', 1, 1, 'a'), shelf, it2('sofa', 4, 5, 'a')]);
    const topFirst = (_: PalaceItem, a: string, b: string) => Number(b.split(':')[1]) - Number(a.split(':')[1]);
    const r = autoRoute(d, topFirst);
    const i = r.indexOf('shelf');
    expect(r.slice(i, i + 3)).toEqual(['shelf', 'shelf#b:4:1', 'shelf#b:0:3']);
  });

  it('没保存过路线时用默认路线；解析时跳过删掉的物件和重复的站', () => {
    const d = doc([it2('a1', 1, 1, 'a'), it2('a2', 2, 2, 'a')]);
    const [auto] = routesOf(d);
    expect(auto.id).toBe(AUTO_ROUTE_ID);
    expect(auto.stops).toHaveLength(2);
    const stops = resolveRoute(d, { stops: ['a2', 'ghost', 'a2', 'a1#b:0:0'] });
    expect(stops.map(s => s.key)).toEqual(['a2', 'a1#b:0:0']);
    expect(stops[1].binding).toBeNull();
    d.routes = [{ id: 'r1', name: '我的路线', stops: ['a1'] }];
    expect(routesOf(d).map(r => r.id)).toEqual(['r1']);
  });
});

describe('记忆程度', () => {
  const now = Date.UTC(2026, 8, 30);
  it('按闪卡状态分级', () => {
    expect(memoryLevel(undefined, now)).toBe('none');
    expect(memoryLevel({ card: false }, now)).toBe('none');
    expect(memoryLevel({ card: true, reps: 0, state: 0 }, now)).toBe('new');
    expect(memoryLevel({ card: true, reps: 2, state: 2, due: now + 1000 }, now)).toBe('fresh');
    expect(memoryLevel({ card: true, reps: 2, state: 2, due: now - 1000 }, now)).toBe('due');
    expect(memoryLevel({ card: true, reps: 2, lapses: 1, state: 3, due: now + 600e3 }, now)).toBe('learning');
    expect(memoryLevel({ card: true, reps: 1, state: 1, due: now - 1000 }, now)).toBe('due');
    expect(worstLevel(['fresh', 'learning'])).toBe('learning');
    expect(memoryLevel({ card: true, reps: 2, state: 2, due: now - STALE_MS - 1 }, now)).toBe('stale');
    expect(isDue('stale') && isDue('due') && !isDue('new')).toBe(true);
    expect(worstLevel(['fresh', 'due', 'none'])).toBe('due');
  });
});
