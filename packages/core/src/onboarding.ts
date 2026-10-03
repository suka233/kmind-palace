import type * as THREE from 'three';
import type { PalaceView, Quality } from './view';
import { ICONS } from './icons';
import { html, rich } from './dom';
import { t, isZh } from './i18n';

/* =====================================================================
 * 新手引导与设置：
 *   第一次打开：欢迎页（几张卡片讲清楚小镇、宫殿、记忆桩、回忆、小管家、串门）
 *   第一次做某件事：在旁边冒一个小提示（进宫殿、选中家具、漫游、小镇里的「好友」），每个只出现一次
 *   右上角「设置」：画质、小管家、再看一遍引导、插件设置
 * 看过哪些存在本机（宿主的 prefs），换设备会再看一遍。
 * ===================================================================== */

const GUIDE_KEY = 'kmind-palace:guide';
const TIPS_KEY = 'kmind-palace:tips';
/** 引导的版本：以后加了大功能时加一，老用户会再看到「新功能」那几页 */
const GUIDE_VERSION = 1;

interface Step { icon: string; title: string; body: string; /** 只在宿主开放了串门时出现 */ social?: boolean }

const STEPS: Step[] = [
  { icon: '🏝', title: '欢迎来到思维宫殿', body: '记忆宫殿法：把要记的东西放进熟悉的房间里，回想时在脑子里走一遍，就能一样样想起来。这里帮你把笔记真的摆进一座座 3D 房子里。' },
  { icon: '🏠', title: '小镇与宫殿', body: '小镇上每座房子都是一座宫殿。<b>双击</b>进去，拖动平移、右键旋转、滚轮缩放；按 <b>B</b> 可以自己摆家具、改房间。' },
  { icon: '📌', title: '记忆桩', body: '<b>点一件家具</b>（或书架上的一本书），把一条笔记绑在它上面，它就成了记忆桩。可以让 AI 写一个夸张好记的小故事，配一张图。' },
  { icon: '🧭', title: '沿路线回忆', body: '标题栏的<b>「路线」</b>把记忆桩串成一条路，按顺序走一遍：先自己想，再翻开答案，按记得的程度打分，系统按遗忘曲线安排下次复习。' },
  { icon: '🦉', title: '你的小管家', body: '宫殿里住着一只小管家，会在门口迎接你、回忆时给你带路。<b>点它</b>可以换物种、颜色和配饰。' },
  { icon: '👫', title: '串门', social: true, body: '右上角<b>「好友」</b>：用好友码加好友，把宫殿发布给好友参观、留言，一起在线逛；小管家也会自己出门去好友家玩，带回纪念品。笔记本身不会上传，只有你标了「公开」的记忆桩会被看到。' },
];

/** 第一次做某件事时的小提示 */
const TIPS: Record<string, string> = {
  palace: '点一件家具试试：可以把一条笔记绑在它上面。双击地板可以走进去看看。',
  select: '「绑定」一个笔记块，这件家具就成了记忆桩；绑好之后可以让 AI 编个故事帮你记。',
  walk: '<b>W A S D</b> 走动，拖动转视角，对准记忆桩按 <b>F</b> 打开笔记，<b>Esc</b> 回到俯视。',
  friends: '右上角「好友」：加好友、去好友的宫殿串门。',
};


export class Onboarding {
  private load(key: string): string | null {
    try { return this.v.prefs.get(key); } catch { return null; }
  }
  private save(key: string, v: string) {
    try { this.v.prefs.set(key, v); } catch { /* 存不了：下次再提示 */ }
  }

  private step = 0;
  private open = false;
  private seenTips: Set<string>;
  private tipTimer: number | null = null;
  private currentTip = '';
  settingsOpen = false;

  constructor(private v: PalaceView) {
    this.seenTips = new Set((this.load(TIPS_KEY) || '').split(',').filter(Boolean));
    v.root.append(html`
      <div class="kp-overlay kp-center kp-hidden" data-ref="guideWrap"><div class="kp-guide kp-glass" data-ref="guide"></div></div>
      <div class="kp-coach kp-glass kp-hidden" data-ref="coach"></div>
      <div class="kp-settings kp-glass kp-hidden" data-ref="settings"></div>`);
    for (const r of ['guideWrap', 'guide', 'coach', 'settings']) v.ui[r] = v.root.querySelector(`[data-ref="${r}"]`) as HTMLElement;
    v.root.querySelector('.kp-topright')?.append(
      html`<button class="kp-gear-btn kp-glass" data-act="settingsOpen" data-ref="gearBtn" title="${t('设置：画质、小管家、新手引导')}">${rich(ICONS.gear)}</button>`);
    v.ui.gearBtn = v.root.querySelector('[data-ref="gearBtn"]') as HTMLElement;
  }

  /** 打开时：没看过引导就看一遍（只读的网页查看器里不显示） */
  start() {
    if (this.v.readonly) return;
    const seen = Number(this.load(GUIDE_KEY)) || 0;
    if (seen < GUIDE_VERSION) window.setTimeout(() => this.showGuide(), 900);
    else window.setTimeout(() => this.onTown(), 1500);
  }

