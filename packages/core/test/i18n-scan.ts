import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EN } from '../src/i18n/en';

/* 多语言扫描：找出源码里含中文的字符串字面量，检查英文字典（i18n.test.ts 和 i18n-report.ts 共用） */

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DIRS = ['core/src', 'siyuan-plugin/src', 'obsidian-plugin/src'].map(d => path.join(ROOT, d));
export const CJK = /[㐀-鿿＀-￯　-〿]/;

export interface Lit { file: string; line: number; text: string; template: boolean; interp: boolean }

export function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'i18n' ? [] : walk(p);
    return /\.ts$/.test(e.name) && !/\.(d|zh)\.ts$/.test(e.name) ? [p] : [];
  });
}

/** 简单的 TS 词法：找出字符串 / 模板字面量（跳过注释和正则） */
export function literals(file: string): Lit[] {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const out: Lit[] = [];
  let i = 0, line = 1, lastSig = '';
  const lineOf = () => line;
  const read = (quote: string) => {
    const startLine = lineOf();
    let text = '', interp = false;
    i++;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { text += src[i + 1]; i += 2; continue; }
      if (c === '\n') line++;
      if (c === quote) { i++; break; }
      if (quote === '`' && c === '$' && src[i + 1] === '{') {
        interp = true;
        // 跳过 ${ … }（里面可能还有字符串，递归处理）
        i += 2;
        let depth = 1;
        while (i < src.length && depth > 0) {
          const d = src[i];
          if (d === '\n') line++;
          if (d === '{') depth++;
          else if (d === '}') depth--;
          else if (d === "'" || d === '"' || d === '`') { scan(d); continue; }
          if (depth > 0) i++;
        }
        i++;
        text += '${}';
        continue;
      }
      text += c;
      i++;
    }
    return { startLine, text, interp };
  };
  const scan = (quote: string) => {
    const { startLine, text, interp } = read(quote);
    if (CJK.test(text)) out.push({ file, line: startLine, text, template: quote === '`', interp });
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); for (let k = i; k < e; k++) if (src[k] === '\n') line++; i = e + 2; continue; }
    if (c === '/' && /[(,=:[!&|?{};]|^$|return/.test(lastSig)) {
      // 正则字面量：跳到结尾的 /
      i++;
      let cls = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '[') cls = true; else if (d === ']') cls = false;
        else if (d === '/' && !cls) { i++; break; }
        else if (d === '\n') break;
        i++;
      }
      lastSig = 'x';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { scan(c); lastSig = 'x'; continue; }
    if (!/\s/.test(c)) {
      if (/[A-Za-z0-9_$]/.test(c)) {
        let w = '';
        while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) w += src[i++];
        lastSig = w === 'return' || w === 'typeof' || w === 'case' ? 'return' : 'x';
        continue;
      }
      lastSig = c;
    }
    i++;
  }
  return out.filter(l => !/i18n-ignore/.test(lines[l.line - 1] || ''));
}


/** 一组文件里还没处理好的地方：模板拼接、缺译文 */
export function problems(files: string[]) {
  const lits = files.flatMap(literals);
  const rel = (l: Lit) => `${path.relative(ROOT, l.file)}:${l.line}  ${JSON.stringify(l.text).slice(0, 100)}`;
  return {
    interp: lits.filter(l => l.interp).map(rel),
    missing: lits.filter(l => !l.interp && EN[l.text] === undefined).map(rel),
  };
}

export function allFiles() { return DIRS.flatMap(walk); }
