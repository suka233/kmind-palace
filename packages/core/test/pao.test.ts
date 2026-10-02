import { describe, it, expect, afterEach } from 'vitest';
import { setLocale } from '../src/i18n';
import { PALACE_FORMAT, PALACE_VERSION, PALACE_COMPAT, normalizePalace } from '../src/schema';
import { createWorld, normalizeWorld } from '../src/world';
import { DEFAULT_OBJECTS, defaultObjects, codeOf, chunks, chunkSize, imageOf, assignNumbers, checkDigits, importCodes, setCode, cleanDigits, type PaoTable, type NumberSet } from '../src/pao';
import { allItemsRoute } from '../src/route';

function doc(extra: any = {}) {
  return normalizePalace({
    format: PALACE_FORMAT, version: 4, compat: 4, id: 'p', name: 'p', createdAt: 0, updatedAt: 0, rooms: [], walls: [],
    items: [
      { id: 'sofa', type: 'sofa', pos: [1, 0, 1], bindings: { '': { blockId: 'b1' } } },
      { id: 'table', type: 'coffeeTable', pos: [3, 0, 1] },
      { id: 'vase', type: 'vase', parent: 'table', pos: [0, .4, 0] },
      { id: 'rug', type: 'rug', pos: [3, 0, 1] },
      { id: 'tv', type: 'tvUnit', pos: [6, 0, 1] },
    ],
    ...extra,
  });
}

describe('数字编码', () => {
  it('默认物件编码 00–99，一位数用象形编码；用户改过的优先', () => {
    expect(DEFAULT_OBJECTS).toHaveLength(100);
    expect(new Set(DEFAULT_OBJECTS).size).toBe(100);
    const t: PaoTable = { codes: { '14': { p: '孙悟空', a: '骑着' } } };
    expect(codeOf(t, '14')).toEqual({ p: '孙悟空', a: '骑着', o: '钥匙' });
    expect(codeOf(t, '01')).toEqual({ p: '', a: '', o: '小树' });
    expect(codeOf(t, '7').o).toBe('镰刀');
  });

  it('切分：PAO 6 位一桩，两位一图按每桩图像数', () => {
    expect(chunkSize({ mode: 'pao' })).toBe(6);
    expect(chunkSize({ mode: 'images', per: 1 })).toBe(2);
    expect(chunkSize({ mode: 'images', per: 9 })).toBe(6);
    expect(chunks('3.14159 26535 8', 6)).toEqual(['314159', '265358']);
    expect(chunks('1234567', 4)).toEqual(['1234', '567']);
  });

  it('画面：人物和动作都填了才组成「人物 动作 物件」，否则列出物件', () => {
    const t: PaoTable = { codes: { '14': { p: '孙悟空' }, '15': { a: '骑着' }, '92': { o: '篮球' } } };
    expect(imageOf(t, '141592', 'pao')).toEqual({ pairs: ['14', '15', '92'], text: '孙悟空 骑着 篮球', scene: true });
    expect(imageOf(t, '651592', 'pao').scene).toBe(false);
    expect(imageOf(t, '6515', 'images').text).toBe('尿壶 · 鹦鹉');
    expect(imageOf(t, '358', 'images').text).toBe('山虎 · 眼镜');
  });

  it('沿全部家具摆：摆件、地毯不算；记忆桩不够时报告放不下的位数', () => {
    const d = doc();
    expect(allItemsRoute(d)).toEqual(['sofa', 'table', 'tv']);
    const set: NumberSet = { id: 'n', name: '圆周率', digits: '3141592653589793238462', mode: 'pao', route: 'all' };
    const r = assignNumbers(d, set, undefined);
    expect(r.slots.map(s => [s.key, s.digits])).toEqual([['sofa', '314159'], ['table', '265358'], ['tv', '979323']]);
    expect(r.overflow).toBe(4);
    // 沿已绑定的记忆桩
    expect(assignNumbers(d, { ...set, route: 'auto' }, undefined).slots.map(s => s.key)).toEqual(['sofa']);
  });

  it('核对：逐位比较，忽略空格', () => {
    expect(checkDigits('314159', '31 41 59')).toEqual({ correct: 6, total: 6, ok: true });
    expect(checkDigits('314159', '31415')).toEqual({ correct: 5, total: 6, ok: false });
    expect(cleanDigits('a1b2')).toBe('12');
  });

  it('批量导入、单条修改（和默认相同的物件不存）', () => {
    const t: PaoTable = { codes: {} };
    expect(importCodes(t, '00 爱因斯坦 思考 望远镜\n1, 白雪公主, 咬\n02|风铃\n随便写的一行')).toBe(3);
    // 和默认相同的物件（00 望远镜）不存
    expect(t.codes).toEqual({ '00': { p: '爱因斯坦', a: '思考' }, '01': { p: '白雪公主', a: '咬' }, '02': { o: '风铃' } });
    setCode(t, '02', 'o', '铃儿');
    expect(t.codes['02']).toBeUndefined();
    setCode(t, '01', 'a', '');
    expect(t.codes['01']).toEqual({ p: '白雪公主' });
  });

  it('数据格式：宫殿 v5 的 numbers、世界的 pao 都是可选字段，坏数据清掉', () => {
    expect(PALACE_VERSION).toBe(5);
    expect(PALACE_COMPAT).toBe(4);
    const d = doc({ numbers: [{ id: 'n', name: 'x', digits: '3.14', mode: 'what', route: 3 }, { name: 'no id' }] });
    expect(d.numbers).toEqual([{ id: 'n', name: 'x', digits: '314', mode: 'pao', route: 'all' }]);
    const w = normalizeWorld({ ...createWorld(), pao: { codes: { '07': { p: ' 007 ', x: 1 }, '7': { o: '?' }, '08': {} } } });
    expect(w.pao).toEqual({ codes: { '07': { p: '007' } } });
  });
});

describe('数字编码 · 英文', () => {
  afterEach(() => setLocale('zh-CN'));

  it('英文界面用 Major System 的默认物件；中文表不变', () => {
    setLocale('en');
    expect(defaultObjects()).toHaveLength(100);
    expect(new Set(defaultObjects()).size).toBe(100);
    expect(codeOf(undefined, '14').o).toBe('tire');
    expect(codeOf(undefined, '7').o).toBe('sickle');
    expect(imageOf(undefined, '6515', 'images').text).toBe('shell · towel');
    // 和英文默认相同的物件不存
    const t: PaoTable = { codes: {} };
    setCode(t, '14', 'o', 'tire');
    expect(t.codes).toEqual({});
    expect(DEFAULT_OBJECTS[14]).toBe('钥匙');
  });
});
