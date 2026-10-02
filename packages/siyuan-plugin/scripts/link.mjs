// 把 dev 构建目录软链接到思源工作空间的 data/plugins/kmind-palace（local-only 开发辅助）
// 用法：pnpm run link [工作空间路径]，默认 ~/SiYuan/kmind-palace-dev
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const devDir = path.resolve(here, '..', 'dev');
const workspace = path.resolve(process.argv[2] || path.join(os.homedir(), 'SiYuan', 'kmind-palace-dev'));
const pluginsDir = path.join(workspace, 'data', 'plugins');
const target = path.join(pluginsDir, 'kmind-palace');

fs.mkdirSync(pluginsDir, { recursive: true });
fs.mkdirSync(devDir, { recursive: true });
const stat = fs.lstatSync(target, { throwIfNoEntry: false });
if (stat?.isSymbolicLink()) fs.unlinkSync(target);
else if (stat) {
  console.error(`${target} 已存在且不是软链接，请先手动处理`);
  process.exit(1);
}
fs.symlinkSync(devDir, target, 'dir');
console.log(`linked ${target} -> ${devDir}`);
