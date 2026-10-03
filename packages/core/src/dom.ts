// 不经过 innerHTML 构建界面：
//   html`<b>${name}</b>`   只解析模板里写死的部分；插进去的值一律当文本 / 属性值，永远不会被当成 HTML 解析
//   rich(t('按 <b>R</b> 旋转'))  界面文案里少量排版标签和 SVG 图标：按白名单重建节点，其余标签只留文字、属性一律丢掉
// 两者都返回 DocumentFragment，用 el.replaceChildren(...) / el.append(...) 放进页面。

export type Child = Node | Rich | string | number | boolean | null | undefined | readonly Child[];

/** 白名单标记（界面文案 / 图标），见 rich() */
export class Rich {
  constructor(readonly source: string) { }
}

/** 文案里允许的排版标签和 SVG 图标；属性只留下面这些 */
const TAGS = new Set(['b', 'strong', 'i', 'em', 'small', 'br', 'kbd', 'code', 'span',
  'svg', 'path', 'circle', 'rect', 'g', 'line', 'polyline', 'polygon', 'ellipse']);
const ATTRS = new Set(['class', 'viewBox', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'width', 'height', 'points', 'opacity', 'fill', 'stroke', 'stroke-width', 'transform']);
const SVG_NS = 'http://www.w3.org/2000/svg';
/** 只在 SVG 里有意义的标签：不管在哪儿出现都按 SVG 建 */
const SVG_ONLY = new Set(['svg', 'path', 'circle', 'rect', 'g', 'line', 'polyline', 'polygon', 'ellipse']);

export function rich(source: string) {
  return new Rich(source);
}

const parser = () => new DOMParser();

function parseInert(source: string): DocumentFragment {
  // DOMParser 得到的是一个不执行脚本、不加载资源的独立文档；<template> 让任何片段（<tr>、<option>…）都按原样解析
  const doc = parser().parseFromString(`<template>${source}</template>`, 'text/html');
  return doc.querySelector('template').content;
}

const BARE_SVG = /<(path|circle|rect|g|line|polyline|polygon|ellipse)[\s/>]/i;
const richCache = new Map<string, DocumentFragment>();

function richFragment(source: string): DocumentFragment {
  let frag = richCache.get(source);
  if (!frag) {
    frag = document.createDocumentFragment();
    // 只有 <path>/<circle> 等、外面没包 <svg> 的图标：按 HTML 解析时 <circle/> 不会自闭合，得包一层 <svg> 再拆开
    if (BARE_SVG.test(source) && !/<svg[\s>]/i.test(source)) copyAllowed(parseInert(`<svg>${source}</svg>`).firstChild, frag, true);
    else copyAllowed(parseInert(source), frag, false);
    if (richCache.size > 500) richCache.clear();
    richCache.set(source, frag);
  }
  return frag.cloneNode(true) as DocumentFragment;
}

function copyAllowed(from: Node, to: Node, inSvg: boolean) {
  for (const n of Array.from(from.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) { to.appendChild(document.createTextNode(n.nodeValue)); continue; }
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const src = n as Element;
    const tag = src.localName;
    if (tag === 'script' || tag === 'style' || tag === 'template') continue;
    if (!TAGS.has(tag)) { copyAllowed(src, to, inSvg); continue; }   // 不认识的标签：只留里面的文字
    const svg = inSvg || SVG_ONLY.has(tag);
    const el = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    for (const a of Array.from(src.attributes)) if (ATTRS.has(a.name)) el.setAttribute(a.name, a.value);
    copyAllowed(src, el, svg);
    to.appendChild(el);
  }
}

// ---- html`` ----

const OPEN = '', CLOSE = '';
const MARK = /(\d+)/g;
const SPREAD = 'data-kp-attrs-';

type Compiled = DocumentFragment;
const compiled = new WeakMap<TemplateStringsArray, Compiled>();

/** 拼接模板的静态部分，在插值处放占位符（文本 / 属性值里放私用区字符，标签里放一个占位属性） */
function compile(strings: TemplateStringsArray): Compiled {
  let src = '';
  let state: 'text' | 'tag' | 'dq' | 'sq' | 'comment' = 'text';
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      if (state === 'text') {
        if (c === '<' && s.startsWith('<!--', j)) state = 'comment';
        else if (c === '<' && /[a-zA-Z/]/.test(s[j + 1] || '')) state = 'tag';
      } else if (state === 'comment') {
        if (c === '>' && s.slice(Math.max(0, j - 2), j) === '--') state = 'text';
      } else if (state === 'tag') {
        if (c === '"') state = 'dq';
        else if (c === "'") state = 'sq';
        else if (c === '>') state = 'text';
      } else if (state === 'dq') { if (c === '"') state = 'tag'; }
      else if (state === 'sq') { if (c === "'") state = 'tag'; }
    }
    src += s;
    if (i === strings.length - 1) break;
    if (state === 'comment') throw new Error('html``: interpolation inside an HTML comment is not supported');
    if (state === 'tag') {
      // 属性值没加引号（value=${x}）就补上；否则是一组属性（${checked ? 'checked' : ''}）
      src += /=\s*$/.test(s) ? `"${OPEN}${i}${CLOSE}"` : ` ${SPREAD}${i}="" `;
    } else {
      src += `${OPEN}${i}${CLOSE}`;
    }
  }
  return parseInert(src);
}

