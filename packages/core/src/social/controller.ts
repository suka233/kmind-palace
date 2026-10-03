import type { Friend, FriendRequest, Inbox, Notification, PublishedPalace, GuestbookEntry, Me, PetInfo, PetTrip, GuestPet } from '@kmind-palace/protocol';
import type { PalaceView } from '../view';
import type { PalaceDoc, PalaceItem, LocusBinding } from '../schema';
import { boundLoci, normalizePalace } from '../schema';
import { normalizeWorld, createWorld, type PalaceWorld } from '../world';
import { SocialApi, ApiError, type SocialAccount } from './api';
import { ICONS, escapeHtml, timeAgo } from '../icons';
import { html, rich } from '../dom';
import { RoomController } from './room';
import { catalogName } from '../catalog';
import { t, tc } from '../i18n';
import { petDisplayName } from '../companion';

/* =====================================================================
 * 串门（客户端界面）：
 *   小镇右上角「好友」：名字、好友码、加好友、好友请求、好友列表（去串门）、收件箱、换设备
 *   小镇宫殿卡片「分享给好友」：发布 / 更新 / 撤下、凭链接访问、带不带照片
 *   宫殿卡片里的记忆桩：「公开给好友」开关（只有公开的会出现在发布的副本里）
 *   参观时：顶部横幅（谁的世界、留言、返回）；宫殿里的留言板
 * 第一次点「开始使用」时才建匿名账号；没配置服务器时整个功能隐藏。
 * ===================================================================== */

const POLL_MS = 90e3;

export class SocialController {
  api: SocialApi | null = null;
  private account: SocialAccount | null = null;
  private me: Me | null = null;
  private friends: Friend[] = [];
  private requests: FriendRequest[] = [];
  private inbox: Inbox = { items: [], unread: 0 };
  private published = new Map<string, PublishedPalace>();
  private publishedLoaded = false;
  private busy = '';
  panelOpen = false;
  private guestOpen = false;
  private guestbook: GuestbookEntry[] = [];
  /** 留言板里正在写举报理由（Electron 里没有 prompt()，就地写） */
  private reporting = false;
  private guestPalace: string | null = null;
  private pairCode: { code: string; until: number } | null = null;
  private redeemOpen = false;
  private confirmRemove: string | null = null;
  private timer: number | null = null;
  private loaded = false;
  /** 实时房间（S2） */
  room: RoomController;
  /** 宠物串门（S3）：服务器上的宠物状态、最近的旅行、来我家做客的宠物 */
  petInfo: PetInfo | null = null;
  petTrips: PetTrip[] = [];
  guestPets: GuestPet[] = [];
  private petSaveTimer: number | null = null;
  private seenNotes = new Set<string>();

  constructor(private v: PalaceView) {
    this.buildUI();
    this.room = new RoomController(v, () => (this.account ? this.api : null));
    void this.init();
  }

  private get social() { return this.v.host.social; }
  get enabled() { return !!this.social?.serverUrl(); }
  get signedIn() { return !!this.account; }

  async init() {
    const s = this.social;
    if (!s) return;
    this.account = await s.loadAccount().catch(() => null);
    this.setupApi();
    this.loaded = true;
    this.updateButton();
    if (this.account) void this.refresh();
    this.timer = window.setInterval(() => { if (!document.hidden && this.account) void this.refreshInbox(); }, POLL_MS);
  }

  /** 服务器地址可能在设置里改了 */
  private setupApi() {
    const url = this.social?.serverUrl() || '';
    if (!url) { this.api = null; return; }
    if (this.api?.base === url.replace(/\/+$/, '')) return;
    this.api = new SocialApi(url, () => this.account, async (a) => {
      this.account = a;
      await this.social.saveAccount(a);
    });
  }

  dispose() { if (this.timer) window.clearInterval(this.timer); if (this.petSaveTimer) window.clearTimeout(this.petSaveTimer); this.room.dispose(); }

  /** 该不该连实时房间：在发布了的自己的宫殿里，或者在参观的好友宫殿里 */
  syncRoom() {
    const v = this.v;
    let want: string | null = null;
    if (this.api && this.account && v.level === 'palace' && v.doc) {
      if (v.visiting) want = v.doc.id;
      else { const p = this.published.get(v.doc.id); if (p && !p.takenDown) want = v.doc.id; }
    }
    this.room.sync(want);
  }

  /** 每帧（房间里别人的小人）；返回 true 需要渲染 */
  update(dt: number) { return this.room.update(dt); }

  onSelect(obj: import('three').Object3D | null, slot: string) { this.room.onSelect(obj, slot); }

  /** 离开宫殿：退出房间 */
  onPalaceLeft() { this.room.sync(null); }

  private fail(e: unknown) {
    const err = e as ApiError;
    if (err?.status === 401 && this.account) {
      this.v.host.notify?.(t('串门账号已失效（可能在别处退出或被封禁）。可以在「好友」里重新开始，或用配对码登录原来的账号'), 'error');
    } else this.v.host.notify?.(err?.message || (typeof e === 'string' ? e : t('出错了')), 'error');
  }

