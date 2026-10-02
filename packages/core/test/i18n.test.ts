import { describe, it, expect, afterEach } from 'vitest';
import { t, setLocale, normalizeLocale } from '../src/i18n';
import { EN } from '../src/i18n/en';
import { allFiles, problems, CJK } from './i18n-scan';

/* =====================================================================
 * 多语言的完整性检查：
 *   - core、思源插件、Obsidian 插件源码里每个含中文的字符串字面量，都要在英文字典里有译文；
 *   - 含中文的模板字符串不能再用 ${} 拼接（改成 t('…{x}…', { x })，英文语序才对得上）；
 *   - 译文里的占位符和原文一致。
 * 不是界面文字的中文（解析大模型输出用的正则、提示词里给模型看的示例等）在那一行加注释 i18n-ignore。
 * ===================================================================== */

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

describe('多语言', () => {
  afterEach(() => setLocale('zh-CN'));

  it('语言代码归一：中文一律简体，其他一律英文', () => {
    expect(normalizeLocale('zh_CN')).toBe('zh-CN');
    expect(normalizeLocale('zh-TW')).toBe('zh-CN');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('ja')).toBe('en');
    expect(normalizeLocale('')).toBe('zh-CN');
  });

  it('占位符与英文单复数', () => {
    setLocale('en');
    expect(t('{n} 天前', { n: 1 })).toBe('1 day ago');
    expect(t('{n} 天前', { n: 3 })).toBe('3 days ago');
    setLocale('zh-CN');
    expect(t('{n} 天前', { n: 3 })).toBe('3 天前');
  });

  const found = problems(allFiles());

  it('含中文的模板字符串不再用 ${} 拼接', () => {
    expect(found.interp).toEqual([]);
  });

  it('每个中文字符串都有英文译文', () => {
    expect(found.missing).toEqual([]);
  });

  it('译文的占位符和原文一致，译文里不留中文', () => {
    const bad = Object.entries(EN).filter(([zh, en]) => en.split('|').some(part => placeholders(part) !== placeholders(zh)) || CJK.test(en.replace(/[，。、：；（）！？“”‘’「」《》…·—]/g, '')));
    expect(bad.map(([zh, en]) => `${zh} → ${en}`)).toEqual([]);
  });
});
