// dev：输出到 ./dev（通过 scripts/link.mjs 软链接到库的 .obsidian/plugins/kmind-palace）；--watch 监听
// production：输出到 ./dist（发布时上传 main.js、manifest.json、styles.css）
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const outdir = production ? 'dist' : 'dev';
fs.mkdirSync(outdir, { recursive: true });
const copy = () => { for (const f of ['manifest.json', 'styles.css']) fs.copyFileSync(f, path.join(outdir, f)); };

const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'cjs',
  target: 'es2020',
  platform: 'browser',
  outfile: path.join(outdir, 'main.js'),
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  sourcemap: production ? false : 'inline',
  minify: production,
  treeShaking: true,
  logLevel: 'info',
  // 默认的串门服务器地址：KP_SERVER_URL=https://… pnpm build:obsidian
  define: { __KP_SERVER__: JSON.stringify(process.env.KP_SERVER_URL || '') },
  plugins: [{ name: 'copy', setup(b) { b.onEnd(copy); } }],
});
if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
