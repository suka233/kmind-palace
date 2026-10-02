import * as THREE from 'three';
import type { PalaceView } from './view';
import { boundLoci, locusKey, type PalaceDoc, type Vec2 } from './schema';
import type { RegionLayer } from './world-layer';
import { ICONS, escapeHtml, timeAgo } from './icons';
import { TEMPLATES, createFromTemplate } from './templates/basic';
import { THEMES, getTheme } from './themes';
import { itemDisplayName } from './build';
import * as W from './world';
import { JourneyPanel } from './journey-panel';
import { pruneJourneys } from './journey';
import { t } from './i18n';

/* =====================================================================
 * 小镇 / 群岛层级的交互
 *   近看一座岛：悬停掀屋顶、选中宫殿、布置（拖动 / 旋转宫殿）、建造新宫殿、搬到别的岛
 *   群岛视角：悬停 / 选中岛、双击飞过去、岛屿设置（名字 / 场景）、开辟新岛、布置岛屿
 *   两个层级都能用：宫殿列表（按岛分组）、⌘K 快速跳转（宫殿 / 记忆桩 / 岛）
 * ===================================================================== */

const GRASS_Y = -.15;
const PEEK_DELAY = 280;

interface PaletteItem { kind: 'palace' | 'locus' | 'region'; id: string; item?: string; title: string; sub: string; color: string }
type Drag =
  | { kind: 'palace'; id: string; regionId: string; offset: Vec2; orig: Vec2; before: string; valid: boolean; moved: boolean }
  | { kind: 'region'; id: string; offset: Vec2; orig: Vec2; before: string; valid: boolean; moved: boolean };

export class TownController {
  selectedId: string | null = null;
  hoveredId: string | null = null;
  selectedRegion: string | null = null;
  hoveredRegion: string | null = null;
  editing = false;
  private hoverSince = 0;
  private tagHover: string | null = null;
  private drag: Drag | null = null;
  private placing: { doc: PalaceDoc; placed: W.PlacedPalace; regionId: string; valid: boolean; down: { x: number; y: number } | null } | null = null;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listOpen = false;
  private panel: 'build' | 'island' | null = null;
  private palette: PaletteItem[] = [];
  private paletteSel = 0;
  private confirmResolve: ((ok: boolean) => void) | null = null;
  private planCache = new Map<string, string>();
  /** 旅程面板（跨宫殿路线） */
  journeys: JourneyPanel;