  async refresh() {
    this.setupApi();
    if (!this.api || !this.account) { this.render(); return; }
    try {
      const [me, friends, requests, inbox] = await Promise.all([this.api.me(), this.api.friends(), this.api.requests(), this.api.inbox()]);
      Object.assign(this, { me, friends, requests, inbox });
      if (this.account.name !== me.user.name) { this.account = { ...this.account, name: me.user.name, userId: me.user.id }; await this.social.saveAccount(this.account); }
      for (const n of inbox.items) this.seenNotes.add(n.id);
      await this.loadPublished();
      void this.refreshPet(true);
      void this.refreshGuests();
    } catch (e) { this.fail(e); }
    this.updateButton();
    this.render();
  }

  private async refreshInbox() {
    if (!this.api || !this.account) return;
    try {
      this.inbox = await this.api.inbox();
      // 新来的宠物消息：刷新宠物状态 / 来做客的宠物
      const fresh = this.inbox.items.filter(n => !this.seenNotes.has(n.id));
      for (const n of fresh) this.seenNotes.add(n.id);
      if (fresh.some(n => n.kind === 'pet_back')) void this.refreshPet();
      if (fresh.some(n => n.kind === 'pet_visit')) void this.refreshGuests();
      this.updateButton();
      if (this.panelOpen) this.render();
    } catch { /* 下次再试 */ }
  }

  private async loadPublished(force = false) {
    if (!this.api || !this.account || (this.publishedLoaded && !force)) return;
    try {
      const list = await this.api.myPalaces();
      this.published = new Map(list.map(p => [p.id, p]));
      this.publishedLoaded = true;
      this.syncRoom();
      this.v.townCtl.refresh();
    } catch { /* 卡片里显示「未发布」 */ }
  }

  // =====================================================================
  // UI 骨架
  // =====================================================================

  private buildUI() {
    const v = this.v;
    v.root.querySelector('.kp-topright')?.prepend(
      html`<button class="kp-friends-btn kp-glass kp-hidden" data-act="socOpen" data-ref="socBtn" title="${t('好友：加好友、去好友的宫殿串门')}">${rich(ICONS.users)}<span>${t('好友')}</span><i class="kp-badge kp-hidden" data-ref="socBadge"></i></button>`);
    v.root.append(html`
      <div class="kp-routes kp-social kp-glass kp-hidden kp-iso-only" data-ref="socPanel"></div>
      <div class="kp-routes kp-guestbook kp-glass kp-hidden kp-palace-only kp-iso-only" data-ref="guestPanel"></div>
      <div class="kp-visit-bar kp-glass kp-hidden" data-ref="visitBar"></div>`);
    v.root.querySelectorAll<HTMLElement>('[data-ref^="soc"], [data-ref="guestPanel"], [data-ref="visitBar"]').forEach(el => { v.ui[el.dataset.ref] = el; });
  }

  private updateButton() {
    const v = this.v, btn = v.ui.socBtn, badge = v.ui.socBadge;
    if (!btn) return;
    btn.classList.toggle('kp-hidden', !this.enabled || !!v.visiting);
    const n = this.inbox.unread + 0;
    badge.textContent = n > 9 ? '9+' : String(n);
    badge.classList.toggle('kp-hidden', !n);
  }

  togglePanel(open = !this.panelOpen) {
    this.panelOpen = open;
    this.v.ui.socPanel.classList.toggle('kp-hidden', !open);
    if (open) {
      this.v.townCtl.closePanels();
      this.v.closeSidePanels('social');
      this.render();
      void this.refresh();
    }
  }

  // =====================================================================
  // 好友面板
  // =====================================================================

