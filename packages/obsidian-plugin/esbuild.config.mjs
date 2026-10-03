// dev：输出到 ./dev（通过 scripts/link.mjs 软链接到库的 .obsidian/plugins/kmind-palace）；--watch 监听
// production：输出到 ./dist（发布时上传 main.js、manifest.json、styles.css）
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const outdir = production ? 'dist' : 'dev';
fs.mkdirSync(outdir, { recursive: true });
// styles.css = 宫殿视图的样式（core/src/styles.ts）+ 插件自己的样式；Obsidian 会自动加载它，视图里就不用再插 <style>
async function paletteCss() {
  const r = await esbuild.build({ entryPoints: ['../core/src/styles.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);
  return mod.PALACE_CSS;
}
const copy = async () => {
  fs.copyFileSync('manifest.json', path.join(outdir, 'manifest.json'));
  fs.writeFileSync(path.join(outdir, 'styles.css'), `${(await paletteCss()).trim()}\n\n/* ---- 插件 ---- */\n${fs.readFileSync('styles.css', 'utf8')}`);
};

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
