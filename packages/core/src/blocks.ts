import { t } from './i18n';

/* =====================================================================
 * 积木物件（纯数据）：用基本形体拼出目录里没有的东西
 * 格式是声明式 JSON（不执行任何代码），适合让大模型看图生成，也可以手写。
 * 约定：米为单位；pos 是形体中心在父级坐标里的位置；rot 为度；物件正面朝 +z。
 * 构建时整体会被挪到「底部落地、左右前后居中」，所以坐标原点放哪都行。
 * ===================================================================== */

export type PartShape = 'box' | 'cyl' | 'cone' | 'sphere' | 'torus' | 'lathe' | 'extrude' | 'group';

export interface PartSpec {
  shape: PartShape;
  /**
   * box    [宽, 高, 深]
   * cyl    [顶直径, 高, 底直径?]（底直径不填同顶）
   * cone   [底直径, 高]
   * sphere [x, y, z 方向的直径]（可以压扁）
   * torus  [外径, 管径]
   * extrude 挤出厚度用 size[2]（或 depth）
   */
  size?: number[];
  pos?: [number, number, number];
  rot?: [number, number, number];
  /** 颜色 #rrggbb，或材质名（oak、walnut、black、brass、glass、ceramic、linen…） */
  color?: string;
  /** 粗糙度 0–1 */
  rough?: number;
  /** 金属度 0–1 */
  metal?: number;
  /** 不透明度 0.1–1（水、玻璃） */
  opacity?: number;
  /** box 的圆角半径（米） */
  round?: number;
  /** lathe：轮廓 [[半径, 高度], …]，绕 y 轴旋转成型（花瓶、灯罩） */
  profile?: [number, number][];
  /** extrude：xy 平面上的轮廓 [[x, y], …]，沿 z 挤出 */
  outline?: [number, number][];
  depth?: number;
  /** 镜像复制一份：x 左右对称、z 前后对称、xz 四份 */
  mirror?: 'x' | 'z' | 'xz';
  /** 阵列：一共 count 份，每份在上一份基础上偏移 step */
  repeat?: { count: number; step: [number, number, number] };
  children?: PartSpec[];
  /** 部件编号：可以单独绑定记忆桩 */
  slot?: string;
  name?: string;
}

export const MAX_PARTS = 300;
const SHAPES: PartShape[] = ['box', 'cyl', 'cone', 'sphere', 'torus', 'lathe', 'extrude', 'group'];

const num = (v: unknown, lo: number, hi: number, def: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};
const vec3 = (v: unknown, lo: number, hi: number, def = 0): [number, number, number] =>
  Array.isArray(v) ? [num(v[0], lo, hi, def), num(v[1], lo, hi, def), num(v[2], lo, hi, def)] : [def, def, def];
const points = (v: unknown, lo: number, hi: number): [number, number][] =>
  Array.isArray(v) ? v.slice(0, 64).filter(Array.isArray).map(p => [num(p[0], lo, hi, 0), num(p[1], lo, hi, 0)] as [number, number]) : [];

/** 展开后（镜像、阵列、子形体）一共多少个形体 */
export function countParts(parts: PartSpec[]): number {
  let n = 0;
  for (const p of parts) {
    const copies = (p.mirror === 'xz' ? 4 : p.mirror ? 2 : 1) * (p.repeat?.count || 1);
    n += copies * (p.shape === 'group' ? countParts(p.children || []) : 1);
  }
  return n;
}

/**
 * 校验并规范化积木：丢掉不认识的字段和形体，数值夹在合理范围，超过 MAX_PARTS 时截断。
 * 返回规范化后的部件、展开后的形体数和提示。
 */
export function sanitizeParts(raw: unknown): { parts: PartSpec[]; count: number; warnings: string[] } {
  const warnings: string[] = [];
  let budget = MAX_PARTS;
  const clean = (list: unknown, depth: number): PartSpec[] => {
    if (!Array.isArray(list)) return [];
    const out: PartSpec[] = [];
    for (const r of list) {
      if (!r || typeof r !== 'object') continue;
      const s = r as Record<string, any>;
      const shape = SHAPES.includes(s.shape) ? s.shape as PartShape : null;
      if (!shape) { warnings.push(t('不认识的形体「{shape}」已忽略', { shape: String(s.shape) })); continue; }
      const p: PartSpec = { shape };
      if (s.size !== undefined) p.size = (Array.isArray(s.size) ? s.size : [s.size]).slice(0, 3).map((v: unknown) => num(v, .001, 6, .1));
      if (s.pos) p.pos = vec3(s.pos, -6, 6);
      if (s.rot) p.rot = vec3(s.rot, -720, 720);
      if (typeof s.color === 'string' && s.color.length <= 24) p.color = s.color.trim();
      if (s.rough !== undefined) p.rough = num(s.rough, 0, 1, .7);
      if (s.metal !== undefined) p.metal = num(s.metal, 0, 1, 0);
      if (s.opacity !== undefined) { const o = num(s.opacity, .1, 1, 1); if (o < 1) p.opacity = o; }
      if (s.round !== undefined) p.round = num(s.round, 0, 1, 0);
      if (shape === 'lathe') p.profile = points(s.profile, 0, 6);
      if (shape === 'extrude') { p.outline = points(s.outline, -6, 6); if (s.depth !== undefined) p.depth = num(s.depth, .001, 6, .02); }
      if (s.mirror === 'x' || s.mirror === 'z' || s.mirror === 'xz') p.mirror = s.mirror;
      if (s.repeat && typeof s.repeat === 'object') {
        const count = Math.round(num(s.repeat.count, 1, 50, 1));
        if (count > 1) p.repeat = { count, step: vec3(s.repeat.step, -3, 3) };
      }
      if (typeof s.slot === 'string' && /^[\w:.-]{1,40}$/.test(s.slot)) p.slot = s.slot;
      if (typeof s.name === 'string') p.name = s.name.slice(0, 30);
      const copies = (p.mirror === 'xz' ? 4 : p.mirror ? 2 : 1) * (p.repeat?.count || 1);
      if (shape === 'group') {
        if (depth >= 6) { warnings.push(t('嵌套太深，多出的层级已忽略')); continue; }
        p.children = clean(s.children, depth + 1);
        if (!p.children.length) continue;
        const n = countParts(p.children) * copies;
        if (n > budget) { warnings.push(t('形体超过 {n} 个，后面的已省略', { n: MAX_PARTS })); break; }
        budget -= n;
      } else {
        if (shape === 'lathe' && (p.profile?.length || 0) < 2) { warnings.push(t('车削形体缺少轮廓，已忽略')); continue; }
        if (shape === 'extrude' && (p.outline?.length || 0) < 3) { warnings.push(t('挤出形体缺少轮廓，已忽略')); continue; }
        if (copies > budget) { warnings.push(t('形体超过 {n} 个，后面的已省略', { n: MAX_PARTS })); break; }
        budget -= copies;
      }
      out.push(p);
    }
    return out;
  };
  const parts = clean(raw, 0);
  return { parts, count: countParts(parts), warnings: [...new Set(warnings)] };
}

/** 积木里某个部件的名字（部件编号 → name） */
export function partName(parts: PartSpec[] | undefined, slot: string): string | null {
  for (const p of parts || []) {
    if (p.slot === slot) return p.name || slot;
    const hit = partName(p.children, slot);
    if (hit) return hit;
  }
  return null;
}
