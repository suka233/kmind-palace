import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { PalaceView } from './view';
import { gid, locusKey, type PalaceRoute } from './schema';
import { computeColliders } from './build';
import { frontDoor } from './world';
import { WalkGrid, type P2 } from './path';
import { AUTO_ROUTE_ID, autoRoute, resolveRoute, routesOf, needsPractice, isDue, type RouteStop, type MemoryLevel } from './route';
import { resolveJourney, journeysWith, createJourney, pruneJourneys } from './journey';
import type { PalaceJourney } from './world';
import type { Rating } from './host';
import { escapeHtml } from './icons';
import { t } from './i18n';

/* =====================================================================
 * 记忆路线 + 回忆模式
 * - 路线面板：选择 / 新建 / 改名 / 删除路线，调整站的顺序，在场景里点选加入或移出
 * - 地上画出路线：从正门出发，沿着能走的路（绕开墙和家具）一站站连起来，每站一个编号
 * - 回忆：沿路线一站站飞过去，只看位置、先回想，再揭晓笔记，四档自评交给宿主的闪卡排期
 * - 旅程：几座宫殿的路线串起来，一座走完淡出淡入到下一座接着走
 * ===================================================================== */

const RATINGS: [Rating, string, string][] = [[1, '忘了', 'again'], [2, '困难', 'hard'], [3, '记得', 'good'], [4, '简单', 'easy']];
const LEVEL_TEXT: Record<MemoryLevel, string> = { none: '还没复习过', new: '新卡', learning: '学习中', fresh: '记得牢', due: '该复习了', stale: '很久没复习' };

interface Session {
  route: string;
  stops: RouteStop[];
  i: number;
  revealed: boolean;
  /** 揭晓前先看了配图提示 */
  hint: boolean;
  done: boolean;
  ratings: Map<string, Rating | 0>;
  cleanup?: (() => void) | null;
  /** 旅程里这一段走完了，等着去下一座宫殿 */
  legDone?: boolean;
}

/** 正在走的旅程：每段只记站的 key，到了那座宫殿再解析 */
interface JourneyRun {
  journey: PalaceJourney;
  legs: { palaceId: string; name: string; routeName: string; keys: string[] }[];
  leg: number;
  /** 每段之前一共有多少站（显示「第 k / N 站」） */
  offsets: number[];
  total: number;
  /** 整个旅程的自评：「宫殿 id|记忆桩」 */
  ratings: Map<string, Rating | 0>;
  /** 正在换宫殿：enterPalace 之后接着走下一段 */
  transit: boolean;
}

export class RecallController {
  /** 路线面板是否打开 */
  panelOpen = false;
  /** 在场景里点选记忆桩加入 / 移出路线 */
  picking = false;
  routeId = AUTO_ROUTE_ID;
  session: Session | null = null;
  private run: JourneyRun | null = null;
  private layer: RouteLayer;
  private confirmDelete = false;

  constructor(private v: PalaceView) {
    this.layer = new RouteLayer(v.scene);
  }

  get active() { return !!this.session; }

  // =====================================================================
  // 生命周期
  // =====================================================================

  /** 换了宫殿：回到第一条路线，关掉一切（旅程途中换宫殿时保留旅程） */
  reset() {
    if (this.run?.transit) this.endSession(); else this.stop();
    this.picking = false;
    this.panelOpen = false;
    this.v.ui.routes.classList.add('kp-hidden');
    this.routeId = this.routes()[0]?.id ?? AUTO_ROUTE_ID;
    this.layer.clear();
    this.updateButton();
  }

  /** 物件、绑定或复习状态变了 */
  refresh() {
    if (!this.v.doc) return;
    if (!this.routes().some(r => r.id === this.routeId)) this.routeId = this.routes()[0]?.id ?? AUTO_ROUTE_ID;
    if (this.panelOpen) this.renderPanel();
    this.redraw();
    this.updateButton();
  }

  dispose() {
    this.stop();
    this.layer.dispose();
  }

  // =====================================================================
  // 路线数据
  // =====================================================================

  routes(): PalaceRoute[] {
    const doc = this.v.doc;
    return doc ? routesOf(doc, this.v.slotSort) : [];
  }

  current(): PalaceRoute | undefined {
    const rs = this.routes();
    return rs.find(r => r.id === this.routeId) || rs[0];
  }

  stops(route = this.current()) {
    return route && this.v.doc ? resolveRoute(this.v.doc, route) : [];
  }

  /** 要改动默认路线时，先把它存成一条真正的路线 */
  private editable(): PalaceRoute {
    const doc = this.v.doc;
    const cur = this.current();
    if (cur && cur.id !== AUTO_ROUTE_ID) return cur;
    const r: PalaceRoute = { id: gid('route-'), name: t('路线 {n}', { n: 1 }), stops: [...(cur?.stops || [])] };
    doc.routes = [...(doc.routes || []), r];
    this.routeId = r.id;
    return r;
  }

  private changed() {
    this.v.emitChange();
    this.refresh();
  }

