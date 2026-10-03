import type { PalaceView } from './view';
import type { PalaceJourney } from './world';
import { AUTO_ROUTE_ID, routesOf, isDue, needsPractice } from './route';
import { resolveJourney, createJourney, deleteJourney } from './journey';
import { html } from './dom';
import { t } from './i18n';

/* =====================================================================
 * 小镇里的「旅程」面板：新建 / 改名 / 删除旅程，按顺序添加各座宫殿的路线，开始回忆。
 * 打开时小镇名牌上标出每座宫殿在旅程里是第几段。
 * ===================================================================== */

export class JourneyPanel {
  open = false;
  private currentId: string | null = null;
  /** 「添加一段」里选中的宫殿 */
  private addPalace: string | null = null;
  private confirmDelete = false;

  constructor(private v: PalaceView, private el: HTMLElement) { }

  private get list() { return this.v.world.journeys || []; }

  current(): PalaceJourney | undefined {
    return this.list.find(j => j.id === this.currentId) || this.list[0];
  }

  /** 名牌上的段号：这座宫殿是当前旅程的第几段（可能有多段） */
  orderOf(palaceId: string): number[] {
    if (!this.open) return [];
    const j = this.current();
    return j ? j.legs.flatMap((l, i) => (l.palaceId === palaceId ? [i + 1] : [])) : [];
  }

  toggle(open = !this.open) {
    this.open = open;
    this.confirmDelete = false;
    this.el.classList.toggle('kp-hidden', !open);
    if (open) this.render();
  }

  private changed() {
    this.v.worldChanged();
    if (this.open) this.render();
  }

  render() {
    if (!this.open) return;
    const v = this.v, list = this.list, cur = this.current();
    const docs = [...v.docs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!this.addPalace || !v.docs.has(this.addPalace)) this.addPalace = docs[0]?.id || null;
    const addDoc = this.addPalace ? v.docs.get(this.addPalace) : null;
    const addRoutes = addDoc ? routesOf(addDoc, v.slotSort) : [];
    const routeOpts = [
      ...addRoutes.filter(r => r.id !== AUTO_ROUTE_ID).map(r => html`<option value="${r.id}">${r.name}${t('（{n} 站）', { n: r.stops.length })}</option>`),
      html`<option value="${AUTO_ROUTE_ID}">${t('全部记忆桩')}${t('（按位置）')}</option>`,
    ];
    const legs = cur ? resolveJourney(cur, v.docs, v.slotSort) : [];
    const bound = legs.flatMap(l => l.stops.filter(s => s.binding));
    const levels = bound.map(s => v.memoryOf(s.binding.blockId));
    const due = levels.filter(isDue).length, practice = levels.filter(needsPractice).length;
    const palaces = new Set(legs.filter(l => l.doc).map(l => l.palaceId)).size;
    this.el.replaceChildren(html`
      <div class="kp-routes-head"><b>${t('旅程 · 跨宫殿路线')}</b><button class="kp-close" data-act="viewMap">×</button></div>
      ${list.length ? html`
      <div class="kp-route-pick">
        <select data-field="journey">${list.map(j => html`<option value="${j.id}"${j === cur ? ' selected' : ''}>${j.name}</option>`)}
          <option value="__new">${t('＋ 新建旅程')}</option></select>
        <button data-act="jpDelete" class="kp-danger">${this.confirmDelete ? t('确认删除') : t('删除')}</button>
      </div>
      <input class="kp-route-name" data-field="journeyName" maxlength="30" spellcheck="false">
      <div class="kp-route-stats">${t('{n} 段', { n: legs.length })} · ${t('{n} 座宫殿', { n: palaces })} · ${t('{n} 站', { n: bound.length })}${due ? html` · <b class="kp-m-due">${t('待复习 {n}', { n: due })}</b>` : ''}</div>
      <div class="kp-route-go">
        <button class="kp-primary" data-act="jpStart"${bound.length ? '' : ' disabled'}>${t('开始回忆')}</button>
        <button data-act="jpPractice"${practice ? '' : ' disabled'} title="${t('跳过记得牢的记忆桩')}">${t('只练需要练的 · {n}', { n: practice })}</button>
      </div>
      <div class="kp-stops">${legs.length ? legs.map((l, i) => {
        const n = l.stops.filter(s => s.binding).length;
        const ld = l.stops.filter(s => s.binding && isDue(v.memoryOf(s.binding.blockId))).length;
        const sub = !l.doc ? t('这座宫殿已被删除') : !l.route ? t('这条路线已被删除') : `${l.route.name} · ${t('{n} 站', { n })}${ld ? ` · ${t('待复习 {n}', { n: ld })}` : ''}`;
        return html`<div class="kp-stop-row${l.doc && l.route && n ? '' : ' kp-off'}">
          <button class="kp-stop-go" data-act="jpEnter" data-i="${i}" title="${t('进入这座宫殿')}"><i class="kp-dot kp-m-${ld ? 'due' : 'fresh'}">${i + 1}</i><span><b>${l.doc?.name || t('（已删除）')}</b><small>${sub}</small></span></button>
          <button class="kp-mini-btn" data-act="jpUp" data-i="${i}" title="${t('往前挪')}"${i ? '' : ' disabled'}>↑</button>
          <button class="kp-mini-btn" data-act="jpDown" data-i="${i}" title="${t('往后挪')}"${i < legs.length - 1 ? '' : ' disabled'}>↓</button>
          <button class="kp-mini-btn" data-act="jpDel" data-i="${i}" title="${t('移出旅程')}">×</button>
        </div>`;
      }) : html`<div class="kp-empty">${t('还没有添加宫殿。在下面选一座宫殿和它的一条路线，按顺序加进来。')}</div>`}</div>
      ${docs.length ? html`<div class="kp-jp-add">
        <div class="kp-route-sub">${t('添加一段')}</div>
        <div class="kp-route-pick"><select data-field="jpPalace">${docs.map(d => html`<option value="${d.id}"${d.id === this.addPalace ? ' selected' : ''}>${d.name}</option>`)}</select></div>
        <div class="kp-route-pick"><select data-field="jpRoute">${routeOpts}</select><button data-act="jpAdd">${t('添加')}</button></div>
      </div>` : ''}` : html`
      <div class="kp-empty">${t('旅程把几座宫殿里的路线按顺序串起来：回忆时一座宫殿走完，会接着去下一座，一次复习完一整门课。')}</div>
      <div class="kp-route-go"><button class="kp-primary" data-act="jpNew">${t('＋ 新建旅程')}</button></div>`}`);
    const name = this.el.querySelector<HTMLInputElement>('[data-field="journeyName"]');
    if (name && cur) name.value = cur.name;
  }