  render() {
    if (!this.panelOpen) return;
    const el = this.v.ui.socPanel;
    const head = html`<div class="kp-routes-head"><b>${t('好友 · 串门')}</b><button class="kp-close" data-act="socClose">×</button></div>`;
    if (!this.enabled) {
      el.replaceChildren(html`${head}<div class="kp-empty">${t('还没有配置串门服务器。')}${this.v.host.openSettings ? t('在插件设置里填写服务器地址后就能加好友、互相参观宫殿。') : ''}</div>
        ${this.v.host.openSettings ? html`<div class="kp-route-go"><button data-act="socSettings">${t('打开设置')}</button></div>` : ''}`);
      return;
    }
    if (!this.account) {
      el.replaceChildren(html`${head}
        <div class="kp-empty">${t('加好友、去好友的宫殿串门、在信箱里留言。')}<br>${t('会自动给你建一个匿名账号（不用邮箱、手机号）；笔记本身永远不会上传，只有你主动发布的宫殿（和你标了「公开」的记忆桩）会给好友看到。')}</div>
        <div class="kp-route-go"><button class="kp-primary" data-act="socStart" ${this.busy ? 'disabled' : ''}>${this.busy || t('开始使用')}</button><button data-act="socRedeemOpen">${t('我有配对码')}</button></div>
        ${this.redeemOpen ? this.redeemForm() : ''}`);
      return;
    }
    const me = this.me;
    const typeText = (n: Notification) => this.notificationText(n);
    el.replaceChildren(html`${head}
      <div class="kp-soc-me">
        <input class="kp-route-name" data-field="socName" maxlength="20" spellcheck="false" placeholder="${t('你的名字')}">
        <div class="kp-soc-code"><span>${t('我的好友码')}</span><b>${me?.friendCode || '…'}</b>
          <button data-act="socCopyCode" title="${t('复制好友码')}">${tc('clipboard', '复制')}</button><button data-act="socRotate" title="${t('换一个好友码（旧的失效）')}">${t('换一个')}</button></div>
      </div>
      ${me?.announcement ? html`<div class="kp-soc-ann">📢 ${me.announcement}</div>` : ''}
      <div class="kp-route-pick"><input class="kp-route-name" data-field="socCode" placeholder="${t('输入好友码，例如 7F3K-9QXA')}" spellcheck="false"><button data-act="socAdd">${t('加好友')}</button></div>
      ${this.requests.length ? html`<div class="kp-route-sub">${t('好友请求')}</div>${this.requests.map(r => html`
        <div class="kp-journey-row"><span><b>${r.from.name}</b><small>${timeAgo(Date.parse(r.createdAt))}</small></span>
          <button data-act="socAccept" data-id="${r.id}">${t('同意')}</button><button class="kp-soc-ghost" data-act="socDecline" data-id="${r.id}">${t('拒绝')}</button></div>`)}` : ''}
      <div class="kp-route-sub">${t('好友 · {n}', { n: this.friends.length })}</div>
      ${this.friends.length ? this.friends.map(f => html`
        <div class="kp-journey-row"><span><b>${f.name}</b><small>${f.palaces ? t('发布了 {n} 座宫殿', { n: f.palaces }) : t('还没有发布宫殿')}</small></span>
          ${f.palaces ? html`<button data-act="socVisit" data-id="${f.id}">${t('去串门')}</button>` : ''}
          <button class="kp-soc-ghost" data-act="socRemove" data-id="${f.id}">${this.confirmRemove === f.id ? t('确认删除') : t('删除')}</button></div>`)
        : html`<div class="kp-route-stats">${t('把你的好友码发给朋友，或者输入朋友的好友码。')}</div>`}
      ${this.v.visiting ? '' : this.myPalacesSection()}
      ${this.petSection()}
      <div class="kp-route-sub">${t('消息')}${this.inbox.unread ? html` · <b class="kp-m-due">${t('{n} 条新消息', { n: this.inbox.unread })}</b>` : ''}${this.inbox.unread ? html` <button class="kp-soc-link" data-act="socRead">${t('全部已读')}</button>` : ''}</div>
      <div class="kp-soc-inbox">${this.inbox.items.length ? this.inbox.items.slice(0, 20).map(n => html`<div class="kp-soc-note${n.read ? '' : ' kp-unread'}"><span></span><small>${timeAgo(Date.parse(n.createdAt))}</small></div>`) : html`<div class="kp-route-stats">${t('还没有消息。')}</div>`}</div>
      <div class="kp-route-sub">${t('其他设备')}</div>
      ${this.pairCode && this.pairCode.until > Date.now() ? html`<div class="kp-soc-pair">${t('在另一台设备的「好友 → 我有配对码」里输入')}<b>${this.pairCode.code.replace(/(.{4})/, '$1 ')}</b><small>${t('10 分钟内有效，只能用一次')}</small></div>` : ''}
      <div class="kp-route-tools"><button data-act="socPair">${t('在其他设备登录…')}</button><button data-act="socRedeemOpen">${t('我有配对码')}</button></div>
      ${this.redeemOpen ? this.redeemForm() : ''}`);
    (el.querySelector('[data-field="socName"]') as HTMLInputElement).value = me?.user.name || this.account.name || '';
    el.querySelectorAll<HTMLElement>('.kp-soc-note span').forEach((s, i) => { s.textContent = typeText(this.inbox.items[i]); });
  }

  private redeemForm() {
    return html`<div class="kp-soc-redeem"><div class="kp-route-stats">${t('输入另一台设备上显示的 8 位配对码。')}${this.account ? t('登录后这台设备会换成那个账号（当前账号的好友不会合并过来）。') : ''}</div>
      <div class="kp-route-pick"><input class="kp-route-name" data-field="socRedeem" maxlength="12" placeholder="${t('例如 7F3K 9QXA')}" spellcheck="false"><button class="kp-primary" data-act="socRedeem">${t('登录')}</button></div></div>`;
  }

  private notificationText(n: Notification): string {
    const p = n.payload || {};
    switch (n.kind) {
      case 'friend_request': return t('{name} 想加你为好友', { name: p.from?.name });
      case 'friend_accepted': return t('{name} 和你成了好友', { name: p.friend?.name });
      case 'visit': return t('{name} 来参观了「{palace}」', { name: p.visitor?.name, palace: p.palace?.name });
      case 'guestbook': return t('{name} 在「{palace}」留言：{text}', { name: p.from?.name, palace: p.palace?.name, text: p.text });
      case 'pet_visit': return t('{name} 的{pet}来「{palace}」串门了', { name: p.owner?.name, pet: p.petName ? petDisplayName(p.petName) : t('宠物'), palace: p.palaceName });
      case 'pet_back': {
        const back = t('{pet}从 {host} 家回来了', { pet: p.petName ? petDisplayName(p.petName) : t('宠物'), host: p.host?.name });
        return p.souvenir?.title ? back + t('，带回了「{what}」', { what: p.souvenir.title }) : back;
      }
      case 'announcement': return `📢 ${p.text}`;
      case 'takedown': return p.reason ? t('「{palace}」被管理员下架了：{reason}', { palace: p.palace?.name, reason: p.reason }) : t('「{palace}」被管理员下架了', { palace: p.palace?.name });
      default: return n.kind;
    }
  }