  /** 场景里点选：绑定过的记忆桩加入路线末尾，已在路线上的移出 */
  onPick(obj: THREE.Object3D | null, slot: string): boolean {
    if (!this.picking || !obj) return false;
    const item = obj.userData.item;
    const key = locusKey(item.id, slot);
    const bound = this.v.doc.items.includes(item) && (slot ? item.bindings?.[slot] : item.bindings?.['']);
    if (!bound) {
      this.v.host.notify?.(t('「{name}」还没绑定笔记，绑定后才能加入路线', { name: this.v.locusName(item, slot) }));
      return true;
    }
    const r = this.editable();
    const i = r.stops.indexOf(key);
    if (i >= 0) r.stops.splice(i, 1); else r.stops.push(key);
    this.changed();
    return true;
  }

  // =====================================================================
  // 面板
  // =====================================================================

  togglePanel(open = !this.panelOpen) {
    if (open && this.v.editor.active) this.v.editor.toggle(false);
    if (open && this.v.numbers?.panelOpen) this.v.numbers.togglePanel(false);
    this.panelOpen = open;
    this.confirmDelete = false;
    if (!open) this.picking = false;
    this.v.ui.routes.classList.toggle('kp-hidden', !open);
    this.v.root.classList.toggle('kp-route-picking', this.picking);
    if (open) {
      this.v.ui.loci.classList.add('kp-hidden');
      this.renderPanel();
    }
    this.redraw();
  }

  private renderPanel() {
    const el = this.v.ui.routes, v = this.v;
    const routes = this.routes(), cur = this.current();
    const stops = this.stops(cur);
    const bound = stops.filter(s => s.binding);
    const levels = bound.map(s => v.memoryOf(s.binding.blockId));
    const due = levels.filter(isDue).length, practice = levels.filter(needsPractice).length;
    const saved = cur && cur.id !== AUTO_ROUTE_ID;
    const inRoute = new Set(stops.map(s => s.key));
    const missing = saved ? v.allLoci().filter(l => !inRoute.has(locusKey(l.item.id, l.slot))).length : 0;
    el.innerHTML = `
      <div class="kp-routes-head"><b>${t('记忆路线')}</b><button class="kp-close" data-act="routesClose">×</button></div>
      <div class="kp-route-pick">
        <select data-field="route">${routes.map(r => `<option value="${escapeHtml(r.id)}"${r === cur ? ' selected' : ''}>${escapeHtml(r.name)}${r.id === AUTO_ROUTE_ID ? t('（按位置）') : ''}</option>`).join('')}
          <option value="__new">${t('＋ 新建路线')}</option></select>
        ${saved ? `<button data-act="routeDelete" class="kp-danger">${this.confirmDelete ? t('确认删除') : t('删除')}</button>` : ''}
      </div>
      ${saved ? `<input class="kp-route-name" data-field="routeName" maxlength="30" spellcheck="false">` : ''}
      <div class="kp-route-stats">${t('{n} 站', { n: bound.length })}${due ? ` · <b class="kp-m-due">${t('待复习 {n}', { n: due })}</b>` : ''}${stops.length > bound.length ? ` · ${t('{n} 站已解绑', { n: stops.length - bound.length })}` : ''}</div>
      <div class="kp-route-go">
        <button class="kp-primary" data-act="recallStart"${bound.length ? '' : ' disabled'}>${t('开始回忆')}</button>
        <button data-act="recallDue"${practice ? '' : ' disabled'} title="${t('跳过记得牢的记忆桩')}">${t('只练需要练的 · {n}', { n: practice })}</button>
      </div>
      <div class="kp-stops">${stops.length ? stops.map((s, i) => {
        const lvl = s.binding ? v.memoryOf(s.binding.blockId) : 'none';
        return `<div class="kp-stop-row${s.binding ? '' : ' kp-off'}" data-key="${escapeHtml(s.key)}">
          <button class="kp-stop-go" data-act="stopFocus" data-key="${escapeHtml(s.key)}" title="${t(LEVEL_TEXT[lvl])}"><i class="kp-dot kp-m-${lvl}">${i + 1}</i><span><b></b><small></small></span></button>
          <button class="kp-mini-btn" data-act="stopUp" data-key="${escapeHtml(s.key)}" title="${t('往前挪')}"${i ? '' : ' disabled'}>↑</button>
          <button class="kp-mini-btn" data-act="stopDown" data-key="${escapeHtml(s.key)}" title="${t('往后挪')}"${i < stops.length - 1 ? '' : ' disabled'}>↓</button>
          <button class="kp-mini-btn" data-act="stopDel" data-key="${escapeHtml(s.key)}" title="${t('移出路线')}">×</button>
        </div>`;
      }).join('') : `<div class="kp-empty">${saved ? t('这条路线还是空的。打开「在场景里点选」，按顺序点击记忆桩。') : t('还没有记忆桩。先点选物件（或书架上的一本书）绑定笔记。')}</div>`}</div>
      ${missing ? `<div class="kp-route-missing">${t('还有 {n} 个记忆桩不在这条路线上', { n: missing })} <button data-act="routeAddAll">${t('加到末尾')}</button></div>` : ''}
      <div class="kp-route-tools">
        <button data-act="routeAuto" title="${t('从正门出发，按位置重新排')}">${t('按位置重排')}</button>
        <button data-act="routePick" class="${this.picking ? 'kp-on' : ''}" title="${t('在场景里点击记忆桩：不在路线上的加到末尾，在路线上的移出')}">${this.picking ? t('点选中… 完成') : t('在场景里点选')}</button>
      </div>
      ${this.journeySection(cur)}`;
    el.querySelectorAll<HTMLElement>('.kp-stop-row').forEach((row, i) => {
      const s = stops[i];
      row.querySelector('b').textContent = s.binding ? (s.binding.title || s.binding.blockId) : t('（已解绑）');
      row.querySelector('small').textContent = v.locusName(s.item, s.slot);
    });
    const name = el.querySelector<HTMLInputElement>('[data-field="routeName"]');
    if (name) name.value = cur.name;
  }

