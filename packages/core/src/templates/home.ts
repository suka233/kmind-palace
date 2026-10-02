import { PALACE_FORMAT, PALACE_VERSION, PALACE_COMPAT, gid, type PalaceDoc, type PalaceItem } from '../schema';
import { materializeDecor } from '../decor';
import { t } from '../i18n';
import { roomLabel } from './label';

/* =====================================================================
 * 模板：一套 8 个房间的家（原 prototypes/home-2.5d.html 的数据化版本）
 * ===================================================================== */

type I = Omit<PalaceItem, 'pos'> & { pos: [number, number, number] };
const it = (id: string, type: string, room: string, pos: [number, number, number], extra: Partial<I> = {}): I => ({ id, type, room, pos, ...extra });

/** 物件名是中文原文（模块加载时还不知道语言），新建宫殿时再 t() */
const ITEMS: I[] = [
  // ---------------- 卧室 ----------------
  it('bed-rug', 'rug', 'bedroom', [2.3, 0, 1.95], { name: '卧室地毯', params: { w: 2.6, d: 2.0, pattern: 'bedroom' } }),
  it('bed', 'bed', 'bedroom', [2.3, 0, 1.2], { name: '双人床' }),
  it('nightstand-l', 'nightstand', 'bedroom', [1.1, 0, .33], { name: '左床头柜', params: { side: -1 } }),
  it('nightstand-r', 'nightstand', 'bedroom', [3.5, 0, .33], { name: '右床头柜', params: { side: 1 } }),
  it('wardrobe', 'wardrobe', 'bedroom', [4.45, 0, .41], { name: '衣柜' }),
  it('bed-bench', 'bench', 'bedroom', [2.3, 0, 2.47], { name: '床尾凳' }),
  it('dresser', 'dresser', 'bedroom', [.33, 0, 3.9], { rot: 90, name: '梳妆台' }),
  it('dresser-mirror', 'roundMirror', 'bedroom', [.11, 1.5, 3.9], { rot: 90, wall: 'W', name: '圆镜' }),
  it('art-arch', 'painting', 'bedroom', [1.92, 2.08, .105], { wall: 'N', name: '装饰画 · 拱门', params: { w: .5, h: .66, art: 'arch' } }),
  it('art-botanical', 'painting', 'bedroom', [2.68, 2.08, .105], { wall: 'N', name: '装饰画 · 植物', params: { w: .5, h: .66, art: 'botanical' } }),
  it('bed-snake', 'plant', 'bedroom', [.42, 0, .42], { name: '虎尾兰', params: { kind: 'snake', h: .95, potR: .15, potH: .3, pot: 'potWhite' } }),
  it('bed-plant', 'plant', 'bedroom', [4.6, 0, 3.1], { name: '绿植', params: { kind: 'bush', h: .7, potR: .14, potH: .28 } }),

  // ---------------- 卫生间 ----------------
  it('bathtub', 'bathtub', 'bath', [5.93, 0, .5], { name: '浴缸' }),
  it('vanity', 'vanity', 'bath', [7.15, 0, .34], { name: '洗手台' }),
  it('bath-mirror', 'rectMirror', 'bath', [7.15, 1.6, .105], { wall: 'N', name: '浴室镜' }),
  it('bath-sconce', 'sconce', 'bath', [7.15, 2.1, .1], { wall: 'N' }),
  it('shower', 'shower', 'bath', [5.35, 1.5, .1], { wall: 'N', name: '花洒' }),
  it('toilet', 'toilet', 'bath', [5.4, 0, 2.1], { rot: 90, name: '马桶' }),
  it('towel-ladder', 'towelLadder', 'bath', [7.4, 0, 2.3], { rot: -90, name: '毛巾架' }),
  it('bath-mat', 'rug', 'bath', [5.95, 0, 1.15], { name: '浴室地垫', params: { w: .8, d: .5, pattern: 'bath' } }),
  it('laundry', 'laundryBasket', 'bath', [7.2, 0, 3.1], { name: '脏衣篮' }),
  it('bath-plant', 'plant', 'bath', [5.35, 0, 4.2], { name: '绿植', params: { kind: 'bush', h: .6, potR: .13, potH: .26, pot: 'potGrey' } }),

  // ---------------- 厨房 ----------------
  it('kitchen-run', 'kitchenRun', 'kitchen', [10.22, 0, .41], { name: '橱柜 · 水槽 · 灶台', params: { length: 5, sink: -1.22, cooktop: .98 } }),
  it('upper-1', 'upperCabinet', 'kitchen', [10.22, 1.5, .1], { wall: 'N', name: '吊柜 · 左', params: { w: 1.0 } }),
  it('upper-2', 'upperCabinet', 'kitchen', [12.19, 1.5, .1], { wall: 'N', name: '吊柜 · 右', params: { w: 1.06 } }),
  it('hood', 'rangeHood', 'kitchen', [11.2, 1.5, .1], { wall: 'N', name: '油烟机' }),
  it('open-shelf', 'wallShelf', 'kitchen', [8.04, 1.3, .1], { wall: 'N', name: '开放搁板' }),
  it('herbs', 'herbPots', 'kitchen', [9.0, 1.05, .17], { wall: 'N', name: '窗台香草' }),
  it('fridge', 'fridge', 'kitchen', [13.2, 0, .45], { name: '冰箱' }),
  it('island', 'kitchenIsland', 'kitchen', [10.4, 0, 2.95], { name: '中岛' }),
  it('stool-1', 'stool', 'kitchen', [9.75, 0, 3.78], { name: '吧椅 · 左' }),
  it('stool-2', 'stool', 'kitchen', [10.4, 0, 3.78], { name: '吧椅 · 中' }),
  it('stool-3', 'stool', 'kitchen', [11.05, 0, 3.78], { name: '吧椅 · 右' }),
  it('island-lamp-1', 'pendant', 'kitchen', [9.85, 0, 2.95], { name: '中岛吊灯', params: { r: .15, drop: .85 } }),
  it('island-lamp-2', 'pendant', 'kitchen', [10.95, 0, 2.95], { name: '中岛吊灯', params: { r: .15, drop: .85 } }),

  // ---------------- 客厅 ----------------
  it('living-rug', 'rug', 'living', [2.75, 0, 7.3], { rot: 90, name: '客厅地毯', params: { w: 3.2, d: 2.6, pattern: 'living' } }),
  it('media', 'mediaConsole', 'living', [.33, 0, 7.3], { rot: 90, name: '电视柜 · 电视' }),
  it('slats', 'slatPanel', 'living', [.105, 0, 7.3], { rot: 90, wall: 'W', name: '木格栅墙' }),
  it('sofa', 'sofa', 'living', [4.35, 0, 7.3], { rot: -90, name: '三人沙发', params: { w: 2.4 } }),
  it('coffee-table', 'coffeeTable', 'living', [2.8, 0, 7.3], { name: '圆茶几' }),
  it('armchair', 'armchair', 'living', [2.55, 0, 5.55], { rot: 20, name: '单人椅', params: { fabric: 'mustard' } }),
  it('living-shelf', 'bookshelf', 'living', [1.0, 0, 4.84], { name: '书架', params: { w: 1.3, h: 2.05 } }),
  it('living-lamp', 'floorLamp', 'living', [3.35, 0, 5.08], { name: '落地灯' }),
  it('monstera', 'plant', 'living', [5.0, 0, 5.2], { name: '龟背竹', params: { kind: 'monstera', h: 1.1, potR: .2, potH: .34, pot: 'potWhite' } }),
  it('olive', 'plant', 'living', [.5, 0, 9.45], { name: '橄榄树', params: { kind: 'tree', h: 1.9, potR: .22, potH: .4, pot: 'pot' } }),
  it('side-table', 'sideTable', 'living', [4.4, 0, 8.85], { name: '边几 · 台灯', params: { lamp: 'sage' } }),
  it('art-mountain', 'painting', 'living', [.105, 1.75, 5.35], { rot: 90, wall: 'W', name: '装饰画 · 远山', params: { w: .46, h: .6, art: 'mountain' } }),
  it('art-lines', 'painting', 'living', [.105, 1.75, 9.3], { rot: 90, wall: 'W', name: '装饰画 · 线条', params: { w: .46, h: .6, art: 'lines' } }),
  it('cat', 'cat', 'living', [2.0, 0, 8.35], { rot: 30, name: '橘猫 · 团子' }),

  // ---------------- 餐厅 ----------------
  it('dining-rug', 'rug', 'dining', [8.3, 0, 7.3], { name: '餐厅地毯', params: { w: 2.4, d: 3.1, pattern: 'jute' } }),
  it('dining-table', 'diningTable', 'dining', [8.3, 0, 7.3], { rot: 90, name: '餐桌' }),
  it('chair-w1', 'chair', 'dining', [7.55, 0, 6.85], { rot: 90, name: '餐椅 · 西 1' }),
  it('chair-w2', 'chair', 'dining', [7.55, 0, 7.75], { rot: 90, name: '餐椅 · 西 2' }),
  it('chair-e1', 'chair', 'dining', [9.05, 0, 6.85], { rot: -90, name: '餐椅 · 东 1' }),
  it('chair-e2', 'chair', 'dining', [9.05, 0, 7.75], { rot: -90, name: '餐椅 · 东 2' }),
  it('chair-n', 'chair', 'dining', [8.3, 0, 6.0], { name: '餐椅 · 北' }),
  it('chair-s', 'chair', 'dining', [8.3, 0, 8.6], { rot: 180, name: '餐椅 · 南' }),
  it('dining-lamp', 'pendant', 'dining', [8.3, 0, 7.3], { name: '餐厅吊灯', params: { r: .3, drop: .95, finish: 'brass' } }),
  it('sideboard', 'sideboard', 'dining', [6.64, 0, 6.9], { rot: 90, name: '边柜' }),
  it('fiddle', 'plant', 'dining', [9.8, 0, 9.55], { name: '琴叶榕', params: { kind: 'tree', h: 1.6, potR: .2, potH: .38, pot: 'potGrey' } }),
  it('dining-plant', 'plant', 'dining', [6.65, 0, 8.35], { name: '绿植', params: { kind: 'bush', h: .8, potR: .16, potH: .32, pot: 'pot' } }),

  // ---------------- 玄关 ----------------
  it('shoe-bench', 'shoeBench', 'hall', [13.7, 0, 3.65], { rot: -90, name: '换鞋凳' }),
  it('coat-rack', 'coatRack', 'hall', [13.6, 0, 4.45], { name: '衣帽架' }),
  it('umbrella', 'umbrellaStand', 'hall', [13.2, 0, 5.52], { name: '伞桶' }),
  it('door-mat', 'rug', 'hall', [13.4, 0, 5.2], { rot: 90, name: '入户地垫', params: { w: .9, d: .6, pattern: 'jute' } }),

  // ---------------- 书房 ----------------
  it('study-rug', 'rug', 'study', [12.0, 0, 8.1], { name: '书房地毯', params: { w: 2.6, d: 2.0, pattern: 'study' } }),
  it('study-shelf-l', 'bookshelf', 'study', [10.43, 0, 7.55], { rot: 90, name: '书架 · 左', params: { w: 1.2, h: 1.36, rows: 3, wood: 'walnut' } }),
  it('study-shelf-r', 'bookshelf', 'study', [10.43, 0, 8.77], { rot: 90, name: '书架 · 右', params: { w: 1.2, h: 1.36, rows: 3, wood: 'walnut' } }),
  it('shelf-plant', 'plant', 'study', [10.45, 1.36, 7.2], { name: '小盆栽', solid: false, params: { kind: 'bush', h: .36, potR: .08, potH: .13, pot: 'terracotta' } }),
  it('shelf-pampas', 'plant', 'study', [10.45, 1.36, 9.1], { name: '干花', solid: false, params: { kind: 'pampas', h: .6, potR: .06, potH: .2, pot: 'ceramic' } }),
  it('art-sea', 'painting', 'study', [10.29, 1.95, 8.2], { rot: 90, wall: 'I5', name: '装饰画 · 海', params: { w: .6, h: .45, art: 'sea' } }),
  it('desk', 'desk', 'study', [12.7, 0, 6.22], { name: '书桌' }),
  it('office-chair', 'officeChair', 'study', [12.7, 0, 6.95], { rot: 180, name: '办公椅' }),
  it('reading-chair', 'armchair', 'study', [13.15, 0, 9.2], { rot: -140, name: '阅读椅', params: { fabric: 'navy', wood: 'walnut' } }),
  it('reading-lamp', 'floorLamp', 'study', [13.6, 0, 9.62], { name: '阅读灯', params: { shade: 'warm' } }),
  it('globe', 'globeTable', 'study', [12.3, 0, 9.5], { name: '地球仪' }),
  it('study-plant', 'plant', 'study', [13.62, 0, 6.75], { name: '绿植', params: { kind: 'tree', h: 1.5, potR: .18, potH: .34, pot: 'potWhite' } }),

  // ---------------- 阳台 ----------------
  it('railing', 'railing', 'balcony', [0, 0, 0], { name: '玻璃栏杆', params: { segments: [[.45, 11.55, 5.95, 11.55], [.45, 10.12, .45, 11.55], [5.95, 10.12, 5.95, 11.55]] } }),
  it('outdoor-rug', 'rug', 'balcony', [4.35, 0, 10.9], { name: '户外地毯', params: { w: 2.0, d: 1.0, pattern: 'outdoor' } }),
  it('lounge-1', 'loungeChair', 'balcony', [3.55, 0, 10.9], { rot: 90, name: '休闲椅 · 左' }),
  it('lounge-2', 'loungeChair', 'balcony', [5.2, 0, 10.9], { rot: -90, name: '休闲椅 · 右' }),
  it('bistro', 'sideTable', 'balcony', [4.35, 0, 10.9], { name: '小圆桌', params: { r: .22, h: .45, top: 'oak', cup: true } }),
  it('lemon', 'plant', 'balcony', [.85, 0, 11.2], { name: '柠檬树', params: { kind: 'tree', h: 1.5, potR: .2, potH: .4, pot: 'pot' } }),
  it('planter', 'planter', 'balcony', [1.95, 0, 11.35], { name: '花槽', params: { w: 1.4 } }),
  it('string-lights', 'stringLights', 'balcony', [0, 0, 0], { name: '串灯', params: { from: [.5, 11.5], to: [5.9, 11.5] } }),

  // ---------------- 庭院 ----------------
  it('tree-sw', 'tree', 'garden', [-.5, -.15, 12.7], { name: '大树 · 西南', params: { h: 3.4, variant: 0 } }),
  it('tree-ne', 'tree', 'garden', [15.0, -.15, -.6], { name: '大树 · 东北', params: { h: 3.8, variant: 1 } }),
  it('tree-nw', 'tree', 'garden', [-.7, -.15, -.6], { name: '小树', params: { h: 2.6, variant: 2 } }),
  ...([[7.4, 12.9, .45], [8.4, 13.1, .35], [9.4, 12.95, .5], [12.4, 13.0, .42], [13.4, 12.9, .38], [15.0, 12.2, .5], [15.0, 2.2, .4], [-.8, 5.0, .45], [-.8, 7.8, .4]] as [number, number, number][])
    .map(([x, z, r], i) => it(`bush-${i + 1}`, 'bush', 'garden', [x, -.15, z], { rot: (i * 67) % 360, params: { r } })),
  it('step', 'step', 'garden', [14.35, -.15, 5.2], { params: { w: .5, d: 1.2, h: .12 } }),
  it('stone-1', 'stone', 'garden', [14.85, -.15, 5.1]),
  it('stone-2', 'stone', 'garden', [15.15, -.15, 4.55]),
  it('stone-3', 'stone', 'garden', [14.9, -.15, 3.95]),
  it('lamp-post', 'lampPost', 'garden', [14.95, -.15, 6.3], { name: '庭院灯' }),
  it('mailbox', 'mailbox', 'garden', [15.1, -.15, 7.4], { name: '信箱' }),
];

