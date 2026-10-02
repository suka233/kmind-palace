import * as THREE from 'three';
import type { Kit } from './kit';
import { rand, rr, pick, seedFromString } from './random';
import { sanitizeParts, partName, type PartSpec } from './blocks';
import { t } from './i18n';

/* =====================================================================
 * 物件目录：每种物件一个构建函数（原点 = 底部中心，正面朝 +z）。
 * 挂墙物件的原点在墙面上，+z 指向室内。
 * ===================================================================== */

/** 编辑面板里可调的参数 */
export interface ParamSpec {
  key: string;
  label: string;
  /** 下拉选项 [值, 显示名] */
  options?: [any, string][];
  min?: number;
  max?: number;
  step?: number;
  /** 构建函数里的默认值（编辑面板显示用） */
  def?: any;
  /** 特殊字段：docSource 书架书目（笔记本 / 文档）· photo 用户照片 · model 导入的 3D 模型 */
  kind?: 'docSource' | 'photo' | 'model' | 'blocks';
  /** 下拉选项之外还可以自定义颜色（值为 #rrggbb） */
  customColor?: boolean;
}

/** 目录里不认识的类型用这个条目占位（见 spawnItem） */
export const UNKNOWN_TYPE = '_unknown';

export interface CatalogEntry {
  /** 默认显示名 */
  name: string;
  category: string;
  build(p: Record<string, any>): THREE.Object3D;
  /** 默认是否阻挡漫游（默认 true） */
  solid?: boolean;
  /** 默认是否可点选 / 绑定（默认 true） */
  pickable?: boolean;
  /** 碰撞只取子节点中标记了 collider 的部分（例如玻璃栏杆） */
  childColliders?: boolean;
  /** 挂墙物件：拖动时吸附墙面 */
  mount?: 'wall';
  /** 挂墙物件的安装高度固定，只能沿墙水平移动（吊柜、油烟机…） */
  fixedY?: boolean;
  /** 编辑面板可调参数 */
  params?: ParamSpec[];
  /**
   * 部件（可以单独绑定记忆桩的一部分，例如书架上的一本书）的显示名。
   * 部件编号由构建函数登记：普通网格用 userData.slot，InstancedMesh 用 userData.slots[instanceId]。
   */
  slotName?(slot: string, params: Record<string, any>): string;
  /** 扁平物件（地毯、汀步石）：小物件叠放时只借它的高度，不挂在它下面 */
  flat?: boolean;
}

// ---------------- 参数选项 ----------------
const FABRICS: [string, string][] = [['sand', '米色'], ['linen', '亚麻白'], ['sage', '鼠尾草绿'], ['grey', '浅灰'], ['charcoalFab', '炭灰'], ['navy', '藏青'], ['terracotta', '陶土红'], ['mustard', '芥末黄'], ['rose', '豆沙粉'], ['olive', '橄榄绿']];
const WOODS: [string, string][] = [['oak', '橡木'], ['oakLight', '浅橡木'], ['walnut', '胡桃木']];
const POTS: [string, string][] = [['pot', '陶土盆'], ['potWhite', '白瓷盆'], ['potGrey', '水泥灰盆'], ['terracotta', '赭红盆'], ['ceramic', '釉面瓶']];
const RUGS: [string, string][] = [['living', '几何纹'], ['bedroom', '条纹'], ['study', '基里姆'], ['jute', '黄麻'], ['bath', '素色'], ['outdoor', '户外条纹']];
const ARTS: [string, string][] = [['arch', '拱门'], ['mountain', '远山'], ['lines', '线条'], ['botanical', '植物'], ['blocks', '色块'], ['sea', '海']];
const PLANTS: [string, string][] = [['bush', '绿植球'], ['tree', '小树'], ['snake', '虎尾兰'], ['monstera', '龟背竹'], ['pampas', '干花'], ['flowers', '鲜花']];
const SHADES: [string, string][] = [['plain', '米白'], ['warm', '暖黄']];
const LAMP_BASES: [string, string][] = [['ceramic', '白瓷'], ['sage', '鼠尾草绿'], ['terracotta', '陶土红'], ['navy', '藏青']];
const num = (key: string, label: string, min: number, max: number, step: number, def: number): ParamSpec => ({ key, label, min, max, step, def });
const sel = (key: string, label: string, options: [any, string][], def: any): ParamSpec => ({ key, label, options, def });
/** 材质下拉 + 自定义颜色 */
const selc = (key: string, label: string, options: [any, string][], def: any): ParamSpec => ({ key, label, options, def, customColor: true });
/** 颜色值：#rrggbb */
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** 物件目录里的预设（添加物件面板用），纯数据 */
export interface Preset {
  id: string;
  type: string;
  name: string;
  category: string;
  params?: Record<string, any>;
  /** 挂墙物件的默认安装高度 */
  y?: number;
}

// ---------------- 积木示例（也是给大模型看的格式样例） ----------------
const SAMPLE_CLOCK: PartSpec[] = [
  { shape: 'box', size: [.5, 1.8, .3], pos: [0, 1, 0], color: 'walnut', round: .015 },
  { shape: 'box', size: [.56, .1, .34], pos: [0, .05, 0], color: 'walnutDark', round: .01 },
  { shape: 'box', size: [.58, .08, .36], pos: [0, 1.94, 0], color: 'walnutDark', round: .01 },
  { shape: 'cyl', size: [.36, .02], pos: [0, 1.58, .155], rot: [90, 0, 0], color: '#f3ead8', slot: 'face', name: '表盘' },
  { shape: 'torus', size: [.4, .025], pos: [0, 1.58, .16], color: 'brass' },
  { shape: 'box', size: [.012, .12, .006], pos: [0, 1.62, .17], color: 'black' },
  { shape: 'box', size: [.012, .09, .006], pos: [.03, 1.57, .17], rot: [0, 0, 65], color: 'black' },
  { shape: 'box', size: [.3, .8, .01], pos: [0, .78, .185], color: 'glass' },
  {
    shape: 'group', slot: 'pendulum', name: '钟摆', children: [
      { shape: 'box', size: [.012, .5, .012], pos: [0, .95, .165], color: 'brass', metal: .8, rough: .3 },
      { shape: 'cyl', size: [.14, .015], pos: [0, .68, .165], rot: [90, 0, 0], color: 'brass', metal: .8, rough: .3 },
    ],
  },
];
const SAMPLE_TANK: PartSpec[] = [
  { shape: 'box', size: [1, .7, .42], pos: [0, .35, 0], color: 'black', round: .01 },
  { shape: 'box', size: [.97, .02, .4], pos: [0, .71, 0], color: '#d8c9a8' },
  { shape: 'box', size: [.98, .5, .4], pos: [0, .96, 0], color: 'glass' },
  { shape: 'box', size: [.94, .42, .36], pos: [0, .93, 0], color: '#7cc0d4', rough: .15, opacity: .45 },
  { shape: 'cone', size: [.05, .3], pos: [-.36, .87, -.08], color: '#4f8a52', repeat: { count: 3, step: [.06, 0, .05] } },
  {
    shape: 'group', slot: 'fish', name: '小丑鱼', children: [
      { shape: 'sphere', size: [.09, .05, .03], pos: [.1, .98, .05], color: '#ff7a2e' },
      { shape: 'cone', size: [.04, .04], pos: [.16, .98, .05], rot: [0, 0, 90], color: '#ff7a2e' },
    ],
  },
  { shape: 'sphere', size: [.07, .04, .025], pos: [-.12, 1.06, 0], color: '#f2d24a', slot: 'fish2', name: '黄鱼' },
];

export const CATEGORIES = ['坐具', '桌几', '柜架', '卧室', '厨房', '卫浴', '灯具', '植物', '摆件', '装饰', '户外', '积木'];

export const PRESETS: Preset[] = [
  { id: 'sofa-3', type: 'sofa', name: '三人沙发', category: '坐具', params: { w: 2.4 } },
  { id: 'sofa-2', type: 'sofa', name: '双人沙发', category: '坐具', params: { w: 1.7, fabric: 'sage', pillows: ['cushion', 'terracotta'] } },
  { id: 'armchair-y', type: 'armchair', name: '单人椅 · 芥末黄', category: '坐具', params: { fabric: 'mustard' } },
  { id: 'armchair-n', type: 'armchair', name: '单人椅 · 藏青', category: '坐具', params: { fabric: 'navy', wood: 'walnut' } },
  { id: 'chair', type: 'chair', name: '餐椅', category: '坐具' },
  { id: 'stool', type: 'stool', name: '吧椅', category: '坐具' },
  { id: 'bench', type: 'bench', name: '长凳', category: '坐具' },
  { id: 'office-chair', type: 'officeChair', name: '办公椅', category: '坐具' },
  { id: 'lounge', type: 'loungeChair', name: '休闲椅', category: '坐具' },
  { id: 'coffee-table', type: 'coffeeTable', name: '圆茶几', category: '桌几' },
  { id: 'side-table', type: 'sideTable', name: '边几', category: '桌几' },
  { id: 'side-table-lamp', type: 'sideTable', name: '边几 · 台灯', category: '桌几', params: { lamp: 'sage' } },
  { id: 'dining-table', type: 'diningTable', name: '餐桌', category: '桌几' },
  { id: 'desk', type: 'desk', name: '书桌', category: '桌几' },
  { id: 'globe', type: 'globeTable', name: '地球仪', category: '桌几' },
  { id: 'shelf-tall', type: 'bookshelf', name: '书架 · 高', category: '柜架', params: { w: 1.2, h: 2.0 } },
  { id: 'shelf-low', type: 'bookshelf', name: '书架 · 矮', category: '柜架', params: { w: 1.2, h: 1.36, rows: 3, wood: 'walnut' } },
  { id: 'media', type: 'mediaConsole', name: '电视柜', category: '柜架' },
  { id: 'sideboard', type: 'sideboard', name: '边柜', category: '柜架' },
  { id: 'shoe-bench', type: 'shoeBench', name: '换鞋凳', category: '柜架' },
  { id: 'coat-rack', type: 'coatRack', name: '衣帽架', category: '柜架' },
  { id: 'bed', type: 'bed', name: '双人床', category: '卧室' },
  { id: 'nightstand', type: 'nightstand', name: '床头柜', category: '卧室' },
  { id: 'wardrobe', type: 'wardrobe', name: '衣柜', category: '卧室' },
  { id: 'dresser', type: 'dresser', name: '梳妆台', category: '卧室' },
  { id: 'kitchen-run', type: 'kitchenRun', name: '橱柜', category: '厨房', params: { length: 2.4, sink: -.55, cooktop: .6 } },
  { id: 'island', type: 'kitchenIsland', name: '中岛', category: '厨房' },
  { id: 'fridge', type: 'fridge', name: '冰箱', category: '厨房' },
  { id: 'upper-cabinet', type: 'upperCabinet', name: '吊柜', category: '厨房', y: 1.5 },
  { id: 'hood', type: 'rangeHood', name: '油烟机', category: '厨房', y: 1.5 },
  { id: 'wall-shelf', type: 'wallShelf', name: '墙面搁板', category: '厨房', y: 1.3 },
  { id: 'herbs', type: 'herbPots', name: '香草盆栽', category: '厨房' },
  { id: 'bathtub', type: 'bathtub', name: '浴缸', category: '卫浴' },
  { id: 'toilet', type: 'toilet', name: '马桶', category: '卫浴' },
  { id: 'vanity', type: 'vanity', name: '洗手台', category: '卫浴' },
  { id: 'towel', type: 'towelLadder', name: '毛巾架', category: '卫浴' },
  { id: 'laundry', type: 'laundryBasket', name: '脏衣篮', category: '卫浴' },
  { id: 'bath-mirror', type: 'rectMirror', name: '浴室镜', category: '卫浴', y: 1.6 },
  { id: 'shower', type: 'shower', name: '花洒', category: '卫浴', y: 1.5 },
  { id: 'floor-lamp', type: 'floorLamp', name: '落地灯', category: '灯具' },
  { id: 'table-lamp', type: 'tableLamp', name: '台灯', category: '灯具' },
  { id: 'pendant-black', type: 'pendant', name: '吊灯 · 黑', category: '灯具', params: { r: .18, drop: .8 } },
  { id: 'pendant-brass', type: 'pendant', name: '吊灯 · 黄铜', category: '灯具', params: { r: .3, drop: .95, finish: 'brass' } },
  { id: 'sconce', type: 'sconce', name: '壁灯', category: '灯具', y: 2.0 },
  { id: 'monstera', type: 'plant', name: '龟背竹', category: '植物', params: { kind: 'monstera', h: 1.1, potR: .2, potH: .34, pot: 'potWhite' } },
  { id: 'olive', type: 'plant', name: '橄榄树', category: '植物', params: { kind: 'tree', h: 1.9, potR: .22, potH: .4, pot: 'pot' } },
  { id: 'snake', type: 'plant', name: '虎尾兰', category: '植物', params: { kind: 'snake', h: .95, potR: .15, potH: .3, pot: 'potWhite' } },
  { id: 'bush-pot', type: 'plant', name: '绿植球', category: '植物', params: { kind: 'bush', h: .7, potR: .14, potH: .28 } },
  { id: 'pampas', type: 'plant', name: '干花', category: '植物', params: { kind: 'pampas', h: .6, potR: .06, potH: .2, pot: 'ceramic' } },
  { id: 'flowers', type: 'plant', name: '鲜花', category: '植物', params: { kind: 'flowers', h: .45, potR: .06, potH: .18, pot: 'ceramic' } },
  { id: 'planter', type: 'planter', name: '花槽', category: '植物' },
  { id: 'blocks-clock', type: 'blocks', name: '落地钟', category: '积木', params: { parts: SAMPLE_CLOCK } },
  { id: 'blocks-tank', type: 'blocks', name: '鱼缸', category: '积木', params: { parts: SAMPLE_TANK } },
  { id: 'book-stack', type: 'bookStack', name: '一摞书', category: '摆件' },
  { id: 'photo-frame', type: 'photoFrame', name: '相框', category: '摆件' },
  { id: 'vase', type: 'vase', name: '花瓶', category: '摆件' },
  { id: 'mug', type: 'cup', name: '马克杯', category: '摆件', params: { color: 'terracotta', r: .035, h: .09 } },
  { id: 'cup', type: 'cup', name: '杯子', category: '摆件' },
  { id: 'tray', type: 'tray', name: '托盘', category: '摆件' },
  { id: 'candle', type: 'candle', name: '烛台', category: '摆件' },
  { id: 'place-setting', type: 'placeSetting', name: '餐具', category: '摆件' },
  { id: 'fruit-bowl', type: 'fruitBowl', name: '果盘', category: '摆件' },
  { id: 'art-arch', type: 'painting', name: '装饰画 · 拱门', category: '装饰', params: { art: 'arch' }, y: 1.6 },
  { id: 'art-mountain', type: 'painting', name: '装饰画 · 远山', category: '装饰', params: { art: 'mountain' }, y: 1.6 },
  { id: 'art-lines', type: 'painting', name: '装饰画 · 线条', category: '装饰', params: { art: 'lines' }, y: 1.6 },
  { id: 'art-botanical', type: 'painting', name: '装饰画 · 植物', category: '装饰', params: { art: 'botanical' }, y: 1.6 },
  { id: 'art-blocks', type: 'painting', name: '装饰画 · 色块', category: '装饰', params: { art: 'blocks' }, y: 1.6 },
  { id: 'art-sea', type: 'painting', name: '装饰画 · 海', category: '装饰', params: { art: 'sea', w: .7, h: .5 }, y: 1.6 },
  { id: 'poster', type: 'poster', name: '海报', category: '装饰', y: 1.7 },
  { id: 'round-mirror', type: 'roundMirror', name: '圆镜', category: '装饰', y: 1.5 },
  { id: 'slats', type: 'slatPanel', name: '木格栅墙', category: '装饰', params: { w: 1.6 }, y: 0 },
  { id: 'rug-living', type: 'rug', name: '地毯 · 几何', category: '装饰', params: { w: 2.4, d: 1.7, pattern: 'living' } },
  { id: 'rug-stripe', type: 'rug', name: '地毯 · 条纹', category: '装饰', params: { w: 2.0, d: 1.4, pattern: 'bedroom' } },
  { id: 'rug-kilim', type: 'rug', name: '地毯 · 基里姆', category: '装饰', params: { w: 2.0, d: 1.5, pattern: 'study' } },
  { id: 'rug-jute', type: 'rug', name: '地毯 · 黄麻', category: '装饰', params: { w: 1.6, d: 1.1, pattern: 'jute' } },
  { id: 'cat', type: 'cat', name: '猫', category: '装饰' },
  { id: 'umbrella', type: 'umbrellaStand', name: '伞桶', category: '装饰' },
  { id: 'tree', type: 'tree', name: '大树', category: '户外', params: { h: 3.2 } },
  { id: 'bush', type: 'bush', name: '灌木', category: '户外', params: { r: .45 } },
  { id: 'lamp-post', type: 'lampPost', name: '庭院灯', category: '户外' },
  { id: 'mailbox', type: 'mailbox', name: '信箱', category: '户外' },
  { id: 'stone', type: 'stone', name: '汀步石', category: '户外' },
];

