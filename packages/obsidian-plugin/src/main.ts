import * as obsidian from 'obsidian';
import { Plugin, ItemView, Notice, Platform, TFile, addIcon, debounce, requestUrl, type WorkspaceLeaf, type ViewStateResult, type HoverPopover, type EventRef } from 'obsidian';
import { PalaceView, PalaceStore, setLocale, t, createLocalReview, createOpenAiAdapter, remapNoteIds, type HostAdapter, type LocalReview, type PalaceDoc, type PalaceWorld, type SocialAccount } from '@kmind-palace/core';

/** Obsidian 的界面语言：1.8 起有 getLanguage()，更早的版本存在 localStorage 的 language 里（没有就是英文） */
function obsidianLang(): string {
  const get = (obsidian as { getLanguage?: () => string }).getLanguage;
  if (typeof get === 'function') return get();
  try { return window.localStorage.getItem('language') || 'en'; } catch { return 'en'; }
}
import { VaultData } from './storage';
import { DEFAULT_SETTINGS, PalaceSettingTab, SOCIAL_ENABLED, type Settings } from './settings';
import { pickBlock, getBlockRef, getBlockText, renderBlock, writeStory, listDocs, pickDocSource, fileOf } from './notes';
import { renamePath } from './md';

/* =====================================================================
 * 思维宫殿 · Obsidian 插件
 * 宫殿视图是一个页签（ItemView）；笔记 id 就是 Obsidian 的链接（路径.md、路径.md#标题、路径.md#^块id），
 * 文件改名时自动改写宫殿里的引用。闪卡排期用内核的本地 FSRS（Obsidian 没有自带闪卡）。
 * ===================================================================== */

export const VIEW_TYPE = 'kmind-palace';
const ICON = 'kmind-palace';
const ICON_SVG = `<g fill="currentColor"><path d="M50 9 9 31.5l41 22.8 41-22.8L50 9Zm0 9.7 24.1 13.1L50 45.3 25.9 31.8 50 18.7Z"/><path d="m9 48.1 41 22.8 41-22.8v10L50 80.9 9 58.1v-10Z"/><path d="m9 65 41 22.8L91 65v10L50 97.8 9 75V65Z" opacity=".55"/></g>`;
/** 视图标题（随界面语言，所以用时再翻译） */
const title = () => t('思维宫殿');