  // =====================================================================
  // 宫殿卡片：分享给好友
  // =====================================================================

  /** 小镇宫殿卡片里的一节（自己的世界里才有） */
  publishSection(doc: PalaceDoc): DocumentFragment {
    if (!this.enabled || this.v.readonly) return html``;
    const p = this.published.get(doc.id);
    const shared = boundLoci(doc).filter(l => l.binding.share).length, total = boundLoci(doc).length;
    const lociLine = html`<div class="kp-note-sm">${total ? t('公开的记忆桩 {shared} / {total}：进宫殿点记忆桩，打开「公开给好友」才会带上它的标题和记忆故事。笔记本身不会上传。', { shared, total }) : t('公开的记忆桩 {shared} / {total}。笔记本身不会上传。', { shared, total })}</div>`;
    if (!this.account) return html`<div class="kp-subtitle">${t('分享给好友')}</div><div class="kp-note-sm">${t('在右上角「好友」里开始使用后，就能把宫殿发布给好友参观。')}</div>`;
    if (!p) {
      return html`<div class="kp-subtitle">${t('分享给好友')}</div>${lociLine}
        <div class="kp-row"><button class="kp-primary" data-act="socPublish" data-id="${doc.id}" ${this.busy ? 'disabled' : ''}>${this.busy === doc.id ? t('正在发布…') : t('发布给好友')}</button></div>`;
    }
    const stale = doc.updatedAt > p.sourceUpdatedAt;
    return html`<div class="kp-subtitle">${t('分享给好友')}</div>
      ${p.takenDown ? html`<div class="kp-note-sm kp-soc-down">${p.takedownReason ? t('已被管理员下架：{reason}', { reason: p.takedownReason }) : t('已被管理员下架')}</div>` : ''}
      <div class="kp-note-sm">${t('已发布')} · ${p.visibility === 'link' ? t('好友 + 凭链接') : t('只给好友')} · ${t('第 {v} 版', { v: p.version })} · ${t('{n} 次参观', { n: p.views })}${stale ? html` · <b class="kp-due-text">${t('有改动还没同步')}</b>` : ''}</div>
      ${lociLine}
      <label class="kp-soc-opt"><input type="checkbox" data-field="socLink" data-id="${doc.id}" ${p.visibility === 'link' ? 'checked' : ''}> ${t('允许凭链接访问（没装插件的人也能在网页上参观）')}</label>
      <label class="kp-soc-opt"><input type="checkbox" data-field="socPhotos" data-id="${doc.id}" ${p.photos ? 'checked' : ''}> ${t('带上自己的照片（画作、相框、海报、电视、配图）')}</label>
      <div class="kp-row">
        <button class="${stale ? 'kp-primary' : ''}" data-act="socPublish" data-id="${doc.id}" ${this.busy ? 'disabled' : ''}>${this.busy === doc.id ? t('正在同步…') : stale ? t('同步改动') : t('重新发布')}</button>
        ${p.visibility === 'link' ? html`<button data-act="socCopyLink" data-id="${doc.id}">${t('复制链接')}</button>` : ''}
        <button class="kp-danger" data-act="socUnpublish" data-id="${doc.id}">${t('撤下')}</button>
      </div>`;
  }

  /** 好友面板里的「我的宫殿」：一键发布 / 同步（更多选项在小镇的宫殿卡片上） */
  private myPalacesSection(): DocumentFragment | null {
    const docs = [...this.v.docs.values()];
    if (!docs.length) return null;
    const rows = docs.map(d => {
      const p = this.published.get(d.id);
      const stale = !!p && d.updatedAt > p.sourceUpdatedAt;
      const state = !p ? t('还没发布') : p.takenDown ? t('已被管理员下架') : `${t('已发布')} · ${p.visibility === 'link' ? t('好友 + 链接') : t('只给好友')}${stale ? ' · ' + t('有改动没同步') : ''}`;
      const id = d.id;
      const btn = this.busy === d.id ? html`<button disabled>${t('正在发布…')}</button>`
        : !p ? html`<button data-act="socPublish" data-id="${id}" ${this.busy ? 'disabled' : ''}>${t('发布')}</button>`
        : stale ? html`<button data-act="socPublish" data-id="${id}" ${this.busy ? 'disabled' : ''}>${t('同步改动')}</button>`
        : p.visibility === 'link' ? html`<button class="kp-soc-ghost" data-act="socCopyLink" data-id="${id}">${t('复制链接')}</button>` : '';
      return html`<div class="kp-journey-row"><span><b>${d.name}</b><small>${state}</small></span>${btn}</div>`;
    });
    return html`<div class="kp-route-sub">${t('我的宫殿 · 发布给好友')}</div>${rows}
      <div class="kp-route-stats">${t('发布后好友能来参观、留言，你们的小管家也能互相串门。凭链接访问、带照片、撤下在小镇里单击宫殿的卡片上设置。')}</div>`;
  }

