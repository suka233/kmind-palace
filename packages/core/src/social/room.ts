import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Peer, PeerState, RoomServerMsg, RoomClientMsg } from '@kmind-palace/protocol';
import type { PalaceView } from '../view';
import { Character } from '../avatar';
import { cleanLook } from '../look';
import { locusKey, parseLocus } from '../schema';
import { escapeHtml } from '../icons';
import { itemDisplayName } from '../build';
import { t } from '../i18n';
import type { SocialApi } from './api';

/* =====================================================================
 * 实时房间（S2，客户端）：
 *   在一座发布了的宫殿里（自己的，或者正在参观的好友的），连上这座宫殿的房间，
 *   彼此的小管家就是各自的小人：看到对方走动、挥手、冒表情和聊天气泡。
 *   主人可以「带大家参观」：选中哪件东西，客人的镜头就跟过去（客人可以关掉跟随）。
 *   参观时（或有客人在时）点地板，自己的小人走过去。
 * ===================================================================== */

const EMOTES: Record<string, string> = { wave: '👋', heart: '❤️', laugh: '😂', clap: '👏', question: '❓', idea: '💡' };
const SCALE = 1.6;
const SEND_MS = 200;

type Status = 'idle' | 'connecting' | 'open' | 'closed';

/** WebSocket 连接：断了自动重连（指数退避）；被踢 / 满员 / 进不去时不再重连 */
class RoomSocket {
  ws: WebSocket | null = null;
  status: Status = 'idle';
  private retry = 0;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private url: () => string, private onMsg: (m: RoomServerMsg) => void, private onStatus: (s: Status, why?: string) => void) { }

  connect() {
    this.stopped = false;
    let opened = false;
    this.setStatus('connecting');
    let ws: WebSocket;
    try { ws = this.ws = new WebSocket(this.url()); } catch { this.scheduleRetry(); return; }
    ws.onopen = () => {
      opened = true;
      this.retry = 0;
      this.failures = 0;
      this.setStatus('open');
      this.ping = setInterval(() => this.send({ t: 'ping' }), 25e3);
    };
    ws.onmessage = (e) => {
      let m: RoomServerMsg;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      this.onMsg(m);
    };
    ws.onclose = (e) => {
      if (this.ping) { clearInterval(this.ping); this.ping = null; }
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      // 4001 被管理员踢出 / 4002 别处登录了 / 4003 满员：不重连
      if (e.code >= 4001 && e.code <= 4003) { this.setStatus('closed', e.code === 4003 ? t('房间满了') : e.code === 4002 ? t('你在另一个窗口进了这座宫殿') : t('已离开房间')); return; }
      if (!opened && ++this.failures >= 3) { this.setStatus('closed', t('连不上实时房间')); return; }
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    this.setStatus('connecting');
    const ms = Math.min(30e3, 1000 * 2 ** this.retry++);
    this.timer = setTimeout(() => { this.timer = null; if (!this.stopped) this.connect(); }, ms);
  }

  private setStatus(s: Status, why?: string) {
    this.status = s;
    this.onStatus(s, why);
  }

  send(m: RoomClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    this.stopped = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.ping) { clearInterval(this.ping); this.ping = null; }
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(1000); } catch { /* 已断 */ }
    this.status = 'idle';
  }
}

/** 房间里别人的小人 */
interface Avatar {
  peer: Peer;
  ch: Character;
  name: CSS2DObject;
  bubble: CSS2DObject;
  bubbleUntil: number;
  target: PeerState | null;
}

export class RoomController {
  palaceId: string | null = null;
  private sock: RoomSocket | null = null;
  private you = '';
  private avatars = new Map<string, Avatar>();
  private group = new THREE.Group();
  private time = 0;
  private lastSent = 0;
  private lastState = '';
  private log: { who: string; text: string }[] = [];
  /** 主人：带大家参观 */
  guiding = false;
  /** 客人：跟着主人的镜头 */
  following = true;
  private ownerOnline = false;
  private why = '';

  constructor(private v: PalaceView, private api: () => SocialApi | null) {
    this.group.name = 'kp-peers';
    v.scene.add(this.group);
    v.root.insertAdjacentHTML('beforeend', `<div class="kp-live kp-glass kp-hidden kp-palace-only kp-iso-only" data-ref="room"></div>`);
    v.ui.room = v.root.querySelector('[data-ref="room"]') as HTMLElement;
  }

