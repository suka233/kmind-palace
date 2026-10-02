import { describe, it, expect } from 'vitest';
import { cleanLook, seededLook, SPECIES } from '../src/look';
import { createWorld, normalizeWorld } from '../src/world';
import { toPublicWorld } from '../src/publish';

describe('小管家外观', () => {
  it('规范化：不认识的物种换成猫头鹰，坏颜色用物种默认色，配饰去重、最多 4 件', () => {
    const l = cleanLook({ species: 'dragon', colors: { body: 'red', accent: '#123456' }, accessories: ['crown', 'crown', 'laser', 'scarf', 'bow', 'glasses', 'party'] });
    expect(l.species).toBe('owl');
    expect(l.colors.body).toBe(SPECIES[0].colors.body);
    expect(l.colors.accent).toBe('#123456');
    expect(l.accessories).toEqual(['crown', 'scarf', 'bow', 'glasses']);
    expect(cleanLook(null).species).toBe('owl');
  });

  it('默认外观按世界 id 固定（同一个世界每次一样，不同世界多半不同）', () => {
    expect(seededLook('world-a')).toEqual(seededLook('world-a'));
    const kinds = new Set(Array.from({ length: 30 }, (_, i) => seededLook(`w${i}`).species));
    expect(kinds.size).toBeGreaterThan(2);
  });

  it('世界数据里的 pet 会被规范化；发布的世界不带 pet', () => {
    const w = createWorld();
    (w as any).pet = { name: '  团团  ', look: { species: 'cat', accessories: ['nope'] }, hidden: 1 };
    const n = normalizeWorld(JSON.parse(JSON.stringify(w)));
    expect(n.pet).toEqual({ name: '团团', look: cleanLook({ species: 'cat' }), hidden: true });
    expect(normalizeWorld({ ...w, pet: 'bad' }).pet).toBeUndefined();
    expect((toPublicWorld(n, []) as any).pet).toBeUndefined();
  });
});
