import { EN } from './i18n/en';

/* =====================================================================
 * 界面文字的多语言（目前：简体中文 zh-CN、英文 en）。
 *   源语言是中文：t('原文') 的键就是中文原文本身，英文字典（i18n/en/*.ts）按原文对照。
 *   占位符写成 {name}：t('有 {n} 个记忆桩该复习了', { n: 3 })。
 *   英文单复数：译文写成「单数|复数」，按 vars.n 是否为 1 选一个，例如 '{n} palace|{n} palaces'。
 *   模块顶层的常量（物件目录、模板等）保持中文原文，在显示的地方再 t(x)——加载模块时还不知道语言。
 *   测试（test/i18n.test.ts）保证：源码里每个中文字符串字面量都在英文字典里有译文。
 * ===================================================================== */

export type Locale = 'zh-CN' | 'en';
export const LOCALES: Locale[] = ['zh-CN', 'en'];

let current: Locale = 'zh-CN';

/** 宿主给的语言代码（zh-CN、zh_CN、zh-TW、en-US、ja……）→ 支持的语言；中文一律用简体，其他都用英文 */
export function normalizeLocale(raw: string | null | undefined): Locale {
  const s = String(raw || '').trim().toLowerCase().replace('_', '-');
  if (!s) return 'zh-CN';
  return s.startsWith('zh') ? 'zh-CN' : 'en';
}

export function setLocale(raw: string | null | undefined) {
  current = normalizeLocale(raw);
  if (typeof document !== 'undefined') document.documentElement?.style.setProperty('--kp-lang', current);
}

export function getLocale(): Locale { return current; }

/** 当前是不是中文（少数地方要换整段内容，比如默认的数字编码表） */
export function isZh() { return current === 'zh-CN'; }

function fill(s: string, vars?: Record<string, string | number>) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** 翻译一段界面文字；键就是中文原文。没有译文时原样返回中文（测试会拦住漏翻） */
export function t(zh: string, vars?: Record<string, string | number>): string {
  if (zh == null) return zh;
  let s = zh;
  if (current !== 'zh-CN') {
    const tr = EN[zh];
    if (tr !== undefined) {
      s = tr;
      if (s.includes('|') && vars && typeof vars.n === 'number') {
        const [one, many] = s.split('|');
        s = vars.n === 1 ? one : (many ?? one);
      }
    }
  }
  return fill(s, vars);
}

/**
 * 同一个中文词在不同地方意思不同（「复制」物件 = Duplicate，「复制」好友码 = Copy）：
 * tc('clipboard', '复制') 先找 'clipboard|复制' 的译文，没有再用 '复制' 的。中文界面照常返回原文。
 */
export function tc(context: string, zh: string, vars?: Record<string, string | number>): string {
  if (current !== 'zh-CN' && EN[`${context}|${zh}`] !== undefined) return t(`${context}|${zh}`, vars);
  return t(zh, vars);
}

/** 只在英文里有区别的单复数小工具：plural(n, 'palace') → 'palace' / 'palaces' */
export function plural(n: number, one: string, many = `${one}s`) { return n === 1 ? one : many; }