  /** 宫殿里记忆桩卡片上的「公开给好友」开关 */
  shareToggle(b: LocusBinding | null): DocumentFragment {
    if (!this.enabled || this.v.readonly || !b?.blockId) return html``;
    return html`<button class="kp-soc-share${b.share ? ' kp-on' : ''}" data-act="socShare" title="${t('公开后，发布这座宫殿时好友能看到这个记忆桩的标题和记忆故事（笔记本身不会上传）')}">${b.share ? '🔓 ' + t('已公开给好友') : '🔒 ' + t('只有自己看得到')}</button>`;
  }

  /** 宫殿标题栏的「留言」按钮：参观时，或者自己的宫殿已发布 */
  canGuestbook() {
    const doc = this.v.doc;
    if (!doc || !this.enabled || !this.account) return false;
    return !!this.v.visiting || this.published.has(doc.id);
  }

  // =====================================================================
  // 动作
  // =====================================================================

  onAction(act: string, el: HTMLElement): boolean {
    if (this.room.onAction(act, el)) return true;
    if (!act.startsWith('soc') && !act.startsWith('guest') && act !== 'visitLeave') return false;
    const id = el.dataset.id;
    switch (act) {
      case 'socOpen': this.togglePanel(); break;
      case 'socPetSend': void this.sendPet(); break;
      case 'socClose': this.togglePanel(false); break;
      case 'socSettings': this.v.host.openSettings?.(); break;
      case 'socStart': void this.start(); break;
      case 'socRedeemOpen': this.redeemOpen = !this.redeemOpen; this.render(); break;
      case 'socRedeem': void this.redeem(); break;
      case 'socCopyCode': void this.copy(this.me?.friendCode || '', t('好友码已复制')); break;
      case 'socRotate': void this.run(async () => { const r = await this.api.rotateFriendCode(); this.me = { ...this.me, friendCode: r.friendCode }; this.v.host.notify?.(t('换了新的好友码，旧的已失效')); }); break;
      case 'socAdd': void this.addFriend(); break;
      case 'socAccept': case 'socDecline': void this.run(async () => { await this.api.respond(id, act === 'socAccept'); await this.refresh(); }); break;
      case 'socRemove':
        if (this.confirmRemove !== id) { this.confirmRemove = id; this.render(); break; }
        this.confirmRemove = null;
        void this.run(async () => { await this.api.removeFriend(id); await this.refresh(); });
        break;
      case 'socVisit': void this.visitFriend(id); break;
      case 'socRead': void this.run(async () => { await this.api.markRead(); await this.refreshInbox(); }); break;
      case 'socPair': void this.run(async () => { this.pairCode = { code: await this.api.pairingCode(), until: Date.now() + 10 * 60e3 }; }); break;
      case 'socPublish': void this.publish(id); break;
      case 'socUnpublish': void this.unpublish(id); break;
      case 'socCopyLink': { const p = this.published.get(id); if (p) void this.copy(p.shareUrl, t('链接已复制：发给朋友，在浏览器里就能参观')); break; }
      case 'socShare': this.toggleShare(); break;
      case 'visitLeave': this.v.leaveVisit(); break;
      case 'guestOpen': void this.openGuestbook(); break;
      case 'guestClose': this.closeGuestbook(); break;
      case 'guestSend': void this.sendGuestbook(); break;
      case 'guestDelete': void this.run(async () => { await this.api.deleteGuestbook(id); await this.loadGuestbook(); }); break;
      case 'guestReport': this.reporting = true; this.renderGuestbook(); break;
      case 'guestReportCancel': this.reporting = false; this.renderGuestbook(); break;
      case 'guestReportSend': void this.report(); break;
    }
    return true;
  }

  onInput(e: Event, commit: boolean): boolean {
    if (this.room.onInput(e, commit)) return true;
    const el = e.target as HTMLInputElement, f = el.dataset.field;
    if (!f?.startsWith('soc') && !f?.startsWith('guest')) return false;
    if (!commit) return true;
    if (f === 'socName') {
      const name = el.value.trim();
      if (name && name !== this.me?.user.name) void this.run(async () => { await this.api.rename(name); this.me = { ...this.me, user: { ...this.me.user, name } }; });
    } else if (f === 'socLink' || f === 'socPhotos') {
      const p = this.published.get(el.dataset.id);
      if (p) void this.publish(el.dataset.id, { visibility: f === 'socLink' ? (el.checked ? 'link' : 'friends') : p.visibility, photos: f === 'socPhotos' ? el.checked : p.photos });
    }
    return true;
  }

