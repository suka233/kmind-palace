import type { PalaceView } from './view';
import { html } from './dom';
import { t } from './i18n';

/** 准星在同一个记忆桩上停留多久才弹出卡片 */
const DWELL_MS = 500;
/** 准星刚移开时多等一会儿再收起：边缘抖一下（一帧扫到旁边的物件）不会闪 */
const GRACE_MS = 180;
/** 收起的淡出时间（要和样式表里的 transition 一致），之后才清掉宿主渲染的内容 */
const FADE_MS = 220;

/** 准星当前对准的、可以预览的笔记 */
export interface WalkTarget {
  id: string;
  title: string;
}

/**
 * 漫游时的笔记预览：准星对准绑定了本机笔记的记忆桩并停留一会儿，在屏幕一侧弹出这条笔记的内容。
 * 宿主不支持 renderBlock、或绑定不是本机笔记时，由调用方传入 null，保持只显示标题。
 */
export class WalkPreview {
  /** 正显示的笔记 id */
  private shown: string | null = null;
  /** 准星最近一次对准的笔记 id（还在等停留计时的也算） */
  private want: string | null = null;
  private timer = 0;
  private cleanTimer = 0;
  private cleanup: (() => void) | null = null;

  constructor(private v: PalaceView) { }

  private get el() { return this.v.ui.walkNote; }

  /** 准星换了目标时调用：可预览的笔记，或 null（没对准东西 / 对准的没有可预览的笔记） */
  target(tg: WalkTarget | null) {
    const id = tg?.id ?? null;
    if (id === this.want) return;
    this.want = id;
    window.clearTimeout(this.timer);
    if (id !== null && id === this.shown) return;   // 移开后很快又回到这条：不收起
    if (this.shown !== null) {
      if (id === null) this.timer = window.setTimeout(() => this.hide(), GRACE_MS);
      else this.hide();
    }
    if (tg) this.timer = window.setTimeout(() => this.show(tg), DWELL_MS);
  }

  /** 退出漫游 / 换宫殿 / 销毁：立刻收起并清理 */
  reset() {
    window.clearTimeout(this.timer);
    this.want = null;
    this.shown = null;
    this.el.classList.remove('kp-on');
    this.flush();
  }

  dispose() {
    this.reset();
  }

  private show(tg: WalkTarget) {
    const host = this.v.host;
    if (this.v.mode !== 'walk' || !host.renderBlock) return;
    this.flush();
    this.el.replaceChildren(html`<div class="kp-wn-head"><b>${tg.title}</b><span><kbd>F</kbd>${t('打开笔记')}</span></div><div class="kp-wn-body"></div>`);
    try {
      this.cleanup = host.renderBlock(this.el.querySelector<HTMLElement>('.kp-wn-body'), tg.id) || null;
    } catch (e) {
      console.warn('[kmind-palace] renderBlock', e);
      this.flush();
      return;
    }
    this.shown = tg.id;
    this.el.classList.add('kp-on');
  }

  private hide() {
    this.shown = null;
    this.el.classList.remove('kp-on');
    // 等淡出完再清内容，否则卡片会在消失前先缩成一条
    window.clearTimeout(this.cleanTimer);
    this.cleanTimer = window.setTimeout(() => this.flush(), FADE_MS + 40);
  }

  /** 调宿主给的清理函数并清空卡片 */
  private flush() {
    window.clearTimeout(this.cleanTimer);
    const fn = this.cleanup;
    this.cleanup = null;
    try { fn?.(); } catch (e) { console.warn('[kmind-palace] renderBlock cleanup', e); }
    this.el.replaceChildren();
  }
}