// ---------------- 书架布局（纯数据，与 three.js 无关） ----------------
const BOOK_COLORS = ['#8c3b2f', '#c9a15a', '#3f5a6b', '#6b7f5a', '#d9cfc0', '#2f3a4a', '#a86b4c', '#e3d7c3', '#5b4a6b', '#b85c3c', '#445c4a', '#f0e6d6', '#7a8a99'];

export interface ShelfBook {
  /** 部件编号 b:层:序号（层从下往上、书从左往右，都从 0 开始） */
  slot: string;
  row: number;
  x: number; y: number; w: number; h: number; d: number;
  /** 倾斜（绕 z 轴，弧度） */
  rz: number;
  c: string;
  /** 往外抽出多少（米） */
  pz?: number;
}

/** 单本书的外观覆盖（存在书架的 params.books 里，按部件编号；笔记本书架上是 doc:<文档 id>） */
export interface BookOverride {
  /** 颜色 #rrggbb */
  c?: string;
  /** 靠：1 向左、-1 向右 */
  lean?: 1 | -1;
  /** 抽出一点 */
  pull?: boolean;
  /** 这一格空着 */
  hide?: boolean;
}

/** 靠着的书倾斜的角度 */
export const LEAN = 12 * Math.PI / 180;

/** 应用单本书的覆盖：换颜色、靠向一边（底边仍落在隔板上）、抽出、空着的去掉 */
export function applyBookOverrides<T extends ShelfBook>(books: T[], over: Record<string, BookOverride> | undefined): T[] {
  if (!over) return books;
  const out: T[] = [];
  for (const b of books) {
    const o = over[b.slot];
    if (!o) { out.push(b); continue; }
    if (o.hide) continue;
    const n = { ...b };
    if (o.c && isHexColor(o.c)) n.c = o.c;
    if (o.lean === 1 || o.lean === -1) {
      const a = o.lean * LEAN, y0 = b.y - b.h / 2;
      n.rz = a;
      n.y = y0 + b.h / 2 * Math.cos(a) + b.w / 2 * Math.abs(Math.sin(a));
    }
    if (o.pull) n.pz = .04;
    out.push(n);
  }
  return out;
}

export interface ShelfDecor { kind: 'vase' | 'plant' | 'box'; x: number; y: number; pick: number }

/**
 * 书架上每层放哪些书、摆件。每层单独取随机种子：
 * 改宽度只会在行尾增减书、改高度不换书、加减层数只影响顶层——已绑定的书尽量留在原位。
 */
export function shelfLayout({ w = 1.2, h = 2.0, d = .34, rows = 5, decor = true }: any, seed: number) {
  const books: ShelfBook[] = [], decos: ShelfDecor[] = [];
  const step = (h - .1) / rows;
  for (let row = 0; row < rows; row++) {
    seedFromString(`${seed}:${row}`);
    const y = .07 + row * step + .013;
    const x0 = -w / 2 + .04, x1 = w / 2 - .04;
    const place = (a: number, b: number) => {
      const list: ShelfBook[] = [];
      let x = a;
      while (x < b - .03) {
        const bw = rr(.022, .05), bh = Math.min(step - .05, rr(.16, .27)), bd = rr(.17, Math.min(.25, d - .04));
        const c = pick(BOOK_COLORS);
        if (x + bw > b) break;
        list.push({ slot: `b:${row}:${list.length}`, row, x: x + bw / 2, y: y + bh / 2, w: bw, h: bh, d: bd, rz: 0, c });
        x += bw + .002;
      }
      if (list.length > 3 && b - x > .07) {
        const L = list[list.length - 1];
        L.rz = -.22; L.x += .03; L.y -= .005;
      }
      books.push(...list);
    };
    if (decor && rand() < .55) {
      const split = rr(x0 + .3, x1 - .3), leftBooks = rand() < .5;
      const r = rand(), kind = r < .33 ? 'vase' : r < .66 ? 'plant' : 'box';
      decos.push({ kind, x: leftBooks ? (split + x1) / 2 : (x0 + split) / 2, y, pick: rand() });
      place(leftBooks ? x0 : split + .08, leftBooks ? split - .08 : x1);
    } else place(x0, x1);
  }
  return { books, decor: decos, step };
}

// ---------------- 书架 = 笔记本（纯数据） ----------------
/** 书脊颜色：偏深的上浅色字，少数浅色的上深色字 */
const SPINE_COLORS = ['#7d3a2f', '#3f5a6b', '#5b4a6b', '#445c4a', '#2f3a4a', '#8a5a3c', '#6b7f5a', '#9a7b4f', '#35524a', '#6d3f55', '#4a4f6b', '#e3d7c3', '#d9cfc0', '#c9a15a'];

/** 书目来源的键 */
export const sourceKey = (s: { box: string; path: string }) => s.box + ':' + s.path;

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const frac = (h: number, k: number) => ((Math.imul(h ^ Math.imul(k, 0x9e3779b1), 2654435761) >>> 0) % 10007) / 10007;

export interface DocBook extends ShelfBook { id: string; title: string }

/**
 * 书架上摆一个笔记本（或一篇文档的子文档）：从最上层开始、从左往右，按文档树里的顺序，
 * 均匀分到各层（每层 ⌈总数 / 层数⌉ 本，一层放不下就接着放下一层）。
 * 每本书的尺寸和颜色由文档 id 决定（改名、调整顺序都不变）。放不下的本数记在 overflow。
 */
export function docShelfLayout({ w = 1.2, h = 2.0, d = .34, rows = 5 }: any, docs: { id: string; title: string }[]) {
  const step = (h - .1) / rows, x0 = -w / 2 + .04, x1 = w / 2 - .04;
  const perRow = Math.max(1, Math.ceil(docs.length / rows));
  const books: DocBook[] = [];
  /** 每层书的末尾（放书挡） */
  const ends: { x: number; y: number }[] = [];
  let k = 0;
  for (let row = rows - 1; row >= 0 && k < docs.length; row--) {
    const y = .07 + row * step + .013;
    let x = x0;
    // 前面几层没放满时，后面的层多放一些
    const quota = perRow + Math.max(0, (rows - 1 - row) * perRow - k);
    for (let n = 0; n < quota && k < docs.length; n++) {
      const doc = docs[k], hs = hashStr(doc.id);
      const bw = .026 + frac(hs, 1) * .016, bh = Math.min(step - .05, .19 + frac(hs, 2) * .07), bd = Math.min(.17 + frac(hs, 3) * .06, d - .04);
      if (x + bw > x1) break;
      books.push({ slot: 'doc:' + doc.id, row, x: x + bw / 2, y: y + bh / 2, w: bw, h: bh, d: bd, rz: 0, c: SPINE_COLORS[hs % SPINE_COLORS.length], id: doc.id, title: doc.title });
      x += bw + .003;
      k++;
    }
    if (x1 - x > .06) ends.push({ x: x + .008, y });
  }
  return { books, overflow: docs.length - k, step, ends };
}

