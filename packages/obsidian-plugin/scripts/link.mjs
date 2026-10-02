// 把 dev 构建目录软链接到库的 .obsidian/plugins/kmind-palace（local-only 开发辅助）
// 用法：pnpm run link <库路径>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const devDir = path.resolve(here, '..', 'dev');
if (!process.argv[2]) { console.error('用法：pnpm run link <库路径>'); process.exit(1); }
const pluginsDir = path.join(path.resolve(process.argv[2]), '.obsidian', 'plugins');
const target = path.join(pluginsDir, 'kmind-palace');
fs.mkdirSync(pluginsDir, { recursive: true });
fs.mkdirSync(devDir, { recursive: true });
const stat = fs.lstatSync(target, { throwIfNoEntry: false });
if (stat?.isSymbolicLink()) fs.unlinkSync(target);
else if (stat) { console.error(`${target} 已存在且不是软链接，请先手动处理`); process.exit(1); }
fs.symlinkSync(devDir, target, 'dir');
console.log(`linked ${target} -> ${devDir}`);