/** 字符串、数字等原样转成文字；其他对象不该出现在这里，转成 JSON 便于发现 */
const scalar = (v: unknown) => typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'bigint' ? v.toString() : JSON.stringify(v);

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && typeof (v as Node).nodeType === 'number';

/** 插到文本位置的值 → 节点 */
function toNodes(v: unknown, out: Node[]) {
  if (v == null || v === false || v === true) return;
  if (Array.isArray(v)) { for (const x of v) toNodes(x, out); return; }
  if (v instanceof Rich) { out.push(richFragment(v.source)); return; }
  if (isNode(v)) { out.push(v); return; }
  out.push(document.createTextNode(scalar(v)));
}

/** 插到属性值里的值 → 字符串 */
function toText(v: unknown): string {
  if (v == null || v === false || v === true) return '';
  if (Array.isArray(v)) return v.map(toText).join('');
  if (v instanceof Rich) return richFragment(v.source).textContent;
  if (isNode(v)) return v.textContent;
  return scalar(v);
}

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'srcset', 'poster']);

function setAttr(el: Element, name: string, value: string, dynamic: boolean) {
  const n = name.toLowerCase();
  if (dynamic && (n.startsWith('on') || n === 'style' && /expression|url\s*\(\s*['"]?\s*javascript:/i.test(value))) {
    throw new Error(`html: refusing to set ${name} dynamically`);
  }
  if (dynamic && URL_ATTRS.has(n) && /^\s*(javascript|vbscript):/i.test(value)) value = '';
  el.setAttribute(name, value);
}

/** ${'checked'}、${'disabled'}、${'selected'} 这类布尔属性，也可以是 name="value" */
function spreadAttrs(el: Element, spec: string) {
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g;
  for (const m of spec.matchAll(re)) setAttr(el, m[1], m[2] ?? '', true);
}

/** 单独解析的片段（html`<rect …/>`）放进 <svg> 时，要换成 SVG 命名空间的元素才画得出来 */
function toSvg(n: Node): Node {
  if (n.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    const f = document.createDocumentFragment();
    for (const c of Array.from(n.childNodes)) f.appendChild(toSvg(c));
    return f;
  }
  if (n.nodeType !== Node.ELEMENT_NODE || (n as Element).namespaceURI === SVG_NS) return n;
  const src = n as Element;
  const el = document.createElementNS(SVG_NS, src.localName);
  for (const a of Array.from(src.attributes)) el.setAttribute(a.name, a.value);
  for (const c of Array.from(src.childNodes)) el.appendChild(toSvg(c));
  return el;
}

function fill(root: DocumentFragment, values: unknown[]) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) { if (n.nodeValue.includes(OPEN)) texts.push(n as Text); continue; }
    const el = n as Element;
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith(SPREAD)) {
        el.removeAttribute(a.name);
        spreadAttrs(el, toText(values[Number(a.name.slice(SPREAD.length))]));
      } else if (a.value.includes(OPEN)) {
        setAttr(el, a.name, a.value.replace(MARK, (_, i: string) => toText(values[Number(i)])), true);
      }
    }
  }
  for (const node of texts) {
    const parent = node.parentNode;
    // <textarea> 里只能放文字
    if (parent.nodeName === 'TEXTAREA') {
      node.nodeValue = node.nodeValue.replace(MARK, (_, i: string) => toText(values[Number(i)]));
      continue;
    }
    const parts = node.nodeValue.split(MARK);   // 偶数位是静态文字，奇数位是插值序号
    const out: Node[] = [];
    parts.forEach((p, k) => {
      if (k % 2 === 0) { if (p) out.push(document.createTextNode(p)); } else toNodes(values[Number(p)], out);
    });
    const inSvg = (parent as Element).namespaceURI === SVG_NS;
    for (const x of out) parent.insertBefore(inSvg ? toSvg(x) : x, node);
    parent.removeChild(node);
  }
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): DocumentFragment {
  let tpl = compiled.get(strings);
  if (!tpl) { tpl = compile(strings); compiled.set(strings, tpl); }
  const frag = document.importNode(tpl, true);
  if (values.length) fill(frag, values);
  return frag;
}
