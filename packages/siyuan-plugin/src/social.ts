import { showMessage, type Plugin, type Setting } from 'siyuan';
import type { HostAdapter, SocialAccount } from '@kmind-palace/core';

/* =====================================================================
 * 串门：服务器地址（插件设置）和账号令牌，存在插件存储的 social.json 里（随思源同步，几台设备是同一个账号）。
 * 默认服务器地址在构建时由环境变量 KP_SERVER_URL 写进来（自部署的人在设置里改成自己的）。
 * ===================================================================== */

declare const __KP_SERVER__: string;
const FILE = 'social.json';

/** 串门功能开关：构建时给了服务器地址（KP_SERVER_URL）才开放；没给时好友、宠物出门、设置里的服务器地址都不出现 */
export const SOCIAL_ENABLED = typeof __KP_SERVER__ === 'string' && !!__KP_SERVER__;

interface SocialConfig { serverUrl: string; account: SocialAccount | null }

export class SocialStore {
  config: SocialConfig = { serverUrl: typeof __KP_SERVER__ === 'string' ? __KP_SERVER__ : '', account: null };

  constructor(private plugin: Plugin) { }

  async load() {
    try {
      const raw = await this.plugin.loadData(FILE);
      if (raw && typeof raw === 'object') this.config = { ...this.config, ...raw };
    } catch { /* 用默认 */ }
  }

  private save() { return this.plugin.saveData(FILE, this.config); }

  adapter(): NonNullable<HostAdapter['social']> {
    return {
      serverUrl: () => this.config.serverUrl.trim(),
      loadAccount: async () => this.config.account,
      saveAccount: async (a) => { this.config.account = a; await this.save(); },
    };
  }

  /** 插件设置里的「串门服务器」 */
  addSettings(setting: Setting, t: (k: string) => string) {
    setting.addItem({
      title: t('socialServer'), description: t('socialServerDesc'),
      createActionElement: () => {
        const el = document.createElement('input');
        el.className = 'b3-text-field fn__flex-center fn__size200';
        el.placeholder = 'https://palace.example.com';
        el.value = this.config.serverUrl;
        el.addEventListener('change', () => {
          const v = el.value.trim().replace(/\/+$/, '');
          if (v && !/^https?:\/\//.test(v)) { showMessage(t('socialServerBad'), 4000, 'error'); return; }
          if (v !== this.config.serverUrl) {
            // 换了服务器：原来的账号在新服务器上不存在
            this.config = { serverUrl: v, account: null };
            void this.save().then(() => showMessage(t('socialServerSaved')));
          }
        });
        return el;
      },
    });
  }
}