  /** 输入框里按回车 */
  onKey(e: KeyboardEvent): boolean {
    if (this.room.onKey(e)) return true;
    const el = e.target as HTMLInputElement;
    if (e.key !== 'Enter') return false;
    if (el.dataset?.field === 'socCode') { void this.addFriend(); return true; }
    if (el.dataset?.field === 'socRedeem') { void this.redeem(); return true; }
    return false;
  }

  private async run(fn: () => Promise<void>) {
    if (!this.api) return;
    try { await fn(); } catch (e) { this.fail(e); }
    this.render();
  }

  private async copy(text: string, msg: string) {
    try { await navigator.clipboard.writeText(text); this.v.host.notify?.(msg); } catch { this.v.host.notify?.(text); }
  }

  private async start() {
    this.setupApi();
    if (!this.api) return;
    this.busy = t('正在创建账号…');
    this.render();
    try {
      await this.api.ensureAccount();
      await this.refresh();
      this.v.host.notify?.(t('好了！把好友码发给朋友，就能互相串门'));
    } catch (e) { this.fail(e); }
    this.busy = '';
    this.render();
  }

  private async redeem() {
    this.setupApi();
    const input = this.v.ui.socPanel.querySelector<HTMLInputElement>('[data-field="socRedeem"]');
    const code = input?.value.trim();
    if (!this.api || !code) return;
    try {
      await this.api.redeem(code);
      this.redeemOpen = false;
      this.publishedLoaded = false;
      await this.refresh();
      this.v.host.notify?.(t('已登录：{name}', { name: this.me?.user.name }));
    } catch (e) { this.fail(e); }
  }

  private async addFriend() {
    const input = this.v.ui.socPanel.querySelector<HTMLInputElement>('[data-field="socCode"]');
    const code = input?.value.trim();
    if (!code || !this.api) return;
    await this.run(async () => {
      const r = await this.api.addFriend(code);
      this.v.host.notify?.(r.status === 'friends' ? t('你和 {name} 成了好友', { name: r.friend.name }) : t('已向 {name} 发送好友请求，等对方同意', { name: r.friend.name }));
      await this.refresh();
    });
  }

  // ---------------- 发布 ----------------

  private async loadMediaBlob(id: string) {
    const url = await this.v.mediaUrl(id);
    return (await fetch(url)).blob();
  }

  async publish(id: string, opts?: { visibility: 'friends' | 'link'; photos: boolean }) {
    const doc = this.v.docs.get(id);
    if (!doc || !this.api || this.busy) return;
    const cur = this.published.get(id);
    const o = opts || { visibility: cur?.visibility || 'friends', photos: cur?.photos ?? false };
    this.busy = id;
    this.v.townCtl.refresh();
    this.render();
    try {
      const p = await this.api.publish(doc, o, (m) => this.loadMediaBlob(m));
      this.published.set(id, p);
      this.syncRoom();
      await this.api.putWorld(this.v.world);
      this.v.host.notify?.(cur ? t('已同步到好友那边') : t('「{name}」已发布：好友在「好友 → 去串门」里就能看到', { name: doc.name }));
    } catch (e) { this.fail(e); }
    this.busy = '';
    this.v.townCtl.refresh();
    this.render();
  }

  private async unpublish(id: string) {
    if (!this.api) return;
    try {
      await this.api.unpublish(id);
      this.published.delete(id);
      this.syncRoom();
      await this.api.putWorld(this.v.world);
      this.v.host.notify?.(t('已撤下，好友和链接都看不到了'));
    } catch (e) { this.fail(e); }
    this.v.townCtl.refresh();
  }

  private toggleShare() {
    const v = this.v, sel = v.selected;
    if (!sel) return;
    const item = sel.userData.item as PalaceItem, slot = v.selectedSlot;
    const b = item.bindings?.[slot];
    if (!b) return;
    if (b.share) delete b.share; else b.share = true;
    v.emitChange();
    v.showCard(sel);
    if (this.published.has(v.doc.id)) v.host.notify?.(b.share ? t('已公开：回到小镇在宫殿卡片里「同步改动」后好友就能看到') : t('已设为只有自己看得到：记得同步改动'));
  }

  // ---------------- 参观 ----------------

  async visitFriend(userId: string) {
    if (!this.api) return;
    try {
      const fw = await this.api.friendWorld(userId);
      const docs: PalaceDoc[] = [];
      for (const p of fw.palaces) {
        try { docs.push(normalizePalace((await this.api.palace(p.id)).doc)); } catch { /* 读不了的跳过 */ }
      }
      if (!docs.length) { this.v.host.notify?.(t('{name} 还没有发布宫殿', { name: fw.owner.name })); return; }
      let world: PalaceWorld;
      try { world = fw.world ? normalizeWorld(fw.world) : createWorld(); } catch { world = createWorld(); }
      world.name = t('{name} 的世界', { name: fw.owner.name });
      this.togglePanel(false);
      this.v.visit({ owner: fw.owner, world, docs, mediaUrl: (m) => this.api.mediaUrl(m) });
      this.v.host.notify?.(t('来到 {name} 的世界：双击宫殿进去参观，在宫殿里可以留言', { name: fw.owner.name }));
    } catch (e) { this.fail(e); }
  }

