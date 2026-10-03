import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createKit, type Kit } from './kit';
import { createCatalog, slotLabel, sourceKey, type Catalog } from './catalog';
import { buildPalace, buildStructure, itemDisplayName, spawnItem, despawnItem, placeItem, computeColliders, releaseLamps, ownBox, slotBox, findSlot, slotOfHit, traverseOwn, type BuiltPalace } from './build';
import { Editor } from './editor';
import { RecallController } from './recall';
import { NumberController } from './numbers';
import { ShelfEditor } from './shelf-editor';
import { SocialController } from './social/controller';
import { Companion } from './companion';
import { setLocale, getLocale, t } from './i18n';
import { Onboarding } from './onboarding';
import { StoryController } from './stories';
import { memoryLevel, worstLevel, isDue, type MemoryLevel, type SlotSort } from './route';
import { WorldLayer, type Shell } from './world-layer';
import { TownController } from './town-controller';
import * as W from './world';
import { getBinding, setBinding, boundLoci, itemLoci, locusKey, parseLocus, noteSourceName, type PalaceDoc, type PalaceItem, type LocusBinding, type BoundLocus } from './schema';
import type { PalaceWorld, PlacedPalace, WorldRegion } from './world';
import type { HostAdapter, Prefs, ReviewState, DocEntry, DocSource } from './host';
import { ensureStyles } from './styles';
import { ICONS } from './icons';
import { html, rich } from './dom';
import { BEND, bendScene, bendPoint, bendNormal, setBend } from './bend';
import { PlanetFx } from './planet';

/* =====================================================================
 * PalaceView：把一个「记忆世界」渲染进任意容器（思源页签、Obsidian 视图、网页…）
 * 两个层级，镜头连续过渡：
 *   town    岛上小镇：所有宫殿的外壳 + 屋顶，悬停掀开屋顶预览，双击飞进去
 *   palace  某一座宫殿：2.5D 正交俯视（剖切墙体）+ 第一人称漫游 + 搭建
 * 进入宫殿时，把整个小镇变换到这座宫殿的局部坐标系，宫殿本身留在原点，
 * 这样宫殿里的编辑 / 漫游代码完全不用关心它在小镇里的位置和朝向。
 * ===================================================================== */

export interface PalaceViewOptions {
  /** 往页面里插样式表（默认插）；宿主自己加载样式时传 false（Obsidian 用插件的 styles.css） */
  injectStyles?: boolean;
  /** 世界（宫殿摆在哪里）；不传时按 docs 自动摆放 */
  world?: PalaceWorld;
  /** 全部宫殿 */
  docs?: PalaceDoc[];
  /** 兼容旧用法：只有一座宫殿 */
  doc?: PalaceDoc;
  host?: HostAdapter;
  /** 打开后直接进入这座宫殿；不填则停在小镇 */
  enter?: string | null;
  /** 只读：不能搭建、绑定、编辑，也不保存（网页查看器） */
  readonly?: boolean;
  /** 界面语言；不给时用 host.locale，再不给按浏览器语言 */
  locale?: string;
}

/** 正在参观好友的世界：自己的数据先收起来，离开时换回来 */
interface VisitState {
  owner: { id: string; name: string };
  home: { world: PalaceWorld; docs: PalaceDoc[]; region?: string };
  mediaUrl: (id: string) => string;
}

/** 只读时不能用的操作（搭建、绑定、编辑类） */
const READONLY_BLOCK = new Set([
  'edit', 'bind', 'bindDoc', 'unbind', 'addItem', 'toolRoom', 'toolWall', 'buildPalace', 'townEdit', 'newIsland', 'palaceMove', 'palaceDelete',
  'palaceColor', 'palaceRoof', 'regionTheme', 'regionDelete', 'regionSettings', 'pickTemplate', 'pickTheme', 'numbers', 'viewJourneys',
  'routePick', 'routeAuto', 'routeDelete', 'routeAddAll', 'stopUp', 'stopDown', 'stopDel', 'routeJourneyGo',
]);
const READONLY_PREFIX = ['story', 'shelf', 'num', 'jp'];

type Mode = 'iso' | 'walk';

/**
 * 画质档位：像素密度上限、环境光遮蔽（GTAO）、阴影贴图大小、阴影多久更新一次、抗锯齿采样。
 * 默认按设备挑（手机、集成显卡用低一些的），运行中持续卡顿会自动再降一档。
 */
export type Quality = 'high' | 'medium' | 'low';
const QUALITY: Record<Quality, { pr: number; ao: boolean; shadow: number; shadowEvery: number; samples: number }> = {
  high: { pr: 2, ao: true, shadow: 4096, shadowEvery: 1, samples: 4 },
  medium: { pr: 1.5, ao: false, shadow: 2048, shadowEvery: 2, samples: 4 },
  low: { pr: 1, ao: false, shadow: 1024, shadowEvery: 3, samples: 0 },
};
const QUALITY_KEY = 'kmind-palace:quality';

/** 按设备猜一个画质档位 */
function detectQuality(renderer: THREE.WebGLRenderer, mobile?: boolean): Quality {
  const coarse = mobile ?? matchMedia('(pointer: coarse)').matches;
  let gpu = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '').toLowerCase();
  } catch { /* 拿不到就按其他条件 */ }
  if (/swiftshader|llvmpipe|software/.test(gpu)) return 'low';
  if (coarse) return /apple gpu|apple a1[5-9]|apple m/.test(gpu) ? 'medium' : 'low';
  if (/mali|adreno|powervr/.test(gpu)) return 'low';
  if (/intel/.test(gpu)) return 'medium';
  return 'high';
}
/** 宿主没给偏好存储时：只在这次打开期间记住 */
function memoryPrefs(): Prefs {
  const m = new Map<string, string>();
  return { get: k => m.get(k) ?? null, set: (k, v) => { m.set(k, v); } };
}

export type Level = 'town' | 'palace';

const DEG = Math.PI / 180;
const ELEV = 38 * DEG;
const DIST = 700;
const CUT_H = .34;
const EYE_H = 1.6;
const PLAYER_R = .22;
const lerp = THREE.MathUtils.lerp;
const WALL_MODES: [string, string][] = [['cut', '剖切'], ['full', '全墙'], ['low', '矮墙']];
const SUN_DIR = new THREE.Vector3(5, 13, 10).normalize();
/** 小镇层级的固定取景跨度（缩放都相对它计算，换岛时视锥不变、画面不跳） */
const TOWN_SPAN = 64;


export class PalaceView {
  /** 当前所在的宫殿（在小镇层级时为 null） */
  doc: PalaceDoc | null = null;
  host: HostAdapter;
  /** 本机的界面偏好 @internal */ prefs: Prefs;
  readonly root: HTMLDivElement;
  world: PalaceWorld;
  /** @internal */ docs = new Map<string, PalaceDoc>();
  /** @internal */ region: WorldRegion;
  /** @internal */ level: Level = 'town';