/** 在书脊贴图的一格里竖着写书名：汉字直排，英文数字横躺（和中文竖排书一样） */
function drawSpine(g: CanvasRenderingContext2D, x: number, y: number, W: number, H: number, bg: string, title: string) {
  g.fillStyle = bg;
  g.fillRect(x, y, W, H);
  const c = new THREE.Color(bg), lum = .2126 * c.r + .7152 * c.g + .0722 * c.b;
  const dark = lum < .5;
  g.fillStyle = dark ? 'rgba(255, 255, 255, .16)' : 'rgba(0, 0, 0, .12)';
  g.fillRect(x, y + 14, W, 3);
  g.fillRect(x, y + H - 17, W, 3);
  g.fillStyle = dark ? 'rgba(255, 248, 235, .93)' : 'rgba(40, 32, 26, .88)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fs = 22;
  g.font = `600 ${fs}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;
  let cy = y + 28;
  const maxY = y + H - 24;
  for (const ch of title) {
    if (ch === ' ') { cy += fs * .4; continue; }
    const ascii = /[\x21-\x7e]/.test(ch);
    const adv = ascii ? g.measureText(ch).width + 1 : fs + 1;
    if (cy + adv > maxY) { g.fillText('⋮', x + W / 2, Math.min(cy + fs / 2, maxY - fs / 2)); break; }
    if (ascii) {
      g.save(); g.translate(x + W / 2, cy + adv / 2); g.rotate(Math.PI / 2); g.fillText(ch, 0, 0); g.restore();
    } else g.fillText(ch, x + W / 2, cy + fs / 2);
    cy += adv;
  }
}

export function createCatalog(K: Kit, wallH = 2.8) {
  const { M, G, box, cyl, ball, lathe, ico, plane, torus, mesh, rbGeo, addLight } = K;
  const DEG = Math.PI / 180;
  const lerp = THREE.MathUtils.lerp;

  /** 材质：预设名（sand、oak…）或自定义颜色 #rrggbb */
  const fabric = (name: string, fallback = M.sand) => isHexColor(name) ? K.solid(name.toLowerCase(), .82) : (M as any)[name] || fallback;

  function legs4(g: THREE.Object3D, w: number, d: number, h: number, mat, r = .02, inset = .06, taper = .7) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, r * taper, r, h, mat, sx * (w / 2 - inset), 0, sz * (d / 2 - inset), 10);
  }

  // ---------------- 坐具 ----------------
  function sofa({ w = 2.3, fabric: fab = 'sand', pillows = ['terracotta', 'mustard', 'navy'] }: any = {}) {
    const F = fabric(fab);
    const P = pillows.map((p: string) => fabric(p));
    const g = new THREE.Group(), d = .94;
    legs4(g, w, d, .1, M.walnut, .025, .12);
    box(g, w, .2, d, F, 0, .1, 0, .04);
    box(g, .2, .38, d, F, -w / 2 + .1, .26, 0, .08);
    box(g, .2, .38, d, F, w / 2 - .1, .26, 0, .08);
    box(g, w - .02, .5, .22, F, 0, .26, -d / 2 + .11, .07);
    const n = w > 2 ? 3 : 2, cw = (w - .4) / n;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + .2 + cw * (i + .5);
      box(g, cw - .015, .15, d - .26, F, x, .29, .1, .065);
      const bc = box(g, cw - .03, .44, .18, F, x, .38, -d / 2 + .3, .075);
      bc.rotation.x = -.14;
    }
    const p1 = box(g, .44, .42, .13, P[0], -w / 2 + .45, .42, -.14, .07); p1.rotation.set(-.3, .3, .1);
    const p2 = box(g, .4, .38, .13, P[1], w / 2 - .45, .42, -.14, .07); p2.rotation.set(-.3, -.35, -.08);
    if (P[2]) { const p3 = box(g, .36, .34, .12, P[2], w / 2 - .78, .42, -.12, .06); p3.rotation.set(-.25, -.1, .05); }
    box(g, .26, .025, .7, M.cushion, -w / 2 + .12, .64, .06, .012);
    box(g, .025, .3, .7, M.cushion, -w / 2 - .005, .36, .06, .012);
    return g;
  }

  function armchair({ fabric: fab = 'mustard', wood = 'oak' }: any = {}) {
    const F = fabric(fab), W = fabric(wood, M.oak);
    const g = new THREE.Group();
    for (const [x, z, rx] of [[-.3, .26, .12], [.3, .26, .12], [-.3, -.26, -.14], [.3, -.26, -.14]]) {
      const l = cyl(g, .014, .02, .34, W, x, 0, z, 10); l.rotation.x = rx;
    }
    box(g, .72, .06, .7, W, 0, .3, 0, .02);
    box(g, .66, .13, .62, F, 0, .34, .02, .05);
    const back = box(g, .66, .52, .14, F, 0, .4, -.28, .06); back.rotation.x = -.2;
    for (const s of [-1, 1]) {
      box(g, .06, .035, .66, W, s * .38, .58, 0, .012);
      box(g, .035, .26, .035, W, s * .38, .33, .25, .01);
    }
    const p = box(g, .36, .32, .11, M.cushion, 0, .5, -.12, .05); p.rotation.x = -.35;
    return g;
  }

  function chair({ wood: woodName = 'oak', seat: seatName = 'linen' }: any = {}) {
    const wood = fabric(woodName, M.oak), seat = fabric(seatName, M.linen);
    const g = new THREE.Group();
    for (const [x, z] of [[-.2, .19], [.2, .19], [-.2, -.19], [.2, -.19]]) cyl(g, .014, .018, .44, wood, x, 0, z, 10);
    box(g, .46, .035, .44, wood, 0, .43, 0, .01);
    box(g, .42, .035, .4, seat, 0, .46, .01, .015);
    torus(g, .22, .016, wood, 0, .73, .02, Math.PI, [-Math.PI / 2, 0, 0]);
    for (const s of [-1, 1]) cyl(g, .013, .013, .28, wood, s * .22, .45, .02, 8);
    const y = box(g, .05, .26, .018, wood, 0, .46, -.19, .008); y.rotation.x = -.08;
    return g;
  }

  function stool() {
    const g = new THREE.Group();
    cyl(g, .19, .17, .06, M.oak, 0, .66, 0, 28);
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + Math.PI / 4;
      const l = cyl(g, .012, .012, .68, M.black, Math.cos(a) * .12, 0, Math.sin(a) * .12, 8);
      l.rotation.set(Math.sin(a) * .08, 0, -Math.cos(a) * .08);
    }
    torus(g, .15, .008, M.black, 0, .25, 0, Math.PI * 2, [Math.PI / 2, 0, 0]);
    return g;
  }

  function bench({ w = 1.3, d = .42, wood = 'oak' }: any = {}) {
    const g = new THREE.Group(), W = fabric(wood, M.oak);
    legs4(g, w, d, .32, W, .02, .06);
    box(g, w, .05, d, W, 0, .32, 0, .012);
    box(g, w - .04, .09, d - .04, M.charcoalFab, 0, .37, 0, .04);
    return g;
  }

  function officeChair() {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      const s = box(g, .3, .03, .04, M.black, Math.cos(a) * .14, .05, Math.sin(a) * .14, .01); s.rotation.y = -a;
      ball(g, .025, M.black, Math.cos(a) * .28, .025, Math.sin(a) * .28);
    }
    cyl(g, .025, .025, .36, M.chrome, 0, .07, 0, 10);
    box(g, .5, .08, .48, M.charcoalFab, 0, .44, 0, .035);
    const back = box(g, .46, .56, .06, M.charcoalFab, 0, .56, -.25, .04); back.rotation.x = -.1;
    box(g, .06, .2, .04, M.black, 0, .42, -.24, .01);
    for (const s of [-1, 1]) { box(g, .04, .18, .04, M.black, s * .25, .47, -.02, .01); box(g, .06, .03, .26, M.black, s * .25, .64, -.02, .01); }
    return g;
  }

  function loungeChair() {
    const g = new THREE.Group();
    for (const s of [-1, 1]) { box(g, .04, .04, .8, M.oak, s * .3, .12, 0, .01); box(g, .04, .5, .04, M.oak, s * .3, 0, -.3, .01).rotation.x = -.35; }
    legs4(g, .6, .7, .14, M.oak, .02, .03, 1);
    box(g, .6, .1, .62, M.cushion, 0, .16, .04, .04);
    const b = box(g, .58, .5, .1, M.cushion, 0, .22, -.3, .045); b.rotation.x = -.4;
    const p = box(g, .32, .28, .1, M.mustard, 0, .34, -.18, .05); p.rotation.x = -.45;
    return g;
  }

  // ---------------- 桌几 ----------------
  function roundTable({ r = .45, h = .38, top = M.oak, base = M.walnut }: any = {}) {
    const g = new THREE.Group();
    cyl(g, r, r, .04, top, 0, h - .04, 0, 48);
    cyl(g, .06, .08, h - .04, base, 0, 0, 0, 20);
    cyl(g, .24, .26, .03, base, 0, 0, 0, 32);
    return g;
  }

  // decor = false：摆件已经是子物件（见 decor.ts），这里不再画（目录缩略图、旧数据预览时仍画出来）
  function coffeeTable({ decor = true, top = 'oak' }: any = {}) {
    const g = roundTable({ top: fabric(top, M.oak) });
    if (!decor) return g;
    box(g, .24, .04, .17, M.navy, -.12, .38, .08, .005).rotation.y = .3;
    box(g, .22, .035, .16, M.cream, -.12, .42, .08, .005).rotation.y = .2;
    cyl(g, .13, .13, .015, M.brass, .15, .38, -.1, 24);
    cyl(g, .03, .025, .07, M.ceramic, .12, .395, -.08, 14); cyl(g, .03, .025, .07, M.terracotta, .2, .395, -.14, 14);
    const vase = plant({ kind: 'pampas', h: .5, potR: .05, potH: .16, pot: 'ceramic' }); vase.position.set(.05, .38, .2); g.add(vase);
    return g;
  }

  function sideTable({ r = .24, h = .52, top = 'walnut', lamp = null, cup = false }: any = {}) {
    const g = new THREE.Group();
    cyl(g, r, r, .03, fabric(top, M.walnut), 0, h - .03, 0, 32);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2;
      const l = cyl(g, .011, .011, h - .03, M.black, Math.cos(a) * r * .7, 0, Math.sin(a) * r * .7, 8);
      l.rotation.set(Math.sin(a) * .12, 0, -Math.cos(a) * .12);
    }
    if (lamp) { const tl = tableLamp({ h: .44, shade: 'warm', base: lamp }); tl.position.set(0, h, 0); g.add(tl); }
    if (cup) cyl(g, .04, .035, .09, M.ceramic, .05, h, 0, 14);
    return g;
  }

  function globeTable() {
    const g = sideTable({ r: .22, h: .5 });
    cyl(g, .06, .08, .03, M.walnut, 0, .5, 0, 20);
    cyl(g, .01, .01, .12, M.brass, 0, .53, 0, 8);
    const s = ball(g, .12, M.globe, 0, .78, 0, [1, 1, 1], 32);
    s.rotation.z = .4;
    torus(g, .135, .006, M.brass, 0, .78, 0, Math.PI * 1.2, [0, Math.PI / 2, .1]);
    return g;
  }

  function diningTable({ w = 1.9, d = .95, decor = true, wood = 'oak' }: any = {}) {
    const g = new THREE.Group(), W = fabric(wood, M.oak);
    box(g, w, .045, d, W, 0, .71, 0, .015);
    for (const s of [-1, 1]) {
      const leg = box(g, .07, .71, .07, W, s * (w / 2 - .12), 0, d / 2 - .1, .01);
      const leg2 = box(g, .07, .71, .07, W, s * (w / 2 - .12), 0, -d / 2 + .1, .01);
      leg.rotation.x = -.04; leg2.rotation.x = .04;
    }
    box(g, w - .3, .06, .04, W, 0, .64, 0, .01);
    box(g, w * .7, .004, .34, M.linen, 0, .755, 0, 0);
    if (!decor) return g;
    const vase = plant({ kind: 'flowers', h: .5, potR: .06, potH: .18, pot: 'ceramic' }); vase.position.set(0, .755, 0); g.add(vase);
    for (const s of [-1, 1]) { cyl(g, .025, .03, .06, M.brass, s * .28, .755, .02, 12); cyl(g, .012, .012, .16, M.cushion, s * .28, .815, .02, 10); }
    for (const [x, z] of [[-.5, .3], [.5, .3], [-.5, -.3], [.5, -.3]]) {
      cyl(g, .12, .1, .012, M.porcelain, x, .755, z, 32);
      cyl(g, .03, .026, .1, M.glass, x + .14, .755, z * .7, 14);
    }
    return g;
  }

  function desk({ w = 1.5, d = .7, decor = true, top = 'oak' }: any = {}) {
    const g = new THREE.Group();
    box(g, w, .035, d, fabric(top, M.oak), 0, .72, 0, .01);
    for (const s of [-1, 1]) {
      box(g, .03, .72, .03, M.black, s * (w / 2 - .06), 0, d / 2 - .06, .004);
      box(g, .03, .72, .03, M.black, s * (w / 2 - .06), 0, -d / 2 + .06, .004);
      box(g, .03, .03, d - .1, M.black, s * (w / 2 - .06), .1, 0, .004);
    }
    box(g, .24, .012, .16, M.charcoal, 0, .755, -.18, .005);
    box(g, .04, .22, .03, M.charcoal, 0, .76, -.22, .005);
    box(g, .74, .44, .03, M.black, 0, .9, -.2, .01);
    plane(g, .71, .41, G.monitor, 0, 1.12, -.184);
    box(g, .44, .018, .14, M.cream, 0, .755, .08, .006);
    ball(g, .03, M.cream, .32, .765, .1, [1, .5, 1.5]);
    box(g, .22, .02, .3, M.paper, -.45, .755, .06, .004).rotation.y = .2;
    if (decor) cyl(g, .035, .032, .09, M.terracotta, .5, .755, .12, 16);
    cyl(g, .07, .08, .02, M.black, -.58, .755, -.2, 20);
    const arm1 = box(g, .015, .42, .015, M.black, -.58, .77, -.2, .004); arm1.rotation.x = .35; arm1.position.set(-.58, .96, -.14);
    const head = cyl(g, .05, .08, .1, G.shade, -.58, 1.08, 0, 20, true); head.rotation.x = .9; head.position.set(-.58, 1.14, -.02);
    ball(g, .025, G.bulb, -.58, 1.11, .01);
    addLight(g, -.58, 1.05, .05, 1.6, 3);
    if (decor) { const pl = plant({ kind: 'bush', h: .26, potR: .06, potH: .1, pot: 'potWhite' }); pl.position.set(.62, .755, -.22); g.add(pl); }
    return g;
  }

  // ---------------- 灯具 ----------------
  function tableLamp({ h = .5, shade = 'plain', base = 'ceramic' }: any = {}) {
    const g = new THREE.Group();
    lathe(g, [[0, 0], [.07, 0], [.1, .08], [.09, .18], [.035, .26], [.02, h * .62], [0, h * .62]], fabric(base, M.ceramic));
    cyl(g, .11, .15, .18, shade === 'warm' ? G.shadeWarm : G.shade, 0, h * .6, 0, 32, true);
    ball(g, .035, G.bulb, 0, h * .66, 0);
    addLight(g, 0, h * .7, 0, 1.6, 3.5);
    return g;
  }

  function floorLamp({ shade = 'plain' }: any = {}) {
    const g = new THREE.Group();
    cyl(g, .15, .17, .025, M.black, 0, 0, 0, 32);
    cyl(g, .012, .012, 1.42, M.brass, 0, .02, 0, 10);
    cyl(g, .15, .22, .3, shade === 'warm' ? G.shadeWarm : G.shade, 0, 1.3, 0, 32, true);
    ball(g, .04, G.bulb, 0, 1.38, 0);
    addLight(g, 0, 1.36, 0, 3.2, 5);
    return g;
  }

  function pendant({ r = .18, drop = .75, finish = 'black' }: any = {}) {
    const g = new THREE.Group();
    const y = wallH - drop;
    cyl(g, .004, .004, drop, M.black, 0, y, 0, 6);
    const dome = mesh(new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), finish === 'brass' ? M.brass : M.black);
    dome.position.y = y - r * .45; g.add(dome);
    const inside = mesh(new THREE.SphereGeometry(r * .97, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), G.shade, false);
    inside.position.y = y - r * .45; inside.scale.y = .98; g.add(inside);
    ball(g, .04, G.bulb, 0, y - r * .35, 0);
    addLight(g, 0, y - r * .6, 0, 3.5, 5.5);
    return g;
  }

  function sconce() {
    const g = new THREE.Group();
    box(g, .06, .04, .08, M.brass, 0, 0, .04, .01);
    cyl(g, .05, .05, .09, G.shadeWarm, 0, -.02, .1, 20);
    addLight(g, 0, 0, .15, 1.2, 3);
    return g;
  }

  function lampPost() {
    const g = new THREE.Group();
    cyl(g, .08, .1, .1, M.black, 0, 0, 0, 16);
    cyl(g, .03, .03, 2.2, M.black, 0, .1, 0, 10);
    box(g, .2, .26, .2, G.shadeWarm, 0, 2.28, 0, .02);
    box(g, .26, .04, .26, M.black, 0, 2.54, 0, .01);
    addLight(g, 0, 2.4, 0, 4, 7);
    return g;
  }

  function stringLights({ from = [.5, 11.5], to = [5.9, 11.5], height = 2.4 }: any = {}) {
    // 以世界坐标给出两根立柱的位置，物件自身放在原点
    const g = new THREE.Group();
    for (const [x, z] of [from, to]) cyl(g, .02, .02, height, M.black, x, 0, z, 8);
    const pts = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18, x = lerp(from[0], to[0], t), z = lerp(from[1], to[1], t), y = height - .04 - Math.sin(t * Math.PI) * .32;
      pts.push(new THREE.Vector3(x, y, z));
      if (i % 2 === 1) ball(g, .03, G.bulb, x, y - .05, z, [1, 1.3, 1], 10);
    }
    g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, .004, 4), M.black, false));
    addLight(g, (from[0] + to[0]) / 2, height - .5, (from[1] + to[1]) / 2 - .2, 3, 5, '#ffcf8a');
    return g;
  }

  // ---------------- 植物 ----------------
  function plant({ kind = 'bush', h = 1, pot = 'pot', potR = .17, potH = .3 }: any = {}) {
    const potMat = fabric(pot, M.pot);
    const g = new THREE.Group();
    lathe(g, [[0, 0], [potR * .76, 0], [potR * .98, potH * .92], [potR, potH], [potR * .9, potH], [potR * .88, potH * .9], [0, potH * .9]], potMat);
    cyl(g, potR * .88, potR * .88, .01, M.soil, 0, potH * .88, 0, 20);
    const top = potH * .9;
    if (kind === 'bush') {
      const leaves = [M.leaf, M.leafDark, M.leafLight];
      for (let i = 0; i < 9; i++) {
        const a = rand() * Math.PI * 2, rad = rr(0, potR * .9), r = rr(potR * .55, potR * .95);
        ico(g, r, pick(leaves), Math.cos(a) * rad, top + rr(r * .6, Math.max(r * .6, h - potH - r * .4)), Math.sin(a) * rad);
      }
    } else if (kind === 'tree') {
      cyl(g, .018, .026, h * .7, M.trunk, 0, top, 0, 8);
      const leaves = [M.leafOlive, M.leaf, M.leafLight];
      for (let i = 0; i < 14; i++) {
        const a = rand() * Math.PI * 2, rad = rr(.03, h * .17), r = rr(h * .07, h * .12);
        ico(g, r, pick(leaves), Math.cos(a) * rad, rr(h * .55, h * .95), Math.sin(a) * rad, 0);
      }
    } else if (kind === 'snake') {
      for (let i = 0; i < 9; i++) {
        const bh = rr(.45, .95) * (h - potH);
        const blade = mesh(new THREE.ConeGeometry(.045, bh, 4, 1), M.leafBlade);
        blade.scale.z = .3;
        const a = rand() * Math.PI * 2, rad = rr(0, potR * .6);
        blade.position.set(Math.cos(a) * rad, top + bh / 2, Math.sin(a) * rad);
        blade.rotation.set(rr(-.15, .15), rand() * Math.PI, rr(-.15, .15));
        g.add(blade);
      }
    } else if (kind === 'monstera') {
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2 + rr(-.2, .2), len = rr(.35, .7) * (h - potH);
        const tilt = rr(.35, .8);
        const stem = cyl(g, .008, .008, len, M.leafBlade, 0, 0, 0, 5);
        const sx = Math.cos(a) * Math.sin(tilt) * len, sz = Math.sin(a) * Math.sin(tilt) * len, sy = Math.cos(tilt) * len;
        stem.position.set(sx / 2, top + sy / 2, sz / 2);
        stem.lookAt(stem.position.clone().add(new THREE.Vector3(sx, sy, sz)));
        stem.rotateX(Math.PI / 2);
        const leaf = mesh(new THREE.CircleGeometry(rr(.13, .2), 14), M.leafFlat);
        leaf.scale.set(1, 1.25, 1);
        leaf.position.set(sx, top + sy + .02, sz);
        leaf.rotation.order = 'YXZ';
        leaf.rotation.set(-Math.PI / 2 + rr(.3, .7), -a + Math.PI / 2, 0);
        g.add(leaf);
      }
    } else if (kind === 'pampas') {
      for (let i = 0; i < 7; i++) {
        const a = rand() * Math.PI * 2, tilt = rr(.05, .35), len = rr(.5, .8) * (h - potH);
        const tip = new THREE.Vector3(Math.cos(a) * Math.sin(tilt) * len, top + Math.cos(tilt) * len, Math.sin(a) * Math.sin(tilt) * len);
        const stem = cyl(g, .004, .004, len, M.trunk, 0, 0, 0, 4);
        stem.position.set(tip.x / 2, top + (tip.y - top) / 2, tip.z / 2);
        stem.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
        ball(g, .045, M.pampas, tip.x, tip.y, tip.z, [1, 3, 1], 10).rotation.copy(stem.rotation);
      }
    } else if (kind === 'flowers') {
      const cols = [M.terracotta, M.rose, M.mustard, M.cushion];
      for (let i = 0; i < 7; i++) {
        const a = rand() * Math.PI * 2, tilt = rr(.05, .3), len = rr(.2, .32);
        const x = Math.cos(a) * Math.sin(tilt) * len, z = Math.sin(a) * Math.sin(tilt) * len, y = top + Math.cos(tilt) * len;
        const stem = cyl(g, .003, .003, len, M.leafBlade, x / 2, top, z / 2, 4);
        stem.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
        ball(g, .028, pick(cols), x, y, z, [1, 1.2, 1], 10);
      }
    }
    return g;
  }

  /** 不认识的物件类型（更新版本的插件加的）：先放一个纸箱占位，数据原样保留 */
  function unknownCrate() {
    const g = new THREE.Group();
    box(g, .44, .4, .44, M.oak, 0, 0, 0, .01);
    box(g, .46, .02, .1, M.mustard, 0, .39, 0, .004);
    box(g, .1, .3, .46, M.mustard, 0, .05, 0, .004);
    return g;
  }

  function herbPots() {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) { const p = plant({ kind: 'bush', h: .2, potR: .045, potH: .08, pot: 'terracotta' }); p.position.set(-.3 + i * .3, 0, 0); g.add(p); }
    return g;
  }

  function planter({ w = 1.4 }: any = {}) {
    const g = new THREE.Group();
    box(g, w, .3, .3, M.oak, 0, 0, 0, .01);
    const n = Math.max(2, Math.round(w / .28));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + .15 + i * (w - .3) / (n - 1);
      ico(g, rr(.1, .15), pick([M.leaf, M.leafLight, M.leafDark]), x, .35, 0, 1);
      ball(g, .03, pick([M.terracotta, M.mustard, M.rose]), x + .05, .47, rr(-.05, .05));
    }
    return g;
  }

  function tree({ h = 3.2, variant = 0 }: any = {}) {
    const canopies = [[M.leaf, M.leafDark, M.leafOlive], [M.leafOlive, M.leaf, M.leafLight], [M.leafDark, M.leaf]];
    const canopy = canopies[variant % canopies.length];
    const g = new THREE.Group();
    cyl(g, .07, .12, h * .55, M.bark, 0, 0, 0, 10);
    for (let i = 0; i < 12; i++) {
      const a = rand() * Math.PI * 2, rad = rr(0, h * .22), r = rr(h * .14, h * .22);
      ico(g, r, pick(canopy), Math.cos(a) * rad, rr(h * .55, h * .9), Math.sin(a) * rad, 1);
    }
    return g;
  }

  function bush({ r = .4 }: any = {}) {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) ico(g, rr(r * .6, r), pick([M.leaf, M.leafDark, M.leafLight]), rr(-r * .6, r * .6), rr(r * .4, r * .8), rr(-r * .5, r * .5), 1);
    return g;
  }

  // ---------------- 织物 / 装饰 ----------------
  function rug({ w = 2, d = 1.5, pattern = 'living', photo = null }: any = {}) {
    const g = new THREE.Group();
    // 换成了自己的照片：印在毯面上（按毯子的长宽比裁切）
    const mat = photo ? K.mediaMat(photo, w / d) : K.texturedMat('rug:' + pattern, K.texRug(pattern));
    const m = mesh(rbGeo(w, .012, d, .004), mat, false);
    m.position.y = .006; g.add(m);
    return g;
  }

  function painting({ w = .5, h = .66, art = 'arch', frame = 'walnut', photo = null }: any = {}) {
    const g = new THREE.Group();
    box(g, w + .05, h + .05, .03, fabric(frame, M.walnut), 0, -(h + .05) / 2, 0, .004);
    box(g, w - .02, h - .02, .005, M.paper, 0, -(h - .02) / 2, .016, 0);
    // 换成了自己的照片时用照片，否则用画作
    const inner = photo ? K.mediaMat(photo, (w - .1) / (h - .1)) : K.texturedMat('art:' + art, K.texArt(art), .9);
    plane(g, w - .1, h - .1, inner, 0, 0, .0195);
    return g;
  }

  /** 海报：直接贴在墙上的一张纸，四角有胶带；可以换成自己的照片 */
  function poster({ w = .6, h = .84, art = 'mountain', photo = null }: any = {}) {
    const g = new THREE.Group();
    // 离墙留出几毫米：俯视镜头的深度精度有限，贴得太近会被墙挡住
    box(g, w, h, .004, M.paper, 0, -h / 2, .006, 0);
    const inner = photo ? K.mediaMat(photo, (w - .04) / (h - .04)) : K.texturedMat('art:' + art, K.texArt(art), .9);
    plane(g, w - .04, h - .04, inner, 0, 0, .0085);
    for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const t = box(g, .07, .022, .002, M.linen, sx * (w / 2 - .012), sy * (h / 2 - .012) - .011, .0092, 0);
      t.rotation.z = sx * sy * .7;
    }
    return g;
  }

  function roundMirror({ r = .34 }: any = {}) {
    const g = new THREE.Group();
    torus(g, r, .018, M.brass, 0, 0, .015);
    const m = mesh(new THREE.CircleGeometry(r, 48), M.mirror, false);
    m.position.z = .012; g.add(m);
    return g;
  }

  function rectMirror({ w = .56, h = .76 }: any = {}) {
    const g = new THREE.Group();
    box(g, w, h, .025, M.brass, 0, -h / 2, 0, .02);
    box(g, w - .04, h - .04, .005, M.mirror, 0, -(h - .04) / 2, .014, .015);
    return g;
  }

  function slatPanel({ w = 2.6, h = 2.62 }: any = {}) {
    const g = new THREE.Group();
    box(g, w, h, .012, M.walnutDark, 0, .09, 0, 0);
    const n = Math.floor(w / .07);
    const inst = new THREE.InstancedMesh(rbGeo(.042, h, .028, .006), M.walnut, n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { m4.makeTranslation(-w / 2 + .035 + i * (w - .07) / (n - 1), .09 + h / 2, .02); inst.setMatrixAt(i, m4); }
    inst.castShadow = inst.receiveShadow = true;
    g.add(inst);
    return g;
  }

  function cat() {
    const g = new THREE.Group();
    ball(g, .17, M.fur, 0, .09, 0, [1, .55, .7]);
    ball(g, .075, M.fur, .15, .1, .05, [1, .9, 1]);
    ball(g, .04, M.furWhite, .2, .08, .06, [1, .7, 1]);
    for (const s of [-1, 1]) { const e = mesh(new THREE.ConeGeometry(.025, .05, 4), M.fur); e.position.set(.15, .17, .05 + s * .04); e.rotation.x = s * .3; g.add(e); }
    torus(g, .13, .022, M.fur, -.02, .03, .02, Math.PI * 1.1, [Math.PI / 2, 0, .4]);
    return g;
  }

  // ---------------- 书 / 柜 ----------------
  // ---------------- 摆件（可以放在家具上、单独绑定记忆桩） ----------------
  function bookStack({ colors = ['navy', 'cream'], w = .23, d = .17 }: any = {}) {
    const g = new THREE.Group();
    let y = 0;
    colors.forEach((c: string, i: number) => {
      const bh = i ? .035 : .04;
      box(g, w - i * .015, bh, d - i * .01, fabric(c, M.navy), 0, y, 0, .005).rotation.y = i % 2 ? -.1 : 0;
      y += bh;
    });
    return g;
  }

  function tray({ r = .13, finish = 'brass' }: any = {}) {
    const g = new THREE.Group();
    cyl(g, r, r, .015, finish === 'black' ? M.black : M.brass, 0, 0, 0, 24);
    return g;
  }

  function cup({ color = 'ceramic', r = .03, h = .07 }: any = {}) {
    const g = new THREE.Group();
    cyl(g, r, r * .84, h, fabric(color, M.ceramic), 0, 0, 0, 14);
    return g;
  }

  function vase({ color = 'ceramic', h = .26 }: any = {}) {
    const g = new THREE.Group(), k = h / .26;
    lathe(g, [[0, 0], [.05, 0], [.07, .1 * k], [.03, .22 * k], [.035, h], [0, h]], fabric(color, M.ceramic));
    return g;
  }

  function candle() {
    const g = new THREE.Group();
    cyl(g, .025, .03, .06, M.brass, 0, 0, 0, 12);
    cyl(g, .012, .012, .16, M.cushion, 0, .06, 0, 10);
    return g;
  }

  function placeSetting() {
    const g = new THREE.Group();
    cyl(g, .12, .1, .012, M.porcelain, 0, 0, 0, 32);
    cyl(g, .03, .026, .1, M.glass, .14, 0, -.09, 14);
    return g;
  }

  function fruitBowl() {
    const g = new THREE.Group();
    lathe(g, [[0, 0], [.08, 0], [.15, .05], [.16, .08], [0, .03]], M.ceramic);
    for (const [dx, dz, m] of [[-.05, -.02, M.fruitO], [.04, .02, M.fruitO], [-.01, -.08, M.fruitR], [.06, -.07, M.fruitY], [-.07, .05, M.fruitR]] as [number, number, THREE.Material][]) ball(g, .038, m, dx, .06, dz);
    return g;
  }

  /** 台面相框：可以换成自己的照片 */
  function photoFrame({ w = .18, h = .24, frame = 'black', photo = null }: any = {}) {
    const g = new THREE.Group();
    const fm = frame === 'oak' ? M.oak : frame === 'walnut' ? M.walnut : frame === 'brass' ? M.brass : M.black;
    const tilt = new THREE.Group();
    tilt.rotation.x = -.16;
    tilt.position.z = .02;
    g.add(tilt);
    box(tilt, w, h, .016, fm, 0, 0, 0, .004);
    plane(tilt, w - .036, h - .036, photo ? K.mediaMat(photo, (w - .036) / (h - .036)) : M.paper, 0, h / 2, .0085);
    const leg = box(g, .014, h * .72, .012, fm, 0, 0, -.03, .003);
    leg.rotation.x = .38;
    return g;
  }

  // ---------------- 积木（大模型看图生成，或手写 JSON）与导入的 3D 模型 ----------------
  const partMats = new Map<string, THREE.Material>();
  function partMat(p: PartSpec): THREE.Material {
    const c = p.color || '#b8a48c';
    if (!isHexColor(c) && p.rough === undefined && p.metal === undefined && p.opacity === undefined && (M as any)[c]) return (M as any)[c];
    const base = isHexColor(c) ? c.toLowerCase() : '#' + (((M as any)[c]?.color as THREE.Color)?.getHexString?.() || 'b8a48c');
    const rough = p.rough ?? .7, metal = p.metal ?? 0, opacity = p.opacity ?? 1;
    const key = `${base}|${rough.toFixed(2)}|${metal.toFixed(2)}|${opacity.toFixed(2)}`;
    let m = partMats.get(key);
    if (!m) { m = K.std(base, rough, metal, opacity < 1 ? { transparent: true, opacity, depthWrite: false } : {}); partMats.set(key, m); }
    return m;
  }

  /** 一个形体（中心在原点） */
  function partShape(p: PartSpec): THREE.Object3D {
    const s = p.size || [], mat = partMat(p);
    const a = s[0] ?? .1, b = s[1] ?? a, c = s[2] ?? a;
    switch (p.shape) {
      case 'box': return mesh(p.round ? rbGeo(a, b, c, p.round) : new THREE.BoxGeometry(a, b, c), mat);
      case 'cyl': return mesh(new THREE.CylinderGeometry(a / 2, (s[2] ?? a) / 2, b, 28), mat);
      case 'cone': return mesh(new THREE.ConeGeometry(a / 2, b, 28), mat);
      case 'sphere': { const m = mesh(new THREE.SphereGeometry(.5, 28, 18), mat); m.scale.set(a, b, c); return m; }
      case 'torus': return mesh(new THREE.TorusGeometry(Math.max(.001, (a - b) / 2), b / 2, 12, 40), mat);
      case 'lathe': {
        const g = new THREE.LatheGeometry(p.profile.map(([r, y]) => new THREE.Vector2(r, y)), 32);
        g.computeBoundingBox();
        g.translate(0, -(g.boundingBox.min.y + g.boundingBox.max.y) / 2, 0);
        return mesh(g, mat);
      }
      case 'extrude': {
        const shape = new THREE.Shape(p.outline.map(([x, y]) => new THREE.Vector2(x, y)));
        const g = new THREE.ExtrudeGeometry(shape, { depth: p.depth ?? s[2] ?? .02, bevelEnabled: false });
        g.center();
        return mesh(g, mat);
      }
    }
    return new THREE.Group();
  }

  /** 摆一个部件（含镜像、阵列副本）；镜像时旋转也跟着镜像 */
  function buildPart(parent: THREE.Object3D, p: PartSpec) {
    const make = (): THREE.Object3D => {
      if (p.shape !== 'group') return partShape(p);
      const g = new THREE.Group();
      for (const c of p.children || []) buildPart(g, c);
      return g;
    };
    const mirrors: [number, number][] = [[1, 1]];
    if (p.mirror === 'x' || p.mirror === 'xz') mirrors.push([-1, 1]);
    if (p.mirror === 'z' || p.mirror === 'xz') mirrors.push([1, -1]);
    if (p.mirror === 'xz') mirrors.push([-1, -1]);
    const [x, y, z] = p.pos || [0, 0, 0], [rx, ry, rz] = p.rot || [0, 0, 0];
    const n = p.repeat?.count || 1, step = p.repeat?.step || [0, 0, 0];
    for (let i = 0; i < n; i++) {
      for (const [mx, mz] of mirrors) {
        const o = make();
        o.position.set((x + step[0] * i) * mx, y + step[1] * i, (z + step[2] * i) * mz);
        o.rotation.set(rx * DEG * mz, ry * DEG * mx * mz, rz * DEG * mx);
        o.scale.x *= mx; o.scale.z *= mz;
        if (p.slot) o.userData.slot = p.slot;
        parent.add(o);
      }
    }
  }

  function blocks({ parts = [], scale = 1 }: any = {}) {
    const g = new THREE.Group(), inner = new THREE.Group();
    for (const p of sanitizeParts(parts).parts) buildPart(inner, p);
    inner.scale.setScalar(scale);
    g.add(inner);
    // 落地、左右前后居中：大模型给的坐标原点在哪都行
    inner.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(inner);
    if (!bb.isEmpty()) inner.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    return g;
  }

  const modelWait = K.std('#d9cfc2', .9, 0, { transparent: true, opacity: .5 });
  /** 导入的 glb：先放一个半透明的占位盒子，加载完换成模型（按高度缩放、落地居中） */
  function model({ src = null, h = 1 }: any = {}) {
    const g = new THREE.Group();
    const ph = box(g, h * .6, h, h * .6, modelWait, 0, 0, 0, .02);
    ph.userData.keep = true; // 加载完要换掉，不参与合批
    if (src && K.loadModel) {
      K.loadModel(src).then((scene) => {
        const inst = scene.clone(true);
        const bb = new THREE.Box3().setFromObject(inst);
        const size = bb.getSize(new THREE.Vector3());
        const k = h / Math.max(size.y, 1e-4);
        inst.scale.multiplyScalar(k);
        inst.position.set(-(bb.min.x + bb.max.x) / 2 * k, -bb.min.y * k, -(bb.min.z + bb.max.z) / 2 * k);
        g.remove(ph);
        g.add(inst);
        K.runtime.onLoaded?.();
      }).catch((e) => console.warn(t('[kmind-palace] 模型加载失败'), src, e));
    }
    return g;
  }

  /** 书脊：一张贴图集 + 每本书正面一块面片（普通书架没有书名，笔记本书架写上文档标题） */
  function spineMesh(books: DocBook[], d: number) {
    const CW = 40, CH = 272, cols = Math.max(1, Math.min(books.length, 48)), rowsA = Math.ceil(books.length / cols);
    const canvas = document.createElement('canvas');
    canvas.width = cols * CW; canvas.height = rowsA * CH;
    const g2 = canvas.getContext('2d');
    const pos: number[] = [], uv: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
    books.forEach((b, i) => {
      const cx = (i % cols) * CW, cy = Math.floor(i / cols) * CH;
      drawSpine(g2, cx, cy, CW, CH, b.c, b.title);
      const z = -d / 2 + .02 + b.d + .0008 + (b.pz || 0);
      // 靠着的书：书脊面片跟着书转
      const cs = Math.cos(b.rz), sn = Math.sin(b.rz);
      const corner = (dx: number, dy: number) => pos.push(b.x + dx * cs - dy * sn, b.y + dx * sn + dy * cs, z);
      const v = pos.length / 3;
      corner(-b.w / 2, -b.h / 2); corner(b.w / 2, -b.h / 2); corner(b.w / 2, b.h / 2); corner(-b.w / 2, b.h / 2);
      const u0 = cx / canvas.width, u1 = (cx + CW) / canvas.width, v1 = 1 - cy / canvas.height, v0 = 1 - (cy + CH) / canvas.height;
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      for (let k = 0; k < 4; k++) { nor.push(0, 0, 1); col.push(1, 1, 1); }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: .8, vertexColors: true });
    mat.userData.owned = true;
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.name = 'kp-spines';
    // 拾取：每本书两个三角形；高亮 / 抽出：每本书四个顶点
    m.userData.faceSlots = books.flatMap(b => [b.slot, b.slot]);
    m.userData.slotVerts = Object.fromEntries(books.map((b, i) => [b.slot, i * 4]));
    return m;
  }

  function bookshelf({ w = 1.2, h = 2.0, d = .34, rows = 5, wood = 'oak', decor = true, source = null, books = null }: any = {}) {
    const mat = fabric(wood, M.oak);
    const g = new THREE.Group();
    box(g, .03, h, d, mat, -w / 2 + .015, 0, 0, .004);
    box(g, .03, h, d, mat, w / 2 - .015, 0, 0, .004);
    box(g, w, .03, d, mat, 0, h - .03, 0, .004);
    box(g, w, .07, d, mat, 0, 0, 0, .004);
    box(g, w - .06, h - .1, .01, M.cream, 0, .07, -d / 2 + .005, 0);
    // 书目：笔记本里的文档（还没拉到书目时先空着），或随机的书
    const docs = source ? K.runtime.shelfDocs?.(source) : null;
    const L: { books: ShelfBook[]; step: number; decor?: ShelfDecor[]; overflow?: number; ends?: { x: number; y: number }[] } = source
      ? docShelfLayout({ w, h, d, rows }, docs || [])
      : shelfLayout({ w, h, d, rows, decor }, Math.floor(rand() * 1e9));
    // 逐本覆盖（颜色、靠、抽出、空着）；二维书架编辑器按这里排好的书画（raw 是覆盖之前的，画空着的格子）
    const raw = L.books;
    L.books = applyBookOverrides(L.books, books);
    g.userData.shelf = { source: !!source, loading: !!source && !docs, total: docs?.length ?? 0, overflow: L.overflow ?? 0, layout: { w, h, d, rows, step: L.step, books: L.books, raw } };
    for (let i = 1; i < rows; i++) box(g, w - .06, .025, d - .02, mat, 0, .07 + i * L.step - .012, .01, .003);
    for (const o of L.decor || []) {
      if (o.kind === 'vase') lathe(g, [[0, 0], [.04, 0], [.06, .07], [.03, .15], [.035, .18], [0, .18]], [M.ceramic, M.terracotta, M.sage][Math.floor(o.pick * 3)], o.x, o.y, 0);
      else if (o.kind === 'plant') { const pl = plant({ kind: 'bush', h: .24, potR: .06, potH: .09, pot: 'potWhite' }); pl.position.set(o.x, o.y, 0); g.add(pl); }
      else box(g, .16, .1, .2, [M.linen, M.charcoalFab, M.sand][Math.floor(o.pick * 3)], o.x, o.y, 0, .01);
    }
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.book, L.books.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    L.books.forEach((b, i) => {
      e.set(0, 0, b.rz); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(b.x, b.y, -d / 2 + .02 + b.d / 2 + (b.pz || 0)), q, new THREE.Vector3(b.w, b.h, b.d));
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, new THREE.Color(b.c));
    });
    inst.castShadow = true; inst.receiveShadow = true;
    inst.userData.slots = L.books.map(b => b.slot);
    g.add(inst);
    if (source && L.books.length) g.add(spineMesh(L.books as DocBook[], d));
    // 书挡：一块竖板 + 压在书下的底板
    for (const e of L.ends || []) {
      box(g, .006, .15, .11, M.black, e.x, e.y, -d / 2 + .09, .002);
      box(g, .07, .004, .11, M.black, e.x + .035, e.y, -d / 2 + .09, .001);
    }
    return g;
  }

  function mediaConsole({ w = 2.0, decor = true, photo = null }: any = {}) {
    const g = new THREE.Group();
    legs4(g, w, .4, .12, M.black, .015, .08, 1);
    box(g, w, .42, .42, M.walnut, 0, .12, 0, .015);
    for (let i = 1; i < 3; i++) box(g, .005, .38, .004, M.walnutDark, -w / 2 + i * w / 3, .14, .211, 0);
    for (let i = 0; i < 3; i++) box(g, .12, .012, .015, M.brass, -w / 2 + (i + .5) * w / 3, .48, .215, .004);
    box(g, .42, .015, .22, M.black, 0, .54, -.04, .004);
    box(g, .06, .1, .03, M.black, 0, .55, -.08, .004);
    box(g, 1.52, .88, .04, M.black, 0, .62, -.08, .008);
    // 电视画面：自己的照片（发光的屏幕）或默认画面
    plane(g, 1.48, .84, photo ? K.mediaMat(photo, 1.48 / .84, true) : G.screen, 0, .62 + .44, -.059);
    box(g, .9, .07, .09, M.charcoal, 0, .54, .12, .02);
    if (!decor) return g;
    const pl = plant({ kind: 'snake', h: .55, potR: .08, potH: .14, pot: 'potWhite' }); pl.position.set(-w / 2 + .18, .54, 0); g.add(pl);
    box(g, .22, .04, .16, M.terracotta, w / 2 - .25, .54, .02, .006);
    box(g, .2, .035, .15, M.navy, w / 2 - .25, .58, .02, .006);
    lathe(g, [[0, 0], [.05, 0], [.07, .1], [.03, .22], [.035, .26], [0, .26]], M.ceramic, w / 2 - .12, .54, -.05);
    return g;
  }

  function sideboard({ w = 1.8, h = .78, d = .44, decor = true, color = 'walnut' }: any = {}) {
    const g = new THREE.Group();
    legs4(g, w, d, .14, M.black, .014, .06, 1);
    box(g, w, h - .14, d, fabric(color, M.walnut), 0, .14, 0, .015);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const cx = -w / 2 + (i + .5) * w / n;
      for (let k = 0; k < 8; k++) box(g, .012, h - .22, .008, M.walnutDark, cx - w / n / 2 + .04 + k * (w / n - .08) / 7, .18, d / 2 + .003, .002);
    }
    if (decor) {
      const lamp = tableLamp({ h: .52, shade: 'warm', base: 'terracotta' }); lamp.position.set(-w / 2 + .25, h, 0); g.add(lamp);
      box(g, .24, .05, .18, M.mustard, .1, h, .02, .006);
      box(g, .22, .04, .17, M.cream, .1, h + .05, .02, .006);
      const p = plant({ kind: 'pampas', h: .75, potR: .07, potH: .26, pot: 'potGrey' }); p.position.set(w / 2 - .22, h, -.02); g.add(p);
    }
    box(g, .36, .08, .3, M.oakLight, .55 - w / 2 + .6, h, 0, .01);
    cyl(g, .13, .13, .008, M.black, .55 - w / 2 + .56, h + .08, 0, 32);
    return g;
  }

  function bed({ w = 1.6, L = 2.1, throwColor = 'terracotta' }: any = {}) {
    const frame = M.oak, head = M.sand, duvet = M.linen, throwMat = fabric(throwColor, M.terracotta);
    const g = new THREE.Group(), z0 = -L / 2;
    legs4(g, w, L, .1, M.walnut, .025, .08);
    box(g, w + .08, .22, L, frame, 0, .1, 0, .02);
    box(g, w + .2, 1.08, .08, head, 0, .08, z0 - .01, .03);
    const n = 5, cw = (w + .16) / n;
    for (let i = 0; i < n; i++) box(g, cw - .012, .78, .07, head, -(w + .16) / 2 + cw * (i + .5), .34, z0 + .05, .03);
    box(g, w, .2, L - .1, M.white, 0, .32, .03, .05);
    box(g, w + .06, .08, L - .5, duvet, 0, .47, .27, .035);
    box(g, .03, .28, L - .5, duvet, -w / 2 - .035, .26, .27, .012);
    box(g, .03, .28, L - .5, duvet, w / 2 + .035, .26, .27, .012);
    box(g, .03 + w, .28, .03, duvet, 0, .26, L / 2 + .02, .012);
    box(g, w + .07, .1, .26, duvet, 0, .47, z0 + .62, .05);
    box(g, w + .1, .04, .52, throwMat, 0, .545, L / 2 - .3, .015);
    box(g, .02, .3, .52, throwMat, -w / 2 - .06, .27, L / 2 - .3, .008);
    box(g, .02, .3, .52, throwMat, w / 2 + .06, .27, L / 2 - .3, .008);
    for (const [x, z, m, rx] of [[-w / 4, z0 + .24, M.white, -.55], [w / 4, z0 + .24, M.white, -.55], [-w / 4 + .05, z0 + .38, M.sage, -.4], [w / 4 - .05, z0 + .38, M.rose, -.4]] as [number, number, THREE.Material, number][]) {
      const small = m !== M.white;
      const p = box(g, small ? .44 : .62, small ? .34 : .44, small ? .12 : .16, m, x, .5, z, .07);
      p.rotation.x = rx;
    }
    return g;
  }

  function nightstand({ side = 1, color = 'walnut' }: any = {}) {
    const g = new THREE.Group();
    legs4(g, .46, .38, .12, M.black, .012, .04, 1);
    box(g, .48, .4, .4, fabric(color, M.walnut), 0, .12, 0, .014);
    box(g, .44, .005, .004, M.walnutDark, 0, .36, .2, 0);
    cyl(g, .014, .014, .02, M.brass, 0, .43, .205, 10).rotation.x = Math.PI / 2;
    const l = tableLamp({ h: .46 }); l.position.set(-side * .07, .52, -.04); g.add(l);
    box(g, .16, .03, .22, M.navy, side * .12, .52, .04, .004).rotation.y = .2;
    box(g, .15, .025, .2, M.cream, side * .12, .55, .04, .004).rotation.y = .12;
    return g;
  }

  function wardrobe({ w = .95, h = 2.2, d = .6, color = 'oakLight' }: any = {}) {
    const g = new THREE.Group();
    box(g, w, .08, d - .04, M.walnutDark, 0, 0, -.02, .004);
    box(g, w, h - .08, d, fabric(color, M.oakLight), 0, .08, 0, .012);
    box(g, .005, h - .2, .004, M.seam, 0, .14, d / 2 + .001, 0);
    for (const s of [-1, 1]) box(g, .018, .5, .025, M.brass, s * .05, 1.0, d / 2 + .012, .006);
    box(g, .36, .2, .32, M.sand, -.2, h, 0, .02);
    box(g, .3, .16, .28, M.linen, .22, h, .02, .02);
    return g;
  }

  function dresser({ w = .9, h = .78, d = .42, decor = true, color = 'oakLight' }: any = {}) {
    const g = new THREE.Group();
    legs4(g, w, d, .1, M.walnut, .016, .05);
    box(g, w, h - .1, d, fabric(color, M.oakLight), 0, .1, 0, .012);
    for (let i = 1; i < 3; i++) box(g, w - .04, .005, .004, M.seam, 0, .1 + i * (h - .1) / 3, d / 2 + .001, 0);
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) cyl(g, .014, .014, .02, M.brass, s * w / 4, .1 + (i + .5) * (h - .1) / 3, d / 2 + .01, 10).rotation.x = Math.PI / 2;
    box(g, .3, .015, .18, M.brass, -.2, h, 0, .004);
    for (let i = 0; i < 3; i++) cyl(g, .022, .026, rr(.08, .14), pick([M.rose, M.cream, M.glass, M.sage]), -.3 + i * .08, h + .015, 0, 12);
    if (decor) { const pl = plant({ kind: 'pampas', h: .55, potR: .06, potH: .16, pot: 'potWhite' }); pl.position.set(.28, h, -.04); g.add(pl); }
    return g;
  }

  function shoeBench({ w = .9 }: any = {}) {
    const g = new THREE.Group();
    box(g, w, .45, .36, M.oakLight, 0, 0, 0, .01);
    box(g, w - .1, .1, .3, M.charcoalFab, 0, .45, 0, .04);
    return g;
  }

  function coatRack() {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; const l = box(g, .03, .02, .3, M.walnut, Math.cos(a) * .12, 0, Math.sin(a) * .12, .006); l.rotation.y = -a + Math.PI / 2; }
    cyl(g, .02, .025, 1.75, M.walnut, 0, 0, 0, 10);
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; const h = cyl(g, .01, .01, .16, M.walnut, Math.cos(a) * .06, 1.6, Math.sin(a) * .06, 6); h.rotation.set(Math.sin(a) * .8, 0, -Math.cos(a) * .8); }
    box(g, .36, .8, .12, M.olive, .09, .82, 0, .05).rotation.z = .08;
    const hat = cyl(g, .12, .12, .02, M.charcoalFab, -.06, 1.62, .03, 24); hat.rotation.z = .3;
    cyl(g, .07, .08, .1, M.charcoalFab, -.06, 1.64, .03, 20).rotation.z = .3;
    return g;
  }

  function umbrellaStand() {
    const g = new THREE.Group();
    cyl(g, .1, .09, .45, M.terracotta, 0, 0, 0, 20);
    for (let i = 0; i < 2; i++) { const u = cyl(g, .012, .012, .8, i ? M.navy : M.black, (i - .5) * .05, .3, 0, 8); u.rotation.z = (i - .5) * .15; }
    return g;
  }

  function laundryBasket() {
    const g = new THREE.Group();
    cyl(g, .2, .17, .45, M.sand, 0, 0, 0, 20);
    box(g, .3, .06, .26, M.cushion, 0, .44, 0, .03).rotation.z = .2;
    return g;
  }

  function mailbox() {
    const g = new THREE.Group();
    cyl(g, .03, .03, 1.0, M.black, 0, 0, 0, 8);
    box(g, .22, .2, .36, M.frontDoor, 0, 1.0, 0, .08);
    box(g, .02, .1, .04, M.terracotta, .11, 1.18, .1, .005);
    return g;
  }

  function stone({ r = .24 }: any = {}) {
    const g = new THREE.Group();
    const s = cyl(g, r, r, .04, M.stone, 0, 0, 0, 18); s.scale.z = .75; s.rotation.y = rand() * 3;
    return g;
  }

  function step({ w = .5, d = 1.2, h = .12 }: any = {}) {
    const g = new THREE.Group();
    box(g, w, h, d, M.stone, 0, 0, 0, .01);
    return g;
  }

  // ---------------- 厨房 ----------------
  function kitchenRun({ length = 5, sink = -1.22, cooktop = .98 }: any = {}) {
    // 原点在地柜中心，背板贴墙（z = -0.31），正面朝 +z
    const g = new THREE.Group(), len = length, z = (v: number) => v - .41;
    box(g, len - .04, .1, .52, M.charcoal, 0, 0, z(.38), 0);
    box(g, len, .76, .6, M.cabinet, 0, .1, z(.4), .008);
    box(g, len + .02, .04, .64, M.quartz, 0, .86, z(.42), .006);
    for (let x = -len / 2 + .6; x < len / 2 - .1; x += .6) box(g, .006, .72, .006, M.seam, x, .12, z(.702), 0);
    box(g, len - .02, .006, .006, M.seam, 0, .68, z(.702), 0);
    for (let x = -len / 2 + .3; x < len / 2; x += .6) box(g, .16, .014, .02, M.brass, x, .75, z(.712), .005);
    box(g, .66, .004, .44, M.steel, sink, .9, z(.44), .02);
    box(g, .58, .003, .36, M.sinkInner, sink, .904, z(.44), .02);
    cyl(g, .028, .032, .04, M.chrome, sink, .9, z(.19), 12);
    cyl(g, .012, .012, .34, M.chrome, sink, .92, z(.19), 10);
    torus(g, .09, .012, M.chrome, sink, 1.26, z(.28), Math.PI, [0, Math.PI / 2, 0]);
    box(g, .62, .006, .5, M.blackGlass, cooktop, .9, z(.44), .01);
    for (const [dx, dz, r] of [[-.15, -.1, .08], [.15, -.1, .06], [-.15, .12, .06], [.15, .12, .08]]) {
      const ring = mesh(new THREE.RingGeometry(r * .8, r, 32), M.burner, false);
      ring.rotation.x = -Math.PI / 2; ring.position.set(cooktop + dx, .908, z(.44) + dz); g.add(ring);
    }
    lathe(g, [[0, 0], [.08, 0], [.09, .12], [.06, .2], [.02, .22], [0, .22]], M.white, cooktop - .75, .9, z(.35));
    box(g, .38, .02, .26, M.oak, -len / 2 + .38, .9, z(.42), .006).rotation.y = .1;
    ball(g, .06, M.bread, -len / 2 + .38, .95, z(.42), [1.5, .6, .8]);
    for (let i = 0; i < 3; i++) cyl(g, .045, .045, .12 + i * .03, M.glass, len / 2 - .62 + i * .12, .9, z(.3), 16);
    box(g, .12, .22, .1, M.walnut, cooktop + .55, .9, z(.3), .01).rotation.y = -.2;
    return g;
  }

  function upperCabinet({ w = 1.0, h = .72, d = .35 }: any = {}) {
    const g = new THREE.Group();
    box(g, w, h, d, M.cabinetUp, 0, 0, d / 2, .008);
    box(g, .005, h - .02, .004, M.seam, 0, .01, d + .002, 0);
    box(g, .012, .14, .02, M.brass, -.06, .06, d + .01, .004);
    box(g, .012, .14, .02, M.brass, .06, .06, d + .01, .004);
    return g;
  }

  function rangeHood() {
    const g = new THREE.Group();
    box(g, .7, .12, .48, M.steel, 0, 0, .24, .01);
    box(g, .3, wallH - 1.62, .24, M.steel, 0, .12, .12, .006);
    return g;
  }

  function wallShelf({ w = .56 }: any = {}) {
    const g = new THREE.Group();
    for (const y of [0, .42]) {
      box(g, w, .03, .24, M.oak, 0, y, .12, .005);
      for (let i = 0; i < 3; i++) cyl(g, .04, .04, rr(.1, .17), pick([M.glass, M.ceramic, M.terracotta]), -.18 + i * .17, y + .03, .12, 14);
    }
    return g;
  }

  function fridge() {
    const g = new THREE.Group();
    box(g, .8, 1.95, .68, M.fridge, 0, 0, 0, .03);
    box(g, .8, .006, .006, M.seam, 0, .66, .342, 0);
    box(g, .006, 1.28, .006, M.seam, 0, .67, .342, 0);
    box(g, .02, .42, .035, M.steel, -.06, 1.05, .36, .008);
    box(g, .02, .42, .035, M.steel, .06, 1.05, .36, .008);
    box(g, .3, .02, .035, M.steel, 0, .52, .36, .008);
    box(g, .12, .16, .003, M.paper, .22, 1.35, .342, 0).rotation.z = .08;
    for (const [x, y, m] of [[.2, 1.46, M.terracotta], [-.25, 1.5, M.mustard], [-.2, 1.2, M.sage]] as [number, number, THREE.Material][]) box(g, .04, .04, .012, m, x, y, .345, .004);
    return g;
  }

  function kitchenIsland({ w = 2.3, decor = true }: any = {}) {
    const g = new THREE.Group();
    box(g, w - .06, .1, .74, M.charcoal, 0, 0, 0, 0);
    box(g, w, .76, .8, M.oakLight, 0, .1, 0, .01);
    box(g, w + .2, .04, 1.0, M.quartz, 0, .86, .05, .008);
    if (decor) {
      const fb = fruitBowl(); fb.position.set(-.35, .9, .05); g.add(fb);
      const fl = plant({ kind: 'flowers', h: .45, potR: .05, potH: .16, pot: 'glass' }); fl.position.set(.55, .9, 0); g.add(fl);
    }
    box(g, .3, .02, .2, M.oak, .1, .9, .15, .005).rotation.y = -.2;
    return g;
  }

  // ---------------- 卫浴 ----------------
  function bathtub({ L = 1.7, W = .75, h = .56 }: any = {}) {
    const g = new THREE.Group();
    box(g, L, h, W, M.porcelain, 0, 0, 0, .06);
    box(g, L - .14, .004, W - .14, M.water, 0, h - .003, 0, .05);
    cyl(g, .018, .018, .18, M.chrome, -L / 2 + .12, h, -W / 2 + .1, 10);
    const sp = cyl(g, .014, .014, .12, M.chrome, -L / 2 + .12, h + .16, -W / 2 + .14, 10); sp.rotation.x = Math.PI / 2;
    box(g, .3, .06, .12, M.oak, L / 2 - .3, h, 0, .01);
    for (let i = 0; i < 3; i++) cyl(g, .025, .025, rr(.1, .16), pick([M.sage, M.cream, M.rose]), L / 2 - .4 + i * .08, h + .06, 0, 12);
    return g;
  }

  function toilet() {
    const g = new THREE.Group();
    lathe(g, [[0, 0], [.13, 0], [.15, .2], [.19, .38], [0, .38]], M.porcelain, 0, 0, .06);
    ball(g, .19, M.porcelain, 0, .38, .08, [1, .28, 1.25]);
    box(g, .38, .035, .46, M.porcelain, 0, .4, .08, .03);
    box(g, .4, .38, .18, M.porcelain, 0, .38, -.2, .04);
    box(g, .1, .012, .05, M.chrome, 0, .76, -.2, .005);
    return g;
  }

  function vanity({ w = .72 }: any = {}) {
    const g = new THREE.Group();
    legs4(g, w, .44, .3, M.black, .012, .04, 1);
    box(g, w, .5, .46, M.oak, 0, .3, 0, .012);
    box(g, w - .04, .005, .004, M.seam, 0, .55, .231, 0);
    box(g, w + .02, .03, .48, M.quartz, 0, .8, 0, .006);
    lathe(g, [[0, 0], [.1, 0], [.19, .06], [.2, .13], [.18, .13], [.17, .08], [0, .03]], M.porcelain, 0, .83, .03);
    cyl(g, .014, .014, .32, M.chrome, 0, .83, -.18, 10);
    const sp = cyl(g, .011, .011, .16, M.chrome, 0, 1.13, -.1, 10); sp.rotation.x = Math.PI / 2;
    cyl(g, .03, .03, .12, M.rose, w / 2 - .09, .83, -.14, 12);
    return g;
  }

  function shower() {
    const g = new THREE.Group();
    cyl(g, .012, .012, .5, M.chrome, 0, 0, .03, 8);
    cyl(g, .012, .012, .12, M.chrome, 0, .49, .06, 8).rotation.x = Math.PI / 2;
    cyl(g, .09, .09, .015, M.chrome, 0, .46, .13, 24);
    return g;
  }

  function towelLadder() {
    const g = new THREE.Group();
    for (const s of [-1, 1]) { const r = box(g, .03, 1.6, .03, M.oak, s * .22, 0, 0, .008); r.rotation.x = -.12; r.position.z = -.1; }
    for (let i = 0; i < 4; i++) {
      const y = .35 + i * .35;
      const rung = cyl(g, .012, .012, .44, M.oak, 0, y, -.1 + y * .12, 8); rung.rotation.z = Math.PI / 2; rung.position.y = y;
    }
    box(g, .36, .45, .025, M.sage, 0, .85, .03, .01);
    box(g, .34, .35, .025, M.cushion, 0, .55, -.01, .01);
    return g;
  }

  // ---------------- 阳台 ----------------
  function railing({ segments = [] as number[][], height = 1.0 }: any = {}) {
    // 以世界坐标给出若干段 [x0, z0, x1, z1]，物件自身放在原点
    const g = new THREE.Group();
    for (const [x0, z0, x1, z1] of segments) {
      const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0);
      const s = new THREE.Group(); s.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); s.rotation.y = ang - Math.PI / 2;
      const glass = box(s, len, height - .05, .02, M.glass, 0, .05, 0, 0); glass.castShadow = false; glass.userData.collider = true;
      box(s, len + .04, .04, .06, M.black, 0, height, 0, .01);
      const n = Math.max(1, Math.round(len / 1.4));
      for (let i = 0; i <= n; i++) box(s, .04, height, .04, M.black, -len / 2 + i * len / n, 0, 0, .006);
      g.add(s);
    }
    return g;
  }

  const E = (name: string, category: string, build: (p: any) => THREE.Object3D, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({ name, category, build, ...extra });
  const CUP_COLORS: [string, string][] = [['ceramic', '白瓷'], ['terracotta', '陶土红'], ['sage', '鼠尾草绿'], ['navy', '藏青'], ['mustard', '芥末黄']];
  /** 书的部件名：笔记本书架是文档标题，普通书架是第几层第几本 */
  const bookSlotLabel = (slot: string, p: Record<string, any>) => {
    if (slot.startsWith('doc:')) {
      const id = slot.slice(4);
      const doc = p.source ? K.runtime.shelfDocs?.(p.source)?.find(x => x.id === id) : null;
      return doc ? t('《{title}》', { title: doc.title }) : t('一本书');
    }
    return bookSlotName(slot, p);
  };

  const catalog: Record<string, CatalogEntry> = {
    sofa: E('沙发', '坐具', sofa, { params: [num('w', '宽度', 1.4, 3.2, .1, 2.3), selc('fabric', '布料', FABRICS, 'sand')] }),
    armchair: E('单人椅', '坐具', armchair, { params: [selc('fabric', '布料', FABRICS, 'mustard'), selc('wood', '木色', WOODS, 'oak')] }),
    chair: E('餐椅', '坐具', chair, { params: [selc('wood', '木色', WOODS, 'oak'), selc('seat', '坐垫', FABRICS, 'linen')] }),
    stool: E('吧椅', '坐具', stool),
    bench: E('长凳', '坐具', bench, { params: [num('w', '宽度', .8, 2.0, .1, 1.3), selc('wood', '木色', WOODS, 'oak')] }),
    officeChair: E('办公椅', '坐具', officeChair),
    loungeChair: E('休闲椅', '坐具', loungeChair),
    coffeeTable: E('茶几', '桌几', coffeeTable, { params: [selc('top', '桌面', WOODS, 'oak')] }),
    sideTable: E('边几', '桌几', sideTable, { params: [sel('lamp', '台灯', [[null, '无'], ...LAMP_BASES], null), selc('top', '桌面', WOODS, 'walnut')] }),
    globeTable: E('地球仪', '桌几', globeTable),
    diningTable: E('餐桌', '桌几', diningTable, { params: [num('w', '长度', 1.0, 3.0, .1, 1.9), num('d', '宽度', .7, 1.2, .05, .95), selc('wood', '木色', WOODS, 'oak')] }),
    desk: E('书桌', '桌几', desk, { params: [num('w', '宽度', .9, 2.2, .05, 1.5), selc('top', '桌面', WOODS, 'oak')] }),
    tableLamp: E('台灯', '灯具', tableLamp, { params: [selc('base', '灯座', LAMP_BASES, 'ceramic'), sel('shade', '灯罩', SHADES, 'plain')] }),
    floorLamp: E('落地灯', '灯具', floorLamp, { params: [sel('shade', '灯罩', SHADES, 'plain')] }),
    pendant: E('吊灯', '灯具', pendant, { solid: false, params: [sel('finish', '材质', [['black', '黑'], ['brass', '黄铜']], 'black'), num('r', '灯罩半径', .1, .4, .01, .18), num('drop', '吊线长度', .4, 1.4, .05, .75)] }),
    sconce: E('壁灯', '灯具', sconce, { solid: false, mount: 'wall' }),
    lampPost: E('庭院灯', '户外', lampPost),
    stringLights: E('串灯', '灯具', stringLights, { solid: false }),
    [UNKNOWN_TYPE]: E('未知物件', '', unknownCrate, { solid: false }),
    plant: E('绿植', '植物', plant, { params: [sel('kind', '品种', PLANTS, 'bush'), num('h', '高度', .3, 2.4, .05, 1), sel('pot', '花盆', POTS, 'pot'), num('potR', '盆半径', .04, .35, .01, .17), num('potH', '盆高', .06, .6, .01, .3)] }),
    herbPots: E('香草盆栽', '植物', herbPots, { solid: false }),
    planter: E('花槽', '植物', planter, { params: [num('w', '长度', .6, 2.4, .1, 1.4)] }),
    tree: E('树', '户外', tree, { params: [num('h', '高度', 1.5, 5, .1, 3.2), sel('variant', '树冠', [[0, '深绿'], [1, '橄榄'], [2, '墨绿']], 0)] }),
    bush: E('灌木', '户外', bush, { params: [num('r', '大小', .2, .9, .05, .4)] }),
    rug: E('地毯', '装饰', rug, { solid: false, flat: true, params: [{ key: 'photo', label: '照片', kind: 'photo' }, sel('pattern', '花纹', RUGS, 'living'), num('w', '长', .6, 4.5, .1, 2), num('d', '宽', .4, 4, .1, 1.5)] }),
    poster: E('海报', '装饰', poster, { solid: false, mount: 'wall', params: [{ key: 'photo', label: '照片', kind: 'photo' }, sel('art', '画面', ARTS, 'mountain'), num('w', '宽', .2, 1.4, .02, .6), num('h', '高', .2, 1.6, .02, .84)] }),
    painting: E('装饰画', '装饰', painting, { solid: false, mount: 'wall', params: [{ key: 'photo', label: '照片', kind: 'photo' }, sel('art', '画作', ARTS, 'arch'), num('w', '宽', .2, 1.6, .02, .5), num('h', '高', .2, 1.6, .02, .66), sel('frame', '画框', [['walnut', '胡桃木'], ['oak', '橡木'], ['black', '黑'], ['brass', '黄铜']], 'walnut')] }),
    roundMirror: E('圆镜', '装饰', roundMirror, { solid: false, mount: 'wall', params: [num('r', '半径', .15, .6, .01, .34)] }),
    rectMirror: E('镜子', '装饰', rectMirror, { solid: false, mount: 'wall', params: [num('w', '宽', .3, 1.4, .02, .56), num('h', '高', .4, 1.6, .02, .76)] }),
    slatPanel: E('木格栅墙', '装饰', slatPanel, { solid: false, mount: 'wall', fixedY: true, params: [num('w', '宽度', .6, 5, .1, 2.6)] }),
    cat: E('猫', '装饰', cat, { solid: false }),
    bookshelf: E('书架', '柜架', bookshelf, { slotName: bookSlotLabel, params: [{ key: 'source', label: '书目', kind: 'docSource' }, num('w', '宽度', .6, 2.4, .1, 1.2), num('h', '高度', .8, 2.4, .02, 2.0), num('rows', '层数', 2, 7, 1, 5), selc('wood', '木色', WOODS, 'oak')] }),
    bookStack: E('一摞书', '摆件', bookStack, { solid: false }),
    tray: E('托盘', '摆件', tray, { solid: false, params: [sel('finish', '材质', [['brass', '黄铜'], ['black', '黑']], 'brass')] }),
    cup: E('杯子', '摆件', cup, { solid: false, params: [selc('color', '颜色', CUP_COLORS, 'ceramic')] }),
    vase: E('花瓶', '摆件', vase, { solid: false, params: [selc('color', '颜色', CUP_COLORS, 'ceramic'), num('h', '高度', .12, .6, .01, .26)] }),
    candle: E('烛台', '摆件', candle, { solid: false }),
    placeSetting: E('餐具', '摆件', placeSetting, { solid: false }),
    fruitBowl: E('果盘', '摆件', fruitBowl, { solid: false }),
    blocks: E('积木', '积木', blocks, { slotName: (slot, p) => t(partName(p.parts, slot) || slot), params: [{ key: 'parts', label: '部件', kind: 'blocks' }, num('scale', '缩放', .2, 3, .05, 1)] }),
    model: E('3D 模型', '积木', model, { params: [{ key: 'src', label: '模型', kind: 'model' }, num('h', '高度', .05, 4, .01, 1)] }),
    photoFrame: E('相框', '摆件', photoFrame, { solid: false, params: [{ key: 'photo', label: '照片', kind: 'photo' }, num('w', '宽', .1, .4, .01, .18), num('h', '高', .1, .5, .01, .24), sel('frame', '边框', [['black', '黑'], ['oak', '橡木'], ['walnut', '胡桃木'], ['brass', '黄铜']], 'black')] }),
    mediaConsole: E('电视柜', '柜架', mediaConsole, { params: [{ key: 'photo', label: '电视画面', kind: 'photo' }, num('w', '宽度', 1.2, 3.0, .1, 2.0)] }),
    sideboard: E('边柜', '柜架', sideboard, { params: [num('w', '宽度', 1.2, 2.6, .1, 1.8), selc('color', '柜体', WOODS, 'walnut')] }),
    bed: E('床', '卧室', bed, { params: [num('w', '宽度', .9, 2.0, .1, 1.6), selc('throwColor', '床尾毯', FABRICS, 'terracotta')] }),
    nightstand: E('床头柜', '卧室', nightstand, { params: [selc('color', '柜体', WOODS, 'walnut')] }),
    wardrobe: E('衣柜', '卧室', wardrobe, { params: [num('w', '宽度', .6, 2.4, .05, .95), num('h', '高度', 1.6, 2.6, .05, 2.2), selc('color', '柜体', WOODS, 'oakLight')] }),
    dresser: E('梳妆台', '卧室', dresser, { params: [selc('color', '柜体', WOODS, 'oakLight')] }),
    shoeBench: E('换鞋凳', '柜架', shoeBench, { params: [num('w', '宽度', .6, 1.6, .1, .9)] }),
    coatRack: E('衣帽架', '柜架', coatRack),
    umbrellaStand: E('伞桶', '装饰', umbrellaStand),
    laundryBasket: E('脏衣篮', '卫浴', laundryBasket),
    mailbox: E('信箱', '户外', mailbox),
    stone: E('汀步石', '户外', stone, { solid: false, flat: true, params: [num('r', '大小', .12, .5, .02, .24)] }),
    step: E('台阶', '户外', step, { solid: false, pickable: false, flat: true }),
    kitchenRun: E('橱柜', '厨房', kitchenRun, { params: [num('length', '长度', 1.2, 6, .1, 5), num('sink', '水槽位置', -3, 3, .05, -1.22), num('cooktop', '灶台位置', -3, 3, .05, .98)] }),
    upperCabinet: E('吊柜', '厨房', upperCabinet, { solid: false, mount: 'wall', fixedY: true, params: [num('w', '宽度', .4, 1.6, .02, 1.0)] }),
    rangeHood: E('油烟机', '厨房', rangeHood, { solid: false, mount: 'wall', fixedY: true }),
    wallShelf: E('搁板', '厨房', wallShelf, { solid: false, mount: 'wall', params: [num('w', '宽度', .4, 1.4, .02, .56)] }),
    fridge: E('冰箱', '厨房', fridge),
    kitchenIsland: E('中岛', '厨房', kitchenIsland, { params: [num('w', '长度', 1.2, 3.2, .1, 2.3)] }),
    bathtub: E('浴缸', '卫浴', bathtub, { params: [num('L', '长度', 1.2, 2.0, .05, 1.7)] }),
    toilet: E('马桶', '卫浴', toilet),
    vanity: E('洗手台', '卫浴', vanity, { params: [num('w', '宽度', .5, 1.4, .02, .72)] }),
    shower: E('花洒', '卫浴', shower, { solid: false, mount: 'wall' }),
    towelLadder: E('毛巾架', '卫浴', towelLadder),
    railing: E('栏杆', '阳台', railing, { pickable: false, childColliders: true }),
  };
  void DEG;
  return catalog;
}

export type Catalog = ReturnType<typeof createCatalog>;

/** 书的部件名：层数从上往下数，和人看书架的习惯一致 */
function bookSlotName(slot: string, p: Record<string, any>) {
  const m = /^b:(\d+):(\d+)$/.exec(slot);
  if (!m) return slot;
  const rows = p.rows ?? 5;
  return t('第 {row} 层 · 第 {n} 本', { row: rows - Number(m[1]), n: Number(m[2]) + 1 });
}

/** 目录里某种物件的显示名（已翻译）；目录里没有这种类型时返回类型名 */
export function catalogName(catalog: Record<string, CatalogEntry>, type: string) {
  const name = catalog[type]?.name;
  return name ? t(name) : type;
}

/** 物件某个部件的显示名；'' 表示整件 */
export function slotLabel(catalog: Record<string, CatalogEntry>, item: { type: string; params?: Record<string, any> }, slot: string) {
  if (!slot) return '';
  return catalog[item.type]?.slotName?.(slot, item.params || {}) || slot;
}
