import type { PalaceDoc } from './schema';
import { AUTO_ROUTE_ID, autoRoute, allItemsRoute, type SlotSort } from './route';
import { isZh } from './i18n';
import { DEFAULT_OBJECTS_ZH, DEFAULT_SINGLE_ZH } from './pao.zh';
import { DEFAULT_OBJECTS_EN, DEFAULT_SINGLE_EN } from './pao.en';

/* =====================================================================
 * 数字记忆（纯数据）：把一长串数字变成一个个画面，沿路线摆在记忆桩上。
 *   编码表   00–99 每个两位数对应一个人物 / 动作 / 物件（默认只有物件：常见的谐音、象形编码），存在世界数据里
 *   数字组   要背的一串数字（圆周率、电话、年份……），存在宫殿里
 * 两种摆法：
 *   pao      人物-动作-物件：6 位一桩，前两位的人物、中间两位的动作、后两位的物件组成一个画面
 *   images   两位一图：每桩放 1–3 个物件图像
 * ===================================================================== */

export interface PaoEntry { p?: string; a?: string; o?: string }

/** 编码表：只存用户改过的，没改的用默认物件 */
export interface PaoTable { codes: Record<string, PaoEntry> }

export type NumberMode = 'pao' | 'images';

export interface NumberSet {
  id: string;
  name: string;
  digits: string;
  mode: NumberMode;
  /** images 模式下每桩几个图像（1–3） */
  per?: number;
  /** 沿哪条路线放：'all' 宫殿里全部家具（按位置），'auto' 全部记忆桩，或某条路线的 id */
  route: string;
}

/** 常见的两位数物件编码（谐音 / 象形）：中文表，测试和旧代码用；界面上用 defaultObjects()（随语言） */
export const DEFAULT_OBJECTS: string[] = DEFAULT_OBJECTS_ZH;

/** 一位数（数字串末尾落单时）：象形编码（中文表） */
export const DEFAULT_SINGLE: string[] = DEFAULT_SINGLE_ZH;

/** 当前语言的默认物件编码 00–99（中文谐音 / 英文 Major System），可以在编码表里改成自己的 */
export const defaultObjects = (): string[] => (isZh() ? DEFAULT_OBJECTS_ZH : DEFAULT_OBJECTS_EN);
/** 当前语言的一位数象形编码 */
export const defaultSingle = (): string[] => (isZh() ? DEFAULT_SINGLE_ZH : DEFAULT_SINGLE_EN);

export const pairKey = (n: number) => String(n).padStart(2, '0');

/** 一个两位数（或末尾落单的一位数）的编码；没填的人物 / 动作为空 */
export function codeOf(table: PaoTable | undefined, pair: string): Required<PaoEntry> {
  if (pair.length === 1) return { p: '', a: '', o: defaultSingle()[Number(pair)] || pair };
  const e = table?.codes?.[pair] || {};
  return { p: e.p?.trim() || '', a: e.a?.trim() || '', o: e.o?.trim() || defaultObjects()[Number(pair)] || pair };
}

/** 只留数字 */
export const cleanDigits = (s: string) => s.replace(/\D+/g, '');

export const chunkSize = (set: Pick<NumberSet, 'mode' | 'per'>) => (set.mode === 'pao' ? 6 : 2 * Math.min(3, Math.max(1, set.per || 2)));

export function chunks(digits: string, size: number): string[] {
  const d = cleanDigits(digits), out: string[] = [];
  for (let i = 0; i < d.length; i += size) out.push(d.slice(i, i + size));
  return out;
}

const pairsOf = (chunk: string) => chunk.match(/\d{1,2}/g) || [];

export interface NumberImage {
  pairs: string[];
  /** 这一桩的画面：pao 且人物、动作都填了时是一句「人物 动作 物件」，否则是物件图像列表 */
  text: string;
  /** 组成了完整的人物-动作-物件画面 */
  scene: boolean;
}

export function imageOf(table: PaoTable | undefined, chunk: string, mode: NumberMode): NumberImage {
  const pairs = pairsOf(chunk);
  if (mode === 'pao' && pairs.length === 3 && pairs.every(p => p.length === 2)) {
    const [c1, c2, c3] = pairs.map(p => codeOf(table, p));
    if (c1.p && c2.a) return { pairs, text: `${c1.p} ${c2.a} ${c3.o}`, scene: true };
  }
  return { pairs, text: pairs.map(p => codeOf(table, p).o).join(' · '), scene: false };
}

/** 数字组沿着走的那串记忆桩 */
export function numberStops(doc: PalaceDoc, set: Pick<NumberSet, 'route'>, slotSort?: SlotSort): string[] {
  if (set.route === 'all') return allItemsRoute(doc);
  if (set.route === AUTO_ROUTE_ID) return autoRoute(doc, slotSort);
  return doc.routes?.find(r => r.id === set.route)?.stops || allItemsRoute(doc);
}

export interface NumberSlot {
  /** 第几桩（从 0 开始） */
  index: number;
  key: string;
  digits: string;
  image: NumberImage;
}

/** 把数字组一桩一桩摆到记忆桩上；记忆桩不够时 overflow 是放不下的位数 */
export function assignNumbers(doc: PalaceDoc, set: NumberSet, table: PaoTable | undefined, slotSort?: SlotSort): { slots: NumberSlot[]; overflow: number } {
  const stops = numberStops(doc, set, slotSort);
  const cs = chunks(set.digits, chunkSize(set));
  const slots = cs.slice(0, stops.length).map((digits, index) => ({ index, key: stops[index], digits, image: imageOf(table, digits, set.mode) }));
  const overflow = cs.slice(stops.length).reduce((s, c) => s + c.length, 0);
  return { slots, overflow };
}

/** 回忆时核对一桩：逐位比较 */
export function checkDigits(expected: string, answer: string) {
  const a = cleanDigits(answer);
  let correct = 0;
  for (let i = 0; i < expected.length; i++) if (a[i] === expected[i]) correct++;
  return { correct, total: expected.length, ok: a === expected };
}

/**
 * 批量导入编码表：每行「数字 人物 动作 物件」或「数字 物件」，用空格、Tab、逗号或竖线分隔。
 * 返回导入的条数。
 */
export function importCodes(table: PaoTable, text: string): number {
  let n = 0;
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/[\s,，|｜\t]+/).filter(Boolean);
    if (parts.length < 2 || !/^\d{1,2}$/.test(parts[0])) continue;
    const key = pairKey(Number(parts[0]));
    const e: PaoEntry = parts.length >= 4 ? { p: parts[1], a: parts[2], o: parts[3] } : parts.length === 3 ? { p: parts[1], a: parts[2] } : { o: parts[1] };
    for (const [f, val] of Object.entries(e) as [keyof PaoEntry, string][]) setCode(table, key, f, val);
    n++;
  }
  return n;
}

/** 编码表里一条：清掉和默认相同、或空的字段 */
export function setCode(table: PaoTable, key: string, field: keyof PaoEntry, value: string) {
  const e = { ...table.codes[key] };
  const v = value.trim();
  if (!v || (field === 'o' && v === defaultObjects()[Number(key)])) delete e[field]; else e[field] = v;
  if (Object.keys(e).length) table.codes[key] = e; else delete table.codes[key];
}