  /** 路线面板底部：经过这座宫殿的旅程，以及把当前路线加入旅程 */
  private journeySection(cur: PalaceRoute | undefined) {
    const v = this.v, doc = v.doc;
    if (!doc || !cur) return '';
    const list = journeysWith(v.world, doc.id);
    const all = v.world.journeys || [];
    const rows = list.map(j => {
      const palaces = new Set(j.legs.map(l => l.palaceId)).size;
      return `<div class="kp-journey-row"><span><b>${escapeHtml(j.name)}</b><small>${t('{n} 段', { n: j.legs.length })} · ${t('{n} 座宫殿', { n: palaces })}</small></span>
        <button data-act="routeJourneyGo" data-id="${escapeHtml(j.id)}" title="${t('从第一段开始，走完整个旅程')}">${t('走一遍')}</button></div>`;
    }).join('');
    return `<div class="kp-route-journeys">
      <div class="kp-route-sub">${t('跨宫殿旅程')}</div>
      ${rows || `<div class="kp-route-stats">${t('还没有经过这座宫殿的旅程。把几座宫殿的路线串起来，一次回忆完一整门课。')}</div>`}
      <div class="kp-route-pick"><select data-field="journeyAdd"><option value="">${t('把「{name}」加入旅程…', { name: escapeHtml(cur.name) })}</option>
        ${all.map(j => `<option value="${escapeHtml(j.id)}">${escapeHtml(j.name)}${t('（{n} 段）', { n: j.legs.length })}</option>`).join('')}
        <option value="__new">${t('＋ 新建旅程')}</option></select></div>
    </div>`;
  }

  /** 把当前路线接到一个旅程的末尾 */
  private addToJourney(id: string) {
    const v = this.v, cur = this.current();
    if (!v.doc || !cur) return;
    const j = id === '__new' ? createJourney(v.world) : v.world.journeys?.find(x => x.id === id);
    if (!j) return;
    j.legs.push({ palaceId: v.doc.id, routeId: cur.id });
    v.worldChanged();
    v.host.notify?.(t('已把「{palace} · {route}」加到旅程「{journey}」第 {n} 段', { palace: v.doc.name, route: cur.name, journey: j.name, n: j.legs.length }) + (id === '__new' ? t('。回到小镇，在「旅程」里可以继续添加别的宫殿') : ''));
    this.renderPanel();
  }

