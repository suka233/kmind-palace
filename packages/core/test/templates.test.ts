import { describe, it, expect, afterEach } from 'vitest';
import { setLocale } from '../src/i18n';
import { createFromTemplate } from '../src/templates/basic';
import { createHomePalace } from '../src/templates/home';

const CJK = /[一-鿿]/;

describe('模板 · 语言', () => {
  afterEach(() => setLocale('zh-CN'));

  it('中文：房间名是中文 + 英文小字，物件名中文', () => {
    const d = createHomePalace();
    expect(d.name).toBe('我的家');
    expect(d.rooms.find(r => r.id === 'bedroom')).toMatchObject({ name: '卧室', en: 'Bedroom' });
    expect(d.items.find(i => i.id === 'bed')?.name).toBe('双人床');
  });

  it('英文：房间、物件、默认宫殿名都是英文，房间不再重复英文小字', () => {
    setLocale('en');
    const d = createHomePalace();
    expect(d.name).toBe('My home');
    const bed = d.rooms.find(r => r.id === 'bedroom')!;
    expect(bed.name).toBe('Bedroom');
    expect(bed.en).toBeUndefined();
    for (const id of ['cottage', 'twoRooms', 'gallery', 'home']) {
      const doc = createFromTemplate(id, 'X');
      for (const r of doc.rooms) expect(r.name, r.id).not.toMatch(CJK);
      // 摆件（decor.ts 生成，有 parent）另由 decor 负责
      for (const i of doc.items) if (i.name && !i.parent) expect(i.name, i.id).not.toMatch(CJK);
    }
    expect(createFromTemplate('gallery', 'X').rooms[0].name).toBe('Hall 1');
  });
});