export function createHomePalace(name = t('我的家')): PalaceDoc {
  const now = Date.now();
  const doc: PalaceDoc = {
    format: PALACE_FORMAT,
    version: PALACE_VERSION,
    compat: PALACE_COMPAT,
    id: gid('palace-'),
    name,
    createdAt: now,
    updatedAt: now,
    wallHeight: 2.8,
    ground: {
      plinth: [-1.5, -1.6, 15.5, 13.8],
      slabs: [[-.1, -.1, 14.1, 10.1], [.4, 10, 6, 11.6]],
    },
    rooms: [
      { id: 'bedroom', ...roomLabel('卧室', 'Bedroom'), rect: [0, 0, 5, 4.6], floor: 'oak', label: [.9, 3.7] },
      { id: 'bath', ...roomLabel('卫生间', 'Bath'), rect: [5, 0, 7.6, 4.6], floor: 'tileBath', label: [6.3, 3.0] },
      { id: 'kitchen', ...roomLabel('厨房', 'Kitchen'), rect: [7.6, 0, 14, 4.6], floor: 'tileLarge', label: [8.5, 4.1] },
      { id: 'living', ...roomLabel('客厅', 'Living'), rect: [0, 4.6, 6.4, 10], floor: 'oak', label: [1.6, 9.4] },
      { id: 'dining', ...roomLabel('餐厅', 'Dining'), rect: [6.4, 4.6, 10.2, 10], floor: 'oak', label: [8.3, 9.45] },
      { id: 'hall', ...roomLabel('玄关', 'Entry'), rect: [10.2, 4.6, 14, 5.8], floor: 'cement', label: [11.6, 5.2] },
      { id: 'study', ...roomLabel('书房', 'Study'), rect: [10.2, 5.8, 14, 10], floor: 'oakWarm', label: [11.3, 9.45] },
      { id: 'balcony', ...roomLabel('阳台', 'Balcony'), rect: [.4, 10, 6, 11.6], floor: 'deck', label: [1.3, 11.05], outdoor: true },
      { id: 'garden', ...roomLabel('庭院', 'Garden'), rect: [-1.5, -1.6, 15.5, 13.8], label: null, outdoor: true },
    ],
    walls: [
      {
        id: 'N', a: [0, 0], b: [14, 0], thickness: .2, normal: [0, -1],
        openings: [
          { s0: 5.55, s1: 6.45, y0: 1.35, y1: 2.15, kind: 'window' },
          { s0: 8.4, s1: 9.6, y0: 1.05, y1: 2.2, kind: 'window' },
        ],
        paint: [
          { side: 1, s0: .1, s1: 4.94, color: '#b9c2b0' },
          { side: 1, s0: 5.06, s1: 7.54, texture: 'bathWall', tile: .6 },
          { side: 1, s0: 7.66, s1: 12.75, y0: .9, y1: 1.5, texture: 'subway', tile: .6 },
        ],
      },
      {
        id: 'W', a: [0, 0], b: [0, 10], thickness: .2, normal: [-1, 0],
        openings: [{ s0: 1.3, s1: 3.1, y0: .55, y1: 2.35, kind: 'window', curtain: true, curtainColor: '#e4d8c4' }],
        paint: [{ side: 1, s0: 4.66, s1: 9.9, color: '#e6dccd' }],
      },
      {
        id: 'E', a: [14, 0], b: [14, 10], thickness: .2, normal: [1, 0],
        openings: [
          { s0: 1.4, s1: 3.0, y0: 1.0, y1: 2.2, kind: 'window' },
          { s0: 4.75, s1: 5.65, y0: 0, y1: 2.15, kind: 'front' },
          { s0: 7.2, s1: 8.8, y0: .8, y1: 2.25, kind: 'window', curtain: true, curtainColor: '#c9d3d6' },
        ],
      },
      {
        id: 'S', a: [0, 10], b: [14, 10], thickness: .2, normal: [0, 1],
        openings: [
          { s0: 1.0, s1: 5.2, y0: 0, y1: 2.35, kind: 'slide', curtain: true },
          { s0: 7.4, s1: 9.2, y0: .8, y1: 2.25, kind: 'window', curtain: true, curtainColor: '#e4d8c4' },
          { s0: 11.3, s1: 13.0, y0: .8, y1: 2.25, kind: 'window' },
        ],
      },
      {
        id: 'I1', a: [0, 4.6], b: [7.66, 4.6],
        openings: [
          { s0: 3.65, s1: 4.5, y0: 0, y1: 2.1, kind: 'door', swing: -1 },
          { s0: 6.6, s1: 7.35, y0: 0, y1: 2.1, kind: 'door', swing: -1 },
        ],
        paint: [{ side: 1, s0: .1, s1: 6.4, color: '#e6dccd' }],
      },
      { id: 'I2', a: [5, 0], b: [5, 4.66] },
      { id: 'I3', a: [7.6, 0], b: [7.6, 4.66] },
      { id: 'I4', a: [10.14, 5.8], b: [14, 5.8], openings: [{ s0: 10.45, s1: 11.3, y0: 0, y1: 2.1, kind: 'door', swing: 1 }] },
      { id: 'I5', a: [10.2, 5.74], b: [10.2, 10], paint: [{ side: 1, s0: 5.86, s1: 9.9, color: '#6f8075' }] },
    ],
    items: ITEMS.map(i => ({ ...i, ...(i.name ? { name: t(i.name) } : {}), pos: [...i.pos] as [number, number, number] })),
  };
  materializeDecor(doc.items);
  return doc;
}