  onAction(act: string, el: HTMLElement): boolean {
    const key = el.dataset.key;
    // 回忆面板的按钮点完后会被重绘，焦点落到 body 上：拉回视图，空格 / 数字键继续可用
    if (act.startsWith('recall')) queueMicrotask(() => { if (this.session) this.v.root.focus({ preventScroll: true }); });
    switch (act) {
      case 'routes': this.togglePanel(); return true;
      case 'routesClose': this.togglePanel(false); return true;
      case 'recallStart': this.start(false); return true;
      case 'recallDue': this.start(true); return true;
      case 'stopFocus': this.v.focusItem(key); return true;
      case 'stopUp': case 'stopDown': {
        const r = this.editable(), i = r.stops.indexOf(key), j = i + (act === 'stopUp' ? -1 : 1);
        if (i < 0 || j < 0 || j >= r.stops.length) return true;
        [r.stops[i], r.stops[j]] = [r.stops[j], r.stops[i]];
        this.changed();
        return true;
      }
      case 'stopDel': {
        const r = this.editable();
        r.stops = r.stops.filter(k => k !== key);
        this.changed();
        return true;
      }
      case 'routeAuto': {
        const cur = this.current();
        if (cur?.id === AUTO_ROUTE_ID) { this.v.host.notify?.(t('默认路线已经是按位置排的')); return true; }
        // 只重排这条路线上的站
        const all = autoRoute(this.v.doc, this.v.slotSort);
        const keep = new Set(cur.stops);
        const extra = cur.stops.filter(k => !all.includes(k));
        cur.stops = [...all.filter(k => keep.has(k)), ...extra];
        this.changed();
        return true;
      }
      case 'routeAddAll': {
        const r = this.editable();
        for (const l of this.v.allLoci()) {
          const k = locusKey(l.item.id, l.slot);
          if (!r.stops.includes(k)) r.stops.push(k);
        }
        this.changed();
        return true;
      }
      case 'routePick':
        this.picking = !this.picking;
        this.v.root.classList.toggle('kp-route-picking', this.picking);
        if (this.picking) this.v.host.notify?.(t('在场景里按顺序点击记忆桩：不在路线上的加到末尾，已在路线上的移出'));
        this.renderPanel();
        return true;
      case 'routeDelete': {
        const cur = this.current();
        if (!cur || cur.id === AUTO_ROUTE_ID) return true;
        if (!this.confirmDelete) { this.confirmDelete = true; this.renderPanel(); return true; }
        this.confirmDelete = false;
        this.v.doc.routes = (this.v.doc.routes || []).filter(r => r !== cur);
        if (!this.v.doc.routes.length) delete this.v.doc.routes;
        // 旅程里用到这条路线的段一起去掉
        if (pruneJourneys(this.v.world, () => true, { palaceId: this.v.doc.id, routeId: cur.id })) this.v.worldChanged();
        this.routeId = this.routes()[0]?.id ?? AUTO_ROUTE_ID;
        this.v.host.notify?.(t('已删除路线「{name}」', { name: cur.name }));
        this.changed();
        return true;
      }
      case 'routeJourneyGo': this.startJourney(el.dataset.id, false); return true;
      // ---------- 回忆 ----------
      case 'recallNextLeg': if (this.run) this.enterLeg(this.run.leg + 1); return true;
      case 'recallReveal': this.reveal(); return true;
      case 'recallHint': if (this.session) { this.session.hint = true; this.renderHud(); } return true;
      case 'recallRate': this.rate(Number(el.dataset.rate) as Rating); return true;
      case 'recallSkip': this.go(this.session.i + 1); return true;
      case 'recallPrev': this.go(Math.max(0, this.session.i - 1)); return true;
      case 'recallOpen': {
        const s = this.session?.stops[this.session.i];
        if (s?.binding && this.v.host.openBlock && this.v.isLocalNote(s.binding)) this.v.host.openBlock(s.binding.blockId, { side: true });
        return true;
      }
      case 'recallAgain': this.again(); return true;
      case 'recallStop': this.stop(); return true;
    }
    return false;
  }

  onInput(e: Event, commit: boolean): boolean {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const f = el.dataset.field;
    if (f === 'route' && commit) {
      if (el.value === '__new') {
        const doc = this.v.doc;
        const n = (doc.routes?.length || 0) + 1;
        const r: PalaceRoute = { id: gid('route-'), name: t('路线 {n}', { n }), stops: [] };
        doc.routes = [...(doc.routes || []), r];
        this.routeId = r.id;
        this.picking = true;
        this.v.root.classList.add('kp-route-picking');
        this.v.host.notify?.(t('新路线已建好：在场景里按顺序点击记忆桩，把它们串起来'));
        this.changed();
      } else {
        this.routeId = el.value;
        this.confirmDelete = false;
        this.refresh();
      }
      return true;
    }
    if (f === 'journeyAdd') {
      if (commit && el.value) this.addToJourney(el.value);
      return true;
    }
    if (f === 'routeName') {
      if (!commit) return true;
      const cur = this.current();
      const name = el.value.trim();
      if (cur && cur.id !== AUTO_ROUTE_ID && name && name !== cur.name) { cur.name = name; this.changed(); }
      return true;
    }
    return false;
  }

  /** 品牌栏上的「路线」按钮：显示待复习数 */
  updateButton() {
    const b = this.v.ui.routesBtn;
    if (!b || !this.v.doc) return;
    const due = this.v.allLoci().filter(l => isDue(this.v.memoryOf(l.binding.blockId))).length;
    b.querySelector('span').textContent = due ? t('待复习 {n}', { n: due }) : t('路线');
    b.classList.toggle('kp-has-due', due > 0);
  }

  // =====================================================================
  // 回忆
  // =====================================================================

  /** 开始沿当前路线回忆；practiceOnly 时跳过记得牢的 */
  start(practiceOnly: boolean, keys?: string[]) {
    const v = this.v;
    if (!v.doc || v.level !== 'palace') return;
    const route = this.current();
    let stops = this.stops(route).filter(s => s.binding);
    if (keys) stops = stops.filter(s => keys.includes(s.key));
    else if (practiceOnly) stops = stops.filter(s => needsPractice(v.memoryOf(s.binding.blockId)));
    if (!stops.length) { v.host.notify?.(practiceOnly ? t('这条路线上的记忆桩都记得很牢，暂时不用练') : t('这条路线上还没有绑定笔记的记忆桩')); return; }
    this.stop();
    this.begin(stops, route?.name || '');
  }

