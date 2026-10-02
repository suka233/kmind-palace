import * as THREE from 'three';
import type { PalaceView } from './view';
import { gid, parseLocus, type PalaceItem } from './schema';
import { AUTO_ROUTE_ID } from './route';
import { RouteLayer } from './recall';
import { assignNumbers, cleanDigits, checkDigits, codeOf, setCode, importCodes, pairKey, defaultObjects, type NumberSet, type NumberSlot } from './pao';
import { t, isZh } from './i18n';
import { escapeHtml } from './icons';

/* =====================================================================
 * 数字记忆：面板（数字组、摆法、沿哪条路线）、场景里每桩标出数字、卡片里这一桩的画面、
 * 数字回忆（逐桩输入数字核对）、编码表编辑器（00–99 的人物 / 动作 / 物件）。
 * ===================================================================== */

interface Drill {
  set: NumberSet;
  slots: NumberSlot[];
  i: number;
  /** 这一桩已经核对过 */
  checked: boolean;
  hint: boolean;
  results: Map<number, { correct: number; total: number; ok: boolean; answer: string }>;
  done: boolean;
}

export class NumberController {
  panelOpen = false;
  setId: string | null = null;
  drill: Drill | null = null;
  private layer: RouteLayer;
  private confirmDelete = false;
  private tableOpen = false;
  private tableQuery = '';

  constructor(private v: PalaceView) {
    this.layer = new RouteLayer(v.scene);
  }

  get active() { return !!this.drill; }

  private get sets(): NumberSet[] { return this.v.doc?.numbers || []; }
  private get table() { return this.v.world.pao; }

  current(): NumberSet | undefined {
    return this.sets.find(s => s.id === this.setId) || this.sets[0];
  }

  /** 当前数字组摆在哪些记忆桩上 */
  private assignment(set = this.current()) {
    return set && this.v.doc ? assignNumbers(this.v.doc, set, this.table, this.v.slotSort) : { slots: [], overflow: 0 };
  }

  reset() {
    this.stopDrill();
    this.panelOpen = false;
    this.confirmDelete = false;
    this.v.ui.numbers?.classList.add('kp-hidden');
    this.setId = null;
    this.layer.clear();
  }

  dispose() {
    this.stopDrill();
    this.layer.dispose();
  }

  /** 物件、路线或编码表变了 */
  refresh() {
    if (!this.v.doc) return;
    if (this.panelOpen) this.renderPanel();
    if (this.panelOpen) this.redraw();
  }

  // =====================================================================
  // 面板
  // =====================================================================

  togglePanel(open = !this.panelOpen) {
    const v = this.v;
    if (open) {
      if (v.editor.active) v.editor.toggle(false);
      if (v.recall.panelOpen) v.recall.togglePanel(false);
      v.ui.loci.classList.add('kp-hidden');
    }
    this.panelOpen = open;
    this.confirmDelete = false;
    v.ui.numbers.classList.toggle('kp-hidden', !open);
    if (open) this.renderPanel();
    this.redraw();
  }

  private changed(redraw = true) {
    this.v.emitChange();
    this.renderPanel();
    if (redraw) this.redraw();
    if (this.v.selected) this.v.showCard(this.v.selected);
  }

