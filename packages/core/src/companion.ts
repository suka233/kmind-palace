import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { PalaceView } from './view';
import { Character, renderLookThumb } from './avatar';
import { SPECIES, ACCESSORIES, cleanLook, seededLook, type Look } from './look';
import { WalkGrid, type P2 } from './path';
import { ownBox } from './build';
import { frontDoor, PET_NAME, type PalaceWorld } from './world';
import { boundLoci } from './schema';
import { escapeHtml } from './icons';
import { t } from './i18n';
import type { GuestPet, PetTrip } from '@kmind-palace/protocol';

/* =====================================================================
 * 小管家：住在宫殿里的小动物。
 *   进门时在门口迎接，提醒今天要复习几个；平时在家具之间溜达、东张西望；
 *   选中一件东西时跑过去站在旁边；回忆时一站站带路，走完了跳一下；
 *   走进去（第一人称）时跟在身后。点它会挥手，打开换装面板（物种、颜色、配饰、名字）。
 * 外观存在世界数据里（world.pet），串门时就是你的小人。
 * ===================================================================== */

const SPEED = 1.1;
/** 比真实小动物大一圈，俯视时看得清、点得中 */
const SCALE = 1.6;
const TIPS = [
  '双击地板可以走进去看看，像真的在房间里一样。',
  '选中一件家具，可以把一条笔记绑在它上面，它就成了记忆桩。',
  '按 B 进入搭建模式：摆家具、改墙、加门窗。',
  '书架可以对应一个笔记本，书脊就是一篇篇笔记。',
  '「回忆」会按路线一站站走，先想，再翻开答案。',
  '夜里（按 N）宫殿会亮起灯，换个心情背书。',
  '记不住的数字？试试数字编码表，把 00–99 变成人物和动作。',
  '把几座宫殿的路线串成旅程，可以一口气走完。',
];

/** 小管家的名字（显示用）：默认名字跟着界面语言走，自己起的名字原样显示 */
export function petDisplayName(name: string) { return name === PET_NAME ? t(PET_NAME) : name; }

export class Companion {
  ch: Character | null = null;
  private grid: WalkGrid | null = null;
  private gridKey: unknown = null;
  private path: P2[] = [];
  /** 走到之后面朝哪里：一个点，或者直接给朝向角 */
  private faceAfter: P2 | number | null = null;
  private idleFor = 0;
  private nextIdle = 6;
  private followCheck = 0;
  private bubble: CSS2DObject | null = null;
  private bubbleUntil = 0;
  private hit: THREE.Mesh | null = null;
  panelOpen = false;
  private thumbs = new Map<string, string>();
  private time = 0;
  private docId: string | null = null;
  /** 正在走向门口准备出门 */
  private leaving = false;
  /** 来做客的别人的宠物 */
  private guests: { g: GuestPet; ch: Character; bubble: CSS2DObject; label: CSS2DObject; path: P2[]; idleFor: number; nextIdle: number; bubbleUntil: number }[] = [];

  constructor(private v: PalaceView) {
    v.root.insertAdjacentHTML('beforeend', `<div class="kp-routes kp-pet-panel kp-glass kp-hidden kp-palace-only" data-ref="petPanel"></div>`);
    v.ui.petPanel = v.root.querySelector('[data-ref="petPanel"]') as HTMLElement;
  }

  /** 自己世界里的小管家（参观好友时也是自己的） */
  get home(): PalaceWorld { return this.v.visiting?.home.world || this.v.world; }
  get pet() { return this.home.pet || { name: PET_NAME, look: seededLook(this.home.id) }; }
  get hidden() { return !!this.home.pet?.hidden; }
  /** 显示用的名字（默认名字会翻译） */
  get petName() { return petDisplayName(this.pet.name); }

  // =====================================================================
  // 生命周期
  // =====================================================================

