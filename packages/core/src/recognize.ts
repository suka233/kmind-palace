import type { CatalogEntry, ParamSpec } from './catalog';
import { isHexColor, UNKNOWN_TYPE } from './catalog';
import { sanitizeParts, type PartSpec } from './blocks';
import type { ChatMessage } from './host';
import { t } from './i18n';

/* =====================================================================
 * 拍照识物（纯数据）：给视觉模型的提示词、解析它返回的物件
 * 优先让模型从目录里挑最接近的类型、按照片调参数（结果一定好看、风格统一）；
 * 目录里没有的东西才用积木拼（blocks.ts）。
 * ===================================================================== */

/** 不让模型选的类型（结构件、导入模型、积木本身另有说明） */
const SKIP = new Set(['step', 'railing', 'model', 'blocks', 'stringLights', UNKNOWN_TYPE]);

/** 目录的精简说明：每行一个类型和它的参数 */
export function catalogBrief(catalog: Record<string, CatalogEntry>) {
  const lines: string[] = [];
  for (const [type, e] of Object.entries(catalog)) {
    if (SKIP.has(type) || e.pickable === false) continue;
    const ps = (e.params || []).filter(p => !p.kind).map(p => {
      if (p.options) {
        const opts = p.options.filter(([v]) => v !== null).map(([v]) => String(v)).join('|');
        return `${p.key}(${t(p.label)})=${opts}${p.customColor ? '|#rrggbb' : ''}`;
      }
      return `${p.key}(${t(p.label)}) ${p.min}–${p.max}`;
    });
    const vars = { type, name: t(e.name), cat: t(e.category) };
    const head = e.mount === 'wall' ? t('{type}：{name}（{cat}，挂墙）', vars) : t('{type}：{name}（{cat}）', vars);
    lines.push(head + (ps.length ? ' · ' + ps.join('; ') : ''));
  }
  return lines.join('\n');
}

/** 积木格式说明（逐行翻译；模块加载时还不知道语言，用的时候再 t()） */
const BLOCKS_GUIDE = [
  '积木格式（目录里没有合适的类型时用）：',
  '{"name":"落地钟","type":"blocks","parts":[',
  '  {"shape":"box","size":[0.5,1.8,0.3],"pos":[0,1,0],"color":"walnut","round":0.015},',
  '  {"shape":"cyl","size":[0.36,0.02],"pos":[0,1.58,0.155],"rot":[90,0,0],"color":"#f3ead8","slot":"face","name":"表盘"},',
  '  {"shape":"cyl","size":[0.04,0.7],"pos":[0.2,0.35,0.2],"mirror":"xz","color":"black"}',
  ']}',
  '- 单位米；pos 是形体中心；rot 为度；物件正面朝 +z；落地、居中会自动处理',
  '- shape：box [宽,高,深]（round 圆角）· cyl [顶直径,高,底直径] · cone [底直径,高] · sphere [x,y,z 直径] · torus [外径,管径] · lathe（profile: [[半径,高度],…]）· extrude（outline: [[x,y],…], depth）· group（children）',
  '- color：#rrggbb 或 oak / walnut / black / white / brass / glass / ceramic / linen；可加 rough、metal（0–1）、opacity（水、玻璃）',
  '- 对称的腿用 mirror（x / z / xz），一排重复的用 repeat {count, step}',
  '- 值得单独记忆的部分加 slot（英文编号）和 name（中文名）',
  '- 一般 5–40 个形体，最多 300 个',
];

const blocksGuide = () => BLOCKS_GUIDE.map(l => (/[^\x00-\x7f]/.test(l) ? t(l) : l)).join('\n');

export function recognizeMessages(catalog: Record<string, CatalogEntry>, imageUrl: string, hint = ''): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        t('你是室内陈设建模助手。用户拍了一件家具或物品，请把它变成 3D 记忆宫殿里的一个物件。'),
        t('优先从下面的目录里选最接近的类型，按照片调整参数：尺寸按真实世界估计（米），颜色尽量贴近照片（可以写 #rrggbb）。'),
        t('目录里确实没有合适的类型时，才用积木（type 为 blocks）拼出来，抓住轮廓和主要颜色即可。'),
        t('只输出一个 JSON 对象，不要解释、不要 Markdown：'),
        t('{"name":"中文名（10 字以内）","type":"目录里的类型","params":{参数}}'),
        '',
        t('目录（类型：名称 · 参数）：'),
        catalogBrief(catalog),
        '',
        blocksGuide(),
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: hint ? t('这是我的{hint}，请识别。', { hint }) : t('请识别照片里的主要物件。') },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    },
  ];
}

export interface Recognized {
  type: string;
  name: string;
  params: Record<string, any>;
  /** 参数被调整 / 形体被省略时的提示 */
  warnings: string[];
}

/** 从模型输出里取出第一个 JSON 对象（容忍 ```json 包裹和前后的废话） */
export function extractJson(text: string): any {
  const s = (text || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = s.indexOf('{');
  if (start < 0) throw new Error(t('模型没有返回物件描述'));
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error(t('模型返回的物件描述不完整'));
}

function cleanParam(spec: ParamSpec, v: any, warnings: string[]) {
  if (spec.options) {
    if (spec.options.some(([o]) => o === v)) return v;
    if (spec.customColor && isHexColor(v)) return v.toLowerCase();
    warnings.push(t('「{label}」的值 {v} 不在可选范围内，用了默认值', { label: t(spec.label), v: JSON.stringify(v) }));
    return undefined;
  }
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return undefined;
  const c = Math.min(spec.max, Math.max(spec.min, n));
  if (c !== n) warnings.push(t('「{label}」{n} 超出范围，调成了 {c}', { label: t(spec.label), n, c }));
  return spec.step >= 1 ? Math.round(c) : Math.round(c * 1000) / 1000;
}

/** 校验模型返回的物件：类型必须在目录里（或是积木），参数按目录的范围修正 */
export function parseRecognition(raw: unknown, catalog: Record<string, CatalogEntry>): Recognized {
  const o = (typeof raw === 'string' ? extractJson(raw) : raw) as Record<string, any>;
  if (!o || typeof o !== 'object') throw new Error(t('模型返回的不是物件描述'));
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 20) : '';
  const warnings: string[] = [];
  if (o.type === 'blocks' || (!o.type && Array.isArray(o.parts))) {
    const r = sanitizeParts(o.parts);
    if (!r.parts.length) throw new Error(t('模型给的积木是空的'));
    return { type: 'blocks', name: name || t('积木'), params: { parts: r.parts as PartSpec[] }, warnings: r.warnings };
  }
  const entry = catalog[o.type];
  if (!entry || SKIP.has(o.type)) throw new Error(t('目录里没有「{type}」这种物件', { type: String(o.type) }));
  const params: Record<string, any> = {};
  for (const spec of entry.params || []) {
    if (spec.kind || o.params?.[spec.key] === undefined) continue;
    const v = cleanParam(spec, o.params[spec.key], warnings);
    if (v !== undefined) params[spec.key] = v;
  }
  return { type: o.type, name: name || t(entry.name), params, warnings };
}