  get peers() { return this.avatars.size; }
  get open() { return this.sock?.status === 'open'; }
  /** 自己是不是这个房间的主人 */
  get isOwner() { return !this.v.visiting; }

  /** 当前该在哪个房间（null = 不该连） */
  sync(want: string | null) {
    if (want === this.palaceId) return;
    this.leave();
    if (!want || !this.api()) return;
    this.palaceId = want;
    this.why = '';
    const api = this.api()!;
    this.sock = new RoomSocket(() => api.roomUrl(want), (m) => this.onMsg(m), (s, why) => { if (why) this.why = why; if (s === 'open') this.hello(); this.render(); });
    this.sock.connect();
    this.render();
  }

  leave() {
    this.sock?.close();
    this.sock = null;
    this.palaceId = null;
    for (const id of [...this.avatars.keys()]) this.removeAvatar(id);
    this.log = [];
    this.guiding = false;
    this.ownerOnline = false;
    this.lastState = '';
    this.render();
  }

  dispose() {
    this.leave();
    this.group.removeFromParent();
    this.v.ui.room?.remove();
  }

  /** 自己的外观（小管家）变了 */
  hello() {
    const pet = this.v.companion.pet;
    this.sock?.send({ t: 'hello', look: cleanLook(pet.look) as any });
    this.lastState = '';
  }

  // =====================================================================
  // 收消息
  // =====================================================================

  private onMsg(m: RoomServerMsg) {
    const v = this.v;
    switch (m.t) {
      case 'welcome':
        this.you = m.you;
        for (const id of [...this.avatars.keys()]) this.removeAvatar(id);
        for (const p of m.peers) this.addAvatar(p);
        break;
      case 'join':
        this.addAvatar(m.peer);
        v.host.notify?.(m.peer.owner ? t('{name}（主人）回来了', { name: m.peer.name }) : t('{name} 来串门了', { name: m.peer.name }));
        break;
      case 'leave': {
        const a = this.avatars.get(m.id);
        if (a) v.host.notify?.(t('{name} 离开了', { name: a.peer.name }));
        this.removeAvatar(m.id);
        break;
      }
      case 'state': {
        const a = this.avatars.get(m.id);
        if (a) { a.peer.state = m.s; a.target = m.s; }
        break;
      }
      case 'look': {
        const a = this.avatars.get(m.id);
        if (a) { a.peer.look = m.look; a.ch.setLook(m.look as any); }
        break;
      }
      case 'emote': {
        const a = this.avatars.get(m.id);
        if (a) this.showEmote(a.ch, a.bubble, m.e, (t) => { a.bubbleUntil = t; });
        break;
      }
      case 'chat': {
        const a = this.avatars.get(m.id);
        if (!a) break;
        this.say(a.bubble, escapeHtml(m.text), (t) => { a.bubbleUntil = t; }, 5);
        this.log.push({ who: a.peer.name, text: m.text });
        break;
      }
      case 'guide':
        if (!this.isOwner && this.following && m.key && m.stop >= 0) this.followGuide(m.key);
        break;
      case 'error':
        v.host.notify?.(m.error, 'error');
        break;
    }
    v.invalidate(2);
    this.render();
  }

  private followGuide(key: string) {
    const v = this.v;
    if (!v.doc || !v.built) return;
    const { itemId } = parseLocus(key);
    if (!v.built.itemObjects.has(itemId)) return;
    v.focusItem(key);
    const item = v.doc.items.find(i => i.id === itemId);
    const owner = [...this.avatars.values()].find(a => a.peer.owner)?.peer.name || t('主人');
    if (item) v.host.notify?.(t('{name} 在介绍：{item}', { name: owner, item: itemDisplayName(item, v.catalog) }));
  }

  // =====================================================================
  // 小人
  // =====================================================================