  renderPanel() {
    if (!this.panelOpen) return;
    const v = this.v, el = v.ui.numbers, sets = this.sets, cur = this.current();
    if (!cur) {
      el.innerHTML = `
        <div class="kp-routes-head"><b>${t('数字记忆')}</b><button class="kp-close" data-act="numClose">×</button></div>
        <div class="kp-empty">${t('把一长串数字（圆周率、电话、历史年份……）变成一个个画面，沿路线摆在宫殿的家具上：每两位数对应一个人物 / 动作 / 物件。')}</div>
        <div class="kp-route-go"><button class="kp-primary" data-act="numNew">${t('＋ 新建数字组')}</button><button data-act="numTable">${t('编码表')}</button></div>`;
      return;
    }
    const { slots, overflow } = this.assignment(cur);
    const digits = cleanDigits(cur.digits);
    const routes = v.doc.routes || [];
    const scenes = slots.filter(s => s.image.scene).length;
    el.innerHTML = `
      <div class="kp-routes-head"><b>${t('数字记忆')}</b><button class="kp-close" data-act="numClose">×</button></div>
      <div class="kp-route-pick">
        <select data-field="numSet">${sets.map(s => `<option value="${escapeHtml(s.id)}"${s === cur ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          <option value="__new">${t('＋ 新建数字组')}</option></select>
        <button data-act="numDelete" class="kp-danger">${this.confirmDelete ? t('确认删除') : t('删除')}</button>
      </div>
      <input class="kp-route-name" data-field="numName" maxlength="30" spellcheck="false">
      <textarea class="kp-num-digits" data-field="numDigits" rows="3" spellcheck="false" placeholder="${t('粘贴要背的数字，例如 3.14159 26535 89793…（只取数字）')}"></textarea>
      <div class="kp-route-pick">
        <select data-field="numMode">
          <option value="pao"${cur.mode === 'pao' ? ' selected' : ''}>${t('人物-动作-物件 · 6 位一桩')}</option>
          ${[1, 2, 3].map(n => `<option value="images-${n}"${cur.mode === 'images' && (cur.per || 2) === n ? ' selected' : ''}>${t('两位一图 · 每桩 {n} 图（{d} 位）', { n, d: n * 2 })}</option>`).join('')}
        </select>
      </div>
      <div class="kp-route-pick">
        <select data-field="numRoute">
          <option value="all"${cur.route === 'all' ? ' selected' : ''}>${t('沿全部家具（按位置）')}</option>
          <option value="${AUTO_ROUTE_ID}"${cur.route === AUTO_ROUTE_ID ? ' selected' : ''}>${t('沿全部记忆桩（按位置）')}</option>
          ${routes.map(r => `<option value="${escapeHtml(r.id)}"${cur.route === r.id ? ' selected' : ''}>${t('沿路线「{name}」', { name: escapeHtml(r.name) })}</option>`).join('')}
        </select>
      </div>
      <div class="kp-route-stats">${t('{d} 位 · {n} 桩', { d: digits.length, n: slots.length })}${overflow ? ' · ' + t('<b class="kp-m-due">还有 {n} 位放不下</b>（换条长一点的路线，或每桩多放几图）', { n: overflow }) : ''}</div>
      <div class="kp-route-go">
        <button class="kp-primary" data-act="numDrill"${slots.length ? '' : ' disabled'}>${t('开始回忆')}</button>
        <button data-act="numTable">${t('编码表')}</button>
      </div>
      ${cur.mode === 'pao' && slots.length && !scenes ? `<div class="kp-route-stats">${t('在编码表里给两位数填上人物和动作，6 位数就能组成「人物 动作 物件」的一个画面；没填时先列出三个物件。')}</div>` : ''}
      <div class="kp-stops">${slots.map(s => `
        <button class="kp-stop-row kp-num-row" data-act="numFocus" data-key="${escapeHtml(s.key)}">
          <i class="kp-dot kp-m-fresh">${s.index + 1}</i>
          <span><b class="kp-num-digits-text">${s.digits.replace(/(\d{2})(?=\d)/g, '$1 ')}</b><small></small></span>
        </button>`).join('') || `<div class="kp-empty">${t('先在上面粘贴数字。')}</div>`}</div>`;
    el.querySelectorAll<HTMLElement>('.kp-num-row').forEach((row, i) => {
      const s = slots[i], item = this.itemOf(s.key);
      row.querySelector('small').textContent = `${item ? v.locusName(item, parseLocus(s.key).slot) : t('（已删除）')} · ${s.image.text}`;
    });
    (el.querySelector('[data-field="numName"]') as HTMLInputElement).value = cur.name;
    (el.querySelector('[data-field="numDigits"]') as HTMLTextAreaElement).value = cur.digits;
  }

  private itemOf(key: string): PalaceItem | undefined {
    const id = parseLocus(key).itemId;
    return this.v.doc?.items.find(i => i.id === id);
  }

  /** 卡片里：这件物件上摆着哪组数字的哪一桩 */
  cardSection(item: PalaceItem, slot: string): string {
    const rows: string[] = [];
    for (const set of this.sets) {
      for (const s of this.assignment(set).slots) {
        const { itemId, slot: sl } = parseLocus(s.key);
        if (itemId !== item.id || sl !== slot) continue;
        rows.push(`<div class="kp-num-card"><small>🔢 ${escapeHtml(set.name)} · ${t('第 {n} 桩', { n: s.index + 1 })}</small><b>${s.digits.replace(/(\d{2})(?=\d)/g, '$1 ')}</b><span>${escapeHtml(s.image.text)}</span></div>`);
      }
    }
    return this.drill ? '' : rows.join('');
  }

  onAction(act: string, el: HTMLElement): boolean {
    if (!act.startsWith('num')) return false;
    const v = this.v, cur = this.current();
    if (act !== 'numDelete') this.confirmDelete = false;
    switch (act) {
      case 'numbers': case 'numClose': this.togglePanel(act === 'numbers' ? !this.panelOpen : false); break;
      case 'numNew': this.create(); break;
      case 'numDelete':
        if (!cur) break;
        if (!this.confirmDelete) { this.confirmDelete = true; this.renderPanel(); break; }
        this.confirmDelete = false;
        v.doc.numbers = this.sets.filter(s => s !== cur);
        if (!v.doc.numbers.length) delete v.doc.numbers;
        this.setId = null;
        this.changed();
        break;
      case 'numFocus': v.focusItem(el.dataset.key); break;
      case 'numDrill': if (cur) this.startDrill(cur); break;
      case 'numTable': this.openTable(); break;
      case 'numTableClose': this.closeTable(); break;
      case 'numImport': this.importTable(); break;
      // ---------- 回忆 ----------
      case 'numCheck': this.check(); break;
      case 'numNext': this.go((this.drill?.i ?? 0) + 1); break;
      case 'numHint': if (this.drill) { this.drill.hint = true; this.renderDrill(); } break;
      case 'numAgain': this.again(); break;
      case 'numStop': this.stopDrill(); break;
    }
    return true;
  }

  private create() {
    const v = this.v;
    const set: NumberSet = { id: gid('num-'), name: t('数字组 {n}', { n: this.sets.length + 1 }), digits: '', mode: 'pao', route: 'all' };
    v.doc.numbers = [...this.sets, set];
    this.setId = set.id;
    this.changed();
    queueMicrotask(() => (v.ui.numbers.querySelector('[data-field="numDigits"]') as HTMLTextAreaElement)?.focus());
  }

  onInput(e: Event, commit: boolean): boolean {
    const el = e.target as HTMLInputElement, f = el.dataset.field;
    if (!f?.startsWith('num') && !f?.startsWith('pao')) return false;
    const cur = this.current();
    if (f.startsWith('pao')) { if (commit || f === 'paoQuery') this.onTableInput(el); return true; }
    if (f === 'numSet') {
      if (commit) { if (el.value === '__new') this.create(); else { this.setId = el.value; this.renderPanel(); this.redraw(); } }
      return true;
    }
    if (f === 'numAnswer') return true;
    if (!cur || !commit) return true;
    if (f === 'numName') { const n = el.value.trim(); if (n && n !== cur.name) { cur.name = n; this.changed(false); } }
    else if (f === 'numDigits') { const d = cleanDigits(el.value); if (d !== cur.digits) { cur.digits = d; this.changed(); } }
    else if (f === 'numMode') {
      const [mode, per] = el.value.split('-');
      cur.mode = mode === 'images' ? 'images' : 'pao';
      if (cur.mode === 'images') cur.per = Number(per) || 2; else delete cur.per;
      this.changed();
    } else if (f === 'numRoute') { cur.route = el.value; this.changed(); }
    return true;
  }

  // =====================================================================
  // 场景里的标记：面板打开时每桩标出数字；回忆时只标序号
  // =====================================================================

  redraw() {
    const v = this.v;
    const show = (this.panelOpen || this.drill) && v.level === 'palace' && !!v.built;
    if (!show) { this.layer.clear(); v.invalidate(); return; }
    const d = this.drill;
    const slots = d ? d.slots : this.assignment().slots;
    const marks = slots.map((s, i) => {
      const item = this.itemOf(s.key);
      const anchor = item ? v.locusAnchor(item, parseLocus(s.key).slot) : null;
      let cls = 'kp-m-fresh', label = s.digits.replace(/(\d{2})(?=\d)/g, '$1 ');
      if (d) {
        const r = d.results.get(i);
        label = String(i + 1);
        cls = r ? `kp-done kp-r-${r.ok ? 'good' : 'again'}` : (!d.done && i === d.i ? 'kp-cur' : 'kp-todo');
      }
      return { anchor, label, cls: `${cls} kp-num-badge`, key: s.key };
    }).filter(m => m.anchor);
    this.layer.draw(v, marks);
    v.invalidate();
  }

  // =====================================================================
  // 数字回忆：飞到每一桩，输入这里的数字，核对
  // =====================================================================

  startDrill(set: NumberSet, only?: Set<number>) {
    const v = this.v;
    let slots = this.assignment(set).slots;
    if (only) slots = slots.filter(s => only.has(s.index));
    if (!slots.length) return;
    if (v.mode === 'walk') v.exitWalk();
    v.recall.stop();
    this.panelOpen = false;
    v.ui.numbers.classList.add('kp-hidden');
    v.root.classList.add('kp-recalling');
    v.select(null);
    this.drill = { set, slots, i: 0, checked: false, hint: false, results: new Map(), done: false };
    this.go(0);
  }

  private go(i: number) {
    const d = this.drill, v = this.v;
    if (!d) return;
    if (i >= d.slots.length) { d.done = true; v.select(null); this.renderDrill(); this.redraw(); return; }
    d.i = i; d.checked = false; d.hint = false;
    const s = d.slots[i], item = this.itemOf(s.key), slot = parseLocus(s.key).slot;
    const obj = item ? v.built?.itemObjects.get(item.id) || null : null;
    v.select(obj, slot);
    const a = item ? v.locusAnchor(item, slot) : null;
    if (a) {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(v.isoCam.quaternion);
      const tgt = new THREE.Vector3(a.x, a.y * .75, a.z).addScaledVector(up, -v.frustum / 2.6 * .16);
      v.tweenCam({ target: tgt, zoom: 2.6, dur: i ? .7 : 1 });
    }
    this.renderDrill();
    this.redraw();
  }

  private check() {
    const d = this.drill;
    if (!d || d.done) return;
    if (d.checked) { this.go(d.i + 1); return; }
    const input = this.v.ui.recall.querySelector<HTMLInputElement>('[data-field="numAnswer"]');
    const answer = cleanDigits(input?.value || '');
    d.results.set(d.i, { ...checkDigits(d.slots[d.i].digits, answer), answer });
    d.checked = true;
    this.renderDrill();
    this.redraw();
  }

  private again() {
    const d = this.drill;
    if (!d) return;
    const wrong = new Set([...d.results].filter(([, r]) => !r.ok).map(([i]) => d.slots[i].index));
    if (!wrong.size) { this.stopDrill(); return; }
    this.startDrill(d.set, wrong);
  }

  stopDrill() {
    if (!this.drill) return;
    this.drill = null;
    const v = this.v;
    v.root.classList.remove('kp-recalling');
    v.ui.recall.classList.add('kp-hidden');
    v.ui.recall.innerHTML = '';
    v.select(null);
    this.redraw();
  }

  private renderDrill() {
    const d = this.drill, el = this.v.ui.recall, v = this.v;
    if (!d) return;
    el.classList.remove('kp-hidden');
    const n = d.slots.length;
    const group = (s: string) => s.replace(/(\d{2})(?=\d)/g, '$1 ');
    if (d.done) {
      const res = [...d.results.values()];
      const ok = res.filter(r => r.ok).length, digits = res.reduce((s, r) => s + r.correct, 0), total = d.slots.reduce((s, x) => s + x.digits.length, 0);
      el.innerHTML = `
        <div class="kp-recall-top"><span>${escapeHtml(d.set.name)} · ${t('走完了')}</span><button data-act="numStop">×</button></div>
        <div class="kp-recall-done">${t('<b>{ok}</b> / {n} 桩全对', { ok, n })}<small>${t('数字对了 {c} / {total} 位', { c: digits, total })}</small></div>
        <div class="kp-recall-actions">
          ${ok < n ? `<button data-act="numAgain">${t('再练错的 · {n}', { n: n - ok })}</button>` : ''}
          <button class="kp-primary" data-act="numStop">${t('完成')}</button>
        </div>`;
      return;
    }
    const s = d.slots[d.i], item = this.itemOf(s.key);
    const where = item ? v.locusName(item, parseLocus(s.key).slot) : '';
    const room = item ? v.built?.roomOf(item.room)?.name || '' : '';
    const r = d.results.get(d.i);
    el.innerHTML = `
      <div class="kp-recall-top"><span>${escapeHtml(d.set.name)} · ${t('第 {i} / {n} 桩 · {d} 位', { i: d.i + 1, n, d: s.digits.length })}</span><button data-act="numStop" title="${t('结束（Esc）')}">×</button></div>
      <div class="kp-recall-bar"><i style="width:${(d.i / n) * 100}%"></i></div>
      <div class="kp-recall-where"><small>${escapeHtml(room)}</small><b></b></div>
      ${d.checked ? `
        <div class="kp-num-result ${r.ok ? 'kp-ok' : 'kp-bad'}">
          <b>${r.ok ? t('全对') : t('对了 {c} / {total} 位', { c: r.correct, total: r.total })}</b>
          <span class="kp-num-answer">${[...s.digits].map((c, k) => `<i class="${r.answer[k] === c ? '' : 'kp-miss'}">${c}</i>`).join('')}</span>
          <small></small>
        </div>
        <div class="kp-recall-actions"><button class="kp-primary kp-grow" data-act="numNext">${d.i < n - 1 ? t('下一桩') : t('看结果')} <kbd>${t('回车')}</kbd></button></div>` : `
        <div class="kp-recall-q">${t('这里摆着哪 {n} 位数字？先回想画面，再输入。', { n: s.digits.length })}</div>
        ${d.hint ? '<div class="kp-num-hint"></div>' : ''}
        <input class="kp-num-input" data-field="numAnswer" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="${group('0'.repeat(s.digits.length))}">
        <div class="kp-recall-actions">
          <button data-act="numNext">${t('跳过')}</button>
          ${d.hint ? '' : `<button data-act="numHint" title="${t('看这一桩的画面')}">${t('看画面')}</button>`}
          <button class="kp-primary kp-grow" data-act="numCheck">${t('核对')} <kbd>${t('回车')}</kbd></button>
        </div>`}`;
    el.querySelector('.kp-recall-where b').textContent = where;
    const hint = el.querySelector('.kp-num-hint');
    if (hint) hint.textContent = s.image.text;
    const small = el.querySelector('.kp-num-result small');
    if (small) small.textContent = s.image.text;
    const input = el.querySelector<HTMLInputElement>('[data-field="numAnswer"]');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.check(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.stopDrill(); }
      });
      setTimeout(() => input.focus({ preventScroll: true }), 0);
    } else {
      setTimeout(() => v.root.focus({ preventScroll: true }), 0);
    }
  }

  /** 回忆时视图上的按键（输入框外）：回车下一桩，Esc 结束 */
  onKey(e: KeyboardEvent): boolean {
    const d = this.drill;
    if (!d) return false;
    if (e.key === 'Escape') { this.stopDrill(); return true; }
    if (e.key === 'Enter' || e.key === ' ') {
      if (d.done) this.stopDrill();
      else if (d.checked) this.go(d.i + 1);
      return true;
    }
    return false;
  }

  // =====================================================================
  // 编码表
  // =====================================================================

  openTable() {
    this.tableOpen = true;
    this.v.ui.paoWrap.classList.remove('kp-hidden');
    this.renderTable();
  }

  closeTable() {
    this.tableOpen = false;
    this.v.ui.paoWrap.classList.add('kp-hidden');
    this.renderPanel();
    this.redraw();
    this.v.root.focus({ preventScroll: true });
  }

  private renderTable() {
    const el = this.v.ui.pao, tbl = this.table;
    const q = this.tableQuery.trim();
    const rows = Array.from({ length: 100 }, (_, n) => pairKey(n)).filter(k => {
      if (!q) return true;
      const c = codeOf(tbl, k);
      return k.includes(q) || c.p.includes(q) || c.a.includes(q) || c.o.includes(q);
    });
    const filled = Object.values(tbl?.codes || {}).filter(e => e.p || e.a).length;
    const objs = defaultObjects();
    el.innerHTML = `
      <div class="kp-panel-head"><b>${t('数字编码表 · 00–99')}</b><button class="kp-close" data-act="numTableClose">×</button></div>
      <div class="kp-pao-tools">
        <input class="kp-route-name" data-field="paoQuery" placeholder="${t('搜索数字或编码…')}" spellcheck="false">
        <span>${t('{n} 个填了人物 / 动作', { n: filled })}</span>
      </div>
      <div class="kp-pao-head"><span></span><span>${t('人物')}</span><span>${t('动作')}</span><span>${isZh() ? '物件' : 'Object'}</span></div>
      <div class="kp-pao-body">${rows.map(k => {
        const e = tbl?.codes?.[k] || {};
        return `<div class="kp-pao-row"><b>${k}</b>
          <input data-field="paoP" data-key="${k}" value="${escapeHtml(e.p || '')}" placeholder="${t('人物')}" maxlength="20">
          <input data-field="paoA" data-key="${k}" value="${escapeHtml(e.a || '')}" placeholder="${t('动作')}" maxlength="20">
          <input data-field="paoO" data-key="${k}" value="${escapeHtml(e.o || '')}" placeholder="${escapeHtml(objs[Number(k)])}" maxlength="20"></div>`;
      }).join('')}</div>
      <details class="kp-pao-import"><summary>${t('批量粘贴')}</summary>
        <textarea data-field="paoBulk" rows="4" placeholder="${t('每行一个：数字 人物 动作 物件（或「数字 物件」），例如&#10;14 孙悟空 骑着 钥匙')}"></textarea>
        <button data-act="numImport">${t('导入')}</button>
      </details>`;
    const qi = el.querySelector<HTMLInputElement>('[data-field="paoQuery"]');
    qi.value = this.tableQuery;
  }

  private ensureTable() {
    const w = this.v.world;
    return w.pao || (w.pao = { codes: {} });
  }

  private onTableInput(el: HTMLInputElement) {
    const f = el.dataset.field;
    if (f === 'paoQuery') {
      this.tableQuery = el.value;
      this.renderTable();
      const qi = this.v.ui.pao.querySelector<HTMLInputElement>('[data-field="paoQuery"]');
      qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length);
      return;
    }
    if (f === 'paoBulk') return;
    const field = ({ paoP: 'p', paoA: 'a', paoO: 'o' } as const)[f as 'paoP'];
    if (!field || !el.dataset.key) return;
    const tbl = this.ensureTable();
    setCode(tbl, el.dataset.key, field, el.value);
    if (!Object.keys(tbl.codes).length) delete this.v.world.pao;
    this.v.worldChanged();
  }

  private importTable() {
    const ta = this.v.ui.pao.querySelector<HTMLTextAreaElement>('[data-field="paoBulk"]');
    if (!ta?.value.trim()) return;
    const n = importCodes(this.ensureTable(), ta.value);
    this.v.worldChanged();
    this.v.host.notify?.(n ? t('导入了 {n} 条编码', { n }) : t('没有认出编码：每行「数字 人物 动作 物件」'));
    this.renderTable();
  }

  /** 编码表打开时的按键：Esc 关掉 */
  onGlobalKey(e: KeyboardEvent): boolean {
    if (this.tableOpen && e.key === 'Escape') { this.closeTable(); return true; }
    return false;
  }

}
