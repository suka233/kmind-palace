#!/usr/bin/env bash
# 打包两个插件，产物是一次 GitHub Release 要上传的全部附件（思源和 Obsidian 共用公开仓库 suka233/kmind-palace 的同一个 Release）：
#   scripts/release.sh                                 只有本地功能（串门关闭：没有好友、宠物出门、服务器设置，插件不连任何服务器）
#   scripts/release.sh https://palace.example.com      开放串门，并把这个地址设为默认服务器
# 输出 release/：
#   package.zip                         思源集市的安装包
#   main.js、manifest.json、styles.css   Obsidian 的三个文件
# 两个插件的版本号必须一致（Release 的 tag 就是这个版本号，不带 v，Obsidian 要求 tag 和 manifest 的 version 完全一样）。
set -euo pipefail

URL="${1:-}"; URL="${URL%/}"
if [[ -n "$URL" && ! "$URL" =~ ^https?:// ]]; then echo "服务器地址要以 http:// 或 https:// 开头"; exit 1; fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
say() { printf '\033[1;33m▶ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }

SY_VER=$(node -p "require('./packages/siyuan-plugin/plugin.json').version")
OB_VER=$(node -p "require('./packages/obsidian-plugin/manifest.json').version")
OB_MIN=$(node -p "require('./packages/obsidian-plugin/manifest.json').minAppVersion")
[[ "$SY_VER" == "$OB_VER" ]] || die "两个插件的版本号不一致：思源 $SY_VER，Obsidian $OB_VER"
node -e "const v=require('./packages/obsidian-plugin/versions.json'); if(v['$OB_VER']!=='$OB_MIN'){console.error('versions.json 里缺少 \"$OB_VER\": \"$OB_MIN\"'); process.exit(1)}"

say "检查类型、跑测试"
pnpm -r --filter @kmind-palace/core --filter @kmind-palace/protocol --filter kmind-palace-siyuan --filter kmind-palace-obsidian typecheck
pnpm --filter @kmind-palace/core test >/dev/null

if [[ -n "$URL" ]]; then MODE="串门开放，默认服务器 $URL"; else MODE="串门关闭，只有本地功能"; fi
say "构建思源插件 $SY_VER（$MODE）"
KP_SERVER_URL="$URL" pnpm build:siyuan >/dev/null
say "构建 Obsidian 插件 $OB_VER"
KP_SERVER_URL="$URL" pnpm build:obsidian >/dev/null

rm -rf release && mkdir -p release
cp packages/siyuan-plugin/package.zip release/
cp packages/obsidian-plugin/dist/main.js packages/obsidian-plugin/dist/manifest.json packages/obsidian-plugin/dist/styles.css release/

say "按集市的规则检查安装包"
# 和 siyuan-note/bazaar 的 PR 检查一致：包根必须有 README.md、plugin.json、index.js；readme 声明的文件都在包里；
# 多语言键用 BCP 47（zh-CN）；icon ≤ 64 KiB、preview ≤ 512 KiB；只允许已知字段
CHECK_DIR="$(mktemp -d)"; trap 'rm -rf "$CHECK_DIR"' EXIT
unzip -q release/package.zip -d "$CHECK_DIR"
node - "$CHECK_DIR" <<'NODE' || die "思源安装包不符合集市规则"
const fs = require('fs'), path = require('path');
const dir = process.argv[2], errs = [];
for (const f of ['README.md', 'plugin.json', 'index.js']) if (!fs.existsSync(path.join(dir, f))) errs.push(`缺少 ${f}`);
const m = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
const known = ['name', 'author', 'url', 'version', 'minAppVersion', 'kernels', 'backends', 'frontends', 'disabledInPublish', 'publish', 'displayName', 'description', 'readme', 'icon', 'preview', 'funding', 'keywords'];
for (const k of Object.keys(m)) if (!known.includes(k)) errs.push(`plugin.json 有未知字段 ${k}`);
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(m.version)) errs.push(`version 不是语义化版本：${m.version}`);
for (const field of ['displayName', 'description', 'readme']) {
  const o = m[field] || {};
  if (!o.default) errs.push(`${field} 缺少 default`);
  for (const k of Object.keys(o)) if (k !== 'default' && !/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/.test(k)) errs.push(`${field} 的语言键 ${k} 不是 BCP 47（应写成 zh-CN 这样）`);
}
for (const f of Object.values(m.readme || {})) if (!fs.existsSync(path.join(dir, f))) errs.push(`readme 声明的 ${f} 不在包里`);
for (const [field, max] of [['icon', 64 * 1024], ['preview', 512 * 1024]]) {
  if (!m[field]) continue;
  const p = path.join(dir, m[field]);
  if (!fs.existsSync(p)) errs.push(`${field} 声明的 ${m[field]} 不在包里`);
  else if (fs.statSync(p).size > max) errs.push(`${field} 太大：${fs.statSync(p).size} 字节，上限 ${max}`);
}
if (!fs.existsSync(path.join(dir, 'i18n', 'en.json')) || !fs.existsSync(path.join(dir, 'i18n', 'zh-CN.json'))) errs.push('i18n 里应有 en.json 和 zh-CN.json');
if (errs.length) { console.error(errs.map(e => '  - ' + e).join('\n')); process.exit(1); }
NODE

# 构建产物里确实写进了服务器地址
if [[ -n "$URL" ]]; then
  grep -q "$URL" release/main.js || die "Obsidian 构建里没有找到服务器地址"
  unzip -p release/package.zip index.js | grep -q "$URL" || die "思源构建里没有找到服务器地址"
fi

say "完成：release/ 里是这次要上传的附件"
ls -lh release | sed 's/^/  /'
cat <<DONE

下一步（详见 docs/RELEASE.md）：
  1. 代码推到 GitHub 的公开仓库（suka233/kmind-palace）
  2. 在公开仓库建 Release，tag 写 $SY_VER（不带 v），上传 release/ 里的 4 个文件
  3. 两边市场会自动发现新的 Release（思源集市、community.obsidian.md），不用再提 PR
DONE