  /** 引导的几页：没开放串门时去掉「串门」那页 */
  private get steps() { return this.v.host.social ? STEPS : STEPS.filter(s => !s.social); }

  // =====================================================================
  // 欢迎页
  // =====================================================================

  showGuide(step = 0) {
    this.open = true;
    this.step = step;
    this.hideTip();
    this.toggleSettings(false);
    this.v.ui.guideWrap.classList.remove('kp-hidden');
    this.renderGuide();
  }

  private closeGuide() {
    this.open = false;
    this.v.ui.guideWrap.classList.add('kp-hidden');
    this.save(GUIDE_KEY, String(GUIDE_VERSION));
  }

  private renderGuide() {
    const steps = this.steps, s = steps[this.step], last = this.step === steps.length - 1;
    const hasHome = this.v.docs.size > 0;
    this.v.ui.guide.replaceChildren(html`
      <button class="kp-close kp-guide-skip" data-act="guideSkip" title="${t('跳过')}">${t('跳过')}</button>
      <div class="kp-guide-icon">${s.icon}</div>
      <h2>${t(s.title)}</h2>
      <p>${rich(t(s.body))}</p>
      <div class="kp-guide-dots">${steps.map((_, i) => html`<i class="${i === this.step ? 'kp-on' : ''}" data-act="guideGo" data-i="${i}"></i>`)}</div>
      <div class="kp-route-go">
        ${this.step ? html`<button data-act="guidePrev">${t('上一步')}</button>` : ''}
        ${last
          ? html`<button class="kp-primary" data-act="guideDone" data-enter="${hasHome ? '1' : ''}">${hasHome ? t('进我的家看看') : t('开始')}</button>`
          : html`<button class="kp-primary" data-act="guideNext">${t('下一步')}</button>`}
      </div>`);
  }

  // =====================================================================
  // 第一次的小提示
  // =====================================================================

  /** 提示一次（看过就不再出现）；anchor 给了就显示在它下面，否则在画面下方中间 */
  tip(id: string, anchor?: HTMLElement | null) {
    if (this.v.readonly || this.open || this.seenTips.has(id) || !TIPS[id]) return;
    if (Number(this.load(GUIDE_KEY) || 0) < GUIDE_VERSION) return;
    this.seenTips.add(id);
    this.save(TIPS_KEY, [...this.seenTips].join(','));
    const el = this.v.ui.coach;
    this.currentTip = id;
    el.replaceChildren(html`<span>💡 ${rich(t(TIPS[id]))}</span><button data-act="coachOk">${t('知道了')}</button>`);
    el.classList.remove('kp-hidden');
    el.classList.toggle('kp-anchored', !!anchor);
    if (anchor && anchor.offsetParent) {
      const r = anchor.getBoundingClientRect(), root = this.v.root.getBoundingClientRect();
      el.style.top = `${r.bottom - root.top + 8}px`;
      el.style.removeProperty('left');
      el.style.right = `${Math.max(8, root.right - r.right)}px`;
      el.style.removeProperty('bottom');
    } else {
      for (const k of ['top', 'left', 'right', 'bottom']) el.style.removeProperty(k);
    }
    if (this.tipTimer) window.clearTimeout(this.tipTimer);
    this.tipTimer = window.setTimeout(() => this.hideTip(), 12e3);
  }

  /** 第一次遇到某件事：标记看过，返回 true（由调用方自己展示，例如小管家的自我介绍） */
  consume(id: string): boolean {
    if (this.v.readonly || this.seenTips.has(id) || Number(this.load(GUIDE_KEY) || 0) < GUIDE_VERSION) return false;
    this.seenTips.add(id);
    this.save(TIPS_KEY, [...this.seenTips].join(','));
    return true;
  }

  hideTip() {
    if (this.tipTimer) { window.clearTimeout(this.tipTimer); this.tipTimer = null; }
    this.currentTip = '';
    this.v.ui.coach?.classList.add('kp-hidden');
  }

  onTown() {
    const btn = this.v.ui.socBtn;
    if (btn && !btn.classList.contains('kp-hidden')) this.tip('friends', btn);
  }

  onPalaceEntered() {
    // 小管家在的话它自己会介绍（见 Companion），这里只提示「点家具」
    window.setTimeout(() => { if (this.v.level === 'palace') this.tip('palace'); }, this.v.companion.ch ? 7000 : 2500);
  }

  onSelect(obj: THREE.Object3D | null) {
    if (!obj || this.v.level !== 'palace') return;
    if (this.currentTip === 'palace') this.hideTip();
    if (!this.v.bindingAt(obj, this.v.selectedSlot)) window.setTimeout(() => this.tip('select'), 600);
  }

  onWalk() { this.tip('walk'); }

  // =====================================================================
  // 设置
  // =====================================================================