  /** 开始沿给定的站回忆（普通路线或旅程的一段） */
  private begin(stops: RouteStop[], label: string) {
    const v = this.v;
    if (v.mode === 'walk') v.exitWalk();
    if (v.editor.active) v.editor.toggle(false);
    this.endSession();
    this.picking = false;
    this.panelOpen = false;
    v.ui.routes.classList.add('kp-hidden');
    v.ui.loci.classList.add('kp-hidden');
    v.root.classList.remove('kp-route-picking');
    v.root.classList.add('kp-recalling');
    v.ui.tip.style.opacity = '0';
    this.session = { route: label, stops, i: 0, revealed: false, hint: false, done: false, ratings: new Map() };
    // 键盘操作（空格揭晓、1–4 自评）要求焦点在视图上
    v.root.focus({ preventScroll: true });
    this.go(0);
  }

  // =====================================================================
  // 旅程
  // =====================================================================

  /** 沿旅程回忆：practiceOnly 时跳过记得牢的；only 指定时只走这些站（「宫殿 id|记忆桩」） */
  startJourney(id: string, practiceOnly: boolean, only?: Set<string>) {
    const v = this.v, journey = v.world.journeys?.find(j => j.id === id);
    if (!journey) return;
    const legs: JourneyRun['legs'] = [];
    for (const r of resolveJourney(journey, v.docs, v.slotSort)) {
      if (!r.doc || !r.route) continue;
      let stops = r.stops.filter(s => s.binding);
      if (only) stops = stops.filter(s => only.has(`${r.palaceId}|${s.key}`));
      else if (practiceOnly) stops = stops.filter(s => needsPractice(v.memoryOf(s.binding.blockId)));
      if (stops.length) legs.push({ palaceId: r.palaceId, name: r.doc.name, routeName: r.route.name, keys: stops.map(s => s.key) });
    }
    if (!legs.length) {
      v.host.notify?.(practiceOnly ? t('这个旅程上的记忆桩都记得很牢，暂时不用练') : t('这个旅程上还没有绑定笔记的记忆桩'));
      return;
    }
    this.stop();
    const offsets: number[] = [];
    let total = 0;
    for (const l of legs) { offsets.push(total); total += l.keys.length; }
    this.run = { journey, legs, leg: 0, offsets, total, ratings: new Map(), transit: false };
    this.enterLeg(0);
  }

  /** 去旅程的第 n 段：在那座宫殿里就直接开始，否则先进那座宫殿 */
  private enterLeg(n: number) {
    const run = this.run, v = this.v;
    if (!run) return;
    if (n >= run.legs.length) { this.finish(); return; }
    run.leg = n;
    const pid = run.legs[n].palaceId;
    if (v.level === 'palace' && v.doc?.id === pid) { this.beginLeg(); return; }
    run.transit = true;
    v.enterPalace(pid, { recall: true });
  }

  private beginLeg() {
    const run = this.run, v = this.v;
    if (!run || !v.doc) return;
    run.transit = false;
    const leg = run.legs[run.leg];
    const stops = resolveRoute(v.doc, { stops: leg.keys }).filter(s => s.binding);
    if (!stops.length) { this.enterLeg(run.leg + 1); return; }
    this.begin(stops, leg.routeName);
  }

  /** 进了宫殿之后（enterPalace 的 recall 选项）：旅程途中接着走这一段，否则练这座宫殿需要练的 */
  onEntered() {
    if (this.run?.transit) this.beginLeg();
    else this.start(true);
  }

