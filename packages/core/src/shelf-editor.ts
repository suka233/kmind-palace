import type { PalaceView } from './view';
import { getBinding, type PalaceItem } from './schema';
import { slotLabel, isHexColor, type BookOverride, type ShelfBook, type DocBook } from './catalog';
import { html } from './dom';
import { t } from './i18n';

/* =====================================================================
 * 二维书架编辑器：书架的正视图，点一本书单独调整——换颜色、靠向一边、抽出一点、空出这一格，
 * 也可以直接绑定 / 解绑这本书（批量绑定一整架书时比在三维里一本本点方便）。
 * 覆盖存在书架的 params.books 里（见 catalog.ts 的 BookOverride）。
 * ===================================================================== */

const SWATCHES = ['#8c3b2f', '#b85c3c', '#c9a15a', '#e3d7c3', '#6b7f5a', '#445c4a', '#3f5a6b', '#2f3a4a', '#5b4a6b', '#6d3f55', '#7a8a99', '#f0e6d6'];

interface Layout { w: number; h: number; d: number; rows: number; step: number; books: ShelfBook[]; raw: ShelfBook[] }

export class ShelfEditor {
  private itemId: string | null = null;
  private slot: string | null = null;

  constructor(private v: PalaceView) { }

  get open() { return !!this.itemId; }

  private item(): PalaceItem | undefined {
    return this.v.doc?.items.find(i => i.id === this.itemId);
  }

  private layout(): Layout | null {
    const obj = this.itemId ? this.v.built?.itemObjects.get(this.itemId) : null;
    return obj?.userData.shelf?.layout || null;
  }

  show(item: PalaceItem, slot = '') {
    if (item.type !== 'bookshelf') return;
    this.itemId = item.id;
    this.slot = slot || null;
    this.v.ui.shelfWrap.classList.remove('kp-hidden');
    this.render();
  }

  close() {
    if (!this.itemId) return;
    this.itemId = this.slot = null;
    this.v.ui.shelfWrap.classList.add('kp-hidden');
    this.v.root.focus({ preventScroll: true });
  }

  /** 宫殿换了 / 物件删了 */
  refresh() {
    if (!this.itemId) return;
    if (!this.item()) this.close(); else this.render();
  }

  private overrides(): Record<string, BookOverride> {
    return this.item()?.params?.books || {};
  }

  private setOverride(slot: string, patch: Partial<BookOverride> | null) {
    const item = this.item();
    if (!item) return;
    const all = { ...(item.params?.books || {}) };
    const o: BookOverride = patch ? { ...all[slot], ...patch } : {};
    for (const k of Object.keys(o) as (keyof BookOverride)[]) if (o[k] === undefined || o[k] === false || (o[k] as unknown) === 0) delete o[k];
    if (Object.keys(o).length) all[slot] = o; else delete all[slot];
    item.params = { ...item.params };
    if (Object.keys(all).length) item.params.books = all; else delete item.params.books;
    this.v.respawn(item);
    this.v.emitChange();
    this.render();
  }

  render() {
    const v = this.v, item = this.item(), L = this.layout(), el = v.ui.shelf;
    if (!item || !L) { el.replaceChildren(); return; }
    const over = this.overrides();
    const shown = new Set(L.books.map(b => b.slot));
    const hidden = L.raw.filter(b => !shown.has(b.slot));
    const pct = (x: number, total: number) => `${(x / total * 100).toFixed(3)}%`;
    const box = (b: ShelfBook, extra: string, cls: string) => html`<button class="kp-b2d ${cls}" data-act="shelfBook" data-slot="${b.slot}" title="${this.label(item, b)}"
      style="left:${pct(b.x - b.w / 2 + L.w / 2, L.w)};bottom:${pct(b.y - b.h / 2, L.h)};width:${pct(b.w, L.w)};height:${pct(b.h, L.h)};${extra}"></button>`;
    const books = L.books.map(b => {
      const bound = !!getBinding(item, b.slot);
      return box(b, `background:${b.c};transform:rotate(${(-b.rz).toFixed(4)}rad)`, `${bound ? 'kp-bound' : ''}${b.slot === this.slot ? ' kp-on' : ''}${b.pz ? ' kp-pulled' : ''}`);
    });
    const holes = hidden.map(b => box(b, '', `kp-hole${b.slot === this.slot ? ' kp-on' : ''}`));
    const boards = Array.from({ length: L.rows + 1 }, (_, i) => html`<i class="kp-board" style="bottom:${pct(i ? .07 + i * L.step - .012 : 0, L.h)}"></i>`);
    const nBound = L.raw.filter(b => getBinding(item, b.slot)).length;
    el.replaceChildren(html`
      <div class="kp-panel-head"><b>${t('书架平面图 · {name}', { name: t(item.name || '书架') })}</b><button class="kp-close" data-act="shelfClose">×</button></div>
      <div class="kp-shelfed-sub">${t('{n} 本', { n: L.books.length })}${hidden.length ? ` · ${t('{n} 格空着', { n: hidden.length })}` : ''} · 📌 ${t('{n} 本已绑定', { n: nBound })}${Object.keys(over).length ? html` · <button data-act="shelfResetAll">${t('全部恢复默认')}</button>` : ''}</div>
      <div class="kp-shelf2d-wrap"><div class="kp-shelf2d" style="aspect-ratio:${L.w} / ${L.h}">${boards}${holes}${books}</div></div>
      <div class="kp-shelfed-book">${this.slot ? this.bookPanel(item, L, over[this.slot] || {}) : html`<div class="kp-empty">${t('点一本书单独调整：颜色、靠向一边、抽出一点、空出这一格；也可以直接把它绑定成记忆桩。')}</div>`}</div>`);
    const ttl = el.querySelector('[data-ref="bookTitle"]');
    if (ttl) ttl.textContent = this.label(item, L.raw.find(b => b.slot === this.slot));
    const bt = el.querySelector('[data-ref="bindTitle"]');
    const b = this.slot ? getBinding(item, this.slot) : null;
    if (bt && b) bt.textContent = b.title || b.blockId;
  }