class PalaceLeafView extends ItemView {
  hoverPopover: HoverPopover | null = null;
  palace: PalaceView | null = null;
  private palaceId: string | null = null;
  private title = title();
  private anchor: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: KMindPalacePlugin) { super(leaf); }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return this.title; }
  getIcon() { return ICON; }
  getState() { return { ...super.getState(), palaceId: this.palaceId }; }

  async setState(state: any, result: ViewStateResult) {
    const id = typeof state?.palaceId === 'string' ? state.palaceId : null;
    if (id && this.palace && id !== this.palaceId) this.palace.enterPalace(id);
    else if (!this.palace) this.palaceId = id;
    await super.setState(state, result);
  }

  async onOpen() {
    const el = this.contentEl;
    el.empty();
    el.addClass('kmind-palace-leaf');
    // 等 setState 把要进入的宫殿带过来（恢复布局时）
    await sleep(0);
    try {
      const { world, docs, lastOpened } = await this.plugin.store.loadAll();
      if (!el.isConnected) return;
      const host = el.createDiv({ cls: 'kmind-palace-host' });
      this.palace = new PalaceView(host, { world, docs, host: this.plugin.createHost(this), enter: this.palaceId || lastOpened });
    } catch (e) {
      el.createDiv({ cls: 'kmind-palace-error', text: t('思维宫殿加载失败：{msg}', { msg: String((e as Error)?.message || e) }) });
    }
  }

  async onClose() {
    this.palace?.dispose();
    this.palace = null;
    this.anchor?.remove();
  }

  sync(world: PalaceWorld, docs: PalaceDoc[]) { this.palace?.sync(world, docs); }

  /** 进入宫殿 / 回到小镇：页签标题跟着变，布局里记下位置 */
  setLocation(id: string | null, name: string) {
    this.palaceId = id;
    this.title = id ? `${name} · ${title()}` : title();
    (this.leaf as any).updateHeader?.();
    this.app.workspace.requestSaveLayout();
  }

  /**
   * 悬停预览：Obsidian 的页面预览只在鼠标停在链接（或预览框）上时保持打开，
   * 所以在指针位置放一个看不见、能悬停的小圆点当「链接」；点击、滚轮穿过它交给画布，预览关掉后收起。
   */
  preview(id: string, at: { x: number; y: number }) {
    const a = this.anchor ||= this.makeAnchor();
    a.style.left = `${at.x - 14}px`;
    a.style.top = `${at.y - 14}px`;
    a.style.display = '';
    this.app.workspace.trigger('hover-link', {
      event: new MouseEvent('mouseover', { clientX: at.x, clientY: at.y }),
      source: VIEW_TYPE, hoverParent: this, targetEl: a, linktext: id, sourcePath: '',
    });
    let seen = false;
    const timer = window.setInterval(() => {
      if (this.hoverPopover) { seen = true; return; }
      if (seen || a.style.display === 'none') { a.style.display = 'none'; window.clearInterval(timer); }
    }, 300);
    window.setTimeout(() => { if (!seen) { a.style.display = 'none'; window.clearInterval(timer); } }, 3000);
  }

  private makeAnchor() {
    const a = document.body.createDiv({ cls: 'kmind-palace-anchor' });
    const pass = (e: Event) => {
      const p = e as PointerEvent;
      a.style.display = 'none';
      const under = document.elementFromPoint(p.clientX, p.clientY);
      if (under) under.dispatchEvent(new (e.constructor as typeof PointerEvent)(e.type, p));
      e.preventDefault();
    };
    a.addEventListener('pointerdown', pass);
    a.addEventListener('wheel', pass, { passive: false });
    a.addEventListener('pointerleave', () => window.setTimeout(() => { if (!this.hoverPopover) a.style.display = 'none'; }, 400));
    return a;
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default class KMindPalacePlugin extends Plugin {
  settings!: Settings;
  data!: VaultData;
  store!: PalaceStore;
  review!: LocalReview;
  ai!: ReturnType<typeof createOpenAiAdapter>;
  private renames: [string, string][] = [];

  async onload() {
    setLocale(obsidianLang());
    await this.loadSettings();
    this.data = new VaultData(this.app, () => this.settings.dataFolder);
    this.store = new PalaceStore(this.data.storage(), (msg) => new Notice(t('思维宫殿：{msg}', { msg }), 8000));
    this.review = createLocalReview(this.data.reviewIo());
    this.ai = createOpenAiAdapter(() => this.settings.ai, async (url, headers, body) => {
      const r = await requestUrl({ url, method: 'POST', headers, body: JSON.stringify(body), throw: false });
      return { status: r.status, text: r.text };
    }, async (url) => new Blob([(await requestUrl({ url })).arrayBuffer]));

    addIcon(ICON, ICON_SVG);
    this.registerView(VIEW_TYPE, (leaf) => new PalaceLeafView(leaf, this));
    this.addRibbonIcon(ICON, t('打开思维宫殿'), () => void this.open());
    this.addCommand({ id: 'open', name: t('打开思维宫殿'), callback: () => void this.open() });
    this.addSettingTab(new PalaceSettingTab(this.app, this));
    this.registerHoverLinkSource(VIEW_TYPE, { display: title(), defaultMod: false });

    // 库加载时会对每个文件发一次 create：等布局就绪后再监听
    this.app.workspace.onLayoutReady(() => {
      // 笔记改名 / 移动：改写宫殿里的引用和闪卡
      this.registerEvent(this.app.vault.on('rename', (f, old) => {
        if (this.data.isInside(old) || this.data.isInside(f.path)) return;
        this.renames.push([old, f.path]);
        this.applyRenames();
      }));
      // 别的设备同步过来改动了数据文件：重新读取
      for (const ev of ['modify', 'create', 'delete'] as const) {
        this.registerEvent(this.app.vault.on(ev as 'modify', (f) => { if (this.data.isExternalChange(f.path)) this.reloadData(); }));
      }
      // 刚装好：提示一次去哪里打开（打开之后宫殿里还有完整的新手引导）
      if (!this.settings.welcomed) {
        new Notice(t('思维宫殿已安装 🏝 点左侧功能区的宫殿图标（或命令面板「打开思维宫殿」）打开，第一次打开会有引导。'), 10000);
        this.settings.welcomed = Date.now();
        void this.saveSettings();
      }
    });
  }

  async onunload() {
    await this.store.flush();
    this.data.dispose();
  }

  private views(): PalaceLeafView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map(l => l.view).filter((v): v is PalaceLeafView => v instanceof PalaceLeafView);
  }

  async open(palaceId?: string) {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) {
      await workspace.revealLeaf(existing);
      if (palaceId && existing.view instanceof PalaceLeafView) existing.view.palace?.enterPalace(palaceId);
      return;
    }
    const leaf = workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, active: true, state: palaceId ? { palaceId } : {} });
    await workspace.revealLeaf(leaf);
  }

  /** 一次改名（文件夹改名时是一串）攒在一起处理 */
  private applyRenames = debounce(async () => {
    const list = this.renames.splice(0);
    if (!list.length) return;
    const f = (id: string) => {
      let cur = id, hit = false;
      for (const [from, to] of list) { const n = renamePath(cur, from, to); if (n) { cur = n; hit = true; } }
      return hit ? cur : null;
    };
    await this.store.flush();
    const { world, docs } = await this.store.loadAll();
    let changed = false;
    for (const d of docs) {
      if (!remapNoteIds(d, f)) continue;
      // 更新时间变了，打开着的视图（和别的设备）才会换成新数据
      d.updatedAt = Date.now();
      this.store.saveDoc(d);
      changed = true;
    }
    await this.review.remap(f);
    if (!changed) return;
    await this.store.flush();
    for (const v of this.views()) v.sync(world, docs);
  }, 400, true);

  private reloadData = debounce(async () => {
    await this.store.reload();
    this.review.reload();
    const { world, docs } = await this.store.loadAll();
    for (const v of this.views()) v.sync(world, docs);
  }, 1000, true);

  createHost(view: PalaceLeafView): HostAdapter {
    const app = this.app, vault = app.vault;
    const isNote = (f: { path: string }) => f instanceof TFile && f.extension === 'md' && !this.data.isInside(f.path);
    return {
      pickBlock: (opts) => pickBlock(app, opts),
      openBlock: (id, opts) => {
        if (!fileOf(app, id)) { new Notice(t('这篇笔记已不存在')); return; }
        void app.workspace.openLinkText(id, '', opts?.side ? 'split' : 'tab');
      },
      getBlock: (id) => getBlockRef(app, id),
      showBlockPreview: Platform.isMobile ? undefined : (id, at) => view.preview(id, at),
      onDocChange: (doc) => this.store.saveDoc(doc),
      onWorldChange: (world) => this.store.saveWorld(world),
      onDocDelete: (id) => void this.store.remove(id),
      onLocationChange: (id, name) => { void this.store.setLastOpened(id); view.setLocation(id, name); },
      notify: (msg, type) => new Notice(msg, type === 'error' ? 6000 : 3000),
      review: this.review,
      renderBlock: (el, id) => renderBlock(app, el, id),
      listDocs: async (src) => listDocs(app, src),
      pickDocSource: () => pickDocSource(app),
      watchDocs: (cb) => {
        const refs: EventRef[] = [
          vault.on('create', f => { if (isNote(f)) cb(); }),
          vault.on('delete', f => { if (isNote(f)) cb(); }),
          vault.on('rename', (f, old) => { if (isNote(f) || old.endsWith('.md')) cb(); }),
        ];
        return () => refs.forEach(r => vault.offref(r));
      },
      // 不带库名：同一个库在不同设备上的文件夹名可能不一样
      noteSource: 'obsidian',
      locale: obsidianLang(),
      saveMedia: (blob, id) => this.data.saveMedia(blob, id),
      loadMedia: (id) => this.data.loadMedia(id),
      ai: this.ai,
      getBlockText: (id) => getBlockText(app, id),
      writeStory: (opts) => writeStory(app, opts, (id) => this.data.mediaBlob(id)),
      openSettings: () => {
        const s = (app as any).setting;
        s?.open();
        s?.openTabById(this.manifest.id);
      },
      ...(SOCIAL_ENABLED ? {
        social: {
          serverUrl: () => this.settings.serverUrl.trim(),
          loadAccount: async () => this.settings.account,
          saveAccount: async (a: SocialAccount | null) => { this.settings.account = a; await this.saveSettings(); },
        },
      } : {}),
    };
  }

  async loadSettings() {
    const raw = (await this.loadData()) || {};
    this.settings = { ...DEFAULT_SETTINGS, ...raw, ai: { ...DEFAULT_SETTINGS.ai, ...(raw.ai || {}) } };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