  onAction(act: string, el: HTMLElement): boolean {
    if (!act.startsWith('jp')) return false;
    const v = this.v, cur = this.current(), i = Number(el.dataset.i);
    if (act !== 'jpDelete') this.confirmDelete = false;
    switch (act) {
      case 'jpNew': { const j = createJourney(v.world); this.currentId = j.id; this.changed(); break; }
      case 'jpDelete':
        if (!cur) break;
        if (!this.confirmDelete) { this.confirmDelete = true; this.render(); break; }
        this.confirmDelete = false;
        deleteJourney(v.world, cur.id);
        this.currentId = null;
        v.host.notify?.(t('已删除旅程「{name}」', { name: cur.name }));
        this.changed();
        break;
      case 'jpStart': case 'jpPractice':
        if (!cur) break;
        this.toggle(false);
        v.recall.startJourney(cur.id, act === 'jpPractice');
        break;
      case 'jpEnter': {
        const leg = cur?.legs[i];
        if (leg && v.docs.has(leg.palaceId)) { this.toggle(false); v.enterPalace(leg.palaceId); }
        break;
      }
      case 'jpUp': case 'jpDown': {
        const j = i + (act === 'jpUp' ? -1 : 1);
        if (!cur || j < 0 || j >= cur.legs.length) break;
        [cur.legs[i], cur.legs[j]] = [cur.legs[j], cur.legs[i]];
        this.changed();
        break;
      }
      case 'jpDel':
        if (!cur) break;
        cur.legs.splice(i, 1);
        this.changed();
        break;
      case 'jpAdd': {
        const route = this.el.querySelector<HTMLSelectElement>('[data-field="jpRoute"]')?.value;
        if (!cur || !this.addPalace || !route) break;
        cur.legs.push({ palaceId: this.addPalace, routeId: route });
        this.changed();
        break;
      }
    }
    return true;
  }

  onInput(e: Event, commit: boolean): boolean {
    const el = e.target as HTMLInputElement | HTMLSelectElement, f = el.dataset.field;
    if (f === 'journey') {
      if (!commit) return true;
      if (el.value === '__new') { const j = createJourney(this.v.world); this.currentId = j.id; this.changed(); } else { this.currentId = el.value; this.confirmDelete = false; this.v.townCtl.refresh(); this.render(); }
      return true;
    }
    if (f === 'journeyName') {
      const cur = this.current(), name = el.value.trim();
      if (commit && cur && name && name !== cur.name) { cur.name = name; this.changed(); }
      return true;
    }
    if (f === 'jpPalace') {
      if (commit) { this.addPalace = el.value; this.render(); }
      return true;
    }
    return f === 'jpRoute';
  }
}