  /** 进出参观时：横幅、按钮 */
  /** 小管家换装、改名：同步到服务器（宠物出门、串门时别人看到的样子） */
  onPetChanged() {
    this.room.hello();
    // 换装、改名：攒一会儿再同步到服务器
    if (this.petSaveTimer) window.clearTimeout(this.petSaveTimer);
    this.petSaveTimer = window.setTimeout(() => { this.petSaveTimer = null; void this.pushPet(); }, 1500);
  }

  // =====================================================================
  // 宠物串门（S3）
  // =====================================================================

  /** 小管家正在别人家玩 */
  get petAway() {
    const t = this.petInfo?.trip;
    return !!t && t.status === 'out';
  }

  private async pushPet() {
    if (!this.api || !this.account) return;
    const pet = this.v.companion.pet;
    try { await this.api.savePet(pet.name, pet.look); } catch { /* 下次改动时再同步 */ }
  }

  /** 拉一次宠物状态；sync 时把本机的外观推上去（本机为准） */
  async refreshPet(sync = false) {
    if (!this.api || !this.account) return;
    const wasAway = this.petAway;
    try {
      const [info, trips] = await Promise.all([this.api.pet(), this.api.trips()]);
      this.petInfo = info;
      this.petTrips = trips;
      const pet = this.v.companion.pet;
      if (sync && (info.name !== pet.name || JSON.stringify(info.look) !== JSON.stringify(pet.look))) await this.pushPet();
    } catch { return; }
    const back = wasAway && !this.petAway ? this.petTrips.find(t => t.status === 'back') : null;
    this.v.companion.onPetStatus(back || null);
  }

  /** 在自己的宫殿里：来做客的别人的宠物 */
  async refreshGuests() {
    const v = this.v;
    if (!this.api || !this.account || v.visiting || v.level !== 'palace' || !v.doc) { v.companion.setGuests([]); return; }
    try { this.guestPets = await this.api.guests(); } catch { return; }
    if (v.doc && !v.visiting) v.companion.setGuests(this.guestPets.filter(g => g.palaceId === v.doc.id));
  }

  /** 让小管家出门去好友家 */
  async sendPet(friendId?: string) {
    if (!this.api || !this.account) { this.v.host.notify?.(t('先在「好友」里开始使用串门，小管家才能出门')); return; }
    try {
      const trip = await this.api.sendPet(friendId);
      const mins = Math.round((Date.parse(trip.returnsAt) - Date.now()) / 60e3);
      this.v.host.notify?.(t('{pet} 出门去 {host} 的「{palace}」玩了，大约 {n} 分钟后回来', { pet: this.v.companion.petName, host: trip.host.name, palace: trip.palaceName, n: mins }));
      await this.refreshPet();
      this.v.companion.leaveHome();
    } catch (e) { this.fail(e); }
  }

  /** 小管家面板里的「出门」一节 */
  petSection(): DocumentFragment {
    if (!this.enabled) return html``;
    if (!this.account) return html`<div class="kp-route-sub">${t('出门串门')}</div><div class="kp-route-stats">${t('在「好友」里开始使用后，它可以自己去好友的宫殿玩，带回纪念品。')}</div>`;
    const info = this.petInfo, trip = info?.trip;
    const souvenirs = this.petTrips.filter(x => x.status === 'back' && x.souvenir).slice(0, 3);
    const mins = trip ? Math.max(1, Math.round((Date.parse(trip.returnsAt) - Date.now()) / 60e3)) : 0;
    return html`<div class="kp-route-sub">${t('出门串门')}</div>
      ${trip ? html`<div class="kp-pet-trip">${rich(t('正在 <b>{host}</b> 的「{palace}」玩，大约 {n} 分钟后回来', { host: escapeHtml(trip.host.name), palace: escapeHtml(trip.palaceName), n: mins }))}</div>`
        : html`<div class="kp-route-go"><button class="kp-primary" data-act="socPetSend" ${info && !info.tripsLeft ? 'disabled' : ''}>${t('让它去好友家玩')}</button></div>
           <div class="kp-route-stats">${info ? t('今天还能出门 {n} 次。', { n: info.tripsLeft }) : ''}${t('它会随机去一位好友发布的宫殿，回来时带一个纪念品。')}</div>`}
      ${souvenirs.length ? html`<div class="kp-route-sub">${t('带回来的纪念品')}</div>${souvenirs.map(x => html`<div class="kp-pet-souvenir"><b>${x.souvenir.title || this.placeName(x.souvenir.place) || t('一段回忆')}</b><small>${t('来自 {host} 的「{palace}」', { host: x.host.name, palace: x.palaceName })}${x.souvenir.place ? ` · ${this.placeName(x.souvenir.place)}` : ''}</small>${x.souvenir.story ? html`<p>${x.souvenir.story}</p>` : ''}</div>`)}` : ''}`;
  }

  /** 纪念品里的地点：物件名，或者物件类型（换成目录里的中文名） */
  placeName(p?: string) {
    if (!p) return '';
    return catalogName(this.v.catalog, p);
  }

