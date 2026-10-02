import { Plugin, Dialog, openTab, openMobileFileById, getFrontend, showMessage } from 'siyuan';
import { PalaceView, PalaceStore, setLocale, type HostAdapter } from '@kmind-palace/core';

/** 思源的界面语言（zh-CN、en、zh-CHT……） */
const siyuanLang = () => (window as any).siyuan?.config?.lang as string | undefined;
import { siyuanStorage } from './store';
import { openBlockPicker, getBlockRef } from './picker';
import { createReview, renderBlock } from './review';
import { listDocs, openSourcePicker, watchDocs, saveMedia, loadMedia } from './docs';
import { AiService } from './ai';
import { getBlockText, writeStory } from './notes';
import { SocialStore, SOCIAL_ENABLED } from './social';
import './index.css';

const TAB_TYPE = 'palace';
const ICON = 'iconKMindPalace';
const ICON_SVG = `<symbol id="${ICON}" viewBox="0 0 32 32">
  <path d="M16 3 3 10.2l13 7.3 13-7.3L16 3Zm0 3.1 7.7 4.2L16 14.5l-7.7-4.2L16 6.1Z"/>
  <path d="m3 15.4 13 7.3 13-7.3v3.2l-13 7.3-13-7.3v-3.2Z"/>
  <path d="m3 20.8 13 7.3 13-7.3V24l-13 7.3L3 24v-3.2Z" opacity=".55"/>
</symbol>`;

interface Mounted { view: PalaceView; container: HTMLElement }
/** 页签模型（桌面端 Custom）：用来随所在位置更新标题 */
type TabModel = { tab?: { updateTitle?(title: string): void } } | null;

// 插件被重载 / 停用时，思源会在旧实例拆除过程中调用页签的 update()。
// 此时旧实例已不可用：把页签登记到全局，等下一个实例 onload 时接管。
const GLOBAL_KEY = '__kmindPalacePlugin';
const PENDING_KEY = '__kmindPalacePendingTabs';
const G = globalThis as any;

export default class KMindPalacePlugin extends Plugin {
  private store!: PalaceStore;
  private ai!: AiService;
  private social!: SocialStore;
  private mounted = new Map<HTMLElement, Mounted>();
  private mobileDialog: Dialog | null = null;
  private isMobile = false;

  onload() {
    setLocale(siyuanLang());
    const fe = getFrontend();
    this.isMobile = fe === 'mobile' || fe === 'browser-mobile';
    this.store = new PalaceStore(siyuanStorage(this), (msg) => showMessage(this.t('saveFailed', { msg }), 6000, 'error'));
    G[GLOBAL_KEY] = this;
    // 大模型配置（Key 只存在插件自己的 ai.json 里）
    this.ai = new AiService(this);
    void this.ai.load();
    this.setting = this.ai.setupSettings((k) => this.t(k));
    this.social = new SocialStore(this);
    if (SOCIAL_ENABLED) {
      void this.social.load();
      this.social.addSettings(this.setting, (k) => this.t(k));
    }

    this.addIcons(ICON_SVG);
    const plugin = this;
    this.addTab({
      type: TAB_TYPE,
      init() {
        void plugin.mount(this.element as HTMLElement, this.data?.palaceId, this as TabModel);
      },
      update() {
        const el = this.element as HTMLElement;
        const current = G[GLOBAL_KEY] as KMindPalacePlugin | undefined;
        if (current && current !== plugin) { void current.mount(el, this.data?.palaceId, this as TabModel); return; }
        plugin.unmount(el);
        (G[PENDING_KEY] ||= new Map()).set(el, { palaceId: this.data?.palaceId, model: this as TabModel });
        const tip = document.createElement('div');
        tip.className = 'kmind-palace-host kmind-palace-error';
        tip.textContent = plugin.t('disabled');
        el.appendChild(tip);
      },
      destroy() {
        const el = this.element as HTMLElement;
        (G[PENDING_KEY] as Map<HTMLElement, unknown>)?.delete(el);
        ((G[GLOBAL_KEY] as KMindPalacePlugin) || plugin).unmount(el);
      },
    });
    // 接管上一个实例留下的页签
    const pending = G[PENDING_KEY] as Map<HTMLElement, { palaceId?: string; model: TabModel }> | undefined;
    if (pending) {
      delete G[PENDING_KEY];
      pending.forEach(({ palaceId, model }, el) => { if (el.isConnected) void this.mount(el, palaceId, model); });
    }
    this.addCommand({
      langKey: 'openPalace',
      hotkey: '⌥⇧M',
      callback: () => void this.openPalace(),
    });
  }

  onLayoutReady() {
    this.addTopBar({
      id: 'open-palace',
      icon: ICON,
      title: this.t('openPalace'),
      position: 'right',
      callback: () => void this.openPalace(),
    });
    void this.welcomeOnce();
  }

  /** 刚装好时提示一次去哪里打开（打开之后宫殿里还有完整的新手引导） */
  private async welcomeOnce() {
    try {
      const state = await this.loadData('state.json');
      if (state && typeof state === 'object' && state.welcomed) return;
      showMessage(this.t('welcome'), 10000);
      await this.saveData('state.json', { ...(state && typeof state === 'object' ? state : {}), welcomed: Date.now() });
    } catch { /* 下次再说 */ }
  }