  constructor(private v: PalaceView) {
    this.buildUI();
    this.journeys = new JourneyPanel(v, v.ui.journeyPanel);
    v.town.journeyOf = (id) => this.journeys.orderOf(id);
    const labels = v.root.querySelector('.kp-labels') as HTMLElement;
    v.on(labels, 'pointerover', (e: PointerEvent) => {
      const tag = (e.target as HTMLElement).closest<HTMLElement>('.kp-tag');
      if (!tag || v.level !== 'town') return;
      this.tagHover = tag.dataset.id;
      this.setHover(this.tagHover);
    });
    v.on(labels, 'pointerout', (e: PointerEvent) => {
      const tag = (e.target as HTMLElement).closest<HTMLElement>('.kp-tag');
      if (!tag || tag.contains(e.relatedTarget as Node)) return;
      this.tagHover = null;
      this.setHover(null);
    });
    v.on(labels, 'dblclick', (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const tag = t.closest<HTMLElement>('.kp-tag'), rtag = t.closest<HTMLElement>('.kp-region-tag');
      if (v.level !== 'town' || this.editing) return;
      if (tag) v.enterPalace(tag.dataset.id);
      else if (rtag) v.flyToRegion(rtag.dataset.id);
    });
    const input = v.ui.paletteInput as HTMLInputElement;
    v.on(input, 'input', () => { this.paletteSel = 0; this.renderPalette(); });
    v.on(input, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = this.palette.length;
        if (n) this.paletteSel = (this.paletteSel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        this.renderPalette(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = this.palette[this.paletteSel];
        if (it) this.pickPalette(it);
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        this.closePalette();
      }
    });
    v.on(v.ui.paletteWrap, 'pointerdown', (e: PointerEvent) => { if (e.target === v.ui.paletteWrap) this.closePalette(); });
    v.on(v.ui.townList, 'pointerover', (e: PointerEvent) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.kp-list-row[data-id]');
      if (row) this.setHover(row.dataset.id);
    });
    v.on(v.ui.townList, 'pointerleave', () => this.setHover(null));
  }

  private get town() { return this.v.town; }
  private get region() { return this.v.region; }
  private get docs() { return this.v.docs; }
  private get world() { return this.v.world; }
  /** 拖动 / 放置进行中：镜头所在的岛不要自动切换 */
  get busy() { return !!this.drag || !!this.placing; }

  private layerOf(regionId: string): RegionLayer | undefined { return this.town.regions.get(regionId); }
  private regionById(id: string) { return this.world.regions.find(r => r.id === id); }

  // =====================================================================
  // UI
  // =====================================================================

  private buildUI() {
    const html = `
      <div class="kp-brand kp-glass kp-town-only">
        <div class="kp-mark" data-ref="townMark">${ICONS.logo}</div>
        <div style="min-width:0">
          <div class="kp-title" data-ref="townTitle"></div>
          <div class="kp-sub" data-ref="townSub"></div>
        </div>
        <button class="kp-loci-btn kp-near-only" data-act="regionSettings" title="${t('这座岛的名字和场景')}">${ICONS.map}<span>${t('岛屿')}</span></button>
      </div>
      <div class="kp-topright kp-iso-only">
        <div class="kp-seg kp-glass kp-town-only kp-town-view">
          <button class="kp-on" data-act="viewMap" data-ref="segMap" title="${t('地图')}">${ICONS.map}<span>${t('地图')}</span></button>
          <button data-act="viewList" data-ref="segList" title="${t('宫殿列表')}">${ICONS.list}<span>${t('列表')}</span></button>
          <button data-act="viewJourneys" data-ref="segJourney" title="${t('旅程：把几座宫殿的路线串起来回忆')}">${ICONS.route}<span>${t('旅程')}</span></button>
        </div>
        <button class="kp-search kp-glass" data-act="palette" title="${t('搜索宫殿、记忆桩或岛（⌘K / Ctrl+K）')}">${ICONS.search}<span>${t('搜索宫殿或记忆桩')}</span><kbd>⌘K</kbd></button>
      </div>
      <nav class="kp-bar kp-glass kp-town-only kp-town-view kp-near-only">
        <button class="kp-primary" data-act="buildPalace" title="${t('在这座岛上建造一座新宫殿')}">${ICONS.plus}<span>${t('建造宫殿')}</span></button>
        <button data-act="townEdit" title="${t('布置小镇：拖动宫殿换位置、旋转（B）')}">${ICONS.move}<span>${t('布置')}</span></button>
        <span class="kp-sep"></span>
        <button data-act="toWorld" title="${t('拉远，看看所有的岛')}">${ICONS.globe}<span>${t('群岛')}</span></button>
        <button class="kp-icon" data-act="rotl" title="${t('向左旋转 90°（Q）')}">${ICONS.rotl}</button>
        <button class="kp-icon" data-act="rotr" title="${t('向右旋转 90°（E）')}">${ICONS.rotr}</button>
        <button data-act="night" title="${t('日 / 夜（N）')}"><svg class="kp-i" viewBox="0 0 24 24" data-night-icon>${ICONS.moon}</svg><span data-night-text>${t('夜晚')}</span></button>
        <button data-act="reset" title="${t('复位视角（R）')}">${ICONS.reset}<span>${t('复位')}</span></button>
      </nav>
      <nav class="kp-bar kp-glass kp-town-only kp-town-view kp-far-only">
        <button class="kp-primary" data-act="newIsland" title="${t('开辟一座新的岛')}">${ICONS.plus}<span>${t('开辟新岛')}</span></button>
        <button data-act="townEdit" title="${t('布置岛屿：拖动岛换位置（B）')}">${ICONS.move}<span>${t('布置岛屿')}</span></button>
        <span class="kp-sep"></span>
        <button class="kp-no-planet" data-act="toPlanet" title="${t('继续拉远：整个世界卷成一颗小星球')}">${ICONS.planet}<span>${t('星球')}</span></button>
        <button class="kp-planet-only" data-act="toWorld" title="${t('回到群岛全景')}">${ICONS.globe}<span>${t('群岛')}</span></button>
        <button class="kp-icon" data-act="rotl" title="${t('向左旋转 90°（Q）')}">${ICONS.rotl}</button>
        <button class="kp-icon" data-act="rotr" title="${t('向右旋转 90°（E）')}">${ICONS.rotr}</button>
        <button data-act="night" title="${t('日 / 夜（N）')}"><svg class="kp-i" viewBox="0 0 24 24" data-night-icon>${ICONS.moon}</svg><span data-night-text>${t('夜晚')}</span></button>
        <button data-act="reset" title="${t('全景（R）')}">${ICONS.reset}<span>${t('全景')}</span></button>
      </nav>
      <nav class="kp-bar kp-glass kp-town-only kp-town-edit">
        <span class="kp-bar-hint" data-ref="townEditHint"></span>
        <button class="kp-icon kp-near-only" data-act="townRotate" title="${t('旋转选中的宫殿 90°（R）')}">${ICONS.rotr}</button>
        <span class="kp-sep"></span>
        <button class="kp-icon" data-act="townUndo" data-ref="townUndo" title="${t('撤销（⌘Z）')}" disabled>${ICONS.undo}</button>
        <button class="kp-icon" data-act="townRedo" data-ref="townRedo" title="${t('重做（⇧⌘Z）')}" disabled>${ICONS.redo}</button>
        <span class="kp-sep"></span>
        <button class="kp-primary" data-act="townEditDone" title="${t('完成布置（Esc）')}">${ICONS.check}<span>${t('完成')}</span></button>
      </nav>
      <div class="kp-place kp-glass kp-town-only kp-town-placing-only"><span data-ref="townPlaceHint"></span><button data-act="townPlaceCancel">${t('取消')}</button></div>
      <div class="kp-card kp-glass kp-hidden kp-town-only" data-ref="townCard"></div>
      <div class="kp-panel kp-build kp-glass kp-hidden kp-town-only" data-ref="buildPanel"></div>
      <div class="kp-panel kp-list kp-glass kp-hidden kp-town-only" data-ref="townList"></div>
      <div class="kp-routes kp-journeys kp-glass kp-hidden kp-town-only" data-ref="journeyPanel"></div>
      <div class="kp-overlay kp-hidden" data-ref="paletteWrap">
        <div class="kp-palette kp-glass">
          <label class="kp-pal-input">${ICONS.search}<input data-ref="paletteInput" placeholder="${t('搜索宫殿、记忆桩或岛…')}" autocomplete="off" spellcheck="false"></label>
          <div class="kp-pal-list" data-ref="paletteList"></div>
          <div class="kp-pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> ${t('选择')}</span><span><kbd>Enter</kbd> ${t('前往')}</span><span><kbd>Esc</kbd> ${t('关闭')}</span></div>
        </div>
      </div>
      <div class="kp-overlay kp-center kp-hidden" data-ref="confirmWrap">
        <div class="kp-confirm kp-glass">
          <b data-ref="confirmTitle"></b>
          <p data-ref="confirmMsg"></p>
          <div class="kp-row"><button data-act="confirmNo">${t('取消')}</button><button class="kp-danger-strong" data-act="confirmYes" data-ref="confirmYes">${t('删除')}</button></div>
        </div>
      </div>`;
    this.v.root.insertAdjacentHTML('beforeend', html);
    this.v.root.querySelectorAll<HTMLElement>('[data-ref]').forEach(el => { this.v.ui[el.dataset.ref] = el; });
  }

  /** 世界 / 宫殿数据变化后刷新：品牌区统计、名牌、卡片、列表 */
  refresh() {
    const v = this.v;
    if (!this.region) return;
    const all = [...this.docs.values()];
    if (v.far) {
      const placed = this.world.regions.reduce((s, r) => s + r.palaces.filter(p => this.docs.has(p.palaceId)).length, 0);
      const loci = all.reduce((s, d) => s + W.palaceStats(d).loci, 0);
      v.ui.townTitle.textContent = this.world.name || t('记忆世界');
      v.ui.townSub.textContent = v.planet > .6
        ? `${t('{n} 座岛', { n: this.world.regions.length })} · ${t('拖动转动星球 · 滚轮拉近')}`
        : [t('{n} 座岛', { n: this.world.regions.length }), t('{n} 座宫殿', { n: placed }), t('{n} 个记忆桩', { n: loci })].join(' · ');
      v.ui.townMark.innerHTML = ICONS.globe;
    } else {
      const docs = this.region.palaces.map(p => this.docs.get(p.palaceId)).filter(Boolean);
      const loci = docs.reduce((s, d) => s + W.palaceStats(d).loci, 0);
      v.ui.townTitle.textContent = this.region.name;
      v.ui.townSub.textContent = docs.length ? `${t('{n} 座宫殿', { n: docs.length })} · ${t('{n} 个记忆桩', { n: loci })}` : t('还没有宫殿 · 点「建造宫殿」开始');
      v.ui.townMark.textContent = getTheme(this.region.theme).icon;
    }
    for (const s of this.town.shells.values()) {
      this.town.updateTag(s);
      s.tag.element.classList.toggle('kp-hot', s.id === this.hoveredId);
      s.tag.element.classList.toggle('kp-sel', s.id === this.selectedId);
    }
    for (const l of this.town.regions.values()) {
      l.updateTag(this.docs);
      l.tag.element.classList.toggle('kp-hot', l.region.id === this.hoveredRegion);
      l.tag.element.classList.toggle('kp-sel', l.region.id === this.selectedRegion);
    }
    if (this.selectedId && !this.docs.has(this.selectedId)) this.selectedId = null;
    if (this.selectedRegion && !this.regionById(this.selectedRegion)) this.selectedRegion = null;
    v.ui.townEditHint.innerHTML = v.far ? t('拖动岛换位置 · 岛和岛之间会留出海面') : t('拖动宫殿换位置 · <b>R</b> 旋转');
    this.renderCard();
    if (this.listOpen) this.renderList();
    this.updateUndoButtons();
    this.updateMarker();
  }

  /** 打开别的面板（好友）时，收起列表、旅程、建造面板 */
  closePanels() {
    this.closePanel();
    this.toggleList(false);
    this.toggleJourneys(false);
  }

  /** 进出宫殿之前：收起小镇里的各种临时状态 */
  beforeLevelChange() {
    if (this.v.social?.panelOpen) this.v.social.togglePanel(false);
    this.cancelPlacing();
    this.setEditing(false);
    this.closePanel();
    this.toggleList(false);
    this.toggleJourneys(false);
    this.selectedId = this.hoveredId = this.selectedRegion = this.hoveredRegion = null;
    this.tagHover = null;
    this.v.ui.townCard.classList.add('kp-hidden');
    this.v.setMarker(null);
    this.v.renderer.domElement.style.cursor = '';
    for (const s of this.town.shells.values()) s.tag.element.classList.remove('kp-hot', 'kp-sel');
    for (const l of this.town.regions.values()) l.tag.element.classList.remove('kp-hot', 'kp-sel');
  }

  /** 近看 ↔ 群岛视角切换 */
  onFarChange(far: boolean) {
    this.setEditing(false);
    this.cancelPlacing();
    this.closePanel();
    this.setHover(null);
    this.setRegionHover(null);
    if (far) this.select(null); else this.selectRegion(null);
    this.refresh();
  }

  highlights(): [THREE.Object3D, number][] {
    return [];
  }

  // =====================================================================
  // 拾取
  // =====================================================================

  private ray(e: { clientX: number; clientY: number }) {
    const v = this.v;
    v.raycaster.setFromCamera(v.ndc(e.clientX, e.clientY), v.isoCam);
    return v.raycaster;
  }

  /** 指针落在某座岛草地平面上的点（区域局部坐标） */
  private regionGround(e: { clientX: number; clientY: number }, regionId: string): Vec2 | null {
    const layer = this.layerOf(regionId);
    return layer ? this.town.groundOf(this.ray(e), layer) : null;
  }

  /** 指针下的宫殿：外壳 / 屋顶 → 正在预览的内部 → 地块 */
  private pickPalace(e: { clientX: number; clientY: number }): string | null {
    const v = this.v, ray = this.ray(e);
    const hit = this.town.pick(ray);
    if (hit) return hit.id;
    if (v.peek) {
      for (const h of ray.intersectObject(v.peek.built.root, true)) {
        let o: THREE.Object3D = h.object, vis = true;
        while (o) { if (!o.visible) { vis = false; break; } o = o.parent; }
        if (vis) return v.peek.id;
      }
    }
    return this.town.pickLot(ray);
  }

  private pickRegion(e: { clientX: number; clientY: number }) {
    return this.town.pickRegion(this.ray(e));
  }

  // =====================================================================
  // 悬停 / 选中
  // =====================================================================

  /** 每帧：处理悬停、屋顶预览、名牌详略 */
  update(_dt: number) {
    const v = this.v;
    const e = v.lastPointer;
    if (e && !v.camTween) {
      v.lastPointer = null;
      if (!e.buttons && !this.drag && !this.placing) {
        if (v.far) this.setRegionHover(this.pickRegion(e));
        else this.setHover(this.pickPalace(e) ?? this.tagHover);
        this.showTip(e);
      } else v.ui.tip.style.opacity = '0';
    }
    const busy = v.far || this.editing || !!this.placing || !!this.drag || !!v.camTween;
    const target = busy ? null : (this.hoveredId ?? this.selectedId);
    const ready = this.hoveredId ? performance.now() - this.hoverSince > PEEK_DELAY : true;
    if (target && ready && !(v.peek?.id === target && v.peek.open)) v.openPeek(target);
    else if (!target && v.peek?.open) v.closePeek();
    v.root.classList.toggle('kp-tags-near', v.frustum / v.isoCam.zoom < 46);
  }

  private setHover(id: string | null) {
    if (id === this.hoveredId) return;
    const old = this.hoveredId;
    this.hoveredId = id;
    this.hoverSince = performance.now();
    if (old) this.town.shells.get(old)?.tag.element.classList.remove('kp-hot');
    if (id) this.town.shells.get(id)?.tag.element.classList.add('kp-hot');
    this.v.renderer.domElement.style.cursor = id ? 'pointer' : '';
    const peek = this.v.peek;
    if (peek?.open && peek.id !== id && peek.id !== this.selectedId) this.v.closePeek();
    this.v.ui.townList.querySelectorAll('.kp-list-row[data-id]').forEach(r => r.classList.toggle('kp-hot', (r as HTMLElement).dataset.id === id));
    this.v.invalidate();
  }

  private setRegionHover(id: string | null) {
    if (id === this.hoveredRegion) return;
    const old = this.hoveredRegion;
    this.hoveredRegion = id;
    if (old) this.layerOf(old)?.tag.element.classList.remove('kp-hot');
    if (id) this.layerOf(id)?.tag.element.classList.add('kp-hot');
    this.v.renderer.domElement.style.cursor = id ? 'pointer' : '';
  }

  onPointerLeave() {
    if (!this.tagHover) this.setHover(null);
    this.setRegionHover(null);
    this.v.ui.tip.style.opacity = '0';
  }

  /** 悬停提示：名字 + 操作方式 */
  private showTip(e: { clientX: number; clientY: number }) {
    const v = this.v, tip = v.ui.tip;
    if (v.far) {
      const r = this.hoveredRegion && this.regionById(this.hoveredRegion);
      if (!r) { tip.style.opacity = '0'; return; }
      tip.innerHTML = `${escapeHtml(r.name)}<small>${this.editing ? t('拖动换位置') : t('双击前往 · 单击查看')}</small>`;
      v.placeTip(e);
      return;
    }
    const doc = this.hoveredId && !this.tagHover ? this.docs.get(this.hoveredId) : null;
    if (!doc) { tip.style.opacity = '0'; return; }
    tip.innerHTML = `${escapeHtml(doc.name)}<small>${this.editing ? t('拖动换位置 · R 旋转') : t('双击进入 · 单击查看')}</small>`;
    v.placeTip(e);
  }

  select(id: string | null) {
    const old = this.selectedId;
    this.selectedId = id;
    if (old) this.town.shells.get(old)?.tag.element.classList.remove('kp-sel');
    if (id) this.town.shells.get(id)?.tag.element.classList.add('kp-sel');
    if (old && old !== id && this.v.peek?.id === old && this.hoveredId !== old) this.v.closePeek();
    this.updateMarker();
    this.renderCard();
    this.v.ui.townList.querySelectorAll('.kp-list-row[data-id]').forEach(r => r.classList.toggle('kp-on', (r as HTMLElement).dataset.id === id));
  }

  selectRegion(id: string | null) {
    const old = this.selectedRegion;
    this.selectedRegion = id;
    if (old) this.layerOf(old)?.tag.element.classList.remove('kp-sel');
    if (id) this.layerOf(id)?.tag.element.classList.add('kp-sel');
    this.renderCard();
  }

  private updateMarker(valid = true) {
    const v = this.v;
    if (v.level !== 'town') return;
    const id = this.placing?.doc.id || (v.far ? null : this.selectedId);
    const s = id ? this.town.shells.get(id) : null;
    const layer = s && this.layerOf(s.regionId);
    if (!s || !layer) { v.setMarker(null); return; }
    const [x0, z0, x1, z1] = s.lot, [ox, oz] = W.regionOrigin(layer.region);
    const box = new THREE.Box3(new THREE.Vector3(ox + x0, 0, oz + z0), new THREE.Vector3(ox + x1, 0, oz + z1));
    v.setMarker(box, layer.lift + GRASS_Y + .07, .05, valid ? '#ef8235' : '#d9483b');
  }

  onClick(e: PointerEvent) {
    if (this.placing) return;
    if (this.v.far) this.selectRegion(this.pickRegion(e));
    else this.select(this.pickPalace(e));
  }

  onDblClick(e: MouseEvent) {
    if (this.editing || this.placing) return;
    if (this.v.far) {
      const rid = this.pickRegion(e);
      if (rid) this.v.flyToRegion(rid);
      return;
    }
    const id = this.pickPalace(e);
    if (id) this.v.enterPalace(id);
  }

  // =====================================================================
  // 卡片：宫殿 / 岛
  // =====================================================================

  private renderCard() {
    const v = this.v, card = v.ui.townCard;
    if (v.level !== 'town' || this.editing || this.placing) { card.classList.add('kp-hidden'); return; }
    if (this.selectedRegion) return this.renderRegionCard(this.selectedRegion);
    const id = this.selectedId;
    const doc = id && this.docs.get(id), placed = id && v.placementOf(id);
    if (!doc || !placed || v.far) { card.classList.add('kp-hidden'); return; }
    const st = W.palaceStats(doc);
    const color = placed.roofColor || W.palaceColor(doc);
    const bound = boundLoci(doc);
    const roof = placed.roof || 'auto';
    const roofs: [W.RoofKind, string][] = [['auto', t('自动')], ['flat', t('平顶')], ['gable', t('坡顶')], ['none', t('无')]];
    const here = v.regionOf(id);
    const others = this.world.regions.filter(r => r !== here);
    if (v.readonly) {
      // 参观好友 / 网页查看器：只能看
      card.innerHTML = `
        <button class="kp-close" data-act="townDeselect">×</button>
        <div class="kp-room">${v.visiting ? t('{name} 的宫殿', { name: escapeHtml(v.visiting.owner.name) }) : t('宫殿')}</div>
        <h3 class="kp-ro-name"></h3>
        <div class="kp-stats">${t('{n} 个房间', { n: st.rooms })} · ${t('{n} 个物件', { n: st.items })}${st.loci ? ` · 📌 ${t('{n} 个公开的记忆桩', { n: st.loci })}` : ''}</div>
        ${bound.length ? `<div class="kp-subtitle">${t('记忆桩')}</div><div class="kp-mini">${bound.slice(0, 4).map(it => `
          <button data-act="palaceLocus" data-item="${escapeHtml(locusKey(it.item.id, it.slot))}"><b>${escapeHtml(it.binding.title || '')}</b><span>${escapeHtml(v.locusName(it.item, it.slot))}</span></button>`).join('')}</div>` : ''}
        <div class="kp-row"><button class="kp-primary kp-grow" data-act="palaceEnter">${t('进去参观 →')}</button></div>`;
      card.querySelector('.kp-ro-name').textContent = doc.name;
      card.classList.remove('kp-hidden');
      return;
    }
    card.innerHTML = `
      <button class="kp-close" data-act="townDeselect">×</button>
      <div class="kp-room">${t('宫殿 · {time}更新', { time: escapeHtml(timeAgo(doc.updatedAt)) })}</div>
      <input class="kp-name" data-field="palaceName" maxlength="40" spellcheck="false">
      <div class="kp-stats">${t('{n} 个房间', { n: st.rooms })} · ${t('{n} 个物件', { n: st.items })} · 📌 ${st.loci}${v.dueCount(doc) ? ` · <b class="kp-due-text">${t('待复习 {n}', { n: v.dueCount(doc) })}</b>` : ''}</div>
      ${bound.length ? `<div class="kp-row kp-recall-row"><button class="kp-primary" data-act="palaceRecall" data-id="${escapeHtml(doc.id)}">${ICONS.route}<span>${t('进去回忆')}${v.dueCount(doc) ? ` · ${t('{n} 个待复习', { n: v.dueCount(doc) })}` : ''}</span></button></div>` : ''}
      ${bound.length ? `<div class="kp-subtitle">${t('记忆桩')}</div><div class="kp-mini">${bound.slice(0, 4).map(it => `
        <button data-act="palaceLocus" data-item="${escapeHtml(locusKey(it.item.id, it.slot))}"><b>${escapeHtml(it.binding.title || it.binding.blockId)}</b><span>${escapeHtml(v.locusName(it.item, it.slot))}</span></button>`).join('')}
        ${bound.length > 4 ? `<div class="kp-more-note">${t('还有 {n} 个…', { n: bound.length - 4 })}</div>` : ''}</div>` : ''}
      <div class="kp-subtitle">${t('主题色')}</div>
      <div class="kp-swatches kp-swatches-10">${W.PALACE_COLORS.map(c => `<span class="kp-swatch${c === color ? ' kp-on' : ''}" data-act="palaceColor" data-color="${c}" style="background:${c}" title="${c}"></span>`).join('')}</div>
      <div class="kp-subtitle">${t('屋顶')}</div>
      <div class="kp-seg kp-seg-full">${roofs.map(([k, l]) => `<button data-act="palaceRoof" data-roof="${k}" class="${roof === k ? 'kp-on' : ''}">${l}</button>`).join('')}</div>
      ${others.length ? `<label class="kp-field kp-move-to"><span>${t('搬到')}</span><select data-field="palaceRegion">
        <option value="">${escapeHtml(getTheme(here?.theme).icon + ' ' + (here?.name || ''))}${t('（当前）')}</option>
        ${others.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(getTheme(r.theme).icon + ' ' + r.name)}</option>`).join('')}
      </select></label>` : ''}
      ${v.social?.publishSection(doc) || ''}
      <div class="kp-row">
        <button data-act="palaceMove" title="${t('拖动到别处 / 旋转')}">${ICONS.move} ${t('移动')}</button>
        <button class="kp-danger" data-act="palaceDelete" title="${t('删除这座宫殿')}">${t('删除')}</button>
        <button class="kp-primary kp-grow" data-act="palaceEnter">${t('进入宫殿 →')}</button>
      </div>`;
    (card.querySelector('[data-field="palaceName"]') as HTMLInputElement).value = doc.name;
    card.classList.remove('kp-hidden');
  }

  private renderRegionCard(regionId: string) {
    const v = this.v, card = v.ui.townCard;
    const r = this.regionById(regionId);
    if (!r) { card.classList.add('kp-hidden'); return; }
    const theme = getTheme(r.theme);
    const docs = r.palaces.map(p => this.docs.get(p.palaceId)).filter(Boolean);
    const loci = docs.reduce((s, d) => s + W.palaceStats(d).loci, 0);
    const last = this.world.regions.length <= 1;
    card.innerHTML = `
      <button class="kp-close" data-act="regionDeselect">×</button>
      <div class="kp-room">${t('岛屿')} · ${theme.icon} ${escapeHtml(t(theme.name))}</div>
      <input class="kp-name" data-field="regionName" maxlength="40" spellcheck="false">
      <div class="kp-stats">${t('{n} 座宫殿', { n: docs.length })} · 📌 ${loci}</div>
      <div class="kp-subtitle">${t('场景')}</div>
      <div class="kp-themes">${THEMES.map(th => `
        <button class="kp-theme${th.id === r.theme ? ' kp-on' : ''}" data-act="regionTheme" data-theme="${th.id}" title="${escapeHtml(t(th.desc))}">
          <i style="background:linear-gradient(135deg, ${th.colors[0]} 0 55%, ${th.colors[1]} 55% 78%, ${th.colors[2]} 78%)">${th.icon}</i><span>${escapeHtml(t(th.name))}</span>
        </button>`).join('')}</div>
      ${docs.length ? `<div class="kp-subtitle">${t('岛上的宫殿')}</div><div class="kp-mini">${docs.slice(0, 5).map(d => `
        <button data-act="regionPalace" data-id="${escapeHtml(d.id)}"><b>${escapeHtml(d.name)}</b><span>📌 ${W.palaceStats(d).loci}</span></button>`).join('')}
        ${docs.length > 5 ? `<div class="kp-more-note">${t('还有 {n} 座…', { n: docs.length - 5 })}</div>` : ''}</div>` : `<div class="kp-note-sm">${t('这座岛还是空的，前往后点「建造宫殿」。')}</div>`}
      <div class="kp-row">
        <button class="kp-danger" data-act="regionDelete" ${docs.length || last ? 'disabled' : ''} title="${last ? t('至少要保留一座岛') : docs.length ? t('先把岛上的宫殿搬走或删除') : t('删除这座空岛')}">${t('删除')}</button>
        <button class="kp-primary kp-grow" data-act="regionGo">${t('前往 →')}</button>
      </div>`;
    (card.querySelector('[data-field="regionName"]') as HTMLInputElement).value = r.name;
    card.classList.remove('kp-hidden');
  }

  onInput(e: Event, commit: boolean) {
    if (this.journeys.onInput(e, commit)) return;
    const el = e.target as HTMLInputElement;
    const field = el.dataset?.field;
    if (field === 'palaceName' && this.selectedId) {
      const doc = this.docs.get(this.selectedId), s = this.town.shells.get(this.selectedId);
      if (!doc) return;
      const name = el.value.trim();
      if (!name) { if (commit) el.value = doc.name; return; }
      doc.name = name;
      if (s) this.town.updateTag(s);
      if (commit) {
        doc.updatedAt = Date.now();
        this.v.host.onDocChange?.(doc);
        this.refresh();
      }
      this.v.invalidate();
    } else if (field === 'regionName') {
      const r = this.regionById(this.selectedRegion || this.region.id);
      if (!r) return;
      const name = el.value.trim();
      if (!name) { if (commit) el.value = r.name; return; }
      r.name = name;
      this.layerOf(r.id)?.updateTag(this.docs);
      if (commit) { this.v.worldChanged(); }
      this.v.invalidate();
    } else if (field === 'palaceRegion' && commit && el.value && this.selectedId) {
      this.movePalaceTo(this.selectedId, el.value);
    }
  }

  // =====================================================================
  // 布置：拖动 / 旋转宫殿；群岛视角下拖动岛
  // =====================================================================

  setEditing(on: boolean) {
    if (on === this.editing) return;
    if (on && this.v.readonly) return;
    if (on) { this.cancelPlacing(); this.closePanel(); this.toggleList(false); this.v.closePeek(); }
    this.editing = on;
    this.drag = null;
    this.v.root.classList.toggle('kp-town-editing', on);
    this.renderCard();
    this.updateMarker();
    this.updateUndoButtons();
    this.v.invalidate();
  }

  /** 可撤销的状态：所有岛（位置、名字、场景）和岛上宫殿的摆放 */
  private snapshot() {
    return JSON.stringify(this.world.regions);
  }

  private pushUndo(before: string) {
    if (before === this.snapshot()) return false;
    this.undoStack.push(before);
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    this.updateUndoButtons();
    return true;
  }

  private commitPalaces(before: string, regionId: string) {
    if (!this.pushUndo(before)) return;
    this.town.rebuildLand(regionId, this.docs);
    this.v.settleRegions();
    this.v.worldChanged();
  }

  private restore(json: string) {
    const v = this.v;
    const cur = this.region?.id;
    this.world.regions = JSON.parse(json);
    v.region = this.world.regions.find(r => r.id === cur) || this.world.regions[0];
    v.closePeek(true);
    this.selectedId = this.selectedRegion = null;
    this.town.build(this.world, this.docs);
    this.town.setFar(v.far);
    v.settleRegions();
    v.worldChanged();
    v.invalidate(3);
  }

  private undo() {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
  }

  private redo() {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  private updateUndoButtons() {
    this.v.ui.townUndo?.toggleAttribute('disabled', !this.undoStack.length);
    this.v.ui.townRedo?.toggleAttribute('disabled', !this.redoStack.length);
  }

  private rotateSelected() {
    const id = this.placing?.doc.id || this.selectedId;
    const s = id && this.town.shells.get(id);
    const region = s && this.regionById(s.regionId);
    if (!s || !region) { this.v.host.notify?.(t('先点选一座宫殿')); return; }
    const [cx, cz] = W.rectCenter(s.lot);
    const rot = W.normRot(s.placed.rot + 90);
    const pos = W.posForLotCenter(s.doc, rot, cx, cz);
    if (this.placing) {
      Object.assign(s.placed, { rot, pos });
      this.town.placeShell(s);
      this.placing.valid = W.canPlace(region, this.docs, s.placed, s.doc);
      this.updateMarker(this.placing.valid);
      this.v.invalidate();
      return;
    }
    if (!W.canPlace(region, this.docs, { ...s.placed, rot, pos }, s.doc)) {
      this.v.host.notify?.(t('这里转不开，先把宫殿挪到空一点的地方'));
      return;
    }
    const before = this.snapshot();
    Object.assign(s.placed, { rot, pos });
    this.town.placeShell(s);
    this.commitPalaces(before, region.id);
    this.updateMarker();
  }

  /** 岛之间是否留够了海面 */
  private regionFits(region: W.WorldRegion) {
    const radii = this.town.radii();
    const me = W.regionCircle(region, this.docs, radii);
    return this.world.regions.every(o => {
      if (o === region) return true;
      const c = W.regionCircle(o, this.docs, radii);
      return Math.hypot(c.x - me.x, c.z - me.z) >= c.r + me.r + W.SEA_GAP - .5;
    });
  }

  // =====================================================================
  // 建造新宫殿 / 开辟新岛
  // =====================================================================

  private openBuild() {
    const v = this.v, panel = v.ui.buildPanel;
    this.setEditing(false);
    this.toggleList(false);
    this.select(null);
    const n = this.region.palaces.length + 1;
    panel.innerHTML = `
      <div class="kp-panel-head"><b>${t('在「{name}」建造一座新宫殿', { name: escapeHtml(this.region.name) })}</b><button class="kp-close" data-act="closePanel">×</button></div>
      <label class="kp-field kp-name-field"><span>${t('名称')}</span><input class="kp-text" data-ref="newName" maxlength="40" spellcheck="false"></label>
      <div class="kp-templates">${TEMPLATES.map(tpl => `
        <button class="kp-tpl" data-act="pickTemplate" data-tpl="${tpl.id}">
          <div class="kp-tpl-art">${this.planSvg(tpl.id)}</div>
          <b>${escapeHtml(t(tpl.name))}</b><small>${escapeHtml(t(tpl.desc))}</small>
        </button>`).join('')}</div>
      <div class="kp-note">${t('选一个模板，然后在岛上点击空地放下。之后可以在宫殿里随意改造。')}</div>`;
    const input = panel.querySelector('input') as HTMLInputElement;
    input.value = t('新宫殿 {n}', { n });
    v.ui.newName = input;
    this.panel = 'build';
    panel.classList.remove('kp-hidden');
    input.focus();
    input.select();
  }

  private openNewIsland() {
    const v = this.v, panel = v.ui.buildPanel;
    this.setEditing(false);
    this.toggleList(false);
    this.selectRegion(null);
    panel.innerHTML = `
      <div class="kp-panel-head"><b>${t('开辟一座新岛')}</b><button class="kp-close" data-act="closePanel">×</button></div>
      <label class="kp-field kp-name-field"><span>${t('名称')}</span><input class="kp-text" data-ref="newName" maxlength="40" spellcheck="false" placeholder="${t('不填就按场景起名')}"></label>
      <div class="kp-templates">${THEMES.map(th => `
        <button class="kp-tpl" data-act="pickTheme" data-theme="${th.id}">
          <div class="kp-tpl-art">${this.themeArt(th.id)}</div>
          <b>${th.icon} ${escapeHtml(t(th.name))}</b><small>${escapeHtml(t(th.desc))}</small>
        </button>`).join('')}</div>
      <div class="kp-note">${t('新岛会出现在群岛旁边，之后可以在「布置岛屿」里拖到别处，也可以在岛屿设置里换场景。')}</div>`;
    const input = panel.querySelector('input') as HTMLInputElement;
    v.ui.newName = input;
    this.panel = 'island';
    panel.classList.remove('kp-hidden');
    input.focus();
  }

  private closePanel() {
    this.panel = null;
    this.v.ui.buildPanel.classList.add('kp-hidden');
  }

  /** 模板的迷你平面图 */
  private planSvg(id: string) {
    if (this.planCache.has(id)) return this.planCache.get(id);
    const doc = createFromTemplate(id, 'x');
    const rooms = doc.rooms.filter(r => r.floor);
    const bb = W.bboxOf(rooms.map(r => r.rect));
    const pad = .6, w = bb[2] - bb[0] + pad * 2, h = bb[3] - bb[1] + pad * 2;
    const fills: Record<string, string> = { oak: '#e6cfae', oakWarm: '#d4b08a', deck: '#bfa089', tileLarge: '#e9e4dc', tileBath: '#d9e4e0', cement: '#dcd3c6' };
    const svg = `<svg viewBox="${bb[0] - pad} ${bb[1] - pad} ${w} ${h}" preserveAspectRatio="xMidYMid meet">${rooms.map(r => {
      const [x0, z0, x1, z1] = r.rect;
      return `<rect x="${x0}" y="${z0}" width="${x1 - x0}" height="${z1 - z0}" fill="${fills[r.floor] || '#e6cfae'}" stroke="#4a4139" stroke-width="${Math.max(w, h) * .018}"/>`;
    }).join('')}</svg>`;
    this.planCache.set(id, svg);
    return svg;
  }

  /** 场景主题的小插图：海 + 海岸 + 岛 + 图标 */
  private themeArt(id: string) {
    const t = getTheme(id), [g, shore, accent] = t.colors;
    const floating = !!t.lift;
    return `<svg viewBox="0 0 100 70">
      <rect width="100" height="70" rx="8" fill="${floating ? '#dcecf5' : '#9fd3cf'}"/>
      ${floating ? `<path d="M22 36 Q50 72 78 36 Z" fill="#8b7e6f"/><ellipse cx="30" cy="54" rx="12" ry="5" fill="#fff"/><ellipse cx="72" cy="58" rx="10" ry="4" fill="#fff"/>` : `<ellipse cx="50" cy="38" rx="38" ry="22" fill="${shore}"/>`}
      <ellipse cx="50" cy="${floating ? 34 : 36}" rx="${floating ? 30 : 33}" ry="${floating ? 12 : 18}" fill="${g}"/>
      <circle cx="${floating ? 60 : 64}" cy="${floating ? 30 : 30}" r="5" fill="${accent}"/>
      <text x="50" y="${floating ? 36 : 42}" font-size="18" text-anchor="middle">${t.icon}</text>
    </svg>`;
  }

  private startPlacing(tplId: string) {
    const v = this.v, region = this.region;
    const name = ((v.ui.newName as HTMLInputElement)?.value || '').trim() || t('新宫殿 {n}', { n: region.palaces.length + 1 });
    const doc = createFromTemplate(tplId, name);
    const used = new Set([...this.docs.values()].map(d => W.palaceColor(d)));
    doc.color = W.PALACE_COLORS.find(c => !used.has(c)) || W.palaceColor(doc);
    const tgt = v.orbit.target, [ox, oz] = W.regionOrigin(region);
    const pos = W.findFreeSpot(region, this.docs, doc, 0, [Math.round(tgt.x - ox), Math.round(tgt.z - oz)]);
    const placed: W.PlacedPalace = { palaceId: doc.id, pos, rot: 0 };
    this.town.addShell(region, placed, doc);
    this.placing = { doc, placed, regionId: region.id, valid: true, down: null };
    this.closePanel();
    this.select(null);
    v.root.classList.add('kp-town-placing');
    v.ui.townPlaceHint.innerHTML = t('把「{name}」放到岛上：点击空地放下 · <b>R</b> 旋转 · <b>Esc</b> 取消', { name: escapeHtml(name) });
    this.updateMarker(true);
    v.invalidate();
  }

  private movePlacing(e: { clientX: number; clientY: number }) {
    const p = this.placing;
    const g = p && this.regionGround(e, p.regionId);
    if (!g) return;
    const pos = W.posForLotCenter(p.doc, p.placed.rot, g[0], g[1]);
    if (pos[0] === p.placed.pos[0] && pos[1] === p.placed.pos[1]) return;
    p.placed.pos = pos;
    const s = this.town.shells.get(p.doc.id);
    if (s) this.town.placeShell(s);
    p.valid = W.canPlace(this.regionById(p.regionId), this.docs, p.placed, p.doc);
    this.updateMarker(p.valid);
    this.v.invalidate();
  }

  private commitPlacing() {
    const p = this.placing;
    if (!p) return;
    if (!p.valid) { this.v.host.notify?.(t('这里放不下：离其他宫殿或广场太近了')); return; }
    const region = this.regionById(p.regionId);
    this.placing = null;
    this.v.root.classList.remove('kp-town-placing');
    this.docs.set(p.doc.id, p.doc);
    region.palaces.push(p.placed);
    this.undoStack = [];
    this.redoStack = [];
    this.v.host.onDocChange?.(p.doc);
    this.town.rebuildLand(region.id, this.docs);
    this.v.settleRegions();
    this.v.worldChanged();
    this.v.setMarker(null);
    this.v.host.notify?.(t('「{name}」建好了', { name: p.doc.name }));
    this.v.enterPalace(p.doc.id);
  }

  private cancelPlacing() {
    const p = this.placing;
    if (!p) return;
    this.placing = null;
    this.town.removeShell(p.doc.id);
    this.v.root.classList.remove('kp-town-placing');
    this.updateMarker();
    this.v.invalidate();
  }

  private createIsland(themeId: string) {
    const v = this.v, theme = getTheme(themeId);
    let name = ((v.ui.newName as HTMLInputElement)?.value || '').trim();
    if (!name) {
      const base = t(W.THEME_NAMES[themeId] || '新的岛');
      const taken = new Set(this.world.regions.map(r => r.name));
      name = base;
      for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
    }
    const before = this.snapshot();
    const region = W.createRegion(name, theme.id);
    region.origin = W.findRegionSpot(this.world, this.docs, region, this.town.radii());
    this.world.regions.push(region);
    this.town.addRegion(region, this.docs);
    this.town.updateBounds();
    v.settleRegions();
    this.pushUndo(before);
    this.closePanel();
    v.worldChanged();
    v.flyToRegion(region.id, 1.4);
    v.host.notify?.(t('「{name}」开辟好了，点「建造宫殿」建第一座宫殿吧', { name }));
  }

  // =====================================================================
  // 岛：换场景 / 删除；宫殿：搬到别的岛 / 删除
  // =====================================================================

  private setTheme(regionId: string, themeId: string) {
    const v = this.v, r = this.regionById(regionId);
    if (!r || r.theme === themeId) return;
    const before = this.snapshot();
    v.closePeek(true);
    r.theme = themeId;
    this.town.addRegion(r, this.docs);
    this.town.setFar(v.far);
    this.town.updateBounds();
    v.settleRegions();
    this.pushUndo(before);
    v.worldChanged();
    v.invalidate(3);
  }

  private async deleteRegion(regionId: string) {
    const v = this.v, r = this.regionById(regionId);
    if (!r || r.palaces.some(p => this.docs.has(p.palaceId)) || this.world.regions.length <= 1) return;
    const ok = await this.confirm(t('删除「{name}」？', { name: r.name }), t('这是一座空岛，删除后它会从群岛里消失。'), t('删除'));
    if (!ok) return;
    const before = this.snapshot();
    this.selectRegion(null);
    this.world.regions = this.world.regions.filter(x => x !== r);
    this.town.removeRegion(r.id);
    this.town.updateBounds();
    if (v.region === r) v.region = this.world.regions[0];
    this.pushUndo(before);
    v.worldChanged();
    v.invalidate(3);
  }

  private movePalaceTo(id: string, targetId: string) {
    const v = this.v;
    const from = v.regionOf(id);
    const before = this.snapshot();
    const placed = W.movePalaceToRegion(this.world, this.docs, id, targetId);
    if (!placed || !from) return;
    v.closePeek(true);
    this.select(null);
    v.refreshShell(id, true);
    this.town.rebuildLand(from.id, this.docs);
    v.settleRegions();
    this.pushUndo(before);
    v.worldChanged();
    const target = this.regionById(targetId);
    v.flyToRegion(targetId, 1.3);
    this.select(id);
    v.host.notify?.(t('已把「{palace}」搬到「{island}」', { palace: this.docs.get(id)?.name ?? '', island: target?.name ?? '' }));
  }

  private async deletePalace(id: string) {
    const v = this.v, doc = this.docs.get(id), region = v.regionOf(id);
    if (!doc || !region) return;
    const st = W.palaceStats(doc);
    const ok = await this.confirm(t('删除「{name}」？', { name: doc.name }), st.loci
      ? t('宫殿里的 {items} 个物件和 {loci} 个记忆桩绑定会一起删除，笔记本身不受影响。此操作无法撤销。', { items: st.items, loci: st.loci })
      : t('宫殿里的 {n} 个物件会一起删除，笔记本身不受影响。此操作无法撤销。', { n: st.items }), t('删除'));
    if (!ok || !this.docs.has(id)) return;
    v.closePeek(true);
    this.select(null);
    region.palaces = region.palaces.filter(p => p.palaceId !== id);
    this.docs.delete(id);
    this.town.removeShell(id);
    this.town.rebuildLand(region.id, this.docs);
    this.undoStack = [];
    this.redoStack = [];
    // 旅程里这座宫殿的段一起去掉
    pruneJourneys(this.world, pid => this.docs.has(pid));
    v.host.onDocDelete?.(id);
    v.worldChanged();
    this.journeys.render();
    v.host.notify?.(t('已删除「{name}」', { name: doc.name }));
    v.invalidate(3);
  }

  private confirm(title: string, msg: string, ok: string) {
    const v = this.v;
    v.ui.confirmTitle.textContent = title;
    v.ui.confirmMsg.textContent = msg;
    v.ui.confirmYes.textContent = ok;
    v.ui.confirmWrap.classList.remove('kp-hidden');
    return new Promise<boolean>((resolve) => {
      this.confirmResolve?.(false);
      this.confirmResolve = resolve;
    });
  }

  private closeConfirm(ok: boolean) {
    this.v.ui.confirmWrap.classList.add('kp-hidden');
    const r = this.confirmResolve;
    this.confirmResolve = null;
    r?.(ok);
    this.v.root.focus({ preventScroll: true });
  }

  // =====================================================================
  // 列表（按岛分组）
  // =====================================================================

  private toggleList(on = !this.listOpen) {
    this.listOpen = on;
    const v = this.v;
    if (on && this.journeys.open) this.toggleJourneys(false);
    v.ui.townList.classList.toggle('kp-hidden', !on);
    v.ui.segMap?.classList.toggle('kp-on', !on && !this.journeys.open);
    v.ui.segList?.classList.toggle('kp-on', on);
    if (on) { this.closePanel(); this.renderList(); }
  }

  /** 旅程面板：打开时名牌上标出每座宫殿是第几段 */
  toggleJourneys(on = !this.journeys.open) {
    if (on === this.journeys.open) return;
    const v = this.v;
    if (on) { this.toggleList(false); this.closePanel(); }
    this.journeys.toggle(on);
    v.ui.segJourney?.classList.toggle('kp-on', on);
    v.ui.segMap?.classList.toggle('kp-on', !on && !this.listOpen);
    for (const s of this.town.shells.values()) this.town.updateTag(s);
  }

  private renderList() {
    const v = this.v;
    const regions = [...this.world.regions].sort((a, b) => (a === this.region ? -1 : b === this.region ? 1 : 0));
    const total = regions.reduce((s, r) => s + r.palaces.filter(p => this.docs.has(p.palaceId)).length, 0);
    const row = (d: PalaceDoc) => {
      const st = W.palaceStats(d), placed = v.placementOf(d.id);
      const color = placed?.roofColor || W.palaceColor(d);
      return `<div class="kp-list-row${d.id === this.selectedId ? ' kp-on' : ''}" data-id="${escapeHtml(d.id)}">
        <button class="kp-list-main" data-act="listPick" data-id="${escapeHtml(d.id)}">
          <i style="background:${color}"></i>
          <span><b>${escapeHtml(d.name)}</b><small>${t('{n} 个房间', { n: st.rooms })} · ${t('{n} 个物件', { n: st.items })} · 📌 ${st.loci} · ${escapeHtml(timeAgo(d.updatedAt))}</small></span>
        </button>
        <button class="kp-list-go" data-act="listEnter" data-id="${escapeHtml(d.id)}" title="${t('进入')}">→</button>
      </div>`;
    };
    v.ui.townList.innerHTML = `
      <div class="kp-panel-head"><b>${t('全部宫殿 · {n}', { n: total })}</b><button class="kp-close" data-act="viewMap">×</button></div>
      <div class="kp-list-body">${regions.map(r => {
        const docs = r.palaces.map(p => this.docs.get(p.palaceId)).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
        return `<button class="kp-list-group" data-act="listRegion" data-region="${escapeHtml(r.id)}">
            <em>${getTheme(r.theme).icon}</em><b>${escapeHtml(r.name)}</b><small>${t('{n} 座', { n: docs.length })}</small></button>
          ${docs.map(row).join('') || `<div class="kp-empty kp-empty-sm">${t('空岛')}</div>`}`;
      }).join('')}</div>
      <button class="kp-list-add" data-act="${v.far ? 'newIsland' : 'buildPalace'}">${ICONS.plus}<span>${v.far ? t('开辟新岛') : t('建造宫殿')}</span></button>`;
  }

  // =====================================================================
  // ⌘K 快速跳转
  // =====================================================================

  openPalette() {
    const v = this.v;
    v.ui.paletteWrap.classList.remove('kp-hidden');
    const input = v.ui.paletteInput as HTMLInputElement;
    input.value = '';
    this.paletteSel = 0;
    this.renderPalette();
    requestAnimationFrame(() => input.focus());
  }

  closePalette() {
    this.v.ui.paletteWrap.classList.add('kp-hidden');
    this.v.root.focus({ preventScroll: true });
  }

  private get paletteOpen() { return !this.v.ui.paletteWrap.classList.contains('kp-hidden'); }

  private renderPalette(recompute = true) {
    const v = this.v;
    if (recompute) {
      const q = (v.ui.paletteInput as HTMLInputElement).value.trim().toLowerCase();
      const tokens = q.split(/\s+/).filter(Boolean);
      const match = (s: string) => tokens.every(tok => s.toLowerCase().includes(tok));
      const out: PaletteItem[] = [];
      const currentId = v.level === 'palace' ? v.doc?.id : null;
      for (const r of this.world.regions) {
        const icon = getTheme(r.theme).icon;
        for (const p of r.palaces) {
          const d = this.docs.get(p.palaceId);
          if (!d) continue;
          const st = W.palaceStats(d);
          const color = p.roofColor || W.palaceColor(d);
          if (match(d.name + ' ' + r.name)) out.push({ kind: 'palace', id: d.id, title: d.name, sub: `${d.id === currentId ? t('当前所在 · ') : ''}${icon} ${r.name} · ${t('{n} 个房间', { n: st.rooms })} · 📌 ${st.loci}`, color });
        }
      }
      if (tokens.length) {
        for (const r of this.world.regions) {
          const th = getTheme(r.theme), thName = t(th.name);
          if (match(r.name + ' ' + thName + ' ' + th.name)) out.push({ kind: 'region', id: r.id, title: `${th.icon} ${r.name}`, sub: `${thName} · ${t('{n} 座宫殿', { n: r.palaces.length })}`, color: th.colors[0] });
        }
        for (const r of this.world.regions) {
          for (const p of r.palaces) {
            const d = this.docs.get(p.palaceId);
            if (!d) continue;
            const color = p.roofColor || W.palaceColor(d);
            for (const { item: it, slot, binding } of boundLoci(d)) {
              const title = binding.title || binding.blockId, where = `${v.locusName(it, slot)} · ${d.name}`;
              if (match(title + ' ' + where)) out.push({ kind: 'locus', id: d.id, item: locusKey(it.id, slot), title, sub: where, color });
              if (out.length > 80) break;
            }
          }
        }
      }
      this.palette = out.slice(0, 60);
      this.paletteSel = Math.min(this.paletteSel, Math.max(0, this.palette.length - 1));
    }
    const kinds = { palace: t('宫殿'), locus: t('记忆桩'), region: t('岛') };
    const list = v.ui.paletteList;
    list.innerHTML = this.palette.map((it, i) => `
      <button class="kp-pal-row${i === this.paletteSel ? ' kp-on' : ''}" data-act="palPick" data-i="${i}">
        <i style="background:${it.color}"></i>${it.kind === 'locus' ? '<em>📌</em>' : ''}
        <span><b>${escapeHtml(it.title)}</b><small>${escapeHtml(it.sub)}</small></span>
        <kbd>${kinds[it.kind]}</kbd>
      </button>`).join('') || `<div class="kp-empty">${t('没有找到匹配的宫殿、记忆桩或岛')}</div>`;
    list.querySelector('.kp-on')?.scrollIntoView({ block: 'nearest' });
  }

  private pickPalette(it: PaletteItem) {
    this.closePalette();
    const v = this.v;
    if (it.kind === 'region') {
      if (v.level === 'palace') { v.exitPalace(); setTimeout(() => v.flyToRegion(it.id), 1200); } else v.flyToRegion(it.id);
    } else if (it.kind === 'palace') v.enterPalace(it.id);
    else v.enterPalace(it.id, { focusItem: it.item });
  }

  // =====================================================================
  // 指针 / 键盘 / 按钮
  // =====================================================================

  /** 捕获阶段的 pointerdown；返回 true 表示接管（不平移视角） */
  onPointerDown(e: PointerEvent): boolean {
    if (e.button !== 0) return false;
    if (this.placing) { this.placing.down = { x: e.clientX, y: e.clientY }; return false; }
    if (!this.editing) return false;
    const v = this.v;
    if (v.far) {
      const rid = this.pickRegion(e);
      const r = rid && this.regionById(rid), layer = rid && this.layerOf(rid);
      const g = layer && this.town.groundOf(this.ray(e), layer);
      if (!r || !g) return false;
      this.selectRegion(rid);
      const o = W.regionOrigin(r);
      // groundOf 返回区域局部坐标：原点偏移就是 -g
      this.drag = { kind: 'region', id: rid, offset: [-g[0], -g[1]], orig: [...o] as Vec2, before: this.snapshot(), valid: true, moved: false };
    } else {
      const id = this.pickPalace(e);
      const s = id && this.town.shells.get(id);
      const g = s && this.regionGround(e, s.regionId);
      if (!s || !g) return false;
      this.select(id);
      this.drag = { kind: 'palace', id, regionId: s.regionId, offset: [s.placed.pos[0] - g[0], s.placed.pos[1] - g[1]], orig: [...s.placed.pos] as Vec2, before: this.snapshot(), valid: true, moved: false };
    }
    try { v.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* 合成事件 */ }
    return true;
  }

  onPointerMove(e: PointerEvent): boolean {
    if (this.placing && !e.buttons) { this.movePlacing(e); return true; }
    const d = this.drag;
    if (!d) return false;
    if (d.kind === 'region') {
      const r = this.regionById(d.id), layer = this.layerOf(d.id);
      const g = layer && this.town.groundOf(this.ray(e), layer);
      if (!r || !g) return true;
      // g 是相对当前原点的局部坐标：换算成世界坐标再加偏移
      const o = W.regionOrigin(r);
      const next: Vec2 = [Math.round(o[0] + g[0] + d.offset[0]), Math.round(o[1] + g[1] + d.offset[1])];
      if (next[0] !== o[0] || next[1] !== o[1]) {
        r.origin = next;
        layer.place();
        d.valid = this.regionFits(r);
        d.moved = true;
        layer.tag.element.classList.toggle('kp-bad', !d.valid);
        this.v.invalidate();
      }
      return true;
    }
    const g = this.regionGround(e, d.regionId), s = this.town.shells.get(d.id), region = this.regionById(d.regionId);
    if (!g || !s || !region) return true;
    const pos: Vec2 = [Math.round(g[0] + d.offset[0]), Math.round(g[1] + d.offset[1])];
    if (pos[0] !== s.placed.pos[0] || pos[1] !== s.placed.pos[1]) {
      s.placed.pos = pos;
      this.town.placeShell(s);
      d.valid = W.canPlace(region, this.docs, s.placed, s.doc);
      d.moved = true;
      this.updateMarker(d.valid);
      this.v.invalidate();
    }
    return true;
  }

  onPointerUp(e: PointerEvent): boolean {
    const p = this.placing;
    if (p) {
      const down = p.down;
      p.down = null;
      if (!down || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return !!down;
      this.movePlacing(e);
      this.commitPlacing();
      return true;
    }
    const d = this.drag;
    if (!d) return false;
    this.drag = null;
    if (d.kind === 'region') {
      const r = this.regionById(d.id), layer = this.layerOf(d.id);
      layer?.tag.element.classList.remove('kp-bad');
      if (r && d.moved) {
        if (d.valid) {
          this.pushUndo(d.before);
          this.town.updateBounds();
          this.v.worldChanged();
        } else {
          r.origin = d.orig;
          layer?.place();
          this.v.host.notify?.(t('离其他岛太近了，岛和岛之间要留出一片海'));
        }
      }
      this.v.invalidate();
      return true;
    }
    const s = this.town.shells.get(d.id);
    if (s && d.moved) {
      if (d.valid) this.commitPalaces(d.before, d.regionId);
      else {
        s.placed.pos = d.orig;
        this.town.placeShell(s);
        this.v.host.notify?.(t('这里放不下：离其他宫殿或广场太近了'));
      }
    }
    this.updateMarker();
    this.v.invalidate();
    return true;
  }

  /** 两个层级都生效的快捷键（⌘K、弹层里的 Esc） */
  onGlobalKey(e: KeyboardEvent): boolean {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      if (this.paletteOpen) this.closePalette(); else this.openPalette();
      return true;
    }
    if (e.key === 'Escape') {
      if (this.confirmResolve) { this.closeConfirm(false); return true; }
      if (this.paletteOpen) { this.closePalette(); return true; }
    }
    return false;
  }

  /** 小镇层级的按键；返回 true 表示已处理 */
  onKey(e: KeyboardEvent): boolean {
    const k = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey;
    if (this.editing && mod && k === 'z') { if (e.shiftKey) this.redo(); else this.undo(); return true; }
    if (this.editing && mod && k === 'y') { this.redo(); return true; }
    if (mod) return false;
    if (k === 'escape') {
      if (this.placing) this.cancelPlacing();
      else if (this.panel) this.closePanel();
      else if (this.editing) this.setEditing(false);
      else if (this.listOpen) this.toggleList(false);
      else if (this.journeys.open) this.toggleJourneys(false);
      else if (this.selectedId) this.select(null);
      else if (this.selectedRegion) this.selectRegion(null);
      else return false;
      return true;
    }
    if (k === 'r' && !this.v.far && (this.editing || this.placing)) { this.rotateSelected(); return true; }
    if (k === 'b' && !this.placing) { this.setEditing(!this.editing); return true; }
    if (k === 'enter' && !this.editing) {
      if (this.v.far && this.selectedRegion) { this.v.flyToRegion(this.selectedRegion); return true; }
      if (!this.v.far && this.selectedId) { this.v.enterPalace(this.selectedId); return true; }
    }
    if ((k === 'delete' || k === 'backspace') && this.editing && this.selectedId && !this.v.far) { void this.deletePalace(this.selectedId); return true; }
    return false;
  }

  onAction(act: string, el: HTMLElement, _e: MouseEvent): boolean {
    const v = this.v;
    switch (act) {
      case 'palette': this.openPalette(); return true;
      case 'palPick': { const it = this.palette[Number(el.dataset.i)]; if (it) this.pickPalette(it); return true; }
      case 'confirmYes': this.closeConfirm(true); return true;
      case 'confirmNo': this.closeConfirm(false); return true;
    }
    if (v.level !== 'town') return false;
    if (this.journeys.onAction(act, el)) return true;
    const id = this.selectedId;
    switch (act) {
      case 'tag': if (!this.placing && !v.far) this.select(el.dataset.id); return true;
      case 'regionTag': if (!this.editing) this.selectRegion(el.dataset.id); return true;
      case 'buildPalace':
        if (v.far) { v.flyToRegion(this.region.id); setTimeout(() => this.openBuild(), 900); } else this.openBuild();
        return true;
      case 'newIsland': this.openNewIsland(); return true;
      case 'closePanel': this.closePanel(); return true;
      case 'pickTemplate': this.startPlacing(el.dataset.tpl); return true;
      case 'pickTheme': this.createIsland(el.dataset.theme); return true;
      case 'townPlaceCancel': this.cancelPlacing(); return true;
      case 'townEdit': this.setEditing(true); return true;
      case 'townEditDone': this.setEditing(false); return true;
      case 'townRotate': this.rotateSelected(); return true;
      case 'townUndo': this.undo(); return true;
      case 'townRedo': this.redo(); return true;
      case 'townDeselect': this.select(null); return true;
      case 'regionDeselect': this.selectRegion(null); return true;
      case 'toWorld': this.select(null); v.flyToWorld(); return true;
      case 'toPlanet': this.select(null); this.selectRegion(null); v.flyToPlanet(); return true;
      case 'regionSettings': this.selectRegion(this.region.id); return true;
      case 'regionGo': {
        const rid = this.selectedRegion;
        this.selectRegion(null);
        if (rid) v.flyToRegion(rid);
        return true;
      }
      case 'regionTheme': if (this.selectedRegion) this.setTheme(this.selectedRegion, el.dataset.theme); return true;
      case 'regionDelete': if (this.selectedRegion) void this.deleteRegion(this.selectedRegion); return true;
      case 'regionPalace': {
        const pid = el.dataset.id, rid = v.regionOf(pid)?.id;
        this.selectRegion(null);
        if (rid) { v.flyToRegion(rid); this.select(pid); }
        return true;
      }
      case 'viewMap': this.toggleList(false); this.toggleJourneys(false); return true;
      case 'viewList': this.toggleList(true); return true;
      case 'viewJourneys': this.toggleJourneys(true); return true;
      case 'listRegion': this.toggleList(false); v.flyToRegion(el.dataset.region); return true;
      case 'listPick': {
        const pid = el.dataset.id, s = this.town.shells.get(pid), layer = s && this.layerOf(s.regionId);
        if (s && layer) {
          if (v.region !== layer.region) v.region = layer.region;
          const [x, z] = W.rectCenter(s.lot), [ox, oz] = W.regionOrigin(layer.region);
          v.flyTo(ox + x, oz + z, Math.max(30, (s.lot[2] - s.lot[0]) * 2.4), .9, layer.lift);
        }
        this.select(pid);
        return true;
      }
      case 'listEnter': this.toggleList(false); v.enterPalace(el.dataset.id); return true;
      case 'palaceEnter': if (id) v.enterPalace(id); return true;
      case 'palaceLocus': if (id) v.enterPalace(id, { focusItem: el.dataset.item }); return true;
      case 'palaceRecall': if (id) v.enterPalace(id, { recall: true }); return true;
      case 'palaceMove': this.setEditing(true); return true;
      case 'palaceDelete': if (id) void this.deletePalace(id); return true;
      case 'palaceColor': {
        const doc = id && this.docs.get(id), placed = id && v.placementOf(id);
        if (!doc || !placed) return true;
        doc.color = el.dataset.color;
        doc.updatedAt = Date.now();
        const hadRoofColor = !!placed.roofColor;
        delete placed.roofColor;
        v.host.onDocChange?.(doc);
        if (hadRoofColor) v.worldChanged();
        this.reshell(id);
        return true;
      }
      case 'palaceRoof': {
        const placed = id && v.placementOf(id);
        if (!placed) return true;
        const before = this.snapshot();
        placed.roof = el.dataset.roof as W.RoofKind;
        if (placed.roof === 'auto') delete placed.roof;
        this.reshell(id);
        this.pushUndo(before);
        v.worldChanged();
        return true;
      }
    }
    return false;
  }

  /** 外观变了（颜色 / 屋顶）：只重建这一座的外壳 */
  private reshell(id: string) {
    const v = this.v;
    const peeking = v.peek?.id === id && v.peek.open;
    v.refreshShell(id, false);
    if (peeking) v.openPeek(id);
    this.refresh();
    v.invalidate();
  }

  dispose() {
    this.confirmResolve?.(false);
    this.confirmResolve = null;
  }
}