  /** @internal */ renderer: THREE.WebGLRenderer;
  /** @internal */ scene = new THREE.Scene();
  /** @internal */ kit: Kit;
  /** @internal */ catalog: Catalog;
  /** @internal */ built: BuiltPalace | null = null;
  /** @internal */ town: WorldLayer;
  /** @internal */ townCtl: TownController;
  /** 小镇里悬停预览（或刚离开）的宫殿内部 @internal */
  peek: { id: string; built: BuiltPalace; open: boolean } | null = null;
  /** @internal */ isoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2200);
  private fpCam = new THREE.PerspectiveCamera(70, 1, .05, 160);
  private activeCam: THREE.Camera = this.isoCam;
  /** @internal */ orbit: OrbitControls;
  private composer: EffectComposer;
  private gtao: GTAOPass;
  private labelRenderer: CSS2DRenderer;
  private hemi = new THREE.HemisphereLight('#fff4e3', '#a8957c', 1.1);
  private sun = new THREE.DirectionalLight('#fff1dc', 2.4);
  private envRT: THREE.WebGLRenderTarget;
  private timer = new THREE.Timer();
  private ro: ResizeObserver;
  private cleanups: (() => void)[] = [];

  private width = 0;
  private height = 0;
  /** @internal */ frustum = 18;
  private homeTarget = new THREE.Vector3();
  private homeZoomSpan = 20;
  private homeH = 2.8;
  private homeZoom = 1;
  /** @internal */ far = false;
  /** 星球化程度 0..1（群岛继续拉远时卷成小星球） @internal */
  planet = 0;
  /** 完全卷起时的星球半径 @internal */
  planetR = 100;
  private planetFocus = new THREE.Vector3(NaN, 0, NaN);
  private planetCam = new THREE.Vector3();
  private fx: PlanetFx;
  /** @internal */ mode: Mode = 'iso';
  private wallMode = 0;
  /** @internal */ night = 0;
  private nightTarget = 0;
  /** @internal */ camTween: any = null;
  private afterTween: (() => void) | null = null;
  private dirty = 2;
  private firstFrame = true;
  private disposed = false;
  private collidersDirty = false;
  /** @internal */ editor: Editor;
  /** @internal */ recall: RecallController;
  /** @internal */ numbers: NumberController;
  /** @internal */ shelfEd: ShelfEditor;
  /** 串门（宿主提供了 social 时才有） @internal */ social: SocialController | null = null;
  /** @internal */ stories: StoryController;
  /** 小管家 @internal */ companion: Companion;
  /** 新手引导、设置 @internal */ guide: Onboarding;
  /** 记忆桩对应笔记块的复习状态（宿主闪卡），按 blockId @internal */
  reviewStates = new Map<string, ReviewState>();

  /** @internal */ hovered: THREE.Object3D | null = null;
  /** @internal */ selected: THREE.Object3D | null = null;
  /** 选中 / 悬停的部件（例如书架上的一本书）；'' 表示整件物件 @internal */
  selectedSlot = '';
  /** @internal */ hoveredSlot = '';
  /** @internal */ lastPointer: PointerEvent | null = null;
  private pointerDown: { x: number; y: number } | null = null;
  private hoverSince = 0;
  private previewShownFor: string | null = null;
  private tinted = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  /** 部件高亮时改过颜色的实例（书架上的书），清除高亮时还原 */
  private tintedInst: { mesh: THREE.InstancedMesh; id: number; color: THREE.Color }[] = [];
  /** 部件高亮时改过顶点色的书脊面片 */
  private tintedVerts: { mesh: THREE.Mesh; start: number }[] = [];
  /** 书架 = 笔记本：已拉取的书目，按来源 */
  private shelfDocs = new Map<string, DocEntry[]>();
  private unwatchDocs: (() => void) | null = null;
  private docsTimer: number | null = null;
  private mediaUrls = new Map<string, Promise<string>>();
  /** 选中部件时的描边框 */
  private slotOutline: THREE.LineSegments;
  private marker = new THREE.Group();
  private markerLine = new THREE.MeshBasicMaterial({ color: '#ef8235', transparent: true, opacity: .9, depthWrite: false, toneMapped: false });
  private markerFill = new THREE.MeshBasicMaterial({ color: '#ef8235', transparent: true, opacity: .13, depthWrite: false, toneMapped: false });
  private pinMat = new THREE.MeshStandardMaterial({ color: '#ef8235', roughness: .35, emissive: '#ef8235', emissiveIntensity: .35 });
  private markMat = new THREE.MeshStandardMaterial({ color: '#ff6a1a', roughness: .4, emissive: '#ff6a1a', emissiveIntensity: .7 });
  /** 按记忆程度给图钉、书签换色：记得牢 绿 · 学习中 琥珀 · 该复习 红 · 很久没复习 灰（没开始复习的保持橙色） */
  private levelMats: Partial<Record<MemoryLevel, THREE.MeshStandardMaterial>> = {
    fresh: new THREE.MeshStandardMaterial({ color: '#4f9a78', roughness: .35, emissive: '#4f9a78', emissiveIntensity: .3 }),
    learning: new THREE.MeshStandardMaterial({ color: '#e0a23a', roughness: .35, emissive: '#e0a23a', emissiveIntensity: .35 }),
    due: new THREE.MeshStandardMaterial({ color: '#dc4632', roughness: .35, emissive: '#dc4632', emissiveIntensity: .45 }),
    stale: new THREE.MeshStandardMaterial({ color: '#9a948c', roughness: .6, emissive: '#6d6862', emissiveIntensity: .15 }),
  };
  private webMat: THREE.MeshBasicMaterial | null = null;
  private pinGeo = { head: new THREE.SphereGeometry(.11, 20, 14), tip: new THREE.ConeGeometry(.065, .2, 16), mark: new THREE.BoxGeometry(1, 1, 1), web: new THREE.PlaneGeometry(1, 1) };
  private missing = new Set<string>();
  /** 找不到部件的绑定（例如书架改窄后放不下的书），locusKey 集合 @internal */
  orphans = new Set<string>();

  private walk = {
    pos: new THREE.Vector3(), yaw: 0, pitch: 0, keys: new Set<string>(), bob: 0,
    drag: null as null | { id: number; x: number; y: number; moved: number },
    joy: { x: 0, y: 0 }, joyId: null as null | number, focus: null as THREE.Object3D | null, focusSlot: '', lastRay: 0,
  };
  /** @internal */ raycaster = new THREE.Raycaster();
  /** @internal */ ui: Record<string, HTMLElement> = {};

  constructor(container: HTMLElement, opts: PalaceViewOptions) {
    setLocale(opts.locale ?? opts.host?.locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'zh-CN'));
    if (opts.injectStyles !== false) ensureStyles(container.ownerDocument);
    // 宿主的保存接口包一层：只读（网页查看器、参观好友）时一律不保存
    const h = opts.host || {};
    const guarded: HostAdapter = Object.create(h);
    if (h.onDocChange) guarded.onDocChange = (d) => { if (!this.readonly) h.onDocChange(d); };
    if (h.onWorldChange) guarded.onWorldChange = (w) => { if (!this.readonly) h.onWorldChange(w); };
    if (h.onDocDelete) guarded.onDocDelete = (id) => { if (!this.readonly) h.onDocDelete(id); };
    this.host = guarded;
    this.prefs = h.prefs ?? memoryPrefs();
    this.readonlyOpt = !!opts.readonly;
    const docs = opts.docs || (opts.doc ? [opts.doc] : []);
    for (const d of docs) this.docs.set(d.id, d);
    this.world = opts.world || W.createWorld();
    const worldChanged = W.syncWorld(this.world, this.docs);
    this.region = W.mainRegion(this.world);

    const root = this.root = document.createElement('div');
    root.className = 'kp-root kp-level-town';
    root.lang = getLocale();
    if (this.readonlyOpt) root.classList.add('kp-readonly');
    root.tabIndex = 0;
    if (matchMedia('(pointer: coarse)').matches) root.classList.add('kp-touch');
    container.appendChild(root);

    // ---------- 渲染器 ----------
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    // 画质：用户选过就用选的，否则按设备猜
    let pref: string | null = null;
    try { pref = this.prefs.get(QUALITY_KEY); } catch { /* 隐私模式 */ }
    this.qualityAuto = !pref || pref === 'auto';
    this.quality = this.qualityAuto ? detectQuality(renderer, this.host.isMobile) : (pref as Quality);
    renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[this.quality].pr));
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.domElement.classList.add('kp-canvas');
    root.appendChild(renderer.domElement);

    const labels = document.createElement('div');
    labels.className = 'kp-labels';
    root.appendChild(labels);
    this.labelRenderer = new CSS2DRenderer({ element: labels });

    this.kit = createKit({ maxAniso: renderer.capabilities.getMaxAnisotropy() });
    // 构建函数用到的宿主数据：书架书目、用户照片
    this.kit.runtime.shelfDocs = (src) => this.shelfDocs.get(sourceKey(src)) || null;
    this.kit.runtime.loadMedia = (id) => this.mediaUrl(id);
    // 照片加载完：高亮用的是材质的克隆，要重新套一次才能带上照片
    // 模型加载完：物件大小变了，图钉、碰撞体、选中框都要重算
    this.kit.runtime.onLoaded = () => {
      if (this.built) { this.collidersDirty = true; this.rebuildPins(); this.updateMarker(); this.editor?.updateRing(); }
      if (this.selected || this.hovered) this.applyHighlight();
      this.invalidate(2);
    };
    this.catalog = createCatalog(this.kit, 2.8);
    this.pinGeo.head.userData.shared = this.pinGeo.tip.userData.shared = this.pinGeo.mark.userData.shared = this.pinGeo.web.userData.shared = true;
    this.slotOutline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#ef8235', depthTest: false, transparent: true, toneMapped: false }));
    this.slotOutline.renderOrder = 12;
    this.slotOutline.visible = false;
    this.scene.add(this.slotOutline);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = new RoomEnvironment();
    this.envRT = pmrem.fromScene(env, .04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = .55;
    env.dispose(); pmrem.dispose();
    this.scene.background = this.kit.TEX.bgDay;

    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(QUALITY[this.quality].shadow, QUALITY[this.quality].shadow);
    this.sun.shadow.bias = -.0004;
    this.sun.shadow.normalBias = .025;
    this.sun.shadow.radius = 3;

    this.marker.visible = false;
    this.marker.renderOrder = 10;
    this.scene.add(this.marker);
    this.fx = new PlanetFx(this.scene);

    // ---------- 控制器 ----------
    const orbit = this.orbit = new OrbitControls(this.isoCam, renderer.domElement);
    orbit.enableDamping = true; orbit.dampingFactor = .09;
    orbit.screenSpacePanning = false;
    orbit.minPolarAngle = Math.PI / 2 - 68 * DEG;
    orbit.maxPolarAngle = Math.PI / 2 - 24 * DEG;
    orbit.minZoom = .55; orbit.maxZoom = 4.5;
    orbit.zoomToCursor = true;
    orbit.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    orbit.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    orbit.addEventListener('change', () => this.invalidate());

    this.buildUI();
    this.town = new WorldLayer(this.kit, this.catalog);
    this.scene.add(this.town.group);
    this.town.build(this.world, this.docs);
    const settled = this.settleRegions();
    this.editor = new Editor(this);
    this.recall = new RecallController(this);
    this.numbers = new NumberController(this);
    this.shelfEd = new ShelfEditor(this);
    this.stories = new StoryController(this);
    this.townCtl = new TownController(this);
    this.companion = new Companion(this);
    if (this.host.social) this.social = new SocialController(this);
    this.guide = new Onboarding(this);
    this.town.dueOf = (d) => this.dueCount(d);
    this.bindEvents();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(root);
    this.resize();

    this.showTown(true);
    const enter = opts.enter && this.docs.has(opts.enter) ? opts.enter : null;
    if (enter) this.enterPalace(enter, { instant: true });
    this.composer = this.makeComposer(this.isoCam);
    renderer.setAnimationLoop((t) => this.frame(t));
    if ((worldChanged || settled) && opts.world) this.host.onWorldChange?.(this.world);
    void this.refreshReview();
    this.guide.start();
    // 文档新建、删除、改名、移动：刷新书架（防抖）
    this.unwatchDocs = this.host.watchDocs?.(() => {
      if (this.docsTimer) window.clearTimeout(this.docsTimer);
      this.docsTimer = window.setTimeout(() => { this.docsTimer = null; void this.loadShelfSources(true); }, 500);
    }) || null;
  }

  // =====================================================================
  // 公共 API
  // =====================================================================

  /** 一座宫殿的数据被外部替换（同步、重置）：在里面就原地重载，否则只刷新它在小镇里的外壳 */
  setDoc(doc: PalaceDoc) {
    const fresh = !this.docs.has(doc.id);
    this.docs.set(doc.id, doc);
    if (fresh && W.syncWorld(this.world, this.docs)) this.host.onWorldChange?.(this.world);
    if (this.level === 'palace' && this.doc?.id === doc.id) {
      this.select(null);
      this.hovered = null;
      const old = this.built;
      this.built = null;
      if (old) this.disposeBuilt(old);
      this.doc = doc;
      this.loadPalace(doc);
      this.cutWallsNow();
      this.editor.reset();
    } else {
      this.refreshShell(doc.id);
    }
    this.townCtl.refresh();
    this.invalidate(3);
  }

  private readonlyOpt = false;
  /** @internal */ visiting: VisitState | null = null;

  /** 只读：网页查看器，或正在参观好友的世界 */
  get readonly() { return this.readonlyOpt || !!this.visiting; }

  /** 只读时能不能做这个操作 @internal */
  blockedWhenReadonly(act: string) {
    return this.readonly && (READONLY_BLOCK.has(act) || READONLY_PREFIX.some(p => act.startsWith(p)));
  }

  /**
   * 参观好友的世界：把好友发布的岛和宫殿换进来（只读），自己的数据先收起来。
   * enter 给了就直接进那座宫殿。再调一次可以换另一个好友。
   */
  visit(v: { owner: { id: string; name: string }; world: PalaceWorld; docs: PalaceDoc[]; enter?: string; mediaUrl: (id: string) => string }) {
    if (!this.visiting) {
      this.editor.toggle(false);
      this.townCtl.beforeLevelChange();
      this.visiting = { owner: v.owner, home: { world: this.world, docs: [...this.docs.values()], region: this.region?.id }, mediaUrl: v.mediaUrl };
    } else {
      this.visiting.owner = v.owner;
      this.visiting.mediaUrl = v.mediaUrl;
    }
    if (this.level === 'palace') this.exitPalace({ instant: true });
    this.root.classList.add('kp-visiting', 'kp-readonly');
    this.sync(v.world, v.docs);
    this.social?.onVisitChanged();
    if (v.enter && this.docs.has(v.enter)) this.enterPalace(v.enter);
    else { const r = W.mainRegion(this.world); if (r) this.flyToRegion(r.id, 1.1); }
  }

  /** 结束参观，回到自己的世界 */
  leaveVisit() {
    const s = this.visiting;
    if (!s) return;
    if (this.level === 'palace') this.exitPalace({ instant: true });
    this.visiting = null;
    this.root.classList.remove('kp-visiting');
    this.root.classList.toggle('kp-readonly', this.readonlyOpt);
    this.sync(s.home.world, s.home.docs);
    const r = s.home.region && this.world.regions.find(x => x.id === s.home.region);
    if (r) this.flyToRegion(r.id, 1.1);
    this.social?.onVisitChanged();
  }

  /** 同步：整个世界和全部宫殿换成新数据 */
  sync(world: PalaceWorld, docs: PalaceDoc[]) {
    const incoming = new Map(docs.map(d => [d.id, d]));
    const activeId = this.level === 'palace' ? this.doc?.id : null;
    if (activeId && !incoming.has(activeId)) {
      this.exitPalace({ instant: true });
    }
    this.closePeek(true);
    const curRegion = this.region?.id;
    this.world = world;
    if (W.syncWorld(world, incoming)) this.host.onWorldChange?.(world);
    this.region = world.regions.find(r => r.id === curRegion) || W.mainRegion(world);
    const current = this.level === 'palace' ? this.doc : null;
    this.docs = incoming;
    this.town.build(world, this.docs);
    this.town.setFar(this.far);
    if (this.settleRegions()) this.host.onWorldChange?.(world);
    if (current) {
      const next = incoming.get(current.id);
      this.region = this.regionOf(current.id) || this.region;
      this.setTownFrame(this.palaceMatrix(current.id)?.invert() || null);
      this.hideActiveShell(true);
      if (next.updatedAt !== current.updatedAt) this.setDoc(next);
      else this.docs.set(current.id, current);
    }
    this.townCtl.refresh();
    this.invalidate(3);
    void this.refreshReview();
  }

  /** 选中并聚焦当前宫殿里的某个记忆桩：物件 id，或「物件 id#部件编号」 */
  focusItem(key: string) {
    const { itemId, slot } = parseLocus(key);
    const obj = this.built?.itemObjects.get(itemId);
    if (!obj) return;
    if (this.mode === 'walk') this.exitWalk();
    this.select(obj, slot && findSlot(obj, slot) ? slot : '');
    this.focusSelected();
  }

  /** 物件绑定关系被外部改动后刷新（例如同步回来的数据） */
  refreshBindings() {
    if (!this.built) return;
    this.rebuildPins();
    this.updateCounts();
    if (this.selected) this.showCard(this.selected);
    this.recall.refresh();
    this.numbers.refresh();
    this.invalidate();
  }

  // =====================================================================
  // 复习状态（宿主的闪卡）
  // =====================================================================

  private reviewAt = 0;

  /** 拉取全部宫殿里记忆桩的复习状态；minGap 毫秒内拉过就跳过（在宿主里复习过之后回来时刷新） */
  async refreshReview(minGap = 0) {
    const review = this.host.review;
    if (!review || performance.now() - this.reviewAt < minGap) return;
    this.reviewAt = performance.now();
    const ids = new Set<string>();
    for (const d of this.docs.values()) for (const l of boundLoci(d)) if (this.isLocalNote(l.binding, d)) ids.add(l.binding.blockId);
    if (!ids.size) return;
    try {
      const states = await review.getStates([...ids]);
      if (this.disposed) return;
      for (const id of ids) this.reviewStates.set(id, states[id] || { card: false });
      this.afterReviewChanged();
    } catch (e) {
      console.warn('[kmind-palace] 读取复习状态失败', e); // i18n-ignore
    }
  }

  /** 一次自评之后更新某个块的状态 @internal */
  setReviewState(blockId: string, st: ReviewState) {
    this.reviewStates.set(blockId, st);
    this.afterReviewChanged();
  }

  private afterReviewChanged() {
    if (this.built) this.rebuildPins();
    this.recall.refresh();
    for (const s of this.town.shells.values()) this.town.updateTag(s);
    this.townCtl.refresh();
    this.invalidate();
  }

  /** @internal */ memoryOf(blockId: string): MemoryLevel {
    return memoryLevel(this.reviewStates.get(blockId));
  }

  /** 宫殿里该复习的记忆桩数 @internal */
  dueCount(doc: PalaceDoc) {
    if (!this.host.review) return 0;
    return boundLoci(doc).filter(l => this.isLocalNote(l.binding, doc) && isDue(this.memoryOf(l.binding.blockId))).length;
  }

  /**
   * 绑定 / 书目的笔记在不在当前宿主里（在别的笔记软件里绑定的记忆桩不去打开、不拉标题、不查复习状态） @internal
   */
  isLocalNote(b: { src?: string } | null | undefined, doc = this.doc) {
    if (!b) return true;
    const src = b.src || doc?.src;
    // 好友发布的公开副本：笔记不在这里
    if (src === 'public') return false;
    const mine = this.host.noteSource;
    return !mine || !src || src === mine;
  }

  /** 新的绑定 / 书目记下来源：宫殿还没有来源时就是当前宿主；和宫殿不同时单独记在绑定上 @internal */
  stampSource<T extends LocusBinding | DocSource>(b: T): T {
    const mine = this.host.noteSource, doc = this.doc;
    if (!mine || !doc) return b;
    if (!doc.src) doc.src = mine;
    if (doc.src === mine) delete b.src; else b.src = mine;
    return b;
  }

  /** 打开别的笔记软件里的笔记时的提示 */
  private foreignNotice(b: { src?: string }) {
    this.host.notify?.(t('这个记忆桩绑定的是{app}里的笔记，在这里打不开', { app: t(noteSourceName(b.src || this.doc?.src)) }));
  }

  /** 当前宫殿的全部记忆桩 @internal */
  allLoci() {
    return this.doc ? boundLoci(this.doc) : [];
  }

  /** 部件按显示名排（书架：从上往下、从左往右） @internal */
  slotSort: SlotSort = (item, a, b) => slotLabel(this.catalog, item, a).localeCompare(slotLabel(this.catalog, item, b), getLocale() === 'zh-CN' ? 'zh' : 'en', { numeric: true });

  /** 记忆桩在场景里的位置：部件的中心，或整件物件的顶面中心 @internal */
  locusAnchor(item: PalaceItem, slot = ''): THREE.Vector3 | null {
    const obj = this.built?.itemObjects.get(item.id);
    if (!obj) return null;
    const sb = slot ? slotBox(obj, slot) : null;
    if (sb) return sb.getCenter(new THREE.Vector3());
    const b = ownBox(obj);
    const c = b.getCenter(new THREE.Vector3());
    c.y = b.max.y;
    return c;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.cleanups.forEach(fn => fn());
    this.editor.dispose();
    this.townCtl.dispose();
    this.companion.dispose();
    this.guide.dispose();
    this.orbit.dispose();
    this.clearTint();
    if (this.built) this.disposeBuilt(this.built);
    if (this.peek) this.disposeBuilt(this.peek.built);
    this.built = null; this.peek = null;
    this.town.dispose();
    this.fx.dispose();
    BEND.k.value = 0;
    this.composer?.dispose();
    this.gtao?.dispose();
    this.envRT.dispose();
    this.kit.dispose();
    this.markerLine.dispose(); this.markerFill.dispose(); this.pinMat.dispose(); this.markMat.dispose();
    this.pinGeo.head.dispose(); this.pinGeo.tip.dispose(); this.pinGeo.mark.dispose(); this.pinGeo.web.dispose();
    Object.values(this.levelMats).forEach(m => m.dispose());
    if (this.webMat) { this.webMat.map?.dispose(); this.webMat.dispose(); }
    this.recall.dispose();
    this.numbers.dispose();
    this.social?.dispose();
    this.unwatchDocs?.();
    if (this.docsTimer) window.clearTimeout(this.docsTimer);
    this.slotOutline.geometry.dispose(); (this.slotOutline.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.root.remove();
  }

  invalidate(frames = 2) { this.dirty = Math.max(this.dirty, frames); }

  /** 右侧的面板（好友、小管家、留言板、设置）同时只开一个 @internal */
  closeSidePanels(except?: 'social' | 'pet' | 'guest' | 'settings') {
    if (except !== 'social' && this.social?.panelOpen) this.social.togglePanel(false);
    if (except !== 'guest') this.social?.closeGuestbook();
    if (except !== 'pet' && this.companion?.panelOpen) this.companion.togglePanel(false);
    if (except !== 'settings' && this.guide?.settingsOpen) this.guide.toggleSettings(false);
  }

  /** 第一人称时人站在哪（平面坐标）；俯视时为 null @internal */
  walkPosition(): THREE.Vector3 | null { return this.mode === 'walk' ? this.walk.pos : null; }

  /** 当前宫殿的碰撞体（家具搬动过就重算） @internal */
  colliders() {
    if (this.built && this.collidersDirty) { this.built.colliders = computeColliders(this.built, this.catalog); this.collidersDirty = false; }
    return this.built?.colliders || [];
  }

  // =====================================================================
  // 层级切换：小镇 ↔ 宫殿
  // =====================================================================

  /** @internal */ placementOf(id: string): PlacedPalace | null {
    for (const r of this.world.regions) {
      const p = r.palaces.find(p => p.palaceId === id);
      if (p) return p;
    }
    return null;
  }

  /** 宫殿所在的岛 @internal */
  regionOf(id: string) {
    return W.regionOfPalace(this.world, id);
  }

  /** 宫殿局部坐标 → 世界坐标的变换（岛原点 + 浮空高度 + 摆放位置 + 朝向） @internal */
  palaceMatrix(id: string): THREE.Matrix4 | null {
    const p = this.placementOf(id), r = this.regionOf(id);
    if (!p || !r) return null;
    const [ox, oz] = W.regionOrigin(r);
    return new THREE.Matrix4().makeRotationY(p.rot * DEG).setPosition(ox + p.pos[0], W.regionLift(r), oz + p.pos[1]);
  }

  /** 岛长大后与邻岛挤在一起：推开，返回是否移动过 @internal */
  settleRegions() {
    const moved = W.settleRegions(this.world, this.docs, this.town.radii());
    if (moved) this.town.placeRegions();
    return moved;
  }

  /** 进入宫殿：镜头从小镇飞进去，屋顶掀开、墙体落下 */
  /** focusItem：进门后聚焦的记忆桩（物件 id，或「物件 id#部件编号」） */
  enterPalace(id: string, opts: { instant?: boolean; focusItem?: string; flown?: boolean; recall?: boolean } = {}) {
    const doc = this.docs.get(id), placed = this.placementOf(id);
    if (!doc || !placed || this.disposed) return;
    if (this.level === 'palace') {
      if (this.doc?.id === id) { if (opts.focusItem) this.focusItem(opts.focusItem); if (opts.recall) this.recall.onEntered(); return; }
      // 宫殿之间直接切换：淡出淡入
      this.fade(() => {
        this.exitPalace({ instant: true });
        this.enterPalace(id, { ...opts, instant: true });
      });
      return;
    }
    // 从群岛 / 星球直接进宫殿：先飞到那座岛（曲率降到零），再进门
    if (this.level === 'town' && (this.far || this.planet > 0) && !opts.instant && !opts.flown) {
      const r = this.regionOf(id);
      if (r) {
        this.flyToRegion(r.id, 1.3);
        this.afterTween = () => this.enterPalace(id, { ...opts, flown: true });
        return;
      }
    }
    this.townCtl.beforeLevelChange();
    if (this.far) { this.far = false; this.town.setFar(false); this.root.classList.remove('kp-far'); if (this.gtao) this.gtao.enabled = QUALITY[this.quality].ao; }
    let b: BuiltPalace;
    if (this.peek?.id === id) { b = this.peek.built; this.peek = null; } else {
      this.closePeek(true);
      b = buildPalace(doc, this.kit, this.catalog, { inWorld: true });
      this.scene.add(b.root);
      for (const w of b.walls) { w.cur = w.target = b.wallH; w.apply(); }
    }
    // 参考系切换：世界 → 宫殿局部；镜头跟着换算，画面不动
    const inv = this.palaceMatrix(id).invert();
    this.moveCameraFrame(v => v.applyMatrix4(inv));
    this.setTownFrame(inv);
    this.region = this.regionOf(id);
    this.level = 'palace';
    this.doc = doc;
    this.loadPalace(doc, b);
    this.hideActiveShell();
    this.social?.onPalaceEntered();
    const shell = this.town.shells.get(id);
    if (shell) { this.setLiftDir(shell); shell.liftTarget = 1; if (opts.instant) this.town.setLift(id, 1); }
    this.root.classList.remove('kp-level-town');
    this.refit(true);
    this.fitSun();
    this.applyNight(this.night);
    this.editor.reset();
    this.recall.reset();
    this.numbers.reset();
    this.shelfEd.close();
    this.missing.clear();
    void this.refreshTitles();
    void this.refreshReview(30e3);
    this.host.onLocationChange?.(id, t(doc.name));
    const snapAz = this.snappedAz();
    if (opts.instant) {
      this.camTween = null;
      this.orbit.target.copy(this.homeTarget);
      this.isoCam.position.copy(this.homeTarget).add(isoOffset(snapAz, ELEV));
      this.isoCam.zoom = 1; this.isoCam.updateProjectionMatrix();
      this.isoCam.lookAt(this.orbit.target);
      this.orbit.update();
      this.cutWallsNow();
      if (opts.focusItem) this.focusItem(opts.focusItem);
      if (opts.recall) this.recall.onEntered();
    } else {
      this.tweenCam({ az: snapAz, el: ELEV, target: this.homeTarget, zoom: 1, dur: 1.15 });
      if (opts.focusItem || opts.recall) this.afterTween = () => {
        if (opts.focusItem) this.focusItem(opts.focusItem);
        if (opts.recall) this.recall.onEntered();
      };
    }
    this.invalidate(3);
  }

  /** 回到小镇：墙体升起、屋顶盖回，镜头拉远 */
  exitPalace(opts: { instant?: boolean } = {}) {
    if (this.level !== 'palace' || !this.doc) return;
    if (this.mode === 'walk') {
      if (opts.instant) this.leaveWalkNow();
      else { this.fade(() => { this.leaveWalkNow(); this.exitPalace({ instant: true }); }); return; }
    }
    this.editor.toggle(false);
    this.recall.reset();
    this.numbers.reset();
    this.shelfEd.close();
    this.companion.leavePalace();
    this.social?.onPalaceLeft();
    this.select(null);
    this.hovered = null;
    this.ui.tip.classList.remove('kp-on');
    this.ui.loci.classList.add('kp-hidden');
    const doc = this.doc, id = doc.id, placed = this.placementOf(id), b = this.built;
    // 宫殿里可能改了结构：重建外壳和小镇地形
    this.refreshShell(id, false);
    this.town.setLift(id, 1);
    const shell = this.town.shells.get(id);
    if (shell) { shell.body.visible = false; this.setLiftDir(shell); }
    const M = this.palaceMatrix(id);
    this.moveCameraFrame(v => v.applyMatrix4(M));
    this.setTownFrame(null);
    this.level = 'town';
    this.doc = null;
    this.built = null;
    this.walk.focus = null;
    if (b) {
      M.decompose(b.root.position, b.root.quaternion, b.root.scale);
      b.labels.forEach(l => l.visible = false);
      b.indoorOnly.forEach(o => o.visible = false);
      b.root.traverse(o => { if (o.userData.overlay) o.visible = false; });
      this.peek = { id, built: b, open: false };
      if (opts.instant) this.finishPeek();
    }
    this.root.classList.add('kp-level-town');
    this.showTown(false);
    this.host.onLocationChange?.(null, t(this.region.name));
    const lot = shell?.lot || W.placedLot(placed, doc);
    const [cx, cz] = W.rectCenter(lot), [ox, oz] = W.regionOrigin(this.region);
    const span = Math.max(lot[2] - lot[0], lot[3] - lot[1]);
    const vis = Math.max(span * 2.6, 34);
    this.tweenCam({ target: new THREE.Vector3(ox + cx, W.regionLift(this.region) + .3, oz + cz), zoom: this.frustum / vis, el: ELEV, dur: opts.instant ? .01 : 1.1 });
    this.townCtl.refresh();
    this.invalidate(3);
  }

  /** 进入小镇层级（初始化 / 从宫殿返回）：取景、阴影、缩放范围 @internal */
  private showTown(intro: boolean) {
    this.homeZoomSpan = TOWN_SPAN;
    this.homeH = 4;
    this.refit(!intro);
    this.updateHome();
    this.fitSun();
    this.applyNight(this.night);
    if (intro) {
      this.orbit.target.copy(this.homeTarget);
      this.isoCam.position.copy(this.homeTarget).add(isoOffset(20 * DEG, 48 * DEG));
      this.isoCam.zoom = this.homeZoom * .82; this.isoCam.updateProjectionMatrix();
      this.orbit.update();
      this.tweenCam({ az: 45 * DEG, el: ELEV, zoom: this.homeZoom, dur: 2 });
    }
    this.townCtl.refresh();
  }

  /** 小镇层级的「复位」取景：当前这座岛上的宫殿群（外扩一圈），而不是整座岛 */
  private updateHome() {
    const layer = this.town.regions.get(this.region?.id);
    if (!layer) return;
    const [x0, z0, x1, z1] = layer.extent, [ox, oz] = W.regionOrigin(this.region), pad = 10;
    this.homeTarget.set(ox + (x0 + x1) / 2, layer.lift + .3, oz + (z0 + z1) / 2);
    this.homeZoom = this.frustum / this.frustumFor((x1 - x0 + z1 - z0 + pad * 4) * Math.SQRT1_2, 4);
  }

  /** 飞到某座岛（小镇层级） @internal */
  flyToRegion(id: string, dur = 1.1) {
    const r = this.world.regions.find(r => r.id === id);
    if (!r) return;
    this.region = r;
    this.updateHome();
    this.fitSun();
    this.tweenCam({ az: this.snappedAz(), el: ELEV, target: this.homeTarget, zoom: this.homeZoom, dur });
    this.townCtl.refresh();
  }

  /** 拉远到群岛全景 @internal */
  flyToWorld(dur = 1.2) {
    const b = this.town.bounds;
    const c = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3());
    const span = (size.x + size.z) * Math.SQRT1_2 + 12;
    this.tweenCam({ target: new THREE.Vector3(c.x, .3, c.z), zoom: this.frustum / this.frustumFor(span, 8), el: ELEV, dur });
  }

  /** 世界 group 的变换：null = 世界坐标；否则传入「世界 → 宫殿局部」矩阵 */
  private setTownFrame(m: THREE.Matrix4 | null) {
    const g = this.town.group;
    g.matrixAutoUpdate = false;
    if (m) g.matrix.copy(m); else g.matrix.identity();
    g.matrixWorldNeedsUpdate = true;
    g.updateMatrixWorld(true);
  }

  private moveCameraFrame(fn: (v: THREE.Vector3) => void) {
    this.camTween = null;
    fn(this.orbit.target);
    fn(this.isoCam.position);
    this.isoCam.lookAt(this.orbit.target);
    this.isoCam.updateMatrixWorld();
  }

  /** 当前宫殿的外壳：墙体和名牌藏起来；外壳重建过（同步、重建外壳）时 lift 让屋顶直接处于掀开状态 */
  private hideActiveShell(lift = false) {
    if (this.level !== 'palace' || !this.doc) return;
    const s = this.town.shells.get(this.doc.id);
    if (!s) return;
    s.body.visible = false;
    s.tag.visible = false;
    if (lift) { this.setLiftDir(s); s.liftTarget = 1; this.town.setLift(s.id, 1); }
  }

  /** 重建一座宫殿的外壳；landToo 时连同地形 / 道路一起重建 @internal */
  refreshShell(id: string, landToo = true) {
    const doc = this.docs.get(id), placed = this.placementOf(id), region = this.regionOf(id);
    if (!doc || !placed || !region) { this.town.removeShell(id); return; }
    const old = this.town.shells.get(id);
    const lotChanged = !old || old.regionId !== region.id || JSON.stringify(old.lot) !== JSON.stringify(W.placedLot(placed, doc));
    const s = this.town.addShell(region, placed, doc);
    if (!s) return;
    if (this.level === 'palace' && this.doc?.id === id) this.hideActiveShell(true);
    if (this.peek?.id === id) { s.body.visible = false; this.town.setLift(id, 1); }
    if (landToo || lotChanged) {
      this.town.rebuildLand(region.id, this.docs);
      if (this.settleRegions()) this.worldChanged();
    }
  }

  /** 屋顶朝远离镜头的方向滑开（宫殿局部坐标） */
  private setLiftDir(s: Shell) {
    const off = new THREE.Vector3().subVectors(this.isoCam.position, this.orbit.target).setY(0).normalize();
    // 当前镜头方向在「场景」坐标里；宫殿层级下场景坐标就是这座宫殿的局部坐标
    let [x, z] = [-off.x, -off.z];
    if (this.level === 'town') [x, z] = W.rotateVec(-s.placed.rot, x, z);
    s.liftDir.set(x, z);
  }

  /** 悬停预览：加载宫殿内部、掀开屋顶 @internal */
  openPeek(id: string) {
    if (this.level !== 'town' || this.disposed) return;
    if (this.peek && this.peek.id !== id) this.closePeek(true);
    const shell = this.town.shells.get(id), doc = this.docs.get(id), placed = this.placementOf(id);
    if (!shell || !doc || !placed) return;
    if (!this.peek) {
      const b = buildPalace(doc, this.kit, this.catalog, { inWorld: true });
      this.palaceMatrix(id).decompose(b.root.position, b.root.quaternion, b.root.scale);
      b.labels.forEach(l => l.visible = false);
      b.indoorOnly.forEach(o => o.visible = false);
      for (const w of b.walls) { w.cur = w.target = b.wallH; w.apply(); }
      this.scene.add(b.root);
      this.applyNightToNew();
      this.peek = { id, built: b, open: true };
    }
    this.peek.open = true;
    shell.body.visible = false;
    this.setLiftDir(shell);
    shell.liftTarget = 1;
    this.invalidate();
  }

  /** @internal */ closePeek(immediate = false) {
    if (!this.peek) return;
    if (immediate) this.finishPeek();
    else this.peek.open = false;
    this.invalidate();
  }

  private finishPeek() {
    const p = this.peek;
    if (!p) return;
    this.peek = null;
    this.disposeBuilt(p.built);
    const s = this.town.shells.get(p.id);
    if (s && !(this.level === 'palace' && this.doc?.id === p.id)) { s.body.visible = true; s.tag.visible = true; s.liftTarget = 0; }
    this.invalidate();
  }

  // =====================================================================
  // 宫殿加载
  // =====================================================================

  /**
   * 用一组新的物件数据替换当前物件（撤销 / 重做 / 同步），只增量重建有变化的物件
   * @internal
   */
  applyItems(items: PalaceItem[]) {
    const b = this.built;
    if (!b) return;
    const selId = (this.selected?.userData.item as PalaceItem)?.id;
    this.clearTint();
    this.hovered = null;
    const old = new Map(this.doc.items.map(i => [i.id, i]));
    this.doc.items = items;
    const keep = new Set(items.map(i => i.id));
    for (const id of old.keys()) if (!keep.has(id)) despawnItem(b, id, this.kit);
    for (const it of items) {
      const prev = old.get(it.id);
      if (!prev || !b.itemObjects.has(it.id)) { spawnItem(b, it, this.catalog); continue; }
      if (prev.type !== it.type || prev.pickable !== it.pickable || JSON.stringify(prev.params || {}) !== JSON.stringify(it.params || {})) {
        despawnItem(b, it.id, this.kit);
        spawnItem(b, it, this.catalog);
      } else placeItem(b, it);
    }
    this.applyNightToNew();
    this.selected = (selId && b.itemObjects.get(selId)) || null;
    if (!this.selected) this.selectedSlot = '';
    this.afterItemsChanged();
  }

  /** 参数变了：只重建这一个物件 @internal */
  respawn(item: PalaceItem) {
    const b = this.built;
    if (!b) return;
    const wasSelected = (this.selected?.userData.item as PalaceItem)?.id === item.id;
    this.clearTint();
    if ((this.hovered?.userData.item as PalaceItem)?.id === item.id) this.hovered = null;
    despawnItem(b, item.id, this.kit);
    const obj = spawnItem(b, item, this.catalog);
    this.applyNightToNew();
    if (wasSelected) this.selected = obj;
    this.rebuildPins();
    this.applyHighlight();
    this.updateMarker();
    this.editor.updateRing();
    this.invalidate();
  }

  /** 物件数据变化后的统一收尾：图钉、计数、卡片、碰撞体、保存 @internal */
  afterItemsChanged() {
    this.collidersDirty = true;
    this.rebuildPins();
    this.updateCounts();
    this.applyHighlight();
    this.updateMarker();
    this.editor.updateRing();
    this.showCard(this.selected);
    this.emitChange();
    this.recall.refresh();
    this.numbers.refresh();
    this.shelfEd.refresh();
    void this.loadShelfSources();
    this.invalidate();
  }

  /** 新建物件里的灯按当前日夜状态设置亮度 @internal */
  applyNightToNew() {
    for (const o of this.kit.LAMPS) o.l.intensity = o.intensity * this.night;
  }

  /** 把一座宫殿作为「当前宫殿」挂到场景原点 */
  private loadPalace(doc: PalaceDoc, prebuilt?: BuiltPalace) {
    const built = this.built = prebuilt || buildPalace(doc, this.kit, this.catalog, { inWorld: true });
    if (!built.root.parent) this.scene.add(built.root);
    built.root.position.set(0, 0, 0);
    built.root.rotation.set(0, 0, 0);
    built.root.updateMatrixWorld(true);
    this.collidersDirty = true;
    const c = built.bounds.getCenter(new THREE.Vector3()), size = built.bounds.getSize(new THREE.Vector3());
    this.homeTarget.set(c.x, .3, c.z);
    this.homeZoomSpan = (size.x + size.z) * Math.SQRT1_2;
    this.homeH = doc.wallHeight ?? 2.8;
    built.indoorOnly.forEach(o => o.visible = this.mode === 'walk');
    built.labels.forEach(l => l.visible = this.mode !== 'walk');
    built.root.traverse(o => { if (o.userData.overlay) o.visible = true; });
    this.applyNightToNew();
    this.rebuildPins();
    this.updateCounts();
    void this.loadShelfSources();
    this.companion?.onPalaceLoaded();
    this.guide?.onPalaceEntered();
  }

  /**
   * 书架 = 笔记本：拉取当前宫殿用到的书目；书目有变化（或第一次拉到）的书架重建。
   * force 时重新拉取全部（文档树变了）；否则只拉还没有缓存的来源。
   */
  private async loadShelfSources(force = false) {
    const doc = this.doc;
    if (!doc || !this.host.listDocs) return;
    const shelves = doc.items.filter(i => i.type === 'bookshelf' && i.params?.source?.box && this.isLocalNote(i.params.source, doc));
    const sources = new Map<string, DocSource>();
    for (const it of shelves) sources.set(sourceKey(it.params.source), it.params.source);
    const changed = new Set<string>();
    await Promise.all([...sources].map(async ([key, src]) => {
      if (!force && this.shelfDocs.has(key)) return;
      try {
        const docs = await this.host.listDocs(src);
        const old = this.shelfDocs.get(key);
        if (old && JSON.stringify(old) === JSON.stringify(docs)) return;
        this.shelfDocs.set(key, docs);
        changed.add(key);
      } catch (e) {
        console.warn('[kmind-palace] 读取书目失败', src, e); // i18n-ignore
      }
    }));
    if (this.disposed || this.doc !== doc || !changed.size) return;
    for (const it of shelves) if (changed.has(sourceKey(it.params.source))) this.respawn(it);
    if (force) void this.refreshTitles();
    this.updateCounts();
    this.recall.refresh();
    if (this.selected) this.showCard(this.selected);
  }

  /** 读取用户照片（同一张只读一次） @internal */
  mediaUrl(id: string) {
    // 参观好友时，照片和模型从串门服务器读（文件名是内容哈希，和本机的缓存不会混）
    if (this.visiting) return Promise.resolve(this.visiting.mediaUrl(id));
    let p = this.mediaUrls.get(id);
    if (p === undefined) {
      if (!this.host.loadMedia) return Promise.reject(new Error(t('当前环境不能读取媒体')));
      p = this.host.loadMedia(id);
      this.mediaUrls.set(id, p);
      p.catch(() => this.mediaUrls.delete(id));
    }
    return p;
  }

  /** 书架上某本「文档书」的文档（笔记本书架） @internal */
  docOfSlot(item: PalaceItem, slot: string): DocEntry | null {
    if (!slot.startsWith('doc:') || !item.params?.source) return null;
    const id = slot.slice(4);
    return this.shelfDocs.get(sourceKey(item.params.source))?.find(d => d.id === id) || { id, title: id };
  }

  /** 墙体直接切到当前视角下的剖切高度（不做动画） */
  private cutWallsNow() {
    const b = this.built;
    if (!b) return;
    const off = new THREE.Vector3().subVectors(this.isoCam.position, this.orbit.target).setY(0).normalize();
    for (const w of b.walls) { w.cur = w.target = this.wallFull(w, off) ? b.wallH : CUT_H; w.apply(); }
  }

  /** 太阳阴影覆盖当前宫殿（及周边），或整座岛 */
  private fitSun() {
    const inPalace = this.level === 'palace' && !!this.built;
    let box = inPalace ? this.built.bounds : this.town.bounds;
    const layer = !inPalace && !this.far && this.town.regions.get(this.region?.id);
    if (layer) {
      // 近看一座岛：阴影只覆盖这座岛（浮空岛连同它投在海面上的影子）
      const c = layer.worldCenter(), R = layer.outerR;
      box = new THREE.Box3(new THREE.Vector3(c.x - R, -1, c.z - R), new THREE.Vector3(c.x + R, layer.lift + 6, c.z + R));
    }
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const half = inPalace ? Math.max(size.x, size.z) * .78 + 6 : Math.max(size.x, size.z) * .62;
    const dir = SUN_DIR.clone();
    if (inPalace) {
      const p = this.placementOf(this.doc.id);
      if (p) { const [x, z] = W.rotateVec(-p.rot, dir.x, dir.z); dir.x = x; dir.z = z; }
    }
    const dist = half * 1.5 + 20;
    this.sun.position.copy(c).addScaledVector(dir, dist);
    this.sun.target.position.copy(c);
    this.sun.target.updateMatrixWorld();
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: dist * 2 + 10 });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  /** 房间 / 墙体变了：只重建结构层（物件保留），剖切状态直接生效 @internal */
  rebuildStructure() {
    const b = this.built;
    if (!b) return;
    this.clearTint();
    buildStructure(b, this.doc, this.kit);
    const off = new THREE.Vector3().subVectors(this.isoCam.position, this.orbit.target).setY(0).normalize();
    for (const w of b.walls) {
      w.cur = w.target = this.wallFull(w, off) ? b.wallH : CUT_H;
      w.apply();
    }
    b.indoorOnly.forEach(o => o.visible = this.mode === 'walk');
    b.labels.forEach(l => l.visible = this.mode !== 'walk');
    this.fitSun();
    this.collidersDirty = true;
    this.rebuildPins();
    this.applyHighlight();
    this.updateMarker();
    this.editor.onStructureRebuilt();
    this.invalidate(3);
  }

  /** 撤销 / 重做：恢复整份状态（结构有变化时重建结构层，物件做增量更新） @internal */
  applyState(st: { items: PalaceItem[]; rooms: PalaceDoc['rooms']; walls: PalaceDoc['walls']; ground?: PalaceDoc['ground'] }) {
    const d = this.doc;
    if (JSON.stringify([st.rooms, st.walls, st.ground]) !== JSON.stringify([d.rooms, d.walls, d.ground])) {
      d.rooms = st.rooms; d.walls = st.walls; d.ground = st.ground;
      this.rebuildStructure();
    }
    this.applyItems(st.items);
  }

  private disposeBuilt(b: BuiltPalace) {
    b.root.removeFromParent();
    b.labels.forEach(l => l.element.remove());
    releaseLamps(b.root, this.kit);
    b.root.traverse((o: any) => {
      if (o.isMesh || o.isInstancedMesh) {
        if (!o.geometry.userData.shared) o.geometry.dispose();
        if (o.isInstancedMesh) o.dispose();
        for (const m of [].concat(o.material)) if (m?.userData?.owned) { m.map?.dispose(); m.dispose(); }
      }
    });
  }

  /**
   * 记忆桩标记：绑定了的物件头顶一枚图钉；绑定了的部件（书）插一张书签。
   * 找不到部件的绑定（书架改窄后放不下的书）记为 orphans。 @internal
   */
  rebuildPins() {
    const b = this.built;
    if (!b) return;
    this.orphans.clear();
    const box3 = new THREE.Box3();
    for (const obj of b.pickables) {
      for (const c of [...obj.children]) if (c.userData.overlay) obj.remove(c);
      const item = obj.userData.item as PalaceItem;
      const loci = itemLoci(item);
      pullSlots(obj, loci.map(l => l.slot).filter(Boolean));
      if (!loci.length) continue;
      obj.updateMatrixWorld(true);
      ownBox(obj, box3);
      const pin = new THREE.Group();
      pin.name = 'kp-pin';
      pin.userData.overlay = true;
      const head = new THREE.Mesh(this.pinGeo.head, this.pinMat);
      head.position.y = .26;
      const tip = new THREE.Mesh(this.pinGeo.tip, this.pinMat);
      tip.rotation.x = Math.PI; tip.position.y = .1;
      pin.add(head, tip);
      const top = new THREE.Vector3((box3.min.x + box3.max.x) / 2, box3.max.y + .06, (box3.min.z + box3.max.z) / 2);
      pin.position.copy(obj.worldToLocal(top));
      pin.quaternion.copy(obj.getWorldQuaternion(new THREE.Quaternion()).invert());
      // 只绑了部件时图钉小一号；颜色按最该复习的那个记忆桩
      if (!getBinding(item)) pin.scale.setScalar(.7);
      const lv = worstLevel(loci.map(l => this.memoryOf(l.binding.blockId)));
      const pm = this.levelMats[lv] || this.pinMat;
      head.material = tip.material = pm;
      obj.add(pin);
      if (lv === 'stale') this.addCobwebs(obj);
      for (const { slot } of loci) {
        if (!slot) continue;
        const lb = slotBox(obj, slot, box3, true);
        if (!lb) { this.orphans.add(locusKey(item.id, slot)); continue; }
        // 书签：书顶靠前露出一截，书脊正面再贴一道书标（俯视、平视都看得见）
        const w = lb.max.x - lb.min.x, h = lb.max.y - lb.min.y, cx = (lb.min.x + lb.max.x) / 2;
        const mm = this.levelMats[this.memoryOf(getBinding(item, slot).blockId)] || this.markMat;
        const tab = new THREE.Mesh(this.pinGeo.mark, mm);
        tab.scale.set(Math.min(w * .8, .03), .1, .004);
        tab.position.set(cx, lb.max.y + .02, lb.max.z - .015);
        const band = new THREE.Mesh(this.pinGeo.mark, mm);
        band.scale.set(w + .004, Math.min(.035, h * .16), .006);
        band.position.set(cx, lb.min.y + h * .72, lb.max.z + .001);
        for (const m of [tab, band]) {
          m.name = 'kp-mark';
          m.userData.overlay = true;
          m.userData.slot = slot;
          obj.add(m);
        }
      }
    }
  }

  /** 很久没复习的物件：顶上两个角结上蜘蛛网 */
  private addCobwebs(obj: THREE.Object3D) {
    const mat = this.webMat ||= cobwebMaterial();
    const lb = ownBox(obj, new THREE.Box3(), true);
    const w = lb.max.x - lb.min.x, h = lb.max.y - lb.min.y;
    const size = THREE.MathUtils.clamp(Math.min(w, h) * .45, .16, .42);
    for (const side of [-1, 1]) {
      const web = new THREE.Mesh(this.pinGeo.web, mat);
      web.name = 'kp-web';
      web.userData.overlay = true;
      web.raycast = () => { /* 不挡拾取 */ };
      web.scale.set(size * side, size, 1);
      web.position.set(side < 0 ? lb.min.x + size / 2 : lb.max.x - size / 2, lb.max.y - size / 2, lb.max.z + .006);
      web.renderOrder = 3;
      obj.add(web);
    }
  }

  private updateCounts() {
    if (!this.doc) return;
    const total = this.built?.pickables.length ?? 0;
    const bound = boundLoci(this.doc).length;
    this.ui.title.textContent = t(this.doc.name);
    this.ui.sub.textContent = t('{rooms} 个房间 · {n} 个物件', { rooms: this.doc.rooms.filter(r => r.floor).length, n: total });
    this.ui.lociCount.textContent = String(bound);
    this.renderLociList();
  }

  /** 从宿主拉取绑定块的最新标题 */
  private async refreshTitles() {
    const doc = this.doc;
    if (!this.host.getBlock || !doc || this.readonly) return;
    const loci = boundLoci(doc).filter(l => this.isLocalNote(l.binding, doc));
    let changed = false;
    await Promise.all(loci.map(async ({ binding }) => {
      try {
        const ref = await this.host.getBlock(binding.blockId);
        if (!ref) { this.missing.add(binding.blockId); return; }
        this.missing.delete(binding.blockId);
        if (ref.title && ref.title !== binding.title) { binding.title = ref.title; changed = true; }
      } catch { /* 宿主暂时不可用时保留旧标题 */ }
    }));
    if (this.disposed || this.doc !== doc) return;
    if (changed) this.emitChange(false);
    this.renderLociList();
    if (this.selected) this.showCard(this.selected);
  }

  /** @internal */ emitChange(touch = true) {
    if (!this.doc || this.readonly) return;
    if (touch) this.doc.updatedAt = Date.now();
    this.host.onDocChange?.(this.doc);
  }

  /** 世界（摆放 / 屋顶）变了：保存并刷新小镇 UI @internal */
  worldChanged() {
    this.world.updatedAt = Date.now();
    this.host.onWorldChange?.(this.world);
    this.townCtl.refresh();
  }

  // =====================================================================
  // UI
  // =====================================================================

  private buildUI() {
    const r = this.root;
    r.append(html`
      <div class="kp-brand kp-glass kp-iso-only kp-palace-only">
        <button class="kp-back" data-act="toTown" title="${t('回到小镇（Esc）')}">${rich(ICONS.back)}</button>
        <div class="kp-mark">${rich(ICONS.logo)}</div>
        <div style="min-width:0">
          <div class="kp-title" data-ref="title"></div>
          <div class="kp-sub" data-ref="sub"></div>
        </div>
        <button class="kp-loci-btn" data-act="loci" title="${t('已绑定的记忆桩')}">${rich(ICONS.pin)}<span data-ref="lociCount">0</span></button>
        <button class="kp-loci-btn kp-routes-btn" data-act="routes" data-ref="routesBtn" title="${t('记忆路线 · 沿路线回忆')}">${rich(ICONS.route)}<span>${t('路线')}</span></button>
        <button class="kp-loci-btn kp-numbers-btn" data-act="numbers" title="${t('数字记忆：把一串数字变成画面，摆在宫殿里')}">${rich(ICONS.hash)}<span>${t('数字')}</span></button>
        <button class="kp-loci-btn kp-guest-btn kp-hidden" data-act="guestOpen" data-ref="guestBtn" title="${t('留言板：好友来参观时留下的话')}">📮<span>${t('留言')}</span></button>
      </div>
      <div class="kp-loci kp-glass kp-hidden kp-iso-only kp-palace-only" data-ref="loci"></div>
      <div class="kp-routes kp-glass kp-hidden kp-iso-only kp-palace-only" data-ref="routes"></div>
      <div class="kp-routes kp-numbers kp-glass kp-hidden kp-iso-only kp-palace-only" data-ref="numbers"></div>
      <div class="kp-overlay kp-center kp-hidden kp-palace-only" data-ref="paoWrap"><div class="kp-pao kp-glass" data-ref="pao"></div></div>
      <div class="kp-overlay kp-center kp-hidden kp-palace-only" data-ref="shelfWrap"><div class="kp-shelfed kp-glass" data-ref="shelf"></div></div>
      <div class="kp-recall kp-glass kp-hidden kp-iso-only kp-palace-only" data-ref="recall"></div>
      <nav class="kp-bar kp-glass kp-iso-only kp-view-only kp-palace-only">
        <button class="kp-icon" data-act="rotl" title="${t('向左旋转 90°（Q）')}">${rich(ICONS.rotl)}</button>
        <button class="kp-icon" data-act="rotr" title="${t('向右旋转 90°（E）')}">${rich(ICONS.rotr)}</button>
        <span class="kp-sep"></span>
        <button data-act="walls" title="${t('切换墙体显示（W）')}">${rich(ICONS.walls)}<span data-wall-text>${t('剖切')}</span></button>
        <button data-act="night" title="${t('日 / 夜（N）')}"><svg class="kp-i" viewBox="0 0 24 24" data-night-icon>${rich(ICONS.moon)}</svg><span data-night-text>${t('夜晚')}</span></button>
        <button data-act="reset" title="${t('复位视角（R）')}">${rich(ICONS.reset)}<span>${t('复位')}</span></button>
        <button data-act="edit" title="${t('搭建模式：摆放、添加、删除物件（B）')}">${rich(ICONS.build)}<span>${t('搭建')}</span></button>
        <span class="kp-sep"></span>
        <button class="kp-primary" data-act="walk" title="${t('进入第一人称漫游')}">${rich(ICONS.walk)}<span>${t('进入漫游')}</span></button>
      </nav>
      <nav class="kp-bar kp-glass kp-iso-only kp-edit-only kp-editbar kp-palace-only">
        <div class="kp-seg">
          <button class="kp-on" data-act="emode" data-mode="items" title="${t('摆放物件')}">${t('物件')}</button>
          <button data-act="emode" data-mode="rooms" title="${t('编辑房间：大小、地面、名称')}">${t('房间')}</button>
          <button data-act="emode" data-mode="walls" title="${t('编辑墙体与门窗')}">${t('墙体')}</button>
        </div>
        <button class="kp-accent kp-em-items" data-act="addItem" title="${t('从目录添加物件')}">${rich(ICONS.plus)}<span>${t('添加物件')}</span></button>
        <button class="kp-accent kp-em-rooms" data-act="toolRoom" title="${t('在地面上拖出矩形新建房间')}">${rich(ICONS.plus)}<span>${t('新建房间')}</span></button>
        <button class="kp-accent kp-em-walls" data-act="toolWall" title="${t('单击起点、终点画墙')}">${rich(ICONS.build)}<span>${t('画墙')}</span></button>
        <span class="kp-sep"></span>
        <button class="kp-icon" data-act="undo" data-ref="undo" title="${t('撤销（⌘Z / Ctrl+Z）')}" disabled>${rich(ICONS.undo)}</button>
        <button class="kp-icon" data-act="redo" data-ref="redo" title="${t('重做（⇧⌘Z / Ctrl+Y）')}" disabled>${rich(ICONS.redo)}</button>
        <span class="kp-sep"></span>
        <button data-act="snap" title="${t('网格 5 cm / 角度 15° 吸附；按住 Alt 临时关闭')}">${rich(ICONS.grid)}<span data-ref="snapText">${t('吸附：开')}</span></button>
        <button class="kp-icon" data-act="rotl" title="${t('向左旋转视角 90°（Q）')}">${rich(ICONS.rotl)}</button>
        <button class="kp-icon" data-act="rotr" title="${t('向右旋转视角 90°（E）')}">${rich(ICONS.rotr)}</button>
        <button data-act="walls" title="${t('切换墙体显示（W）')}">${rich(ICONS.walls)}<span data-wall-text>${t('剖切')}</span></button>
        <span class="kp-sep"></span>
        <button class="kp-primary" data-act="editDone" title="${t('退出搭建（Esc）')}">${rich(ICONS.check)}<span>${t('完成')}</span></button>
      </nav>
      <div class="kp-place kp-glass kp-placing-only kp-palace-only"><span data-ref="placeHint"></span><button data-act="cancelPlace">${t('取消')}</button></div>
      <div class="kp-edit-hint kp-glass kp-edit-only kp-palace-only" data-ref="editHint">${rich(t('拖动物件移动（小物件可以放到家具上，随家具一起移动）· 拖动橙色圆点旋转 · <b>R</b> 旋转 90° · <b>[ ]</b> 微调角度 · 方向键微移 · <b>Delete</b> 删除 · <b>⌘D</b> 复制 · <b>⌘Z</b> 撤销 · 按住 <b>Alt</b> 关闭吸附'))}</div>
      <div class="kp-drawer kp-glass kp-hidden kp-palace-only" data-ref="drawer"></div>
      <div class="kp-card kp-glass kp-hidden kp-iso-only kp-palace-only" data-ref="card"></div>
      <div class="kp-crosshair kp-walk-only"></div>
      <div class="kp-focus kp-glass kp-hidden" data-ref="focus"></div>
      <div class="kp-walk-hud kp-glass kp-walk-only">
        <span>${rich(t('<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动 · 拖动转视角 · <kbd>F</kbd> 打开笔记 · <kbd>Esc</kbd> 退出'))}</span>
        <button data-act="exitWalk">${t('返回俯视')}</button>
      </div>
      <div class="kp-joy kp-glass kp-walk-only" data-ref="joy"><i></i></div>
      <div class="kp-tip" data-ref="tip"></div>
      <div class="kp-fade" data-ref="fade"></div>
      <div class="kp-loading" data-ref="loading">${t('正在登岛…')}</div>`);
    r.querySelectorAll<HTMLElement>('[data-ref]').forEach(el => { this.ui[el.dataset.ref] = el; });
  }

  private renderLociList() {
    const list = this.ui.loci;
    if (!this.doc) return;
    const loci = this.sortLoci(boundLoci(this.doc));
    if (!loci.length) {
      list.replaceChildren(html`<div class="kp-empty">${rich(t('还没有记忆桩。<br>点选场景里的物件（或书架上的一本书），就能把它和一个笔记块绑定。'))}</div>`);
      return;
    }
    list.replaceChildren();
    for (const { item, slot, binding } of loci) {
      const b = document.createElement('button');
      b.className = 'kp-row';
      b.dataset.act = 'gotoItem';
      b.dataset.id = locusKey(item.id, slot);
      const room = t(this.built?.roomOf(item.room)?.name || '');
      const missing = this.missing.has(binding.blockId), orphan = this.orphans.has(locusKey(item.id, slot));
      b.replaceChildren(html`<b></b><span></span>`);
      b.querySelector('b').textContent = [this.locusName(item, slot), room].filter(Boolean).join(' · ');
      b.querySelector('span').textContent = missing ? t('⚠︎ 绑定的块已不存在')
        : orphan ? t('⚠︎ {title}（这个部件已不在了，调回物件尺寸即可恢复）', { title: binding.title || binding.blockId })
          : (binding.title || binding.blockId);
      list.appendChild(b);
    }
  }

  /** 同一件物件上的部件按显示名排（第 1 层在前），物件之间保持原顺序 */
  private sortLoci(list: BoundLocus[]) {
    const label = (l: BoundLocus) => l.slot ? slotLabel(this.catalog, l.item, l.slot) : '';
    const order = new Map<string, number>();
    list.forEach((l, i) => { if (!order.has(l.item.id)) order.set(l.item.id, i); });
    return [...list].sort((a, b) => order.get(a.item.id) - order.get(b.item.id) || label(a).localeCompare(label(b), getLocale() === 'zh-CN' ? 'zh' : 'en', { numeric: true }));
  }

  /** 记忆桩的显示名：物件名，部件再加上部件名（书架 · 第 2 层 · 第 5 本） @internal */
  locusName(item: PalaceItem, slot = '') {
    const name = itemDisplayName(item, this.catalog);
    return slot ? `${name} · ${slotLabel(this.catalog, item, slot)}` : name;
  }

  /** @internal */ showCard(obj: THREE.Object3D | null) {
    if (this.editor?.active) return this.editor.renderCard(obj);
    const card = this.ui.card;
    if (!obj || this.recall?.active || this.numbers?.active) { card.classList.add('kp-hidden'); return; }
    const item = obj.userData.item as PalaceItem;
    const slot = this.selectedSlot;
    const room = t(this.built?.roomOf(item.room)?.name || item.room || '');
    const b = getBinding(item, slot);
    const missing = b && this.missing.has(b.blockId);
    const foreign = b && !this.isLocalNote(b);
    const canPick = !!this.host.pickBlock && !this.readonly, canOpen = !!this.host.openBlock && !foreign;
    // 笔记本书架上的书：它本身就是一篇文档
    const doc = slot && !b ? this.docOfSlot(item, slot) : null;
    let pinSlot: DocumentFragment;
    if (b?.blockId) {
      pinSlot = html`<div class="kp-slot kp-linked${missing ? ' kp-missing' : ''}" data-act="${canOpen ? 'openBinding' : ''}" title="${canOpen ? t('打开笔记块') : ''}">
        📌 ${b.src === 'public' ? t('公开的记忆桩') : t('已绑定记忆桩')}<b data-ref="bindTitle"></b><small>${missing ? t('⚠︎ 这个块已被删除或移动，请重新绑定') : b.src === 'public' ? t('主人只分享了标题和记忆故事，笔记本身不会分享') : foreign ? t('笔记在{app}里', { app: t(noteSourceName(b.src || this.doc?.src)) }) : (canOpen ? t('点击打开 · 按住 Alt 在右侧分屏打开') : b.blockId)}</small></div>`;
    } else if (doc) {
      pinSlot = html`<div class="kp-slot kp-linked kp-docbook" data-act="${canOpen ? 'openBinding' : ''}" title="${canOpen ? t('打开文档') : ''}">
        📖 ${t('这本书就是笔记')}<b data-ref="bindTitle"></b><small>${canOpen ? t('点击打开 · ') : ''}${t('设为记忆桩后会出现在路线和回忆里')}</small></div>`;
    } else {
      pinSlot = html`<div class="kp-slot">📌 ${t('尚未绑定笔记')}<br>${canPick ? (slot ? t('把这个部件和一个笔记块关联起来，漫游到这里时就能回想起它。') : t('把这个物件和一个笔记块关联起来，漫游到这里时就能回想起它。')) : t('当前环境不支持绑定笔记。')}</div>`;
    }
    const bindBtns = this.readonly ? null : b?.blockId
      ? html`${canPick ? html`<button data-act="bind">${t('更换')}</button>` : ''}<button class="kp-danger" data-act="unbind" title="${t('解除绑定')}">${t('解绑')}</button>`
      : doc ? html`<button class="kp-primary" data-act="bindDoc">${t('设为记忆桩')}</button>`
        : (canPick ? html`<button class="kp-primary" data-act="bind">${t('绑定笔记块')}</button>` : null);
    // 整个笔记本书架：书目来源、放不下的本数
    const shelf = !slot && obj.userData.shelf?.source ? obj.userData.shelf : null;
    const shelfLine = shelf ? html`<div class="kp-shelf-src">📚 ${item.params.source.name || t('笔记本')} · ${shelf.loading ? t('正在读取书目…') : t('{n} 本', { n: shelf.total })}${shelf.overflow ? html`<br><em>${t('还有 {n} 本放不下：在搭建模式里加宽书架或加层', { n: shelf.overflow })}</em>` : ''}</div>` : null;
    // 整件物件：列出它上面已绑定的部件；部件：可以回到整件
    const parts = slot ? [] : this.sortLoci(itemLoci(item).filter(l => l.slot));
    const partList = parts.length ? html`<div class="kp-subtitle">${t('部件记忆桩')} · ${parts.length}</div><div class="kp-mini">${parts.slice(0, 5).map(l => html`
      <button data-act="gotoItem" data-id="${locusKey(item.id, l.slot)}"><b>${l.binding.title || l.binding.blockId}</b><span>${slotLabel(this.catalog, item, l.slot)}${this.orphans.has(locusKey(item.id, l.slot)) ? ' · ' + t('⚠︎ 已不在') : ''}</span></button>`)}
      ${parts.length > 5 ? html`<div class="kp-more-note">${t('还有 {n} 个…', { n: parts.length - 5 })}</div>` : ''}</div>` : null;
    card.replaceChildren(html`
      <button class="kp-close" data-act="closeCard">×</button>
      <div class="kp-room">${room.toUpperCase()}</div>
      <h3></h3>
      ${slot ? html`<div class="kp-part"><span></span><button data-act="selectWhole">${t('选中整个{name}', { name: itemDisplayName(item, this.catalog) })}</button></div>` : ''}
      ${shelfLine}
      ${this.catalog[item.type] ? '' : html`<div class="kp-shelf-src">📦 ${t('「{type}」需要更新版本的插件才能显示，先用纸箱占位', { type: item.type })}</div>`}
      ${pinSlot}
      ${bindBtns ? html`<div class="kp-row">${bindBtns}</div>` : ''}
      ${this.social?.shareToggle(b)}
      ${this.numbers.cardSection(item, slot)}
      ${b?.blockId ? this.stories.section(item, slot, b) : ''}
      ${partList}
      ${item.type === 'bookshelf' ? html`<div class="kp-row"><button data-act="shelfEdit" title="${t('书架的正视图：逐本换颜色、靠向一边、抽出、空出一格，也能一本本绑定')}">📚 ${t('书架平面图')}</button></div>` : ''}
      <div class="kp-row"><button data-act="focus">${t('聚焦')}</button><button data-act="walkHere">${t('从这里漫游')}</button></div>`);
    card.querySelector('h3').textContent = itemDisplayName(item, this.catalog);
    const part = card.querySelector('.kp-part span');
    if (part) part.textContent = slotLabel(this.catalog, item, slot);
    const bt = card.querySelector('[data-ref="bindTitle"]');
    if (bt) bt.textContent = b ? (b.title || b.blockId) : t('《{title}》', { title: doc.title });
    if (b?.blockId) this.stories.hydrate(card, b);
    card.classList.remove('kp-hidden');
  }

  /** 笔记本书架上的书：把它对应的文档设为记忆桩 */
  private bindDocSlot() {
    const item = this.selected?.userData.item as PalaceItem;
    if (item) this.bindDocBook(item, this.selectedSlot);
  }

  private async bindSelected() {
    const item = this.selected?.userData.item as PalaceItem;
    if (item) await this.pickAndBind(item, this.selectedSlot);
  }

  private unbindSelected() {
    const item = this.selected?.userData.item as PalaceItem;
    if (item) this.unbindLocus(item, this.selectedSlot);
  }

  /** 笔记本书架上的书：把它对应的文档设为记忆桩 @internal */
  bindDocBook(item: PalaceItem, slot: string) {
    const doc = this.docOfSlot(item, slot);
    if (!doc) return;
    setBinding(item, slot, this.stampSource({ blockId: doc.id, title: doc.title, boundAt: Date.now() }));
    this.emitChange();
    this.refreshBindings();
    this.host.notify?.(t('《{title}》已设为记忆桩', { title: doc.title }));
  }

  /** 让用户挑一个笔记块，绑定到这个记忆桩 @internal */
  async pickAndBind(item: PalaceItem, slot: string) {
    if (!this.host.pickBlock) return;
    const name = this.locusName(item, slot);
    const ref = await this.host.pickBlock({ current: getBinding(item, slot)?.blockId, itemName: name });
    if (!ref || this.disposed) return;
    setBinding(item, slot, this.stampSource({ blockId: ref.id, title: ref.title, boundAt: Date.now() }));
    this.missing.delete(ref.id);
    this.emitChange();
    this.refreshBindings();
    this.host.notify?.(t('已把「{name}」绑定到「{title}」', { name, title: ref.title }));
  }

  /** @internal */ unbindLocus(item: PalaceItem, slot: string) {
    setBinding(item, slot, null);
    this.emitChange();
    this.refreshBindings();
  }

  /**
   * 物件 / 部件上可打开的笔记：部件自己的绑定；笔记本书架上的书就是那篇文档；否则退回整件的绑定
   */
  /** @internal */ bindingAt(obj: THREE.Object3D | null, slot = ''): LocusBinding | null {
    const item = obj?.userData.item as PalaceItem | undefined;
    const own = slot && getBinding(item, slot);
    if (own) return own;
    const doc = item && slot ? this.docOfSlot(item, slot) : null;
    if (doc) return { blockId: doc.id, title: doc.title, src: item.params.source.src };
    return getBinding(item);
  }

  /** 悬停 / 准星提示里绑定那一段：部件自己的、文档书、或借用整件的 */
  private linkText(item: PalaceItem, slot: string, lb: LocusBinding) {
    if (slot && !getBinding(item, slot)) {
      if (slot.startsWith('doc:')) return `📖 ${lb.title || lb.blockId}`;
      return `📌 ${t('整个{name}：{title}', { name: itemDisplayName(item, this.catalog), title: lb.title || lb.blockId })}`;
    }
    return `📌 ${lb.title || lb.blockId}`;
  }

  private openBinding(obj: THREE.Object3D | null, side = false, slot = '') {
    const b = this.bindingAt(obj, slot);
    if (!b?.blockId || !this.host.openBlock) return;
    if (!this.isLocalNote(b)) { this.foreignNotice(b); return; }
    this.host.openBlock(b.blockId, { side });
  }

  // =====================================================================
  // 事件
  // =====================================================================

  /** @internal */ on<K extends keyof HTMLElementEventMap>(el: EventTarget, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) {
    el.addEventListener(type, fn, opts);
    this.cleanups.push(() => el.removeEventListener(type, fn, opts));
  }

  private bindEvents() {
    const cvs = this.renderer.domElement, root = this.root;

    this.on(root, 'click', (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b || !root.contains(b)) return;
      this.onAction(b.dataset.act, b, e);
    });
    this.on(cvs, 'contextmenu', (e: Event) => e.preventDefault());
    // 编辑模式在捕获阶段先拿到 pointerdown：拖动物件时不让 OrbitControls 平移视角
    this.on(root, 'pointerdown', (e: PointerEvent) => {
      if (e.target !== cvs || this.mode !== 'iso' || this.camTween) return;
      const took = this.level === 'town' ? this.townCtl.onPointerDown(e) : this.editor.onPointerDown(e);
      if (took) {
        e.stopPropagation();
        this.pointerDown = null;
        root.focus({ preventScroll: true });
      }
    }, { capture: true });
    this.on(root, 'input', (e: Event) => { if (this.social?.onInput(e, false) || this.companion.onInput(e, false)) return; if (this.level === 'town') this.townCtl.onInput(e, false); else if (this.shelfEd.onInput(e, false) || this.numbers.onInput(e, false) || this.recall.onInput(e, false)) return; else if (this.editor.active) this.editor.onInput(e, false); });
    this.on(root, 'change', (e: Event) => { if (this.social?.onInput(e, true) || this.companion.onInput(e, true)) return; if (this.level === 'town') this.townCtl.onInput(e, true); else if (this.shelfEd.onInput(e, true) || this.numbers.onInput(e, true) || this.recall.onInput(e, true)) return; else if (this.editor.active) this.editor.onInput(e, true); });
    this.on(cvs, 'pointermove', (e: PointerEvent) => {
      if (this.mode === 'iso') {
        if (this.level === 'town' ? this.townCtl.onPointerMove(e) : this.editor.onPointerMove(e)) return;
      }
      this.lastPointer = e;
      if (this.mode === 'walk') this.onWalkPointerMove(e);
      else this.invalidate(1);
    });
    this.on(cvs, 'pointerleave', () => {
      this.lastPointer = null;
      if (this.level === 'town') this.townCtl.onPointerLeave();
      else if (this.hovered) { this.hovered = null; this.applyHighlight(); }
      this.ui.tip.classList.remove('kp-on');
    });
    this.on(cvs, 'pointerdown', (e: PointerEvent) => {
      root.focus({ preventScroll: true });
      this.pointerDown = { x: e.clientX, y: e.clientY };
      if (this.mode === 'walk') {
        this.walk.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
        cvs.setPointerCapture(e.pointerId);
      }
    });
    this.on(cvs, 'pointerup', (e: PointerEvent) => {
      if (this.mode === 'walk') { this.onWalkPointerUp(e); return; }
      if (this.level === 'town') {
        if (this.townCtl.onPointerUp(e)) { this.pointerDown = null; return; }
      } else if (this.editor.onPointerUp(e)) { this.pointerDown = null; return; }
      if (!this.pointerDown || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y);
      this.pointerDown = null;
      if (moved > 5) return;
      if (this.level === 'town') { this.townCtl.onClick(e); return; }
      if (this.editor.active && this.editor.emode !== 'items') { this.editor.struct.onClick(e); return; }
      if (this.companion.click(e.clientX, e.clientY)) return;
      if (this.recall.active || this.numbers.active) return;
      const hit = this.pickAt(e.clientX, e.clientY);
      // 串门时（或有客人在）点地板：自己的小人走过去
      if (this.social?.room.walkByClick && !this.editor.active && (!hit || ![...this.built.itemObjects.values()].includes(hit.obj))) {
        const floor = this.pickAt(e.clientX, e.clientY, this.built?.floors || []);
        if (floor) { this.select(null); this.companion.walkTo(floor.point.x, floor.point.z); return; }
      }
      if (this.recall.picking && this.recall.onPick(hit?.obj || null, hit?.slot || '')) return;
      this.select(hit?.obj || null, this.editor.active ? '' : hit?.slot);
      this.ui.loci.classList.add('kp-hidden');
    });
    this.on(cvs, 'dblclick', (e: MouseEvent) => {
      if (this.mode !== 'iso') return;
      if (this.level === 'town') { this.townCtl.onDblClick(e); return; }
      if (this.editor.active || this.recall.active || this.numbers.active) return;
      const hit = this.pickAt(e.clientX, e.clientY);
      if (hit?.obj && this.bindingAt(hit.obj, hit.slot)) { this.openBinding(hit.obj, e.altKey, hit.slot); return; }
      const floor = this.pickAt(e.clientX, e.clientY, this.built?.floors || []);
      if (!floor) return;
      const dir = new THREE.Vector3().subVectors(this.orbit.target, this.isoCam.position).setY(0).normalize();
      this.enterWalk(floor.point.x, floor.point.z, Math.atan2(-dir.x, -dir.z));
    });
    this.on(root, 'keydown', (e: KeyboardEvent) => this.onKey(e, true));
    this.on(root, 'keyup', (e: KeyboardEvent) => this.onKey(e, false));
    this.on(root, 'blur', () => this.walk.keys.clear());
    this.on(document, 'visibilitychange', () => { this.invalidate(); if (!document.hidden) void this.refreshReview(30e3); });

    const joy = this.ui.joy, knob = joy.querySelector('i') as HTMLElement;
    const moveJoy = (e: PointerEvent) => {
      const r = joy.getBoundingClientRect();
      let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
      const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      this.walk.joy.x = x; this.walk.joy.y = y;
      knob.style.transform = `translate(${x * 36}px, ${y * 36}px)`;
    };
    this.on(joy, 'pointerdown', (e: PointerEvent) => { this.walk.joyId = e.pointerId; joy.setPointerCapture(e.pointerId); moveJoy(e); });
    this.on(joy, 'pointermove', (e: PointerEvent) => { if (e.pointerId === this.walk.joyId) moveJoy(e); });
    this.on(joy, 'pointerup', () => { this.walk.joyId = null; this.walk.joy.x = this.walk.joy.y = 0; knob.style.removeProperty('transform'); });
  }

  private onAction(act: string, el: HTMLElement, e: MouseEvent) {
    if (this.blockedWhenReadonly(act)) { this.host.notify?.(this.visiting ? t('参观时只能看，不能改动别人的宫殿') : t('这是只读的宫殿')); return; }
    if (this.social?.onAction(act, el)) return;
    if (this.guide.onAction(act, el)) return;
    if (this.companion.onAction(act, el)) return;
    if (this.townCtl.onAction(act, el, e)) return;
    if (this.level === 'palace' && this.stories.onAction(act)) return;
    if (this.level === 'palace' && this.shelfEd.onAction(act, el)) return;
    if (this.level === 'palace' && this.numbers.onAction(act, el)) return;
    if (this.level === 'palace' && this.recall.onAction(act, el)) return;
    if (this.level === 'palace' && this.editor.onAction(act, el)) return;
    switch (act) {
      case 'rotl': return this.rotateBy(-90);
      case 'rotr': return this.rotateBy(90);
      case 'walls': return this.cycleWalls();
      case 'night': return this.toggleNight();
      case 'reset': return this.resetView();
      case 'walk': return this.enterWalk();
      case 'exitWalk': return this.exitWalk();
      case 'toTown': return this.exitPalace();
      case 'closeCard': return this.select(null);
      case 'focus': return this.focusSelected();
      case 'bind': return void this.bindSelected();
      case 'bindDoc': return this.bindDocSlot();
      case 'unbind': return this.unbindSelected();
      case 'openBinding': return this.openBinding(this.selected, e.altKey, this.selectedSlot);
      case 'selectWhole': return this.select(this.selected);
      case 'loci':
        this.ui.loci.classList.toggle('kp-hidden');
        if (!this.ui.loci.classList.contains('kp-hidden') && this.recall.panelOpen) this.recall.togglePanel(false);
        if (!this.ui.loci.classList.contains('kp-hidden') && this.numbers.panelOpen) this.numbers.togglePanel(false);
        return;
      case 'gotoItem': this.ui.loci.classList.add('kp-hidden'); return this.focusItem(el.dataset.id);
      case 'walkHere': {
        if (!this.selected) return;
        const c = ownBox(this.selected).getCenter(new THREE.Vector3());
        const dir = new THREE.Vector3().subVectors(this.orbit.target, this.isoCam.position).setY(0).normalize();
        const [x, z] = this.findFree(c.x - dir.x * 1.4, c.z - dir.z * 1.4);
        return this.enterWalk(x, z, Math.atan2(-(c.x - x), -(c.z - z)));
      }
    }
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (down && this.guide.onKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
    if (down && this.social?.onKey(e)) { e.preventDefault(); return; }
    if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (down && (this.townCtl.onGlobalKey(e) || this.numbers.onGlobalKey(e) || this.shelfEd.onGlobalKey(e))) { e.stopPropagation(); e.preventDefault(); return; }
    if (down && this.mode === 'iso') {
      const took = this.level === 'town' ? this.townCtl.onKey(e) : (this.numbers.onKey(e) || this.recall.onKey(e) || this.editor.onKey(e));
      if (took) { e.stopPropagation(); e.preventDefault(); return; }
    }
    if (e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    let handled = true;
    if (this.mode === 'walk') {
      if (down) {
        this.walk.keys.add(k);
        if (k === 'escape' && !document.pointerLockElement) this.exitWalk();
        else if (k === 'f') this.openBinding(this.walk.focus, e.altKey, this.walk.focusSlot);
      } else this.walk.keys.delete(k);
    } else if (down) {
      if (k === 'q') this.rotateBy(-90);
      else if (k === 'e') this.rotateBy(90);
      else if (k === 'r') this.resetView();
      else if (k === 'n') this.toggleNight();
      else if (k === 'w' && this.level === 'palace') this.cycleWalls();
      else if (k === 'b' && this.level === 'palace') this.editor.toggle();
      else if (k === 'escape' && this.level === 'palace') {
        if (this.selected) this.select(null);
        else if (!this.ui.loci.classList.contains('kp-hidden')) this.ui.loci.classList.add('kp-hidden');
        else this.exitPalace();
      }
      else handled = false;
    } else handled = false;
    if (handled) { e.stopPropagation(); if (k !== 'escape') e.preventDefault(); }
  }

  // =====================================================================
  // 拾取 / 高亮
  // =====================================================================

  /** @internal */ ndc(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  /** @internal */ pickAt(clientX: number, clientY: number, list?: THREE.Object3D[]) {
    if (!this.built && !list) return null;
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.activeCam);
    return this.pickRay(list || this.built.pickables);
  }

  /** 射线拾取：返回物件（或房间）、落点和打中的部件编号（'' 表示不是部件） */
  private pickRay(list: THREE.Object3D[], maxDist = Infinity): { obj: THREE.Object3D; point: THREE.Vector3; slot: string } | null {
    const hits = this.raycaster.intersectObjects(list, true);
    for (const h of hits) {
      if (h.distance > maxDist) break;
      if (!isVisible(h.object)) continue;
      let o: THREE.Object3D = h.object;
      while (o && !o.userData.item && !o.userData.room) o = o.parent;
      if (o) return { obj: o, point: h.point, slot: o.userData.item ? slotOfHit(h, o) : '' };
    }
    return null;
  }

  private updateHover() {
    if (this.mode !== 'iso' || !this.lastPointer || this.camTween || !this.built) return;
    if (this.editor.active && this.editor.emode !== 'items') { this.lastPointer = null; return; }
    // 回忆时不显示提示（会泄露答案）
    if (this.recall.active || this.numbers.active) { this.lastPointer = null; this.ui.tip.classList.remove('kp-on'); this.setCursor(''); return; }
    const e = this.lastPointer; this.lastPointer = null;
    const tip = this.ui.tip;
    if (e.buttons) { tip.classList.remove('kp-on'); return; }
    const hit = this.pickAt(e.clientX, e.clientY);
    const obj = hit?.obj || null, slot = obj && !this.editor.active ? hit.slot : '';
    if (obj !== this.hovered || slot !== this.hoveredSlot) {
      this.hovered = obj; this.hoveredSlot = slot; this.hoverSince = performance.now(); this.previewShownFor = null;
      this.applyHighlight();
    }
    if (obj) {
      const item = obj.userData.item as PalaceItem;
      const room = t(this.built.roomOf(item.room)?.name || '');
      const lb = this.bindingAt(obj, slot);
      const bound = lb ? html`<span class="kp-bound">${this.linkText(item, slot, lb)}</span>` : null;
      tip.replaceChildren(html`${this.locusName(item, slot)}<small>${room}</small>${bound}`);
      this.placeTip(e);
      this.setCursor('pointer');
      // 悬停在已绑定的物件上一会儿 → 宿主显示笔记预览
      if (lb && this.host.showBlockPreview) this.lastHoverPos = { x: e.clientX, y: e.clientY };
    } else {
      tip.classList.remove('kp-on');
      this.setCursor('');
    }
  }
  private lastHoverPos: { x: number; y: number } | null = null;

  /** 画布上的鼠标样式（样式表里按 data-kp-cursor 设置） @internal */
  setCursor(c: '' | 'pointer' | 'grab' | 'grabbing') {
    this.renderer.domElement.dataset.kpCursor = c;
  }

  /** @internal */ placeTip(e: { clientX: number; clientY: number }) {
    const tip = this.ui.tip;
    const rr = this.root.getBoundingClientRect();
    tip.style.transform = `translate(${e.clientX - rr.left + 14}px, ${e.clientY - rr.top + 14}px)`;
    tip.classList.add('kp-on');
  }

  private maybeShowPreview() {
    const obj = this.hovered;
    if (!obj || !this.lastHoverPos || this.mode !== 'iso') return;
    const lb = this.bindingAt(obj, this.hoveredSlot), id = lb?.blockId;
    if (!id || !this.isLocalNote(lb) || this.previewShownFor === id || performance.now() - this.hoverSince < 700) return;
    this.previewShownFor = id;
    this.ui.tip.classList.remove('kp-on');
    this.host.showBlockPreview?.(id, this.lastHoverPos);
  }

  /** @internal */ clearTint() {
    for (const [m, orig] of this.tinted) {
      for (const c of ([] as THREE.Material[]).concat(m.material)) c.dispose();
      m.material = orig;
    }
    this.tinted.clear();
    for (const t of this.tintedInst) {
      t.mesh.setColorAt(t.id, t.color);
      t.mesh.instanceColor.needsUpdate = true;
    }
    this.tintedInst = [];
    for (const t of this.tintedVerts) {
      const attr = t.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      if (!attr) continue;
      for (let i = 0; i < 4; i++) attr.setXYZ(t.start + i, 1, 1, 1);
      attr.needsUpdate = true;
    }
    this.tintedVerts = [];
  }

  /** 高亮一个部件：实例化的书直接调颜色（书脊面片调顶点色），普通网格走材质高亮 */
  private tintSlot(obj: THREE.Object3D, slot: string, color: string, k: number) {
    const ref = findSlot(obj, slot);
    if (!ref) return;
    traverseOwn(obj, (o: any) => {
      const start = o.userData.slotVerts?.[slot];
      if (start === undefined || this.tintedVerts.some(t => t.mesh === o && t.start === start)) return;
      const attr = o.geometry.getAttribute('color') as THREE.BufferAttribute;
      const c = new THREE.Color('#ffffff').lerp(new THREE.Color(color), k * .8);
      for (let i = 0; i < 4; i++) attr.setXYZ(start + i, c.r, c.g, c.b);
      attr.needsUpdate = true;
      this.tintedVerts.push({ mesh: o, start });
    });
    if (ref.instanceId === undefined) { this.applyTint(ref.mesh, color, k); return; }
    const mesh = ref.mesh as THREE.InstancedMesh;
    if (!mesh.instanceColor || this.tintedInst.some(t => t.mesh === mesh && t.id === ref.instanceId)) return;
    const orig = new THREE.Color();
    mesh.getColorAt(ref.instanceId, orig);
    this.tintedInst.push({ mesh, id: ref.instanceId, color: orig });
    mesh.setColorAt(ref.instanceId, orig.clone().lerp(new THREE.Color(color), k).multiplyScalar(1.15));
    mesh.instanceColor.needsUpdate = true;
  }

  private applyTint(root: THREE.Object3D, color: string, k: number) {
    traverseOwn(root, (m: any) => {
      if (!m.isMesh || this.tinted.has(m)) return;
      const orig = m.material;
      const conv = (mm: any) => {
        const c = mm.clone();
        if (c.emissive && !c.emissiveMap) {
          // 普通材质的 emissive 是黑色、强度默认 1：只加一层很淡的暖色；本身会发光的灯罩保持原亮度
          const wasDark = c.emissive.getHex() === 0;
          c.emissive.set(color);
          c.emissiveIntensity = wasDark ? k : Math.max(c.emissiveIntensity, k);
        }
        return c;
      };
      m.material = Array.isArray(orig) ? orig.map(conv) : conv(orig);
      this.tinted.set(m, orig);
    });
  }

  /** @internal */ applyHighlight() {
    this.clearTint();
    if (this.selected) {
      if (this.selectedSlot) this.tintSlot(this.selected, this.selectedSlot, '#ff8a3d', .6);
      else this.applyTint(this.selected, '#ff8a3d', .12);
    }
    if (this.hovered && (this.hovered !== this.selected || this.hoveredSlot !== this.selectedSlot)) {
      if (this.hoveredSlot) this.tintSlot(this.hovered, this.hoveredSlot, '#ffb070', .4);
      else if (this.hovered !== this.selected) this.applyTint(this.hovered, '#ffb070', .08);
    }
    if (this.level === 'palace') for (const o of this.editor?.struct.highlights() || []) this.applyTint(o, '#ff8a3d', .18);
    for (const [o, k] of this.townCtl?.highlights() || []) this.applyTint(o, '#ffa060', k);
    this.invalidate();
  }

  /** 选中物件；slot 为部件编号（'' = 整件） @internal */
  select(obj: THREE.Object3D | null, slot = '') {
    if (obj !== this.selected || slot !== this.selectedSlot) this.stories?.reset();
    this.selected = obj;
    this.selectedSlot = obj ? slot || '' : '';
    this.applyHighlight();
    this.updateMarker();
    this.editor?.updateRing();
    this.showCard(obj);
    this.companion?.onSelect(obj);
    this.social?.onSelect(obj, this.selectedSlot);
    this.guide?.onSelect(obj);
  }

  /** @internal */ updateMarker() {
    const o = this.slotOutline;
    o.visible = false;
    if (!this.selected || this.mode !== 'iso') { this.setMarker(null); return; }
    if (this.selectedSlot) {
      // 部件：不画地面框，改为在部件外面描一圈
      const sb = slotBox(this.selected, this.selectedSlot);
      if (sb) {
        this.setMarker(null);
        sb.expandByScalar(.008);
        sb.getCenter(o.position);
        sb.getSize(o.scale);
        o.visible = true;
        this.invalidate();
        return;
      }
    }
    const b = ownBox(this.selected);
    // 放在家具上的物件：框画在它所在的台面上
    const onTop = !!(this.selected.userData.item as PalaceItem).parent;
    this.setMarker(b, onTop ? b.min.y + .012 : (b.min.y < -.05 ? b.min.y : 0) + .02, onTop ? .06 : .13);
  }

  /** 地面上的橙色圆角框（选中物件 / 小镇里选中的宫殿） @internal */
  setMarker(box: THREE.Box3 | null, y = .02, pad = .13, color = '#ef8235') {
    const marker = this.marker;
    for (const c of marker.children) (c as THREE.Mesh).geometry.dispose();
    marker.clear();
    if (!box) { marker.visible = false; this.invalidate(); return; }
    this.markerLine.color.set(color); this.markerFill.color.set(color);
    const c = box.getCenter(new THREE.Vector3());
    const w = box.max.x - box.min.x + pad * 2, d = box.max.z - box.min.z + pad * 2, r = Math.min(.16 + pad * .6, w / 2, d / 2), lw = .05 + pad * .08;
    const inner = () => roundRectShape(w - lw * 2, d - lw * 2, Math.max(.01, r - lw));
    const ring = roundRectShape(w, d, r);
    ring.holes.push(inner());
    for (const [shape, mat] of [[ring, this.markerLine], [inner(), this.markerFill]] as [THREE.Shape, THREE.Material][]) {
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), mat);
      m.rotation.x = -Math.PI / 2; m.renderOrder = 10;
      marker.add(m);
    }
    marker.position.set(c.x, y, c.z);
    marker.visible = true;
    this.invalidate();
  }

  // =====================================================================
  // 相机
  // =====================================================================

  /** 让跨度为 span、高度为 H 的范围刚好装满画面所需的视锥高度 */
  private frustumFor(span: number, H: number) {
    const a = this.width / Math.max(1, this.height) || 1;
    const projW = span * 1.02;
    const projH = projW * Math.sin(ELEV) + H * Math.cos(ELEV);
    return Math.max(projH * 1.05, projW / a);
  }

  private fitIso() {
    const a = this.width / Math.max(1, this.height) || 1;
    this.frustum = this.frustumFor(this.homeZoomSpan, this.homeH);
    const f = this.frustum;
    Object.assign(this.isoCam, { left: -f * a / 2, right: f * a / 2, top: f / 2, bottom: -f / 2 });
    this.isoCam.updateProjectionMatrix();
    this.fpCam.aspect = a; this.fpCam.updateProjectionMatrix();
  }

  /** 重新取景；keepView 时保持画面上的可见范围不变（层级切换时画面不跳） */
  private refit(keepView: boolean) {
    const vis = this.frustum / this.isoCam.zoom;
    this.fitIso();
    if (keepView) { this.isoCam.zoom = this.frustum / vis; this.isoCam.updateProjectionMatrix(); }
    if (this.level === 'palace') { this.orbit.minZoom = .55; this.orbit.maxZoom = 4.5; }
    else this.townZoomLimits();
  }

  /** 小镇层级的缩放范围：最远能看到整个群岛，最近约 8 m */
  private townZoomLimits() {
    // 最远：完整的小星球再留一点余地
    const { V1 } = this.planetRange();
    this.orbit.minZoom = Math.min(.5, this.frustum / (V1 * 1.25));
    this.orbit.maxZoom = Math.max(2.5, this.frustum / 8);
  }

  /** @internal */ tweenCam({ az, el, target, zoom, dur = .9 }: { az?: number; el?: number; target?: THREE.Vector3; zoom?: number; dur?: number }) {
    const sph = new THREE.Spherical().setFromVector3(new THREE.Vector3().subVectors(this.isoCam.position, this.orbit.target));
    const fromAz = sph.theta;
    let toAz = az ?? fromAz;
    toAz = fromAz + Math.atan2(Math.sin(toAz - fromAz), Math.cos(toAz - fromAz));
    const fromEl = Math.PI / 2 - sph.phi;
    this.camTween = {
      t: 0, dur, fromAz, toAz, fromEl, toEl: el ?? fromEl,
      fromT: this.orbit.target.clone(), toT: (target || this.orbit.target).clone(),
      fromZ: Math.log(this.isoCam.zoom), toZ: Math.log(zoom ?? this.isoCam.zoom),
    };
  }

  private stepCamTween(dt: number) {
    const c = this.camTween;
    if (!c) return;
    c.t = Math.min(1, c.t + dt / c.dur);
    const k = c.t < .5 ? 4 * c.t ** 3 : 1 - (-2 * c.t + 2) ** 3 / 2;
    this.orbit.target.lerpVectors(c.fromT, c.toT, k);
    this.isoCam.position.copy(this.orbit.target).add(isoOffset(lerp(c.fromAz, c.toAz, k), lerp(c.fromEl, c.toEl, k)));
    this.isoCam.zoom = Math.exp(lerp(c.fromZ, c.toZ, k));
    this.isoCam.updateProjectionMatrix();
    this.isoCam.lookAt(this.orbit.target);
    if (c.t >= 1) {
      this.camTween = null;
      this.orbit.update();
      const fn = this.afterTween;
      this.afterTween = null;
      fn?.();
    }
    this.invalidate();
  }

  /** 当前方位角吸附到最近的 45° + k·90° */
  private snappedAz() {
    const az = new THREE.Spherical().setFromVector3(new THREE.Vector3().subVectors(this.isoCam.position, this.orbit.target)).theta;
    return Math.round((az - 45 * DEG) / (90 * DEG)) * 90 * DEG + 45 * DEG;
  }

  private rotateBy(deg: number) {
    this.tweenCam({ az: this.snappedAz() + deg * DEG, dur: .8 });
  }

  private resetView() {
    if (this.level === 'town' && this.planet > .6) { this.flyToPlanet(1); return; }
    if (this.level === 'town' && this.far) { this.flyToWorld(1); return; }
    if (this.level === 'town') this.updateHome();
    this.tweenCam({ az: 45 * DEG, el: ELEV, target: this.homeTarget, zoom: this.level === 'town' ? this.homeZoom : 1, dur: 1 });
  }

  private focusSelected() {
    if (!this.selected) return;
    const sb = this.selectedSlot && slotBox(this.selected, this.selectedSlot);
    const c = (sb || ownBox(this.selected)).getCenter(new THREE.Vector3());
    this.tweenCam({ target: new THREE.Vector3(c.x, .3, c.z), zoom: sb ? 3.4 : 2.4, dur: .9 });
  }

  /** @internal */ flyTo(x: number, z: number, visibleHeight: number, dur = .9, y = 0) {
    this.tweenCam({ target: new THREE.Vector3(x, y + .3, z), zoom: this.frustum / visibleHeight, dur });
  }

  private clampPan() {
    const b = this.level === 'palace' ? this.built?.bounds : this.town.bounds;
    if (!b || b.isEmpty()) return;
    const t = this.orbit.target, before = t.clone(), pad = this.level === 'town' ? 25 + this.planet * this.planetR * 1.5 : 0;
    t.x = THREE.MathUtils.clamp(t.x, b.min.x - pad, b.max.x + pad);
    t.z = THREE.MathUtils.clamp(t.z, b.min.z - pad, b.max.z + pad);
    this.isoCam.position.add(t.clone().sub(before));
  }

  // =====================================================================
  // 墙体 / 日夜
  // =====================================================================

  private wallFull(w: { id: string; normal: { x: number; z: number } | null }, off: THREE.Vector3) {
    const m = WALL_MODES[this.wallMode][0];
    if (this.mode === 'walk' || m === 'full') return true;
    if (this.editor?.active && this.editor.struct.forceFull(w.id)) return true;
    if (m === 'low' || !w.normal) return false;
    return w.normal.x * off.x + w.normal.z * off.z < .25;
  }

  private updateWalls(dt: number) {
    const step = (w: { cur: number; target: number; apply(): void }) => {
      if (w.cur === w.target) return;
      w.cur += (w.target - w.cur) * Math.min(1, dt * 7);
      if (Math.abs(w.cur - w.target) < .004) w.cur = w.target;
      w.apply();
      this.invalidate();
    };
    const off = new THREE.Vector3().subVectors(this.isoCam.position, this.orbit.target).setY(0).normalize();
    if (this.level === 'palace' && this.built) {
      const H = this.built.wallH;
      for (const w of this.built.walls) { w.target = this.wallFull(w, off) ? H : CUT_H; step(w); }
    }
    const p = this.peek;
    if (p) {
      const placed = this.placementOf(p.id);
      const [lx, lz] = placed ? W.rotateVec(-placed.rot, off.x, off.z) : [off.x, off.z];
      const H = p.built.wallH;
      let settled = true;
      for (const w of p.built.walls) {
        w.target = p.open && w.normal && w.normal.x * lx + w.normal.z * lz >= .25 ? CUT_H : p.open && !w.normal ? CUT_H : H;
        step(w);
        if (w.cur !== H) settled = false;
      }
      if (!p.open && settled) this.finishPeek();
    }
  }

  private cycleWalls() {
    this.wallMode = (this.wallMode + 1) % WALL_MODES.length;
    this.root.querySelectorAll('[data-wall-text]').forEach(el => { el.textContent = t(WALL_MODES[this.wallMode][1]); });
    this.invalidate();
  }

  /** @internal */ toggleNight() {
    this.nightTarget = this.nightTarget ? 0 : 1;
    this.root.classList.toggle('kp-night', !!this.nightTarget);
    this.root.querySelectorAll('[data-night-text]').forEach(el => { el.textContent = this.nightTarget ? t('白天') : t('夜晚'); });
    this.root.querySelectorAll('[data-night-icon]').forEach(el => { el.replaceChildren(html`${rich(this.nightTarget ? ICONS.sun : ICONS.moon)}`); });
    this.invalidate();
  }

  private applyNight(n: number) {
    const K = this.kit;
    this.sun.intensity = lerp(2.4, .28, n);
    this.sun.color.lerpColors(new THREE.Color('#fff1dc'), new THREE.Color('#8fa3d9'), n);
    this.hemi.intensity = lerp(1.1, this.level === 'town' ? .42 : .16, n);
    this.hemi.color.lerpColors(new THREE.Color('#fff4e3'), new THREE.Color('#6d7aa6'), n);
    this.scene.environmentIntensity = lerp(.55, .06, n);
    for (const o of K.LAMPS) o.l.intensity = o.intensity * n;
    for (const o of K.GLOWS) o.m.emissiveIntensity = lerp(o.day, o.night, n);
    K.G.screen.emissiveIntensity = lerp(.95, 1.25, n);
    if (this.planet <= 0) this.scene.background = n > .5 ? K.TEX.bgNight : K.TEX.bgDay;
    this.renderer.toneMappingExposure = lerp(1, this.level === 'town' ? 1.3 : 1.12, n);
    if (this.planet > 0) this.fx.update(this.planet, this.planetR / this.planet, n, this.width, this.height);
  }

  // =====================================================================
  // 漫游
  // =====================================================================

  private blocked(x: number, z: number) {
    for (const c of this.built?.colliders || []) if (x + PLAYER_R > c.x0 && x - PLAYER_R < c.x1 && z + PLAYER_R > c.z0 && z - PLAYER_R < c.z1) return true;
    return false;
  }

  private findFree(x: number, z: number): [number, number] {
    if (!this.blocked(x, z)) return [x, z];
    for (let r = .15; r < 4; r += .15) for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
      if (!this.blocked(nx, nz)) return [nx, nz];
    }
    return [x, z];
  }

  /** 默认从「入户门」附近进入：找一扇 front 门，站到门内 */
  private defaultSpawn(): [number, number, number] {
    for (const w of this.doc.walls) {
      const o = w.openings?.find(o => o.kind === 'front');
      if (!o || !w.normal) continue;
      const s = (o.s0 + o.s1) / 2, axisX = w.a[1] === w.b[1];
      const c = axisX ? w.a[1] : w.a[0];
      const inX = -w.normal[0], inZ = -w.normal[1];
      const x = axisX ? s : c + inX * .9, z = axisX ? c + inZ * .9 : s;
      return [x, z, Math.atan2(-inX, -inZ)];
    }
    const t = this.homeTarget;
    return [t.x, t.z, 0];
  }

  /** @internal */ fade(fn: () => void) {
    const f = this.ui.fade;
    f.classList.add('kp-on');
    window.setTimeout(() => {
      if (this.disposed) return;
      fn();
      this.invalidate(3);
      window.requestAnimationFrame(() => { f.classList.remove('kp-on'); });
    }, 360);
  }

  private enterWalk(x?: number, z?: number, yaw?: number) {
    this.recall.stop();
    if (this.mode === 'walk' || !this.built) return;
    this.editor.toggle(false);
    if (this.collidersDirty) { this.built.colliders = computeColliders(this.built, this.catalog); this.collidersDirty = false; }
    if (x === undefined) [x, z, yaw] = this.defaultSpawn();
    this.select(null); this.hovered = null; this.ui.tip.classList.remove('kp-on');
    this.fade(() => {
      if (!this.built) return;
      this.mode = 'walk';
      this.guide.onWalk();
      [x, z] = this.findFree(x, z);
      this.walk.pos.set(x, EYE_H, z); this.walk.yaw = yaw; this.walk.pitch = -.06;
      this.activeCam = this.fpCam;
      this.orbit.enabled = false;
      this.built.indoorOnly.forEach(o => o.visible = true);
      this.built.labels.forEach(l => l.visible = false);
      for (const w of this.built.walls) { w.cur = this.built.wallH; w.apply(); }
      this.swapComposer(this.fpCam);
      this.root.classList.add('kp-walking');
      this.setCursor('grab');
      this.root.focus({ preventScroll: true });
    });
  }

  /** @internal */ exitWalk() {
    if (this.mode !== 'walk') return;
    if (document.pointerLockElement) document.exitPointerLock();
    this.fade(() => this.leaveWalkNow());
  }

  /** 立即回到俯视（不做淡入淡出） */
  private leaveWalkNow() {
    if (this.mode !== 'walk') return;
    if (document.pointerLockElement) document.exitPointerLock();
    this.mode = 'iso';
    this.activeCam = this.isoCam;
    this.orbit.enabled = true;
    this.built?.indoorOnly.forEach(o => o.visible = false);
    this.built?.labels.forEach(l => l.visible = true);
    const t = new THREE.Vector3(this.walk.pos.x, .3, this.walk.pos.z);
    const off = new THREE.Vector3().subVectors(this.isoCam.position, this.orbit.target);
    this.orbit.target.copy(t); this.isoCam.position.copy(t).add(off);
    this.orbit.update();
    this.swapComposer(this.isoCam);
    this.root.classList.remove('kp-walking');
    this.ui.focus.classList.add('kp-hidden');
    this.walk.focus = null;
    this.walk.keys.clear();
    this.setCursor('');
  }

  private look(dx: number, dy: number, k = .0024) {
    this.walk.yaw -= dx * k;
    this.walk.pitch = THREE.MathUtils.clamp(this.walk.pitch - dy * k, -1.35, 1.35);
  }

  private onWalkPointerMove(e: PointerEvent) {
    const cvs = this.renderer.domElement;
    if (document.pointerLockElement === cvs) { this.look(e.movementX, e.movementY); return; }
    const d = this.walk.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
    this.look(dx, dy, e.pointerType === 'touch' ? .005 : .004);
  }

  private onWalkPointerUp(e: PointerEvent) {
    const d = this.walk.drag;
    if (!d) return;
    this.walk.drag = null;
    if (d.moved < 4) {
      // 轻点：对着准星的物件打开笔记；鼠标点击空白处则尝试锁定指针
      if (this.bindingAt(this.walk.focus, this.walk.focusSlot)) this.openBinding(this.walk.focus, e.altKey, this.walk.focusSlot);
      else if (e.pointerType === 'mouse' && !document.pointerLockElement) {
        try { (this.renderer.domElement.requestPointerLock?.() as any)?.catch?.(() => { }); } catch { /* 嵌入环境可能不允许锁定指针 */ }
      }
    }
  }

  private updateWalk(dt: number) {
    const K = this.walk.keys, w = this.walk;
    let f = (K.has('w') || K.has('arrowup') ? 1 : 0) - (K.has('s') || K.has('arrowdown') ? 1 : 0) - w.joy.y;
    let r = (K.has('d') || K.has('arrowright') ? 1 : 0) - (K.has('a') || K.has('arrowleft') ? 1 : 0) + w.joy.x;
    const len = Math.hypot(f, r);
    if (len > 1) { f /= len; r /= len; }
    const speed = K.has('shift') ? 3.6 : 1.8;
    const sy = Math.sin(w.yaw), cy = Math.cos(w.yaw);
    const dx = (-sy * f + cy * r) * speed * dt, dz = (-cy * f - sy * r) * speed * dt;
    if (dx && !this.blocked(w.pos.x + dx, w.pos.z)) w.pos.x += dx;
    if (dz && !this.blocked(w.pos.x, w.pos.z + dz)) w.pos.z += dz;
    const moving = len > .05;
    w.bob = moving ? w.bob + dt * speed * 5.5 : w.bob * .9;
    this.fpCam.position.set(w.pos.x, EYE_H + (moving ? Math.sin(w.bob) * .025 : 0), w.pos.z);
    this.fpCam.rotation.set(w.pitch, w.yaw, 0, 'YXZ');

    // 准星对准的物件：显示绑定的笔记标题
    const now = performance.now();
    if (now - w.lastRay > 120) {
      w.lastRay = now;
      this.fpCam.updateMatrixWorld();
      this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.fpCam);
      const hit = this.pickRay(this.built?.pickables || [], 4.5);
      const obj = hit?.obj || null, slot = hit?.slot || '';
      if (obj !== w.focus || slot !== w.focusSlot) {
        w.focus = obj;
        w.focusSlot = slot;
        const item = obj?.userData.item as PalaceItem;
        const focus = this.ui.focus;
        if (item) {
          const name = this.locusName(item, slot);
          const lb = this.bindingAt(obj, slot);
          focus.replaceChildren(lb
            ? html`<b>${this.linkText(item, slot, lb)}</b> · ${name} · ${t('按 F 打开')}`
            : name);
          focus.classList.remove('kp-hidden');
        } else focus.classList.add('kp-hidden');
      }
    }
  }

  // =====================================================================
  // 渲染
  // =====================================================================

  private makeComposer(cam: THREE.Camera) {
    const pr = this.renderer.getPixelRatio();
    const w = Math.max(1, this.width), h = Math.max(1, this.height);
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: QUALITY[this.quality].samples });
    const composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    composer.addPass(new RenderPass(this.scene, cam));
    this.gtao = new GTAOPass(this.scene, cam, w, h);
    this.gtao.updateGtaoMaterial({ radius: (cam as any).isOrthographicCamera ? .45 : .35, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 16 });
    this.gtao.blendIntensity = .9;
    this.gtao.enabled = QUALITY[this.quality].ao && !this.far;
    composer.addPass(this.gtao);
    composer.addPass(new OutputPass());
    return composer;
  }

  private swapComposer(cam: THREE.Camera) {
    this.composer.dispose();
    this.gtao.dispose();
    this.composer = this.makeComposer(cam);
  }

  /** @internal */ resize() {
    // 用布局尺寸而不是 getBoundingClientRect：容器在做缩放动画时（思源手机端的对话框从 0.8 倍放大），
    // 后者是缩放后的大小，而 ResizeObserver 不会因为 transform 变化再通知一次
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.refit(false);
    this.composer?.setSize(w, h);
    this.invalidate(3);
  }

  /** 推进一帧的状态（动画、悬停、墙体）；返回后按需渲染 @internal */
  tick(dt: number) {
    if (this.mode === 'iso') {
      if (this.camTween) this.stepCamTween(dt);
      else if (this.orbit.update()) this.invalidate();
      this.clampPan();
      if (this.level === 'town') { this.updateRegionFocus(); this.townCtl.update(dt); }
      else { this.updateHover(); this.maybeShowPreview(); }
      this.updatePlanet();
    } else {
      this.updateWalk(dt);
      this.invalidate(1);
    }
    if (this.town.update(dt)) this.invalidate();
    if (this.companion.update(dt)) this.invalidate(1);
    if (this.social?.update(dt)) this.invalidate(1);
    this.updateWalls(dt);
    if (this.night !== this.nightTarget) {
      this.night = THREE.MathUtils.clamp(this.night + Math.sign(this.nightTarget - this.night) * dt * 1.4, 0, 1);
      if (Math.abs(this.night - this.nightTarget) < .01) this.night = this.nightTarget;
      this.applyNight(this.night);
      this.invalidate();
    }
  }

  /** 小镇层级：镜头焦点所在的岛成为「当前岛」；拉得足够远时进入群岛视角 */
  private updateRegionFocus() {
    const t = this.orbit.target;
    if (!this.townCtl.busy && !this.camTween) {
      let best = this.region, bestD = Infinity;
      const c = new THREE.Vector3();
      for (const l of this.town.regions.values()) {
        l.worldCenter(c);
        const d = Math.hypot(c.x - t.x, c.z - t.z) / l.outerR;
        if (d < bestD) { bestD = d; best = l.region; }
      }
      if (best && best !== this.region) {
        this.region = best;
        this.updateHome();
        this.fitSun();
        this.townCtl.refresh();
      }
    }
    const layer = this.town.regions.get(this.region?.id);
    const visH = this.frustum / this.isoCam.zoom;
    const th = Math.max(110, (layer?.outerR ?? 40) * 2.6);
    const far = this.far ? visH > th * .9 : visH > th * 1.1;
    if (far !== this.far) {
      this.far = far;
      this.town.setFar(far);
      this.root.classList.toggle('kp-far', far);
      // 远看时环境光遮蔽几乎看不出来，关掉能省一整遍场景渲染
      if (this.gtao) this.gtao.enabled = !far && QUALITY[this.quality].ao;
      this.fitSun();
      this.townCtl.onFarChange(far);
    }
    this.town.updateLightPool(t);
  }

  /** @internal */ render() {
    // 新出现的材质接上弯曲（曲率为 0 时和原来完全一样；先接上可以避免进星球时重新编译）
    bendScene(this.scene);
    // 阴影：中低画质下连续动画时隔几帧更新一次；一串动画的最后一帧一定更新，停下来时阴影是对的
    if (this.shadowTick++ % QUALITY[this.quality].shadowEvery === 0 || this.dirty <= 0) this.renderer.shadowMap.needsUpdate = true;
    this.composer.render();
    if (this.planet > 0 && this.level === 'town') this.renderBentLabels();
    else this.labelRenderer.render(this.scene, this.activeCam);
  }

  /** 星球模式的名牌：位置跟着弯曲，转到星球背面的藏起来 */
  private renderBentLabels() {
    const toCam = new THREE.Vector3().subVectors(this.isoCam.position, this.orbit.target).normalize();
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    const tags: THREE.Object3D[] = [];
    for (const l of this.town.regions.values()) tags.push(l.tag);
    for (const s of this.town.shells.values()) tags.push(s.tag);
    for (const t of tags) {
      p.setFromMatrixPosition(t.matrixWorld);
      bendNormal(p, n);
      bendPoint(p, p);
      t.matrixWorld.setPosition(p);
      (t as any).element.classList.toggle('kp-behind', n.dot(toCam) < -.05);
    }
    const auto = this.scene.matrixWorldAutoUpdate;
    this.scene.matrixWorldAutoUpdate = false;
    this.labelRenderer.render(this.scene, this.activeCam);
    this.scene.matrixWorldAutoUpdate = auto;
  }

  /** 群岛全景和完整星球时的可见高度（星球化从 V0 开始，到 V1 完全卷起） */
  private planetRange() {
    const size = this.town.bounds.getSize(new THREE.Vector3());
    const V0 = this.frustumFor((size.x + size.z) * Math.SQRT1_2 + 12, 8) * 1.1;
    // 星球半径按群岛大小定：群岛大约包住星球的一半，岛越多星球越大
    const R = Math.max(45, Math.max(size.x, size.z) / 2 * .75);
    return { V0, V1: Math.max(V0 * 1.5, R * 4.2), R };
  }

  /** 按缩放程度更新星球化：曲率、焦点、阴影、阻尼、星空与大气 */
  private updatePlanet() {
    let p = 0;
    if (this.level === 'town' && !this.town.bounds.isEmpty()) {
      const { V0, V1, R } = this.planetRange();
      this.planetR = R;
      p = THREE.MathUtils.smoothstep(this.frustum / this.isoCam.zoom, V0, V1);
      if (p < .002) p = 0;
    }
    const t = this.orbit.target, cam = this.isoCam.position;
    const moved = p > 0 && (t.x !== this.planetFocus.x || t.z !== this.planetFocus.z || !cam.equals(this.planetCam));
    if (p === this.planet && !moved) return;
    const was = this.planet;
    this.planet = p;
    this.planetFocus.set(t.x, 0, t.z);
    this.planetCam.copy(cam);
    setBend(p > 0 ? p / this.planetR : 0, t, new THREE.Vector3().subVectors(cam, t).normalize(), THREE.MathUtils.smoothstep(p, .15, .95));
    if (p !== was) {
      // 阴影是按平面算的，卷起来以后会错位：淡出并停止更新
      const sh = 1 - THREE.MathUtils.smoothstep(p, 0, .12);
      this.sun.shadow.intensity = sh;
      if (sh > 0 && !this.renderer.shadowMap.autoUpdate) this.renderer.shadowMap.needsUpdate = true;
      this.renderer.shadowMap.autoUpdate = sh > 0;
      // 转星球时惯性更足
      this.orbit.dampingFactor = THREE.MathUtils.lerp(.09, .035, p);
      if ((p > .6) !== (was > .6)) { this.root.classList.toggle('kp-planet', p > .6); this.townCtl.refresh(); }
      if (p === 0) {
        this.town.updateBounds();
        for (const l of this.town.regions.values()) l.tag.element.classList.remove('kp-behind');
        for (const s of this.town.shells.values()) s.tag.element.classList.remove('kp-behind');
      }
    }
    if (p > 0) this.town.setOceanCenter(BEND.pole.value.x, BEND.pole.value.z, Math.PI * this.planetR / p);
    this.town.setPlanetLook(p);
    this.fx.update(p, p > 0 ? this.planetR / p : 0, this.night, this.width, this.height, this.scene, this.night > .5 ? this.kit.TEX.bgNight : this.kit.TEX.bgDay);
    this.invalidate();
  }

  /** 拉远到小星球 @internal */
  flyToPlanet(dur = 1.6) {
    const c = this.town.bounds.getCenter(new THREE.Vector3());
    const { V1 } = this.planetRange();
    this.tweenCam({ target: new THREE.Vector3(c.x, .3, c.z), zoom: this.frustum / (V1 * 1.02), el: ELEV, dur });
  }

  // ---------------- 画质 ----------------

  /** 当前画质档位 @internal */ quality: Quality = 'high';
  /** 自动（按设备 + 卡了自动降档）还是用户选的 */
  qualityAuto = true;
  private shadowTick = 0;
  private slowFrames = 0;
  private lastRender = 0;
  private lastDowngrade = 0;

  /** 换画质：auto 时按设备重新判断 */
  setQuality(q: Quality | 'auto') {
    try { this.prefs.set(QUALITY_KEY, q); } catch { /* 隐私模式 */ }
    this.qualityAuto = q === 'auto';
    this.applyQuality(q === 'auto' ? detectQuality(this.renderer, this.host.isMobile) : q);
  }

  private applyQuality(q: Quality) {
    this.quality = q;
    const c = QUALITY[q];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, c.pr));
    this.sun.shadow.mapSize.set(c.shadow, c.shadow);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.swapComposer(this.activeCam);
    this.width = 0;
    this.resize();
    this.invalidate(3);
  }

  /** 连续动画时持续掉帧（低于约 24 帧）：自动降一档 */
  private watchFrameRate(time: number) {
    const gap = this.lastRender ? time - this.lastRender : 0;
    this.lastRender = time;
    if (!this.qualityAuto || !gap || gap > 500) return;
    this.slowFrames = gap > 42 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames < 90 || this.quality === 'low' || time - this.lastDowngrade < 20e3) return;
    this.lastDowngrade = time;
    this.slowFrames = 0;
    this.applyQuality(this.quality === 'high' ? 'medium' : 'low');
    this.host.notify?.(t('画面有点卡，已自动降低画质'));
  }

  private frame(time: number) {
    if (this.disposed) return;
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), .05);
    // 页签被隐藏（尺寸为 0）或窗口在后台时不渲染
    if (!this.width || !this.height || document.hidden || !this.root.isConnected) return;
    this.tick(dt);
    if (this.dirty <= 0) { this.slowFrames = 0; this.lastRender = 0; return; }
    this.dirty--;
    this.render();
    this.watchFrameRate(time);
    if (this.firstFrame) {
      this.firstFrame = false;
      window.setTimeout(() => this.ui.loading.classList.add('kp-done'), 120);
    }
  }
}