  async onunload() {
    for (const el of [...this.mounted.keys()]) this.unmount(el);
    this.mobileDialog?.destroy();
    await this.store.flush();
    if (G[GLOBAL_KEY] === this) delete G[GLOBAL_KEY];
  }

  /** 同步或其他端改动了宫殿数据：刷新打开着的视图，而不是重载整个插件 */
  async onDataChanged() {
    await this.store.reload();
    for (const { view } of this.mounted.values()) {
      const { world, docs } = await this.store.loadAll();
      view.sync(world, docs);
    }
  }

  /**
   * 打开思维宫殿：回到上次所在的位置（小镇或某座宫殿）；给了 palaceId 就直接进入那座宫殿。
   * 思源按 data 是否相等来复用已打开的页签，所以默认页签的 data 保持为空对象。
   */
  async openPalace(palaceId?: string) {
    if (this.isMobile) return this.openMobile(palaceId);
    await openTab({
      app: this.app,
      custom: { id: this.name + TAB_TYPE, icon: ICON, title: this.t('tabTitle'), data: palaceId ? { palaceId } : {} },
    });
  }

  // 移动端没有自定义页签：用全屏对话框承载宫殿
  private openMobile(palaceId?: string) {
    this.mobileDialog?.destroy();
    const dialog = this.mobileDialog = new Dialog({
      title: this.t('tabTitle'),
      content: '<div class="kmind-palace-mobile"></div>',
      width: '100vw',
      height: '100vh',
      destroyCallback: () => {
        const host = dialog.element.querySelector('.kmind-palace-mobile') as HTMLElement;
        if (host) this.unmount(host);
        if (this.mobileDialog === dialog) this.mobileDialog = null;
      },
    });
    void this.mount(dialog.element.querySelector('.kmind-palace-mobile') as HTMLElement, palaceId);
  }

  async mount(el: HTMLElement, palaceId?: string | null, model: TabModel = null) {
    this.unmount(el);
    const container = document.createElement('div');
    container.className = 'kmind-palace-host';
    el.appendChild(container);
    try {
      if (SOCIAL_ENABLED) await this.social.load();
      const { world, docs, lastOpened } = await this.store.loadAll();
      // 等待加载期间页签被关闭、或已被另一次挂载替换
      if (!container.isConnected || this.mounted.has(el)) { container.remove(); return; }
      const view = new PalaceView(container, { world, docs, host: this.createHost(model), enter: palaceId || lastOpened });
      this.mounted.set(el, { view, container });
    } catch (e) {
      container.innerHTML = `<div class="kmind-palace-error">${this.t('loadFailed', { msg: String((e as Error)?.message || e) })}</div>`;
    }
  }

  unmount(el: HTMLElement) {
    const m = this.mounted.get(el);
    if (m) {
      m.view.dispose();
      m.container.remove();
      this.mounted.delete(el);
    }
    el.querySelectorAll(':scope > .kmind-palace-host').forEach(n => n.remove());
  }

  private createHost(model: TabModel): HostAdapter {
    return {
      pickBlock: (opts) => openBlockPicker(this, { ...opts, mobile: this.isMobile }),
      openBlock: (id, opts) => {
        const action = ['cb-get-hl', 'cb-get-context'] as any;
        if (this.isMobile) {
          this.mobileDialog?.destroy();
          openMobileFileById(this.app, id, action);
          return;
        }
        void openTab({ app: this.app, doc: { id, action }, position: opts?.side ? 'right' : undefined });
      },
      getBlock: (id) => getBlockRef(id),
      showBlockPreview: this.isMobile ? undefined : (id, at) => {
        this.addFloatLayer({ refDefs: [{ refID: id, defIDs: [] }], x: at.x, y: at.y, isBacklink: false });
      },
      onDocChange: (doc) => this.store.saveDoc(doc),
      onWorldChange: (world) => this.store.saveWorld(world),
      onDocDelete: (id) => void this.store.remove(id),
      onLocationChange: (id, name) => {
        // 记下最后所在的位置：下次打开（或重启后恢复页签）时回到这里
        void this.store.setLastOpened(id);
        // 推迟一拍：页签刚创建时标题元素可能还没就绪（rAF 在后台窗口里不触发，所以用 setTimeout）
        setTimeout(() => {
          try { model?.tab?.updateTitle?.(id ? `${name} · ${this.t('tabTitle')}` : this.t('tabTitle')); } catch { /* 移动端没有页签 */ }
        }, 0);
      },
      notify: (msg, type) => showMessage(msg, 3000, type || 'info'),
      review: createReview(),
      renderBlock: (el, id) => renderBlock(this.app, el, id),
      listDocs: (src) => listDocs(src),
      pickDocSource: (opts) => openSourcePicker(this, { ...opts, mobile: this.isMobile }),
      watchDocs: (cb) => watchDocs(this, cb),
      noteSource: 'siyuan',
      locale: siyuanLang(),
      saveMedia: (blob, id) => saveMedia(this, blob, id),
      loadMedia: (id) => loadMedia(this, id),
      ai: this.ai.adapter(),
      getBlockText: (id) => getBlockText(id),
      writeStory: (opts) => writeStory(opts, (id) => loadMedia(this, id).then(u => fetch(u)).then(r => r.blob())),
      openSettings: () => this.openSetting(),
      ...(SOCIAL_ENABLED ? { social: this.social.adapter() } : {}),
    };
  }

  t(key: string, vars: Record<string, string> = {}) {
    return String(this.i18n[key] ?? key).replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  }
}