  /** 进了一座宫殿：在门口出现 */
  onPalaceLoaded() {
    const v = this.v, b = v.built, doc = v.doc;
    // 同一座宫殿重新载入（同步、重置）：留在原地，只是重新找路
    if (this.ch && doc && this.docId === doc.id) { this.grid = null; this.path = []; return; }
    this.remove();
    this.setGuests([]);
    this.docId = doc?.id || null;
    // 出门在别人家玩：自己的宫殿里没有它（参观好友时它一直跟着你）
    // 网页查看器（凭链接、没有登录）里没有小管家
    if (!b || !doc || this.hidden || (v.readonly && !v.visiting) || (!v.visiting && v.social?.petAway)) return;
    const ch = this.ch = new Character(this.pet.look, SCALE);
    ch.root.name = 'kp-pet';
    // 点击用的隐形球（比小动物本身好点中）
    const hit = this.hit = new THREE.Mesh(new THREE.SphereGeometry(.28 * SCALE, 8, 6), new THREE.MeshBasicMaterial());
    hit.position.y = .24 * SCALE;
    hit.visible = false;
    ch.root.add(hit);
    // 对话气泡
    const el = document.createElement('div');
    el.className = 'kp-pet-bubble kp-hidden';
    const bubble = this.bubble = new CSS2DObject(el);
    bubble.position.y = .62 * SCALE;
    ch.root.add(bubble);
    v.scene.add(ch.root);
    this.grid = null;
    const door = frontDoor(doc);
    const g = this.walkGrid();
    let p: P2 = door ? [door.x - door.nx * .9, door.z - door.nz * .9] : [b.bounds.getCenter(new THREE.Vector3()).x, b.bounds.getCenter(new THREE.Vector3()).z];
    p = g?.nearestFree(p[0], p[1]) || p;
    ch.root.position.set(p[0], 0, p[1]);
    // 面朝镜头
    const cam = v.isoCam.position;
    ch.root.rotation.y = Math.atan2(cam.x - p[0], cam.z - p[1]);
    ch.play('hop');
    this.idleFor = 0;
    this.nextIdle = 5 + Math.random() * 4;
    if (!v.readonly && v.guide?.consume('pet')) {
      this.say(t('你好！我是小管家 <b>{name}</b>，以后我帮你看家、陪你复习。点我可以给我换装哦～', { name: escapeHtml(this.petName) }), 7000);
    } else if (!v.readonly) {
      const due = v.dueCount(doc);
      this.say(due ? t('欢迎回来！今天有 {n} 个记忆桩该复习了。', { n: due }) : t('欢迎回来，{name} 一切都好。', { name: escapeHtml(doc.name) }), 4200);
    } else if (v.visiting) this.say(t('哇，这是 {name} 的宫殿！', { name: escapeHtml(v.visiting.owner.name) }), 3600);
    v.invalidate(2);
  }

  /** 离开宫殿 / 关掉 */
  remove() {
    if (!this.ch) return;
    this.bubble?.element.remove();
    this.hit?.geometry.dispose();
    (this.hit?.material as THREE.Material)?.dispose();
    this.ch.dispose();
    this.ch = null;
    this.bubble = null;
    this.hit = null;
    this.path = [];
    this.grid = null;
    this.docId = null;
    this.leaving = false;
  }

  /** 离开宫殿：自己的小管家、来做客的宠物、面板都收起来 */
  leavePalace() {
    this.remove();
    this.setGuests([]);
    this.togglePanel(false);
  }

  dispose() {
    this.remove();
    this.setGuests([]);
    this.v.ui.petPanel?.remove();
  }

  private walkGrid(): WalkGrid | null {
    const b = this.v.built;
    if (!b) return null;
    const colliders = this.v.colliders();
    if (this.grid && this.gridKey === colliders) return this.grid;
    const bb = b.bounds;
    this.gridKey = colliders;
    this.grid = new WalkGrid({ x0: bb.min.x - .5, z0: bb.min.z - .5, x1: bb.max.x + .5, z1: bb.max.z + .5 }, colliders, .15, .12);
    return this.grid;
  }

  /** 家具搬动过：下次找路时重建网格 */
  invalidateGrid() { this.grid = null; }

  // =====================================================================
  // 行为
  // =====================================================================