function isoOffset(az: number, el = ELEV) {
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(DIST);
}

function isVisible(o: THREE.Object3D) {
  while (o) { if (!o.visible) return false; o = o.parent; }
  return true;
}

export function roundRectShape(w: number, h: number, r: number) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/**
 * 绑定了的部件（书）往外抽出一截，像读到一半做了记号的书。
 * 只动实例矩阵；第一次改动前记下原始矩阵，每次都从原始矩阵重算，解绑后自动归位。
 */
const PULL = .04;
function pullSlots(obj: THREE.Object3D, slots: string[]) {
  const want = new Set(slots);
  traverseOwn(obj, (o: any) => {
    // 书脊面片跟着书一起抽出
    const verts = o.userData.slotVerts as Record<string, number> | undefined;
    if (verts) {
      const pos = o.geometry.getAttribute('position') as THREE.BufferAttribute;
      if (!o.userData.basePos && !Object.keys(verts).some(s => want.has(s))) return;
      const base: Float32Array = o.userData.basePos ||= (pos.array as Float32Array).slice();
      (pos.array as Float32Array).set(base);
      for (const [s, start] of Object.entries(verts)) if (want.has(s)) for (let i = 0; i < 4; i++) pos.setZ(start + i, pos.getZ(start + i) + PULL);
      pos.needsUpdate = true;
      o.geometry.computeBoundingBox();
      o.geometry.computeBoundingSphere();
      return;
    }
    if (!o.isInstancedMesh || !o.userData.slots) return;
    const list = o.userData.slots as string[];
    if (!o.userData.baseMatrices && !list.some(s => want.has(s))) return;
    const arr = o.instanceMatrix.array as Float32Array;
    const base: Float32Array = o.userData.baseMatrices ||= arr.slice();
    arr.set(base);
    list.forEach((s, i) => { if (want.has(s)) arr[i * 16 + 14] += PULL; });
    o.instanceMatrix.needsUpdate = true;
    o.computeBoundingBox();
    o.computeBoundingSphere();
  });
}

