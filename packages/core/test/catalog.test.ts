import { describe, it, expect } from 'vitest';
import { shelfLayout, docShelfLayout, applyBookOverrides, LEAN } from '../src/catalog';

const bySlot = (L: ReturnType<typeof shelfLayout>) => new Map(L.books.map(b => [b.slot, b]));

describe('书架布局', () => {
  it('同一个种子每次一样，部件编号唯一', () => {
    const a = shelfLayout({}, 42), b = shelfLayout({}, 42);
    expect(a).toEqual(b);
    expect(new Set(a.books.map(x => x.slot)).size).toBe(a.books.length);
    expect(a.books.length).toBeGreaterThan(40);
  });

  it('改宽度：每层只在行尾增减书，前面的书不变', () => {
    const wide = bySlot(shelfLayout({ w: 1.6 }, 7)), narrow = shelfLayout({ w: 1.0 }, 7);
    for (const b of narrow.books) {
      const o = wide.get(b.slot);
      expect(o, b.slot).toBeTruthy();
      expect([o.c, o.w, o.h]).toEqual([b.c, b.w, b.h]);
    }
    expect(narrow.books.length).toBeLessThan(wide.size);
  });

  it('改高度、加一层：原来各层的书不变', () => {
    const base = shelfLayout({ h: 2.0, rows: 5 }, 9);
    const taller = bySlot(shelfLayout({ h: 2.3, rows: 6 }, 9));
    for (const b of base.books) {
      const o = taller.get(b.slot);
      expect(o, b.slot).toBeTruthy();
      expect([o.c, o.w]).toEqual([b.c, b.w]);
    }
  });
});

describe('书架 = 笔记本', () => {
  const docs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `2026093012000${i}-doc${i}`, title: `文档 ${i}` }));

  it('按文档树顺序从最上层往下，均匀分到各层', () => {
    const L = docShelfLayout({ rows: 5 }, docs(23));
    expect(L.overflow).toBe(0);
    expect(L.books.map(b => b.slot)).toEqual(docs(23).map(d => 'doc:' + d.id));
    const perRow = [4, 3, 2, 1, 0].map(r => L.books.filter(b => b.row === r).length);
    expect(perRow).toEqual([5, 5, 5, 5, 3]);
  });

  it('尺寸和颜色由文档 id 决定，不随顺序变化', () => {
    const a = docShelfLayout({}, docs(6)), b = docShelfLayout({}, [...docs(6)].reverse());
    const byId = new Map(b.books.map(x => [x.id, x]));
    for (const x of a.books) expect([x.w, x.h, x.c]).toEqual([byId.get(x.id).w, byId.get(x.id).h, byId.get(x.id).c]);
  });

  it('放不下的计入 overflow', () => {
    const L = docShelfLayout({ w: .6, rows: 2 }, docs(80));
    expect(L.overflow).toBeGreaterThan(0);
    expect(L.books.length + L.overflow).toBe(80);
  });
});

describe('单本书的覆盖', () => {
  const base = shelfLayout({ w: 1.2, h: 2, rows: 5, decor: false }, 7).books;

  it('换颜色、抽出、空着的去掉；没覆盖的不变', () => {
    const [a, b, c] = base;
    const out = applyBookOverrides(base, { [a.slot]: { c: '#123456', pull: true }, [b.slot]: { hide: true }, [c.slot]: { c: 'red' } });
    expect(out).toHaveLength(base.length - 1);
    expect(out[0]).toMatchObject({ slot: a.slot, c: '#123456', pz: .04 });
    expect(out.find(x => x.slot === b.slot)).toBeUndefined();
    // 不是 #rrggbb 的颜色不用
    expect(out.find(x => x.slot === c.slot).c).toBe(c.c);
    expect(out.slice(2)).toEqual(base.slice(3));
  });

  it('靠向一边：转 12°，底边仍落在隔板上', () => {
    const b = base[0];
    for (const lean of [1, -1] as const) {
      const [n] = applyBookOverrides([b], { [b.slot]: { lean } });
      expect(n.rz).toBeCloseTo(lean * LEAN);
      // 最低的角
      const low = n.y - (n.h / 2 * Math.cos(n.rz) + n.w / 2 * Math.abs(Math.sin(n.rz)));
      expect(low).toBeCloseTo(b.y - b.h / 2, 6);
    }
  });
});