  /** 走到 (x, z)；face 给了就到了之后面朝那里 */
  walkTo(x: number, z: number, face?: P2 | number) {
    const ch = this.ch, g = this.walkGrid();
    if (!ch) return;
    const from: P2 = [ch.root.position.x, ch.root.position.z];
    const path = g?.path(from, [x, z]) || [from, [x, z]];
    this.path = path.slice(1);
    this.faceAfter = face ?? null;
    if (this.path.length) ch.play('walk');
    this.idleFor = 0;
    this.v.invalidate(2);
  }

  /** 选中了一件东西（或回忆走到这一站）：跑到它前面（靠镜头这一侧） */
  onSelect(obj: THREE.Object3D | null) {
    if (!this.ch || !obj || this.v.mode !== 'iso') return;
    const c = ownBox(obj).getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3().subVectors(this.v.orbit.target, this.v.isoCam.position).setY(0).normalize();
    // 站在物件靠镜头一侧、稍微偏一点，不挡住它
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const size = ownBox(obj).getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z) / 2 + .35;
    const tx = c.x - dir.x * r + side.x * .35, tz = c.z - dir.z * r + side.z * .35;
    const p = this.walkGrid()?.nearestFree(tx, tz, 1.5) || [tx, tz];
    // 侧身对着镜头、稍微转向物件（像在介绍它）
    const toCam = Math.atan2(-dir.x, -dir.z), toItem = Math.atan2(c.x - p[0], c.z - p[1]);
    this.walkTo(p[0], p[1], toCam + angleDiff(toCam, toItem) * .35);
  }

  /** 回忆打分 / 走完：给个反应 */
  cheer(text?: string) {
    if (!this.ch) return;
    this.ch.play('hop');
    if (text) this.say(text, 3000);
    this.v.invalidate(2);
  }

  /** 头顶冒一句话 */
  say(html: string, ms = 3000) {
    if (!this.bubble) return;
    const el = this.bubble.element;
    el.innerHTML = html;
    el.classList.remove('kp-hidden');
    this.bubbleUntil = this.time + ms / 1000;
    this.v.invalidate(2);
  }

  /** 屏幕坐标点到了小管家吗 */
  pick(clientX: number, clientY: number): boolean {
    if (!this.ch || !this.hit || !this.ch.root.visible) return false;
    const rc = this.v.raycaster;
    rc.setFromCamera(this.v.ndc(clientX, clientY), this.v.isoCam);
    return rc.intersectObject(this.hit, false).length > 0;
  }

  /** 点击：点到自己的小管家或来做客的宠物时处理并返回 true */
  click(clientX: number, clientY: number): boolean {
    if (this.pick(clientX, clientY)) { this.onClick(); return true; }
    return this.pickGuest(clientX, clientY);
  }

  /** 被点了：挥手、说句话、打开换装面板 */
  onClick() {
    const ch = this.ch, v = this.v;
    if (!ch) return;
    ch.play('wave');
    const cam = v.isoCam.position;
    ch.root.rotation.y = Math.atan2(cam.x - ch.root.position.x, cam.z - ch.root.position.z);
    this.path = [];
    const due = v.doc && !v.readonly ? v.dueCount(v.doc) : 0;
    const bound = v.doc ? boundLoci(v.doc).length : 0;
    let tip: string;
    if (due) tip = t('有 {n} 个记忆桩该复习了，点左上角「回忆」我带你走一遍。', { n: due });
    else if (!bound && !v.readonly) tip = t('这座宫殿还没有记忆桩：选中一件家具，绑一条笔记试试？');
    else tip = t(TIPS[Math.floor(Math.random() * TIPS.length)]);
    this.say(t('<b>{name}</b>：{tip}', { name: escapeHtml(this.petName), tip }), 5200);
    this.togglePanel(true);
  }

  /** 每帧；返回 true 表示需要继续渲染 */
  update(dt: number): boolean {
    this.time += dt;
    const ch = this.ch, v = this.v;
    const guestsBusy = this.guests.length && v.level === 'palace' ? this.updateGuests(dt) : false;
    if (!ch) return guestsBusy;
    const show = v.level === 'palace' && !v.editor.active;
    if (ch.root.visible !== show) { ch.root.visible = show; v.invalidate(1); }
    if (!show) return false;
    let busy = false;
    if (this.bubble && this.bubbleUntil && this.time > this.bubbleUntil) {
      this.bubbleUntil = 0;
      this.bubble.element.classList.add('kp-hidden');
      busy = true;
    }
    // 走路
    if (this.path.length) {
      const [tx, tz] = this.path[0];
      const p = ch.root.position;
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      const step = SPEED * dt;
      if (d <= step) {
        p.x = tx; p.z = tz;
        this.path.shift();
      } else {
        p.x += dx / d * step; p.z += dz / d * step;
      }
      if (d > 1e-3) ch.root.rotation.y = turn(ch.root.rotation.y, Math.atan2(dx, dz), dt * 10);
      if (!this.path.length && this.leaving) {
        // 走到门口了：出门
        this.remove();
        v.invalidate(2);
        return true;
      }
      if (!this.path.length) {
        ch.play('idle');
        const f = this.faceAfter;
        if (typeof f === 'number') ch.root.rotation.y = f;
        else if (f) ch.root.rotation.y = Math.atan2(f[0] - p.x, f[1] - p.z);
        this.faceAfter = null;
      }
      busy = true;
    } else if (v.mode === 'walk') {
      busy = this.follow(dt) || busy;
    } else {
      // 闲着：隔一会儿东张西望，或者溜达到另一件家具旁边
      this.idleFor += dt;
      if (this.idleFor > this.nextIdle && !v.recall.active && !v.selected && !v.social?.room.walkByClick) {
        this.idleFor = 0;
        this.nextIdle = 7 + Math.random() * 9;
        if (Math.random() < .45) ch.play('look');
        else this.wander();
      }
    }
    if (ch.update(dt)) busy = true;
    return busy || guestsBusy;
  }

  /** 第一人称：跟在身后一米左右 */
  private follow(dt: number): boolean {
    const ch = this.ch!, v = this.v;
    this.followCheck -= dt;
    if (this.followCheck > 0) return false;
    this.followCheck = .4;
    const me = v.walkPosition();
    if (!me) return false;
    const p = ch.root.position;
    const d = Math.hypot(me.x - p.x, me.z - p.z);
    if (d < 1.6) {
      // 够近：转过来看着你
      const yaw = Math.atan2(me.x - p.x, me.z - p.z);
      if (Math.abs(angleDiff(ch.root.rotation.y, yaw)) > .3) { ch.root.rotation.y = yaw; return true; }
      return false;
    }
    const k = 1 - 1 / d;
    const g = this.walkGrid();
    const t = g?.nearestFree(p.x + (me.x - p.x) * k, p.z + (me.z - p.z) * k, 1) || [me.x, me.z];
    this.walkTo(t[0], t[1], [me.x, me.z]);
    return true;
  }

  /** 随便挑一件家具，溜达过去 */
  private wander() {
    const b = this.v.built;
    if (!b || !this.ch) return;
    const items = [...b.itemObjects.values()];
    if (!items.length) return;
    const obj = items[Math.floor(Math.random() * items.length)];
    const c = ownBox(obj).getCenter(new THREE.Vector3());
    const a = Math.random() * Math.PI * 2;
    const p = this.walkGrid()?.nearestFree(c.x + Math.sin(a) * .7, c.z + Math.cos(a) * .7, 1.2);
    if (!p) return;
    // 别走太远（大宫殿里一趟走半天）
    const here = this.ch.root.position;
    if (Math.hypot(p[0] - here.x, p[1] - here.z) > 7) return;
    this.walkTo(p[0], p[1], [c.x, c.z]);
  }

  // =====================================================================
  // 出门串门（S3）
  // =====================================================================

  /** 出门：走到门口，消失 */
  leaveHome() {
    const v = this.v, ch = this.ch, doc = v.doc;
    if (!ch || !doc || v.visiting) { this.render(); return; }
    const door = frontDoor(doc);
    this.say(t('出门玩啦，回来给你带礼物～'), 2500);
    if (!door) { this.remove(); v.invalidate(2); this.render(); return; }
    this.leaving = true;
    this.walkTo(door.x + door.nx * .3, door.z + door.nz * .3);
    this.render();
  }

  /** 宠物状态变了（服务器那边）：出门中就收起来；刚回来就在门口出现，说说带回了什么 */
  onPetStatus(back: PetTrip | null) {
    const v = this.v;
    if (v.social?.petAway && this.ch && !v.visiting && !this.leaving) this.leaveHome();
    else if (back && v.level === 'palace' && !v.visiting && !this.ch) {
      this.onPalaceLoaded();
      const s = back.souvenir;
      const what = s?.title || (s?.place ? v.social?.placeName(s.place) : '');
      const went = t('我回来啦！去了 <b>{host}</b> 家', { host: escapeHtml(back.host.name) });
      this.say(what ? went + t('，带回了「{what}」', { what: escapeHtml(what) }) : went, 6000);
    }
    this.render();
  }

  /** 来做客的宠物：在宫殿里随便溜达 */
  setGuests(list: GuestPet[]) {
    for (const x of this.guests) { x.label.element.remove(); x.bubble.element.remove(); x.ch.dispose(); }
    this.guests = [];
    const v = this.v, b = v.built;
    if (!b || !list.length) return;
    const g = this.walkGrid();
    for (const guest of list.slice(0, 6)) {
      const ch = new Character(guest.look as Look, SCALE * .9);
      const labelEl = document.createElement('div');
      labelEl.className = 'kp-peer-name';
      labelEl.textContent = t('{owner}的{pet}', { owner: guest.owner.name, pet: petDisplayName(guest.name) });
      const label = new CSS2DObject(labelEl);
      label.position.y = -.06;
      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'kp-pet-bubble kp-hidden';
      const bubble = new CSS2DObject(bubbleEl);
      bubble.position.y = .6 * SCALE;
      ch.root.add(label, bubble);
      // 从门口进来，散在门内一两米的地方
      const door = v.doc && frontDoor(v.doc);
      const c = door ? new THREE.Vector3(door.x - door.nx * 1.4, 0, door.z - door.nz * 1.4) : b.bounds.getCenter(new THREE.Vector3());
      const a = Math.random() * Math.PI * 2;
      const p = g?.nearestFree(c.x + Math.sin(a) * .8, c.z + Math.cos(a) * .8, 2) || [c.x, c.z];
      ch.root.position.set(p[0], 0, p[1]);
      ch.root.rotation.y = Math.random() * Math.PI * 2;
      v.scene.add(ch.root);
      this.guests.push({ g: guest, ch, label, bubble, path: [], idleFor: 0, nextIdle: 3 + Math.random() * 6, bubbleUntil: 0 });
    }
    v.invalidate(2);
  }

  /** 点到了来做客的宠物：它自我介绍 */
  private pickGuest(clientX: number, clientY: number): boolean {
    if (!this.guests.length) return false;
    const rc = this.v.raycaster;
    rc.setFromCamera(this.v.ndc(clientX, clientY), this.v.isoCam);
    for (const x of this.guests) {
      if (!rc.intersectObject(x.ch.root, true).length) continue;
      const mins = Math.max(1, Math.round((Date.parse(x.g.returnsAt) - Date.now()) / 60e3));
      x.bubble.element.innerHTML = t('我是 <b>{owner}</b> 家的{pet}，来玩一会儿～（{n} 分钟后回家）', { owner: escapeHtml(x.g.owner.name), pet: escapeHtml(petDisplayName(x.g.name)), n: mins });
      x.bubble.element.classList.remove('kp-hidden');
      x.bubbleUntil = this.time + 4;
      x.ch.play('wave');
      x.path = [];
      this.v.invalidate(2);
      return true;
    }
    return false;
  }

  private updateGuests(dt: number): boolean {
    let busy = false;
    const v = this.v, g = this.walkGrid();
    for (const x of this.guests) {
      const r = x.ch.root;
      if (x.path.length) {
        const [tx, tz] = x.path[0];
        const dx = tx - r.position.x, dz = tz - r.position.z, d = Math.hypot(dx, dz), step = SPEED * .8 * dt;
        if (d <= step) { r.position.x = tx; r.position.z = tz; x.path.shift(); if (!x.path.length) x.ch.play('idle'); }
        else { r.position.x += dx / d * step; r.position.z += dz / d * step; }
        if (d > 1e-3) r.rotation.y = turn(r.rotation.y, Math.atan2(dx, dz), dt * 10);
        busy = true;
      } else if ((x.idleFor += dt) > x.nextIdle && g && v.mode === 'iso') {
        x.idleFor = 0;
        x.nextIdle = 6 + Math.random() * 10;
        const a = Math.random() * Math.PI * 2, R = 1 + Math.random() * 2;
        const t = g.nearestFree(r.position.x + Math.sin(a) * R, r.position.z + Math.cos(a) * R, 1.5);
        const path = t && g.path([r.position.x, r.position.z], t);
        if (path && path.length > 1) { x.path = path.slice(1); x.ch.play('walk'); }
        else x.ch.play('look');
      }
      if (x.bubbleUntil && this.time > x.bubbleUntil) { x.bubbleUntil = 0; x.bubble.element.classList.add('kp-hidden'); busy = true; }
      if (x.ch.update(dt)) busy = true;
    }
    return busy;
  }

  // =====================================================================
  // 换装面板
  // =====================================================================

  togglePanel(open = !this.panelOpen) {
    this.panelOpen = open;
    this.v.ui.petPanel.classList.toggle('kp-hidden', !open);
    if (open) { this.v.closeSidePanels('pet'); this.render(); }
  }

  private thumb(look: Look) {
    const key = JSON.stringify(look);
    let url = this.thumbs.get(key);
    if (!url) {
      try { url = renderLookThumb(this.v.renderer, look, 96); } catch { url = ''; }
      this.thumbs.set(key, url);
      this.v.invalidate(1);
    }
    return url;
  }

  render() {
    if (!this.panelOpen) return;
    const el = this.v.ui.petPanel, pet = this.pet, look = cleanLook(pet.look);
    const locked = !!this.v.visiting || this.v.readonly;
    const head = `<div class="kp-routes-head"><b>${t('小管家')}</b><button class="kp-close" data-act="petClose">×</button></div>`;
    if (locked) {
      el.innerHTML = `${head}<div class="kp-pet-hero"><img src="${this.thumb(look)}" alt=""><div><b>${escapeHtml(this.petName)}</b><small>${t('陪你一起来串门')}</small></div></div>
        <div class="kp-route-stats">${t('回到自己的世界后可以给它换装。')}</div>`;
      return;
    }
    const colors = look.colors!;
    const sp = SPECIES.find(s => s.id === look.species)!;
    const swatch = (field: 'body' | 'accent', list: string[]) => [...new Set(list.map(c => c.toLowerCase()))].map(c => `<button class="kp-pet-sw${colors[field] === c ? ' kp-on' : ''}" style="background:${c}" data-act="petColor" data-field="${field}" data-color="${c}" title="${c}"></button>`).join('');
    el.innerHTML = `${head}
      <div class="kp-pet-hero"><img src="${this.thumb(look)}" alt="">
        <div><input class="kp-route-name" data-field="petName" maxlength="20" spellcheck="false" value="${escapeHtml(this.petName)}"><small>${escapeHtml(t(sp.name))}${look.accessories?.length ? ' · ' + look.accessories.map(a => t(ACCESSORIES.find(x => x.id === a)?.name)).join(t('、')) : ''}</small></div></div>
      <div class="kp-route-sub">${t('物种')}</div>
      <div class="kp-pet-species">${SPECIES.map(s => {
        const l = cleanLook({ species: s.id, accessories: look.accessories });
        return `<button class="${s.id === look.species ? 'kp-on' : ''}" data-act="petSpecies" data-id="${s.id}"><img src="${this.thumb(l)}" alt=""><span>${t(s.name)}</span></button>`;
      }).join('')}</div>
      <div class="kp-route-sub">${t('毛色')}</div>
      <div class="kp-pet-swatches">${swatch('body', [sp.colors.body, '#8b6a4f', '#d9682e', '#e3a15c', '#efe9e2', '#5a5550', '#9fb4c7', '#c79bc4'])}</div>
      <div class="kp-route-sub">${t('点缀色')}</div>
      <div class="kp-pet-swatches">${swatch('accent', [sp.colors.accent, '#f0a33c', '#f2a7a0', '#3a2a22', '#4f86c6', '#4f9a78', '#c4453a', '#e8b93c'])}</div>
      <div class="kp-route-sub">${t('配饰（最多 4 件）')}</div>
      <div class="kp-pet-acc">${ACCESSORIES.map(a => `<button class="${look.accessories?.includes(a.id) ? 'kp-on' : ''}" data-act="petAcc" data-id="${a.id}">${t(a.name)}</button>`).join('')}</div>
      ${this.v.social?.petSection() || ''}
      <div class="kp-route-tools"><button data-act="petRandom">${t('随机一身')}</button><button data-act="petHide">${t('先让它休息')}</button></div>`;
  }

  private save(pet: { name: string; look: Look; hidden?: boolean }) {
    const v = this.v;
    if (v.readonly) return;
    v.world.pet = { name: pet.name, look: cleanLook(pet.look), ...(pet.hidden ? { hidden: true } : {}) };
    v.world.updatedAt = Date.now();
    v.host.onWorldChange?.(v.world);
    v.social?.onPetChanged?.();
  }

  private setLook(look: Look) {
    const pet = this.pet;
    this.save({ name: pet.name, look });
    this.ch?.setLook(this.pet.look);
    this.ch?.play('hop');
    this.render();
    this.v.invalidate(2);
  }

  onAction(act: string, el: HTMLElement): boolean {
    if (!act.startsWith('pet')) return false;
    const pet = this.pet, look = cleanLook(pet.look);
    switch (act) {
      case 'petClose': this.togglePanel(false); return true;
      case 'petSpecies': {
        const sp = SPECIES.find(s => s.id === el.dataset.id);
        if (sp) this.setLook({ species: sp.id, colors: { ...sp.colors }, accessories: look.accessories });
        return true;
      }
      case 'petColor': {
        const f = el.dataset.field as 'body' | 'accent';
        this.setLook({ ...look, colors: { ...look.colors, [f]: el.dataset.color } });
        return true;
      }
      case 'petAcc': {
        const id = el.dataset.id, cur = look.accessories || [];
        const next = cur.includes(id) ? cur.filter(a => a !== id) : [...cur, id].slice(-4);
        this.setLook({ ...look, accessories: next });
        return true;
      }
      case 'petRandom': {
        const sp = SPECIES[Math.floor(Math.random() * SPECIES.length)];
        const acc = ACCESSORIES.filter(() => Math.random() < .3).map(a => a.id).slice(0, 2);
        this.setLook({ species: sp.id, colors: { ...sp.colors }, accessories: acc });
        return true;
      }
      case 'petHide':
        this.save({ ...pet, hidden: true });
        this.togglePanel(false);
        this.remove();
        this.v.host.notify?.(t('{name} 去休息了。想它的时候在右上角「设置」里叫它回来', { name: petDisplayName(pet.name) }));
        this.v.invalidate(2);
        return true;
      case 'petCall':
        this.save({ ...pet, hidden: false });
        if (this.v.level === 'palace') this.onPalaceLoaded();
        return true;
    }
    return false;
  }

  onInput(e: Event, commit: boolean): boolean {
    const inp = e.target as HTMLInputElement;
    if (inp?.dataset?.field !== 'petName') return false;
    if (commit) {
      const name = inp.value.trim().slice(0, 20) || PET_NAME;
      // 输入框里显示的是翻译后的默认名字：没改就不算改名
      if (name !== this.pet.name && name !== this.petName) { this.save({ ...this.pet, name }); this.say(t('我现在叫 <b>{name}</b> 啦！', { name: escapeHtml(petDisplayName(name)) }), 2500); }
    }
    return true;
  }
}

function angleDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turn(a: number, b: number, k: number) {
  return a + angleDiff(a, b) * Math.min(1, k);
}
