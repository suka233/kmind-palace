const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const ZipPlugin = require("zip-webpack-plugin");
const {EsbuildPlugin} = require("esbuild-loader");
const webpack = require("webpack");

// dev：输出到 ./dev（通过 scripts/link.mjs 软链接到思源工作空间 data/plugins/kmind-palace）
// production：输出到 ./dist 并打包 package.zip（集市发布格式）
module.exports = (env, argv) => {
    const production = argv.mode === "production";
    const outDir = path.resolve(__dirname, production ? "dist" : "dev");
    const plugins = [
        new MiniCssExtractPlugin({filename: "index.css"}),
        // 默认的串门服务器地址：构建时 KP_SERVER_URL=https://… pnpm build:siyuan
        new webpack.DefinePlugin({__KP_SERVER__: JSON.stringify(process.env.KP_SERVER_URL || "")}),
        new CopyPlugin({
            patterns: [
                {from: "plugin.json"},
                {from: "icon.png", noErrorOnMissing: true},
                {from: "preview.webp"},
                {from: "README.md"},
                {from: "README.zh-CN.md"},
                {from: "src/i18n", to: "i18n"},
                // 繁体中文界面（zh-TW）：没有单独的译文，用简体，和宫殿里的界面一致
                {from: "src/i18n/zh-CN.json", to: "i18n/zh-TW.json"},
            ],
        }),
    ];
    if (production) {
        plugins.push(new ZipPlugin({path: "..", filename: "package.zip"}));
    }
    return {
        mode: argv.mode || "development",
        watch: !production && !env.once,
        devtool: production ? false : "eval-cheap-module-source-map",
        entry: {index: "./src/index.ts"},
        output: {
            filename: "[name].js",
            path: outDir,
            clean: true,
            library: {type: "commonjs2"},
        },
        externals: {siyuan: "siyuan"},
        resolve: {extensions: [".ts", ".js", ".json"]},
        module: {
            rules: [
                {test: /\.ts$/, exclude: /node_modules/, loader: "esbuild-loader", options: {target: "es2020"}},
                {test: /\.css$/, use: [MiniCssExtractPlugin.loader, "css-loader"]},
            ],
        },
        optimization: {
            minimize: production,
            // format 必须显式给（哪怕是 undefined）：不然 esbuild-loader 对 web 目标默认包一层 iife，
            // commonjs2 的 module.exports 被包进局部作用域，思源加载时报「plugin has no export」
            minimizer: [new EsbuildPlugin({target: "es2020", css: true, format: undefined})],
        },
        performance: {hints: false},
        plugins,
    };
};