  toggleSettings(open = !this.settingsOpen) {
    this.settingsOpen = open;
    this.v.ui.settings.classList.toggle('kp-hidden', !open);
    if (open) { this.v.closeSidePanels('settings'); this.renderSettings(); }
  }

  private renderSettings() {
    const v = this.v;
    const q = v.qualityAuto ? 'auto' : v.quality;
    // 「高」在字典里已经是物件参数的「高度」（Height），画质档位这里单独给英文
    const names: Record<Quality | 'auto', string> = isZh() ? { auto: '自动', high: '高', medium: '中', low: '低' } : { auto: 'Auto', high: 'High', medium: 'Medium', low: 'Low' };
    const petName = v.companion.petName;
    v.ui.settings.replaceChildren(html`
      <div class="kp-routes-head"><b>${t('设置')}</b><button class="kp-close" data-act="settingsClose">×</button></div>
      <div class="kp-route-sub">${t('画质')}${v.qualityAuto ? html`<small>${t('（现在：{q}）', { q: names[v.quality] })}</small>` : ''}</div>
      <div class="kp-set-seg">${(['auto', 'high', 'medium', 'low'] as const).map(k => html`<button class="${q === k ? 'kp-on' : ''}" data-act="setQuality" data-q="${k}">${names[k]}</button>`)}</div>
      <div class="kp-route-stats">${t('卡顿时选低一档；「自动」会按设备挑选，持续卡顿时自动降一档。')}</div>
      ${v.readonly ? '' : html`
      <div class="kp-route-sub">${t('小管家')}</div>
      <div class="kp-route-tools">
        ${v.companion.hidden ? html`<button data-act="petCall">${t('叫 {name} 回来', { name: petName })}</button>` : html`<button data-act="setPetDress">${t('给 {name} 换装', { name: petName })}</button><button data-act="petHide">${t('让它休息')}</button>`}
      </div>
      <div class="kp-route-sub">${t('帮助')}</div>
      <div class="kp-route-tools"><button data-act="guideReplay">${t('再看一遍新手引导')}</button><button data-act="tipsReset">${t('重新显示小提示')}</button></div>`}
      ${v.host.openSettings ? html`<div class="kp-route-tools"><button data-act="setHost">${v.host.social ? t('插件设置（大模型、串门服务器）…') : t('插件设置（大模型）…')}</button></div>` : ''}
      <div class="kp-set-keys"><b>${t('快捷键')}</b> ${t('双击进入宫殿 · Q/E 旋转 · W 墙体 · N 夜晚 · B 搭建 · R 复位 · ⌘K 搜索 · Esc 返回')}</div>`);
  }

  onAction(act: string, el: HTMLElement): boolean {
    switch (act) {
      case 'guideNext': this.step = Math.min(this.steps.length - 1, this.step + 1); this.renderGuide(); return true;
      case 'guidePrev': this.step = Math.max(0, this.step - 1); this.renderGuide(); return true;
      case 'guideGo': this.step = Number(el.dataset.i) || 0; this.renderGuide(); return true;
      case 'guideSkip': this.closeGuide(); return true;
      case 'guideDone': {
        this.closeGuide();
        // 进第一座宫殿看看（已经在宫殿里就不动）
        const first = [...this.v.docs.keys()][0];
        if (el.dataset.enter && first && this.v.level === 'town') this.v.enterPalace(first);
        return true;
      }
      case 'coachOk': this.hideTip(); return true;
      case 'settingsOpen': this.toggleSettings(); return true;
      case 'settingsClose': this.toggleSettings(false); return true;
      case 'setQuality': {
        const q = el.dataset.q as Quality | 'auto';
        this.v.setQuality(q);
        this.renderSettings();
        return true;
      }
      case 'setPetDress':
        this.toggleSettings(false);
        if (this.v.level === 'palace' && this.v.companion.ch) this.v.companion.onClick();
        else if (this.v.level === 'palace') this.v.companion.togglePanel(true);
        else this.v.host.notify?.(t('进到一座宫殿里，点小管家就能换装'));
        return true;
      case 'guideReplay': this.showGuide(); return true;
      case 'tipsReset': this.seenTips.clear(); this.save(TIPS_KEY, ''); this.v.host.notify?.(t('小提示会重新出现')); return true;
      case 'setHost': this.toggleSettings(false); this.v.host.openSettings?.(); return true;
      case 'petCall': case 'petHide':
        // 交给小管家处理，这里只刷新面板
        window.setTimeout(() => this.renderSettings(), 0);
        return false;
    }
    return false;
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    if (e.key === 'Escape') { this.closeGuide(); return true; }
    if (e.key === 'ArrowRight' || e.key === 'Enter') { if (this.step < this.steps.length - 1) { this.step++; this.renderGuide(); } else this.closeGuide(); return true; }
    if (e.key === 'ArrowLeft') { this.step = Math.max(0, this.step - 1); this.renderGuide(); return true; }
    return true;
  }

  dispose() {
    if (this.tipTimer) window.clearTimeout(this.tipTimer);
  }
}
