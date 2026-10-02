import { describe, it, expect, afterEach } from 'vitest';
import { setLocale } from '../src/i18n';
import { catalogBrief, recognizeMessages, parseRecognition, extractJson } from '../src/recognize';
import type { CatalogEntry } from '../src/catalog';

// 不依赖 three.js 的迷你目录
const cat: Record<string, CatalogEntry> = {
  sofa: { name: '沙发', category: '坐具', build: null, params: [{ key: 'w', label: '宽度', min: 1.4, max: 3.2, step: .1, def: 2.3 }, { key: 'fabric', label: '布料', options: [['sand', '米色'], ['navy', '藏青']], def: 'sand', customColor: true }] },
  rug: { name: '地毯', category: '装饰', build: null, params: [{ key: 'pattern', label: '花纹', options: [['living', '几何']], def: 'living' }] },
  step: { name: '台阶', category: '户外', build: null, pickable: false },
};

describe('拍照识物', () => {
  it('目录说明列出类型、参数范围和可选值', () => {
    const b = catalogBrief(cat);
    expect(b).toContain('sofa：沙发（坐具） · w(宽度) 1.4–3.2; fabric(布料)=sand|navy|#rrggbb');
    expect(b).not.toContain('step');
    const [sys, user] = recognizeMessages(cat, 'data:image/webp;base64,AAA', '沙发');
    expect(sys.content).toContain('blocks');
    expect(Array.isArray(user.content) && user.content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/webp;base64,AAA' } });
  });

  it('解析目录物件：参数夹在范围内，自定义颜色只在允许的字段上', () => {
    const r = parseRecognition('好的：```json\n{"name":"灰色布艺沙发","type":"sofa","params":{"w":4,"fabric":"#8A8F94","legs":"metal"}}\n```', cat);
    expect(r).toMatchObject({ type: 'sofa', name: '灰色布艺沙发', params: { w: 3.2, fabric: '#8a8f94' } });
    expect(r.warnings.length).toBe(1);
    const bad = parseRecognition({ type: 'rug', params: { pattern: '#ff0000' } }, cat);
    expect(bad.params).toEqual({});
    expect(bad.name).toBe('地毯');
  });

  it('解析积木', () => {
    const r = parseRecognition({ name: '吉他', type: 'blocks', parts: [{ shape: 'sphere', size: [.4, .5, .1] }, { shape: 'unicorn' }] }, cat);
    expect(r.type).toBe('blocks');
    expect(r.params.parts).toHaveLength(1);
    expect(r.warnings.length).toBe(1);
  });

  it('不认识的类型、空结果报错', () => {
    expect(() => parseRecognition({ type: 'spaceship' }, cat)).toThrow(/没有/);
    expect(() => parseRecognition({ type: 'step' }, cat)).toThrow();
    expect(() => parseRecognition({ type: 'blocks', parts: [] }, cat)).toThrow(/空/);
    expect(() => extractJson('我看不清')).toThrow();
  });

  it('JSON 提取容忍思考过程和字符串里的大括号', () => {
    expect(extractJson('<think>{乱}</think> 结果 {"name":"a{b}","type":"sofa"} 完')).toEqual({ name: 'a{b}', type: 'sofa' });
  });
});

describe('拍照识物 · 英文', () => {
  afterEach(() => setLocale('zh-CN'));

  it('英文界面：提示词和报错是英文，模型给英文名', () => {
    setLocale('en');
    const [sys, user] = recognizeMessages(cat, 'data:image/webp;base64,AAA', 'sofa');
    expect(sys.content).toContain('single JSON object');
    expect(sys.content).toContain('Clock face');
    expect(sys.content).not.toContain('表盘');
    expect(Array.isArray(user.content) && user.content[0]).toEqual({ type: 'text', text: 'This is my sofa. Please identify it.' });
    expect(() => parseRecognition({ type: 'spaceship' }, cat)).toThrow(/no item type “spaceship”/);
  });
});
