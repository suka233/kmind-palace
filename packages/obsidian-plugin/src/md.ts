/* =====================================================================
 * Markdown 文本处理（纯函数，不依赖 Obsidian，单元测试覆盖）
 * 笔记 id 就是 Obsidian 的链接：
 *   路径.md            整篇笔记
 *   路径.md#标题        一个标题（连同它下面的内容）
 *   路径.md#^块id       一个段落 / 列表项 / 引述……（绑定时自动加上 ^kp-xxxx）
 * ===================================================================== */

// 只引入多语言模块（和 '@kmind-palace/core' 里导出的是同一个模块），单元测试不必加载整个内核
import { t } from '@kmind-palace/core/src/i18n';

export type NoteKind = 'd' | 'h' | 'b';

export interface NoteId { path: string; kind: NoteKind; frag: string }

export function parseNoteId(id: string): NoteId {
  const i = id.indexOf('#');
  if (i < 0) return { path: id, kind: 'd', frag: '' };
  const frag = id.slice(i + 1);
  return { path: id.slice(0, i), kind: frag.startsWith('^') ? 'b' : 'h', frag: frag.startsWith('^') ? frag.slice(1) : frag };
}

export function noteId(path: string, kind: NoteKind = 'd', frag = '') {
  return kind === 'd' ? path : kind === 'h' ? `${path}#${frag}` : `${path}#^${frag}`;
}

/** 文件 / 文件夹改名：旧路径开头的 id 换成新路径（按路径分段，不会误伤同名前缀） */
export function renamePath(id: string, from: string, to: string): string | null {
  if (id === from) return to;
  if (id.startsWith(from + '#') || id.startsWith(from + '/')) return to + id.slice(from.length);
  return null;
}

const lines = (s: string) => s.split('\n');

/** 去掉开头的 YAML 属性区 */
export function stripFrontmatter(s: string) {
  return s.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

/** 标题（不计代码块里的 #） */
function headingsOf(ls: string[]) {
  const out: { line: number; level: number; text: string }[] = [];
  let fence = false;
  ls.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (fence) return;
    const m = l.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) out.push({ line: i, level: m[1].length, text: m[2].replace(/\s+\^[\w-]+$/, '') });
  });
  return out;
}

/** 标题这一节的行范围 [start, end)：到下一个同级或更高级的标题为止 */
export function headingRange(content: string, heading: string): [number, number] | null {
  const ls = lines(content), hs = headingsOf(ls);
  const i = hs.findIndex(h => h.text === heading);
  if (i < 0) return null;
  const next = hs.slice(i + 1).find(h => h.level <= hs[i].level);
  return [hs[i].line, next ? next.line : ls.length];
}

/**
 * 带 ^id 的块的行范围 [start, end)：id 在块最后一行的行尾（段落、列表项），
 * 或单独一行跟在块后面（引述、表格、代码块）——这时范围是它前面那个块。
 */
export function blockRange(content: string, id: string): [number, number] | null {
  const ls = lines(content);
  const re = new RegExp(`(^|\\s)\\^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  const at = ls.findIndex(l => re.test(l));
  if (at < 0) return null;
  if (/^\s*\^[\w-]+\s*$/.test(ls[at])) {
    // 单独一行：往上跳过空行，找到前一个块
    let end = at;
    while (end > 0 && !ls[end - 1].trim()) end--;
    let start = end;
    while (start > 0 && ls[start - 1].trim()) start--;
    return [start, end];
  }
  // 段落 / 列表项：往上找到段落开头（列表项就是这一行）
  let start = at;
  if (!/^\s*([-*+]|\d+[.)])\s/.test(ls[at])) while (start > 0 && ls[start - 1].trim() && !/^\s*([-*+]|\d+[.)]|#{1,6})\s/.test(ls[start - 1])) start--;
  return [start, at + 1];
}

/** 一个笔记 id 对应的正文（去掉块 id 标记和属性区）；找不到时返回 null */
export function sectionText(content: string, id: NoteId): string | null {
  if (id.kind === 'd') return stripFrontmatter(content).trim();
  const range = id.kind === 'h' ? headingRange(content, id.frag) : blockRange(content, id.frag);
  if (!range) return null;
  return lines(content).slice(range[0], range[1]).join('\n').replace(/\s*\^[\w-]+\s*$/gm, '').trim();
}

/** 一段 Markdown 的简短标题：第一行非空文字，去掉标记符号 */
export function shortTitle(md: string, max = 40) {
  const first = md.split('\n').map(l => l.trim()).find(Boolean) || '';
  const t = first.replace(/^(#{1,6}|>|[-*+]|\d+[.)])\s+/, '').replace(/^\[[ xX]\]\s+/, '')
    .replace(/!?\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_: string, a: string, __: string, b: string | undefined) => b || a).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~=]/g, '').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

export interface BlockChoice {
  /** 块在文件里的结束行（id 加在这一行之后 / 行尾） */
  endLine: number;
  type: string;
  text: string;
  /** 已有的块 id */
  id?: string;
}

/** 给一个块加上 id：段落、列表项写在行尾；引述、表格、代码块、callout 单独一行写在块后面 */
export function addBlockId(content: string, block: Pick<BlockChoice, 'endLine' | 'type'>, id: string): string {
  const ls = lines(content);
  const end = block.endLine;
  if (end < 0 || end >= ls.length) return content;
  if (['blockquote', 'callout', 'table', 'code'].includes(block.type)) {
    ls.splice(end + 1, 0, '', `^${id}`);
    if (ls[end + 3] !== undefined && ls[end + 3].trim()) ls.splice(end + 3, 0, '');
  } else {
    ls[end] = ls[end].replace(/\s*$/, '') + ` ^${id}`;
  }
  return ls.join('\n');
}

/** 记忆故事的引述块（id 单独一行跟在后面） */
export function storyMarkdown(opts: { palace: string; place: string; story: string; image?: string }, id: string) {
  const quote = (s: string) => s.split('\n').map(l => (l ? `> ${l}` : '>')).join('\n');
  let md = quote(`🏛️ **${t('记忆故事')}** · ${opts.palace} · ${opts.place}\n\n${opts.story}`);
  if (opts.image) md += '\n>\n' + quote(`![[${opts.image}]]`);
  return `${md}\n\n^${id}`;
}

/**
 * 写回记忆故事：已有同一个 id 的故事就整段替换；否则插在 afterLine 之后（-1 = 文末）。
 * 返回新的全文。
 */
export function upsertStory(content: string, id: string, md: string, afterLine: number): string {
  const ls = lines(content);
  const at = ls.findIndex(l => l.trim() === `^${id}`);
  if (at >= 0) {
    let start = at;
    while (start > 0 && !ls[start - 1].trim()) start--;
    while (start > 0 && ls[start - 1].startsWith('>')) start--;
    ls.splice(start, at - start + 1, ...md.split('\n'));
    return ls.join('\n');
  }
  const pos = afterLine < 0 || afterLine >= ls.length ? ls.length : afterLine + 1;
  // 前后各留一个空行，不和相邻的段落粘在一起
  const before = pos > 0 && ls[pos - 1]?.trim() ? [''] : [];
  const after = pos < ls.length && ls[pos]?.trim() ? [''] : [];
  ls.splice(pos, 0, ...before, ...md.split('\n'), ...after);
  return ls.join('\n');
}

/** 稳定的短哈希（同一个记忆桩每次写回都用同一个块 id） */
export function shortHash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