/** 蜘蛛网贴图：从左上角辐射出的丝线 + 一圈圈横丝 */
function cobwebMaterial() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255, 255, 255, .85)';
  g.lineCap = 'round';
  const spokes = 6, R = 250;
  const angle = (i: number) => (i / (spokes - 1)) * Math.PI / 2;
  g.lineWidth = 2.4;
  for (let i = 0; i < spokes; i++) {
    g.beginPath(); g.moveTo(2, 2); g.lineTo(2 + Math.cos(angle(i)) * R, 2 + Math.sin(angle(i)) * R); g.stroke();
  }
  g.lineWidth = 1.6;
  for (let r = 34; r < R; r *= 1.42) {
    g.beginPath();
    for (let i = 0; i < spokes; i++) {
      const a = angle(i), rr = r * (1 + ((i * 37) % 7) / 40);
      const x = 2 + Math.cos(a) * rr, y = 2 + Math.sin(a) * rr;
      if (!i) g.moveTo(x, y);
      else {
        // 横丝微微下垂
        const pa = angle(i - 1), mx = 2 + Math.cos((a + pa) / 2) * r * .9, my = 2 + Math.sin((a + pa) / 2) * r * .9;
        g.quadraticCurveTo(mx, my, x, y);
      }
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  return m;
}
