// Obsidian 官方的审核规则（community.obsidian.md 的自动审核用的就是这一套），对整个仓库生效
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/dev/**/*.js", "**/*.d.ts", "**/test/**", "**/*.test.ts", "release/**", "main.js",
      "packages/*/dev/index.js", "packages/siyuan-plugin/dev/**", "packages/obsidian-plugin/dev/**", "apps/**", "prototypes/**", "tools/**", "deploy/**", "scripts/**", "**/*.mjs", "**/*.config.*"],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["packages/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true } },
    // 和线上审核的级别一致：这些在 community.obsidian.md 上只算 Warning（Error 的是 innerHTML、写死的样式、<style> 等）
    rules: Object.fromEntries([
      "@typescript-eslint/no-unsafe-member-access", "@typescript-eslint/no-unsafe-argument", "@typescript-eslint/no-unsafe-assignment",
      "@typescript-eslint/no-unsafe-call", "@typescript-eslint/no-unsafe-return", "@typescript-eslint/no-unnecessary-type-assertion",
      "@typescript-eslint/no-base-to-string", "@typescript-eslint/unbound-method", "@typescript-eslint/no-misused-promises",
      "@typescript-eslint/no-floating-promises", "@typescript-eslint/no-this-alias", "@typescript-eslint/no-redundant-type-constituents",
      "obsidianmd/rule-custom-message", "no-control-regex",
    ].map(r => [r, "warn"])),
  },
]);