  private addAvatar(p: Peer) {
    this.removeAvatar(p.id);
    const ch = new Character(cleanLook(p.look), SCALE);
    const nameEl = document.createElement('div');
    nameEl.className = 'kp-peer-name' + (p.owner ? ' kp-owner' : '');
    nameEl.textContent = p.owner ? t('{name} · 主人', { name: p.name }) : p.name;
    const name = new CSS2DObject(nameEl);
    name.position.y = -.06;
    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'kp-pet-bubble kp-hidden';
    const bubble = new CSS2DObject(bubbleEl);
    bubble.position.y = .62 * SCALE;
    ch.root.add(name, bubble);
    // 还没收到位置：先站在门口附近（等第一条 state）
    if (p.state) { ch.root.position.set(p.state.p[0], 0, p.state.p[1]); ch.root.rotation.y = p.state.yaw; }
    else ch.root.visible = false;
    this.group.add(ch.root);
    const a: Avatar = { peer: p, ch, name, bubble, bubbleUntil: 0, target: p.state };
    this.avatars.set(p.id, a);
    if (p.owner) this.ownerOnline = true;
  }

  private removeAvatar(id: string) {
    const a = this.avatars.get(id);
    if (!a) return;
    a.name.element.remove();
    a.bubble.element.remove();
    a.ch.dispose();
    this.avatars.delete(id);
    if (a.peer.owner) this.ownerOnline = false;
  }

  private say(b: CSS2DObject, html: string, set: (t: number) => void, secs = 3) {
    b.element.innerHTML = html;
    b.element.classList.remove('kp-hidden');
    set(this.time + secs);
  }

  private showEmote(ch: Character, b: CSS2DObject, e: string, set: (t: number) => void) {
    const icon = EMOTES[e];
    if (!icon) return;
    ch.play(e === 'wave' ? 'wave' : 'hop');
    this.say(b, `<span class="kp-emote">${icon}</span>`, set, 2.5);
  }