  onVisitChanged() {
    const v = this.v, bar = v.ui.visitBar;
    this.closeGuestbook();
    this.syncRoom();
    this.updateButton();
    if (!v.visiting) { bar.classList.add('kp-hidden'); return; }
    bar.classList.remove('kp-hidden');
    bar.replaceChildren(html`<span>🏝 ${rich(t('正在参观 <b></b> 的世界'))}</span><button class="kp-primary" data-act="visitLeave">${t('返回我的世界')}</button>`);
    bar.querySelector('b').textContent = v.visiting.owner.name;
  }

  /** 进了某座宫殿：标题栏的「留言」按钮 */
  onPalaceEntered() {
    this.closeGuestbook();
    this.syncRoom();
    void this.refreshGuests();
    const btn = this.v.ui.guestBtn;
    if (btn) btn.classList.toggle('kp-hidden', !this.canGuestbook());
  }

  // ---------------- 留言 ----------------

  private async openGuestbook() {
    const v = this.v;
    if (!v.doc || !this.api) return;
    v.closeSidePanels('guest');
    this.guestOpen = true;
    this.reporting = false;
    this.guestPalace = v.doc.id;
    v.ui.guestPanel.classList.remove('kp-hidden');
    if (v.recall.panelOpen) v.recall.togglePanel(false);
    if (v.numbers.panelOpen) v.numbers.togglePanel(false);
    this.renderGuestbook(true);
    await this.loadGuestbook();
  }

  closeGuestbook() {
    this.guestOpen = false;
    this.v.ui.guestPanel?.classList.add('kp-hidden');
  }

  private async loadGuestbook() {
    if (!this.api || !this.guestPalace) return;
    try { this.guestbook = await this.api.guestbook(this.guestPalace); } catch (e) { this.fail(e); this.guestbook = []; }
    this.renderGuestbook();
  }

  private renderGuestbook(loading = false) {
    if (!this.guestOpen) return;
    const v = this.v, el = v.ui.guestPanel;
    const mine = !v.visiting;
    el.replaceChildren(html`
      <div class="kp-routes-head"><b>📮 ${t('留言板')}</b><button class="kp-close" data-act="guestClose">×</button></div>
      <div class="kp-route-stats">${mine ? t('好友来参观时在这里给你留言。') : t('给 {name} 留句话吧。', { name: v.visiting.owner.name })}</div>
      <div class="kp-soc-guest">${loading ? html`<div class="kp-route-stats">${t('正在读取…')}</div>` : this.guestbook.length ? this.guestbook.map(g => html`
        <div class="kp-soc-gb${g.hidden ? ' kp-off' : ''}"><div><b>${g.author.name}</b><small>${timeAgo(Date.parse(g.createdAt))}</small>
          ${g.mine || mine ? html`<button class="kp-soc-link" data-act="guestDelete" data-id="${g.id}">${t('删除')}</button>` : ''}</div><p></p></div>`) : html`<div class="kp-route-stats">${t('还没有留言。')}</div>`}</div>
      ${this.reporting && v.visiting ? html`<div class="kp-route-stats">${t('举报这座宫殿的原因（广告 / 骚扰 / 违法 / 侵犯隐私 / 其他），可以写几句说明：')}</div>
      <textarea class="kp-num-digits" data-field="reportText" rows="3" maxlength="500"></textarea>
      <div class="kp-route-go"><button class="kp-danger" data-act="guestReportSend">${t('举报')}</button><button class="kp-soc-ghost" data-act="guestReportCancel">${t('取消')}</button></div>`
      : v.visiting || mine ? html`<textarea class="kp-num-digits" data-field="guestText" rows="2" maxlength="300" placeholder="${t('写点什么…（300 字以内）')}"></textarea>
      <div class="kp-route-go"><button class="kp-primary" data-act="guestSend">${tc('submit', '留言')}</button>${v.visiting ? html`<button class="kp-soc-ghost" data-act="guestReport" title="${t('这座宫殿有不当内容')}">${t('举报')}</button>` : ''}</div>` : ''}`);
    el.querySelectorAll<HTMLElement>('.kp-soc-gb p').forEach((p, i) => { p.textContent = this.guestbook[i].text; });
  }

  private async sendGuestbook() {
    const ta = this.v.ui.guestPanel.querySelector<HTMLTextAreaElement>('[data-field="guestText"]');
    const text = ta?.value.trim();
    if (!text || !this.api || !this.guestPalace) return;
    try {
      await this.api.postGuestbook(this.guestPalace, text);
      await this.loadGuestbook();
    } catch (e) { this.fail(e); }
  }

  private async report() {
    if (!this.api || !this.guestPalace) return;
    const reason = this.v.ui.guestPanel.querySelector<HTMLTextAreaElement>('[data-field="reportText"]')?.value.trim() || '';
    try {
      await this.api.report(this.guestPalace, 'other', reason.slice(0, 500));
      this.v.host.notify?.(t('已举报，管理员会尽快处理'));
      this.reporting = false;
      this.renderGuestbook();
    } catch (e) { this.fail(e); }
  }

  /** 收件箱有没有未读（宫殿标题栏、小镇按钮上的红点） */
  get unread() { return this.inbox.unread; }
  get ready() { return this.loaded; }
}