  private go(i: number) {
    const s = this.session;
    if (!s) return;
    s.cleanup?.(); s.cleanup = undefined;
    if (i >= s.stops.length) {
      // 旅程还有下一段：先停在这里，告诉用户下一座去哪
      if (this.run && this.run.leg < this.run.legs.length - 1) {
        s.legDone = true;
        s.i = s.stops.length;
        this.v.select(null);
        this.renderHud();
        this.redraw();
        return;
      }
      this.finish();
      return;
    }
    s.i = i;
    s.legDone = false;
    s.revealed = false;
    s.hint = false;
    s.done = false;
    const stop = s.stops[i];
    const obj = this.v.built?.itemObjects.get(stop.item.id) || null;
    this.v.select(obj, stop.slot);
    const a = this.v.locusAnchor(stop.item, stop.slot);
    if (a) {
      // 回忆面板占了画面下方：让这一站落在画面偏上的位置
      const zoom = stop.slot ? 3.2 : 2.6;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.v.isoCam.quaternion);
      const t = new THREE.Vector3(a.x, a.y * .75, a.z).addScaledVector(up, -this.v.frustum / zoom * .16);
      this.v.tweenCam({ target: t, zoom, dur: i ? .75 : 1 });
    }
    this.renderHud();
    this.redraw();
  }

  private reveal() {
    const s = this.session;
    if (!s || s.done || s.revealed) return;
    s.revealed = true;
    this.renderHud();
    const stop = s.stops[s.i];
    const note = this.v.ui.recall.querySelector<HTMLElement>('.kp-recall-note');
    if (note && stop.binding && this.v.host.renderBlock && this.v.isLocalNote(stop.binding)) {
      try { s.cleanup = this.v.host.renderBlock(note, stop.binding.blockId) || null; } catch (e) { console.warn('[kmind-palace] renderBlock', e); }
    }
  }

  private rate(r: Rating) {
    const s = this.session;
    if (!s || s.done) return;
    if (!s.revealed) { this.reveal(); return; }
    const stop = s.stops[s.i];
    s.ratings.set(stop.key, r);
    if (this.run) this.run.ratings.set(`${this.run.legs[this.run.leg].palaceId}|${stop.key}`, r);
    const id = stop.binding?.blockId;
    const review = this.v.host.review;
    if (id && review && this.v.isLocalNote(stop.binding)) {
      review.rate(id, r)
        .then(st => { if (st) this.v.setReviewState(id, st); })
        .catch(e => this.v.host.notify?.(t('记录复习结果失败：{err}', { err: String((e as Error)?.message || e) }), 'error'));
    }
    this.go(s.i + 1);
  }

  private finish() {
    const s = this.session;
    if (!s) return;
    s.done = true;
    this.v.select(null);
    this.v.companion?.cheer(t('全部走完啦！'));
    this.renderHud();
    this.redraw();
  }

  /** 再练一遍没记住的（忘了 / 困难） */
  private again() {
    const s = this.session;
    if (!s) return;
    if (this.run) {
      const weak = new Set([...this.run.ratings].filter(([, r]) => r > 0 && r <= 2).map(([k]) => k));
      if (!weak.size) { this.stop(); return; }
      this.startJourney(this.run.journey.id, false, weak);
      return;
    }
    const keys = s.stops.filter(x => (s.ratings.get(x.key) || 0) > 0 && (s.ratings.get(x.key) as number) <= 2).map(x => x.key);
    if (!keys.length) { this.stop(); return; }
    this.start(false, keys);
  }

  stop() {
    this.run = null;
    this.endSession();
  }

  /** 结束当前这一段的回忆界面（旅程本身保留） */
  private endSession() {
    const s = this.session;
    if (!s) return;
    s.cleanup?.();
    this.session = null;
    const v = this.v;
    v.root.classList.remove('kp-recalling');
    v.ui.recall.classList.add('kp-hidden');
    v.ui.recall.innerHTML = '';
    v.select(null);
    this.redraw();
  }

  private renderHud() {
    const s = this.session, el = this.v.ui.recall;
    if (!s) { el.classList.add('kp-hidden'); return; }
    el.classList.remove('kp-hidden');
    const run = this.run;
    const n = run ? run.total : s.stops.length;
    if (s.legDone && run) {
      const next = run.legs[run.leg + 1];
      el.innerHTML = `
        <div class="kp-recall-top"><span>${t('{name} · 第 {i} / {n} 段走完了', { name: escapeHtml(run.journey.name), i: run.leg + 1, n: run.legs.length })}</span><button data-act="recallStop">×</button></div>
        <div class="kp-recall-bar"><i style="width:${(run.offsets[run.leg] + s.stops.length) / n * 100}%"></i></div>
        <div class="kp-recall-next"><small>${t('下一座宫殿')}</small><b></b><span></span></div>
        <div class="kp-recall-actions">
          <button data-act="recallStop">${t('先到这里')}</button>
          <button class="kp-primary kp-grow" data-act="recallNextLeg">${t('前往')} <kbd>${t('空格')}</kbd></button>
        </div>`;
      el.querySelector('.kp-recall-next b').textContent = next.name;
      el.querySelector('.kp-recall-next span').textContent = `${next.routeName} · ${t('{n} 站', { n: next.keys.length })}`;
      return;
    }
    if (s.done) {
      const all = run ? run.ratings : s.ratings;
      const counts = RATINGS.map(([r, label, cls]) => [t(label), cls, [...all.values()].filter(x => x === r).length] as const);
      const weak = [...all.values()].filter(x => x && x <= 2).length;
      const skipped = n - [...all.values()].filter(Boolean).length;
      el.innerHTML = `
        <div class="kp-recall-top"><span>${t('{name} · 走完了', { name: escapeHtml(run ? run.journey.name : s.route) })}</span><button data-act="recallStop">×</button></div>
        <div class="kp-recall-done">${t('<b>{n}</b> 站回忆完毕', { n })}${run ? `<small>${t('{n} 座宫殿', { n: new Set(run.legs.map(l => l.palaceId)).size })}</small>` : ''}</div>
        <div class="kp-recall-sum">${counts.map(([l, c, k]) => `<span class="kp-r-${c}">${l} <b>${k}</b></span>`).join('')}${skipped ? `<span>${t('跳过 <b>{n}</b>', { n: skipped })}</span>` : ''}</div>
        <div class="kp-recall-actions">
          ${weak ? `<button data-act="recallAgain">${t('再练一遍没记住的 · {n}', { n: weak })}</button>` : ''}
          <button class="kp-primary" data-act="recallStop">${t('完成')}</button>
        </div>`;
      return;
    }
    const stop = s.stops[s.i];
    const where = this.v.locusName(stop.item, stop.slot);
    const room = this.v.built?.roomOf(stop.item.room)?.name || '';
    const k = (run ? run.offsets[run.leg] : 0) + s.i;
    const label = run ? `${run.journey.name} · ${run.legs[run.leg].name}` : s.route;
    const top = `<div class="kp-recall-top"><span>${t('{name} · 第 {i} / {n} 站', { name: escapeHtml(label), i: k + 1, n })}</span><button data-act="recallStop" title="${t('结束回忆（Esc）')}">×</button></div>
      <div class="kp-recall-bar"><i style="width:${(k / n) * 100}%"></i></div>
      <div class="kp-recall-where"><small>${escapeHtml(room)}</small><b></b></div>`;
    const b = stop.binding;
    if (!s.revealed) {
      // 有配图时可以先看图提示（不看文字）
      el.innerHTML = `${top}
        <div class="kp-recall-q">${t('这里放着什么？先在心里说出来，再揭晓。')}</div>
        ${s.hint && b?.image ? '<img class="kp-recall-img" alt="">' : ''}
        <div class="kp-recall-actions">
          <button data-act="recallPrev"${s.i ? '' : ' disabled'}>${t('上一站')}</button>
          ${b?.image && !s.hint ? `<button data-act="recallHint" title="${t('先看配图，不看文字')}">${t('看图提示')}</button>` : `<button data-act="recallSkip">${t('跳过')}</button>`}
          <button class="kp-primary kp-grow" data-act="recallReveal">${t('揭晓')} <kbd>${t('空格')}</kbd></button>
        </div>`;
    } else {
      const local = this.v.isLocalNote(b);
      const canOpen = !!this.v.host.openBlock && local, canRender = !!this.v.host.renderBlock && local;
      el.innerHTML = `${top}
        <div class="kp-recall-answer">
          <div class="kp-recall-title"><b></b>${canOpen ? `<button data-act="recallOpen" title="${t('在右侧打开笔记')}">${t('打开笔记')}</button>` : ''}</div>
          ${b?.story || b?.image ? `<div class="kp-recall-story">${b.image ? '<img class="kp-recall-img" alt="">' : ''}${b.story ? '<p></p>' : ''}</div>` : ''}
          ${canRender ? '<div class="kp-recall-note"></div>' : ''}
        </div>
        <div class="kp-rate">${RATINGS.map(([r, label, cls]) => `<button class="kp-r-${cls}" data-act="recallRate" data-rate="${r}">${t(label)}<kbd>${r}</kbd></button>`).join('')}</div>`;
      el.querySelector('.kp-recall-title b').textContent = b?.title || b?.blockId || '';
      const p = el.querySelector('.kp-recall-story p');
      if (p) p.textContent = b.story;
    }
    const img = el.querySelector<HTMLImageElement>('img.kp-recall-img');
    if (img && b?.image) this.v.mediaUrl(b.image).then(u => { img.src = u; }).catch(() => img.remove());
    el.querySelector('.kp-recall-where b').textContent = where;
  }

  /** 回忆模式下的按键：空格揭晓，1–4 自评，← → 前后，Esc 结束 */
  onKey(e: KeyboardEvent): boolean {
    const s = this.session;
    if (!s) {
      if (this.picking && e.key === 'Escape') { this.picking = false; this.v.root.classList.remove('kp-route-picking'); this.renderPanel(); return true; }
      return false;
    }
    const k = e.key;
    if (k === 'Escape') { this.stop(); return true; }
    if (s.done) { if (k === 'Enter' || k === ' ') { this.stop(); return true; } return true; }
    if (s.legDone) { if (k === 'Enter' || k === ' ') this.enterLeg(this.run.leg + 1); return true; }
    if (k === ' ' || k === 'Enter') { if (s.revealed) this.rate(3); else this.reveal(); return true; }
    if (/^[1-4]$/.test(k)) { this.rate(Number(k) as Rating); return true; }
    if (k === 'ArrowRight') { this.go(s.i + 1); return true; }
    if (k === 'ArrowLeft') { this.go(Math.max(0, s.i - 1)); return true; }
    // 其余按键（视角旋转等）照常
    return false;
  }

  // =====================================================================
  // 地上的路线
  // =====================================================================

  redraw() {
    const v = this.v;
    const show = (this.panelOpen || this.active) && v.level === 'palace' && !!v.built;
    if (!show) { this.layer.clear(); v.invalidate(); return; }
    const s = this.session;
    const stops = s ? s.stops : this.stops().filter(x => x.binding);
    const marks = stops.map((st, i) => {
      const a = v.locusAnchor(st.item, st.slot);
      let cls = `kp-m-${st.binding ? v.memoryOf(st.binding.blockId) : 'none'}`;
      if (s) {
        const r = s.ratings.get(st.key);
        cls = r ? `kp-done kp-r-${RATINGS[r - 1][2]}` : (!s.done && i === s.i ? 'kp-cur' : 'kp-todo');
      }
      return { anchor: a, label: String(i + 1), cls, key: st.key };
    }).filter(m => m.anchor);
    this.layer.draw(v, marks);
    v.invalidate();
  }
}

