import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { OPENAI_DEFAULTS, t, type OpenAiConfig, type SocialAccount } from '@kmind-palace/core';

declare const __KP_SERVER__: string;

/** 串门功能开关：构建时给了服务器地址（KP_SERVER_URL）才开放 */
export const SOCIAL_ENABLED = typeof __KP_SERVER__ === 'string' && !!__KP_SERVER__;
import type KMindPalacePlugin from './main';

export interface Settings {
  /** 宫殿数据所在的库内文件夹 */
  dataFolder: string;
  ai: OpenAiConfig;
  /** 串门服务器（默认地址构建时写入） */
  serverUrl: string;
  /** 串门账号（令牌只存在插件设置里） */
  account: SocialAccount | null;
  /** 第一次装好时的提示已经显示过 */
  welcomed?: number;
}

export const DEFAULT_SETTINGS: Settings = { dataFolder: 'KMind Palace', ai: { ...OPENAI_DEFAULTS }, serverUrl: typeof __KP_SERVER__ === 'string' ? __KP_SERVER__ : '', account: null };

export class PalaceSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: KMindPalacePlugin) { super(app, plugin); }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings, ai = s.ai;
    const save = () => void this.plugin.saveSettings();
    containerEl.empty();

    new Setting(containerEl).setName(t('数据文件夹'))
      .setDesc(t('宫殿、闪卡排期和照片存在库里的这个文件夹，随库一起同步。改了之后重新打开思维宫殿生效（原来的数据不会自动搬过去）。'))
      .addText(c => c.setPlaceholder('KMind Palace').setValue(s.dataFolder).onChange(v => { s.dataFolder = v.trim().replace(/^\/+|\/+$/g, '') || 'KMind Palace'; save(); }));

    if (SOCIAL_ENABLED) new Setting(containerEl).setName(t('串门服务器'))
      .setDesc(t('加好友、互相参观宫殿用的服务器地址（例如 https://palace.example.com）。留空则关闭串门。换了服务器后需要在「好友」里重新开始。'))
      .addText(c => c.setPlaceholder('https://palace.example.com').setValue(s.serverUrl).onChange(v => {
        const url = v.trim().replace(/\/+$/, '');
        if (url !== s.serverUrl) { s.serverUrl = url; s.account = null; save(); }
      }));

    new Setting(containerEl).setName(t('大模型')).setHeading();
    new Setting(containerEl).setName(t('记忆故事的风格')).setDesc(t('夸张荒诞的画面最容易记住'))
      .addDropdown(d => d.addOptions({ vivid: t('夸张荒诞'), warm: t('温馨写实'), brief: t('一句话') }).setValue(ai.style).onChange(v => { ai.style = v as OpenAiConfig['style']; save(); }));
    new Setting(containerEl).setName(t('接口地址')).setDesc(t('OpenAI 兼容接口，例如 https://api.openai.com/v1、DeepSeek、通义千问，或本地的 Ollama（http://127.0.0.1:11434/v1）'))
      .addText(c => c.setPlaceholder('https://api.openai.com/v1').setValue(ai.textBase).onChange(v => { ai.textBase = v.trim(); save(); }));
    new Setting(containerEl).setName('API Key').setDesc(t('只存在本机的插件设置里，不会写进宫殿数据'))
      .addText(c => { c.inputEl.type = 'password'; c.setPlaceholder('sk-…').setValue(ai.textKey).onChange(v => { ai.textKey = v.trim(); save(); }); });
    new Setting(containerEl).setName(t('模型'))
      .addText(c => c.setPlaceholder('gpt-4o-mini').setValue(ai.textModel).onChange(v => { ai.textModel = v.trim(); save(); }));
    new Setting(containerEl).setName(t('识图模型')).setDesc(t('拍照识物用；留空时用上面的模型（它要能看图）'))
      .addText(c => c.setPlaceholder(t('例如 gpt-4o-mini、qwen-vl-plus')).setValue(ai.visionModel).onChange(v => { ai.visionModel = v.trim(); save(); }));
    new Setting(containerEl).setName(t('测试连接')).addButton(b => b.setButtonText(t('发一句「你好」')).onClick(async () => {
      b.setDisabled(true);
      try { new Notice(t('连接成功：{reply}', { reply: (await this.plugin.ai.test()).slice(0, 40) })); } catch (e) { new Notice(t('连接失败：{msg}', { msg: String((e as Error)?.message || e) }), 8000); }
      b.setDisabled(false);
    }));

    new Setting(containerEl).setName(t('配图')).setHeading();
    new Setting(containerEl).setName(t('开启生图')).setDesc(t('按记忆故事画一张配图'))
      .addToggle(c => c.setValue(ai.imageEnabled).onChange(v => { ai.imageEnabled = v; save(); }));
    new Setting(containerEl).setName(t('生图接口地址')).setDesc(t('留空时和文字接口相同'))
      .addText(c => c.setPlaceholder(t('和文字接口相同')).setValue(ai.imageBase).onChange(v => { ai.imageBase = v.trim(); save(); }));
    new Setting(containerEl).setName(t('生图 API Key')).setDesc(t('留空时和文字接口相同'))
      .addText(c => { c.inputEl.type = 'password'; c.setValue(ai.imageKey).onChange(v => { ai.imageKey = v.trim(); save(); }); });
    new Setting(containerEl).setName(t('生图模型'))
      .addText(c => c.setPlaceholder('gpt-image-1').setValue(ai.imageModel).onChange(v => { ai.imageModel = v.trim(); save(); }));
    new Setting(containerEl).setName(t('图片尺寸'))
      .addDropdown(d => d.addOptions({ '1024x1024': '1024 × 1024', '768x768': '768 × 768', '512x512': '512 × 512' }).setValue(ai.imageSize).onChange(v => { ai.imageSize = v; save(); }));
  }
}
