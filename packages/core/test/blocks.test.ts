import { describe, it, expect } from 'vitest';
import { sanitizeParts, countParts, partName, MAX_PARTS } from '../src/blocks';

describe('积木', () => {
  it('保留认识的字段，数值夹在范围内，丢掉不认识的形体和字段', () => {
    const { parts, warnings } = sanitizeParts([
      { shape: 'box', size: [100, '0.5', -1], pos: [0, 99, 0], color: '#AABBCC', rough: 3, evil: 'x', slot: 'top', name: '桌面' },
      { shape: 'teapot', size: [1] },
      { shape: 'lathe', profile: [[0, 0]] },
      'nonsense',
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ shape: 'box', size: [6, .5, .001], pos: [0, 6, 0], color: '#AABBCC', rough: 1, slot: 'top', name: '桌面' });
    expect(warnings.some(w => w.includes('teapot'))).toBe(true);
    expect(warnings.some(w => w.includes('车削'))).toBe(true);
  });

  it('镜像、阵列、组合按展开后的数量计数', () => {
    const parts = sanitizeParts([
      { shape: 'cyl', size: [.04, .7], mirror: 'xz' },
      { shape: 'box', size: [.1, .1, .1], repeat: { count: 5, step: [.2, 0, 0] } },
      { shape: 'group', mirror: 'x', children: [{ shape: 'sphere' }, { shape: 'cone' }] },
    ]).parts;
    expect(countParts(parts)).toBe(4 + 5 + 4);
  });

  it(`超过 ${MAX_PARTS} 个形体时截断`, () => {
    const many = Array.from({ length: 50 }, () => ({ shape: 'box', repeat: { count: 10, step: [.1, 0, 0] } }));
    const r = sanitizeParts(many);
    expect(r.count).toBeLessThanOrEqual(MAX_PARTS);
    expect(r.warnings.some(w => w.includes(String(MAX_PARTS)))).toBe(true);
  });

  it('部件名', () => {
    const parts = sanitizeParts([{ shape: 'group', children: [{ shape: 'box', slot: 'face', name: '表盘' }] }]).parts;
    expect(partName(parts, 'face')).toBe('表盘');
    expect(partName(parts, 'nope')).toBeNull();
  });

  it('不是数组时返回空', () => {
    expect(sanitizeParts(null).parts).toEqual([]);
    expect(sanitizeParts({ shape: 'box' }).parts).toEqual([]);
  });
});