// =====================================================================
// 路线图层：地上的点线 + 每站的编号
// =====================================================================

export interface Mark { anchor: THREE.Vector3; label: string; cls: string; key: string }

export class RouteLayer {
  readonly group = new THREE.Group();
  private dotGeo = new THREE.CircleGeometry(.045, 12);
  private arrowGeo: THREE.BufferGeometry;
  private mat = new THREE.MeshBasicMaterial({ color: '#ef8235', transparent: true, opacity: .85, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
  private badges: CSS2DObject[] = [];

  constructor(scene: THREE.Scene) {
    this.group.name = 'kp-route';
    this.group.renderOrder = 4;
    const shape = new THREE.Shape([new THREE.Vector2(-.09, -.07), new THREE.Vector2(.11, 0), new THREE.Vector2(-.09, .07), new THREE.Vector2(-.04, 0)]);
    this.arrowGeo = new THREE.ShapeGeometry(shape);
    scene.add(this.group);
  }

  clear() {
    for (const c of [...this.group.children]) {
      c.removeFromParent();
      if ((c as THREE.InstancedMesh).isInstancedMesh) (c as THREE.InstancedMesh).dispose();
    }
    this.badges.forEach(b => b.element.remove());
    this.badges = [];
  }

  draw(v: PalaceView, marks: Mark[]) {
    this.clear();
    const b = v.built;
    if (!b || !marks.length) return;
    // 步行网格：墙体 + 实心家具
    const bb = b.bounds;
    const grid = new WalkGrid({ x0: bb.min.x - 1, z0: bb.min.z - 1, x1: bb.max.x + 1, z1: bb.max.z + 1 }, computeColliders(b, v.catalog));
    const stand = (p: THREE.Vector3): P2 => grid.nearestFree(p.x, p.z) || [p.x, p.z];
    const pts: P2[] = [];
    const door = v.doc ? frontDoor(v.doc) : null;
    let prev: P2 | null = door ? [door.x + door.nx * .4, door.z + door.nz * .4] : null;
    for (const m of marks) {
      const s = stand(m.anchor);
      if (prev) {
        const seg = grid.path(prev, s) || [prev, s];
        if (pts.length) seg.shift();
        pts.push(...seg);
      } else pts.push(s);
      prev = s;
    }
    // 点线：每 0.3 m 一个点，每 1.5 m 一个箭头
    const dots: THREE.Matrix4[] = [], arrows: THREE.Matrix4[] = [];
    const up = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    let carry = 0, sinceArrow = .8;
    for (let i = 1; i < pts.length; i++) {
      const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1e-4) continue;
      // 箭头形状朝 +x，绕 z 转 ang 后再放平：指向 (dx, dz)
      const ang = Math.atan2(-(z1 - z0), x1 - x0);
      let d = carry;
      for (; d < len; d += .3) {
        const t = d / len, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        sinceArrow += .3;
        if (sinceArrow >= 1.5) {
          sinceArrow = 0;
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, ang));
          arrows.push(new THREE.Matrix4().compose(new THREE.Vector3(x, .035, z), q, new THREE.Vector3(1, 1, 1)));
        } else dots.push(new THREE.Matrix4().compose(new THREE.Vector3(x, .035, z), up, new THREE.Vector3(1, 1, 1)));
      }
      carry = d - len;
    }
    for (const [geo, list] of [[this.dotGeo, dots], [this.arrowGeo, arrows]] as [THREE.BufferGeometry, THREE.Matrix4[]][]) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geo, this.mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.renderOrder = 4;
      im.frustumCulled = false;
      im.raycast = () => { /* 不参与拾取 */ };
      this.group.add(im);
    }
    // 编号：离得太近的（同一个书架上的几本书）往上错开
    const placed: THREE.Vector3[] = [];
    for (const m of marks) {
      const el = document.createElement('div');
      el.className = `kp-stop-badge ${m.cls}`;
      el.textContent = m.label;
      el.dataset.key = m.key;
      const o = new CSS2DObject(el);
      const p = new THREE.Vector3(m.anchor.x, m.anchor.y + .32, m.anchor.z);
      for (let guard = 0; guard < 12 && placed.some(q => q.distanceTo(p) < .4); guard++) p.y += .3;
      placed.push(p);
      o.position.copy(p);
      this.group.add(o);
      this.badges.push(o);
    }
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
    this.dotGeo.dispose(); this.arrowGeo.dispose(); this.mat.dispose();
  }
}