  /** 每帧：别人的小人往目标位置插值；自己的位置变了就发出去。返回 true 需要渲染 */
  update(dt: number): boolean {
    this.time += dt;
    let busy = false;
    const show = this.v.level === 'palace';
    if (this.group.visible !== show) { this.group.visible = show; busy = true; }
    for (const a of this.avatars.values()) {
      const t = a.target, r = a.ch.root;
      if (t) {
        if (!r.visible) { r.visible = true; r.position.set(t.p[0], 0, t.p[1]); r.rotation.y = t.yaw; busy = true; }
        const dx = t.p[0] - r.position.x, dz = t.p[1] - r.position.z, d = Math.hypot(dx, dz);
        if (d > 3) { r.position.set(t.p[0], 0, t.p[1]); busy = true; }
        else if (d > .01) {
          const step = Math.min(d, Math.max(1.2, d * 4) * dt);
          r.position.x += dx / d * step; r.position.z += dz / d * step;
          r.rotation.y = lerpAngle(r.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 10));
          a.ch.play('walk');
          busy = true;
        } else {
          if (a.ch.current === 'walk') a.ch.play(t.anim === 'walk' ? 'idle' : t.anim);
          if (Math.abs(lerpAngle(r.rotation.y, t.yaw, 1) - r.rotation.y) > .01) { r.rotation.y = lerpAngle(r.rotation.y, t.yaw, Math.min(1, dt * 8)); busy = true; }
        }
      }
      if (a.bubbleUntil && this.time > a.bubbleUntil) { a.bubbleUntil = 0; a.bubble.element.classList.add('kp-hidden'); busy = true; }
      if (a.ch.update(dt)) busy = true;
    }
    this.sendState();
    return busy && show;
  }

  private sendState() {
    if (!this.open || this.time - this.lastSent < SEND_MS / 1000) return;
    const ch = this.v.companion.ch;
    if (!ch) return;
    const r = ch.root;
    const anim = ch.current === 'walk' || ch.current === 'wave' || ch.current === 'sit' ? ch.current : 'idle';
    const s: RoomClientMsg = { t: 'state', p: [round(r.position.x), round(r.position.z)], yaw: round(r.rotation.y), anim };
    const key = JSON.stringify(s);
    if (key === this.lastState) return;
    this.lastState = key;
    this.lastSent = this.time;
    this.sock?.send(s);
  }

  // =====================================================================
  // 自己的动作
  // =====================================================================

  emote(e: string) {
    const c = this.v.companion;
    if (!c.ch || !EMOTES[e]) return;
    c.ch.play(e === 'wave' ? 'wave' : 'hop');
    c.say(`<span class="kp-emote">${EMOTES[e]}</span>`, 2500);
    this.sock?.send({ t: 'emote', e: e as any });
  }

  chat(text: string) {
    text = text.trim().slice(0, 80);
    if (!text) return;
    this.v.companion.say(escapeHtml(text), 5000);
    this.log.push({ who: t('我'), text });
    this.sock?.send({ t: 'chat', text });
    this.render();
  }

  /** 主人选中了一件东西：带大家看 */
  onSelect(obj: THREE.Object3D | null, slot: string) {
    if (!this.guiding || !this.open || !this.isOwner || !obj) return;
    const id = [...(this.v.built?.itemObjects || [])].find(([, o]) => o === obj)?.[0];
    if (!id) return;
    this.sock?.send({ t: 'guide', stop: 0, key: locusKey(id, slot) });
  }

  /** 参观时（或有客人时）点地板：自己的小人走过去 */
  get walkByClick() { return this.open && (!this.isOwner || this.peers > 0); }

  // =====================================================================
  // 面板：在线的人、表情、聊天、带路
  // =====================================================================

  render() {
    const el = this.v.ui.room;
    if (!el) return;
    const active = !!this.palaceId && (this.open ? (!this.isOwner || this.peers > 0) : !!this.why);
    el.classList.toggle('kp-hidden', !active);
    if (!active) return;
    if (!this.open) {
      el.innerHTML = `<div class="kp-live-head"><span class="kp-live-dot kp-off"></span><b>${escapeHtml(this.why || t('正在连接…'))}</b></div>`;
      return;
    }
    const names = [...this.avatars.values()].map(a => `<span class="kp-live-chip${a.peer.owner ? ' kp-owner' : ''}">${escapeHtml(a.peer.name)}</span>`).join('');
    const log = this.log.slice(-4).map(l => `<div><b></b><span></span></div>`).join('');
    el.innerHTML = `
      <div class="kp-live-head"><span class="kp-live-dot"></span><b>${this.peers ? t('{n} 人在这里', { n: this.peers + 1 }) : t('只有你在这里')}</b>${names}</div>
      ${log ? `<div class="kp-live-log">${log}</div>` : ''}
      <div class="kp-live-emotes">${Object.entries(EMOTES).map(([k, i]) => `<button data-act="roomEmote" data-e="${k}" title="${k}">${i}</button>`).join('')}</div>
      <div class="kp-live-chat"><input data-field="roomChat" maxlength="80" placeholder="${t('说点什么，回车发送')}" spellcheck="false"></div>
      ${this.isOwner
        ? `<label class="kp-soc-opt"><input type="checkbox" data-field="roomGuide"${this.guiding ? ' checked' : ''}> ${t('带大家参观（我选中哪件东西，大家的镜头就跟过去）')}</label>`
        : `<label class="kp-soc-opt"><input type="checkbox" data-field="roomFollow"${this.following ? ' checked' : ''}> ${t('跟着主人看')}${this.ownerOnline ? '' : t('（主人不在）')}</label>`}`;
    el.querySelectorAll<HTMLElement>('.kp-live-log > div').forEach((d, i) => {
      const l = this.log.slice(-4)[i];
      d.querySelector('b').textContent = t('{name}：', { name: l.who });
      d.querySelector('span').textContent = l.text;
    });
  }

  onAction(act: string, el: HTMLElement): boolean {
    if (act !== 'roomEmote') return false;
    this.emote(el.dataset.e);
    return true;
  }

  onInput(e: Event, commit: boolean): boolean {
    const inp = e.target as HTMLInputElement;
    const f = inp?.dataset?.field;
    if (f === 'roomGuide') { if (commit) { this.guiding = inp.checked; if (this.guiding) this.v.host.notify?.(t('带路中：选中一件东西，客人的镜头会跟过去')); } return true; }
    if (f === 'roomFollow') { if (commit) this.following = inp.checked; return true; }
    return f === 'roomChat';
  }

  onKey(e: KeyboardEvent): boolean {
    const inp = e.target as HTMLInputElement;
    if (inp?.dataset?.field !== 'roomChat' || e.key !== 'Enter') return false;
    this.chat(inp.value);
    const input = this.v.ui.room.querySelector<HTMLInputElement>('[data-field="roomChat"]');
    input?.focus();
    return true;
  }
}

function round(n: number) { return Math.round(n * 100) / 100; }

function lerpAngle(a: number, b: number, k: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