  private label(item: PalaceItem, b: ShelfBook | undefined) {
    if (!b) return '';
    return (b as DocBook).title || slotLabel(this.v.catalog, item, b.slot);
  }

  private bookPanel(item: PalaceItem, L: Layout, o: BookOverride) {
    const slot = this.slot, v = this.v;
    const b = getBinding(item, slot), isDoc = slot.startsWith('doc:');
    const raw = L.raw.find(x => x.slot === slot);
    if (!raw) return null;
    const color = o.c || raw.c;
    const lean = o.lean || 0;
    const canPick = !!v.host.pickBlock, canOpen = !!v.host.openBlock;
    const bindBtns = b
      ? html`${canOpen ? html`<button data-act="shelfOpen">${t('打开笔记')}</button>` : ''}<button class="kp-danger" data-act="shelfUnbind">${t('解绑')}</button>`
      : isDoc ? html`<button class="kp-primary" data-act="shelfBind">${t('设为记忆桩')}</button>`
        : canPick ? html`<button class="kp-primary" data-act="shelfBind">${t('绑定笔记…')}</button>` : null;
    return html`
      <div class="kp-shelfed-title"><b data-ref="bookTitle"></b>${b ? html`<small>📌 <span data-ref="bindTitle"></span></small>` : ''}</div>
      <div class="kp-shelfed-row"><span>${t('颜色')}</span><div class="kp-swatches">${SWATCHES.map(c => html`<button class="kp-sw${c === color ? ' kp-on' : ''}" data-act="shelfColor" data-c="${c}" style="background:${c}"></button>`)}
        <input type="color" data-field="shelfColor" value="${isHexColor(color) ? color : '#888888'}" title="${t('自定义颜色')}"></div></div>
      <div class="kp-shelfed-row"><span>${t('姿态')}</span><div class="kp-seg kp-seg-full">
        <button class="${lean === 1 ? 'kp-on' : ''}" data-act="shelfLean" data-lean="1">${t('向左靠')}</button>
        <button class="${!lean ? 'kp-on' : ''}" data-act="shelfLean" data-lean="0">${t('立着')}</button>
        <button class="${lean === -1 ? 'kp-on' : ''}" data-act="shelfLean" data-lean="-1">${t('向右靠')}</button></div></div>
      <div class="kp-shelfed-row"><span></span><div class="kp-shelfed-btns">
        <button class="${o.pull ? 'kp-on' : ''}" data-act="shelfPull">${t('抽出一点')}</button>
        <button class="${o.hide ? 'kp-on' : ''}" data-act="shelfHide"${b && !o.hide ? ` disabled title="${t('已绑定的书不能空出来，先解绑')}"` : ''}>${t('空出这一格')}</button>
        <button data-act="shelfReset"${Object.keys(o).length ? '' : ' disabled'}>${t('恢复默认')}</button></div></div>
      ${bindBtns ? html`<div class="kp-row">${bindBtns}</div>` : ''}`;
  }

  onAction(act: string, el: HTMLElement): boolean {
    if (!act.startsWith('shelf')) return false;
    const v = this.v, item = this.item(), slot = this.slot;
    switch (act) {
      case 'shelfEdit': {
        const sel = v.selected?.userData.item as PalaceItem | undefined;
        if (sel) this.show(sel, v.selectedSlot);
        break;
      }
      case 'shelfClose': this.close(); break;
      case 'shelfBook': this.slot = el.dataset.slot; this.render(); break;
      case 'shelfColor': if (slot) this.setOverride(slot, { c: el.dataset.c }); break;
      case 'shelfLean': if (slot) { const l = Number(el.dataset.lean); this.setOverride(slot, { lean: l === 1 || l === -1 ? l : undefined }); } break;
      case 'shelfPull': if (slot) this.setOverride(slot, { pull: !this.overrides()[slot]?.pull }); break;
      case 'shelfHide': if (slot) this.setOverride(slot, { hide: !this.overrides()[slot]?.hide }); break;
      case 'shelfReset': if (slot) this.setOverride(slot, null); break;
      case 'shelfResetAll':
        if (!item) break;
        item.params = { ...item.params };
        delete item.params.books;
        v.respawn(item);
        v.emitChange();
        this.render();
        break;
      case 'shelfBind':
        if (!item || !slot) break;
        if (slot.startsWith('doc:')) { v.bindDocBook(item, slot); this.render(); } else void v.pickAndBind(item, slot).then(() => this.render());
        break;
      case 'shelfUnbind': if (item && slot) { v.unbindLocus(item, slot); this.render(); } break;
      case 'shelfOpen': { const b = item && slot ? getBinding(item, slot) : null; if (b && v.isLocalNote(b)) v.host.openBlock?.(b.blockId, { side: true }); break; }
    }
    return true;
  }

  onInput(e: Event, commit: boolean): boolean {
    const el = e.target as HTMLInputElement;
    if (el.dataset.field !== 'shelfColor') return false;
    if (commit && this.slot && isHexColor(el.value)) this.setOverride(this.slot, { c: el.value });
    return true;
  }

  onGlobalKey(e: KeyboardEvent): boolean {
    if (this.open && e.key === 'Escape') { this.close(); return true; }
    return false;
  }
}
