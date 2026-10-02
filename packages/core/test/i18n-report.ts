/* 多语言进度报告：npx tsx test/i18n-report.ts [文件或目录…]（路径相对 packages/，不给就是全部） */
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, walk, allFiles, problems } from './i18n-scan';

const args = process.argv.slice(2);
const files = args.length ? args.flatMap(a => { const p = path.resolve(ROOT, a); return fs.statSync(p).isDirectory() ? walk(p) : [p]; }) : allFiles();
const { interp, missing } = problems(files);
const count = (list: string[]) => { const m = new Map<string, number>(); for (const l of list) { const f = l.split(':')[0]; m.set(f, (m.get(f) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
console.log(`模板拼接 ${interp.length} 处，缺译文 ${missing.length} 处`);
for (const [f, n] of count([...interp, ...missing])) console.log(`  ${String(n).padStart(4)}  ${f}`);
if (process.env.VERBOSE) { for (const l of interp) console.log('INTERP ' + l); for (const l of missing) console.log('MISSING ' + l); }
