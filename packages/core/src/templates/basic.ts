import { PALACE_FORMAT, PALACE_VERSION, PALACE_COMPAT, uid, gid, type PalaceDoc, type PalaceItem, type Rect } from '../schema';
import * as st from '../structure';
import { createHomePalace } from './home';
import { materializeDecor } from '../decor';
import { t } from '../i18n';
import { roomLabel } from './label';

/* =====================================================================
 * 新建宫殿用的模板：小屋 / 两居室 / 长廊 / 我的家
 * 结构都用结构编辑的纯数据操作生成，保证和手动搭出来的宫殿完全一致。
 * ===================================================================== */

export interface PalaceTemplate {
  id: string;
  name: string;
  /** name / desc 是中文原文（模块加载时还不知道语言），显示时用 t() */
  desc: string;
  create(name: string): PalaceDoc;
}

function blank(name: string): PalaceDoc {
  const now = Date.now();
  return { format: PALACE_FORMAT, version: PALACE_VERSION, compat: PALACE_COMPAT, id: gid('palace-'), name, createdAt: now, updatedAt: now, wallHeight: 2.8, rooms: [], walls: [], items: [] };
}

const wallAt = (d: PalaceDoc, axis: 'x' | 'z', c: number, s: number) =>
  d.walls.find(w => { const L = st.wallLine(w); return L.axis === axis && Math.abs(L.c - c) < .02 && s > L.lo && s < L.hi; });

function opening(d: PalaceDoc, axis: 'x' | 'z', c: number, s: number, kind: 'window' | 'door' | 'front' | 'slide', patch: Partial<{ s0: number; s1: number; curtain: boolean; swing: 1 | -1 }> = {}) {
  const w = wallAt(d, axis, c, s);
  if (!w) return;
  const i = st.addOpening(d, w, kind, s);
  if (i >= 0 && Object.keys(patch).length) st.updateOpening(w, i, patch);
}

function item(d: PalaceDoc, type: string, room: string, pos: [number, number, number], rot = 0, params?: Record<string, any>, name?: string) {
  const it: PalaceItem = { id: uid(type + '-'), type, room, pos, rot };
  if (params) it.params = params;
  if (name) it.name = t(name);
  d.items.push(it);
}

/** 地基 = 房间外扩 1.4 m，外加一块覆盖地基的庭院（与「我的家」模板一致） */
function finish(d: PalaceDoc) {
  st.computeWallNormals(d);
  const rs = d.rooms.filter(r => r.floor).map(r => r.rect);
  const plinth: Rect = [
    Math.min(...rs.map(r => r[0])) - 1.4, Math.min(...rs.map(r => r[1])) - 1.4,
    Math.max(...rs.map(r => r[2])) + 1.4, Math.max(...rs.map(r => r[3])) + 1.4,
  ];
  d.ground = { plinth, slabs: [] };
  d.rooms.push({ id: 'garden', ...roomLabel('庭院', 'Garden'), rect: [...plinth] as Rect, label: null, outdoor: true });
  return d;
}

function cottage(name: string) {
  const d = blank(name);
  const r = st.addRoom(d, [0, 0, 6, 5], true);
  Object.assign(r, { id: 'living', ...roomLabel('起居室', 'Living') });
  st.computeWallNormals(d);
  opening(d, 'x', 5, 4.2, 'front');
  opening(d, 'x', 0, 3, 'window', { curtain: true });
  opening(d, 'z', 0, 2.5, 'window');
  opening(d, 'z', 6, 2.5, 'window');
  item(d, 'rug', 'living', [2.6, 0, 2.6], 0, { w: 2.6, d: 1.9, pattern: 'living' }, '地毯');
  item(d, 'sofa', 'living', [2.6, 0, 3.9], 180, { w: 2.0, fabric: 'sage' }, '沙发');
  item(d, 'coffeeTable', 'living', [2.6, 0, 2.5], 0, undefined, '茶几');
  item(d, 'bookshelf', 'living', [1.2, 0, .3], 0, { w: 1.2, h: 1.9 }, '书架');
  item(d, 'desk', 'living', [4.6, 0, .45], 0, { w: 1.2 }, '书桌');
  item(d, 'officeChair', 'living', [4.6, 0, 1.2], 180, undefined, '椅子');
  item(d, 'floorLamp', 'living', [.5, 0, 4.4], 0, undefined, '落地灯');
  item(d, 'plant', 'living', [5.5, 0, 4.4], 0, { kind: 'monstera', h: 1.1, potR: .2, potH: .34, pot: 'potWhite' }, '绿植');
  return finish(d);
}

function twoRooms(name: string) {
  const d = blank(name);
  const a = st.addRoom(d, [0, 0, 5, 6], true);
  Object.assign(a, { id: 'study', ...roomLabel('书房', 'Study'), floor: 'oakWarm' });
  const b = st.addRoom(d, [5, 0, 9, 6], true);
  Object.assign(b, { id: 'bedroom', ...roomLabel('卧室', 'Bedroom') });
  st.computeWallNormals(d);
  opening(d, 'z', 5, 3.4, 'door');
  opening(d, 'x', 6, 2.5, 'front');
  opening(d, 'x', 0, 2.5, 'window');
  opening(d, 'x', 0, 7, 'window', { curtain: true });
  opening(d, 'z', 0, 3, 'window');
  opening(d, 'z', 9, 3, 'window');
  item(d, 'bookshelf', 'study', [1.3, 0, .3], 0, { w: 1.4, h: 2.0, wood: 'walnut' }, '书架');
  item(d, 'desk', 'study', [3.6, 0, .45], 0, { w: 1.3 }, '书桌');
  item(d, 'officeChair', 'study', [3.6, 0, 1.2], 180, undefined, '椅子');
  item(d, 'rug', 'study', [2.4, 0, 3.4], 0, { w: 2.6, d: 2.0, pattern: 'study' }, '地毯');
  item(d, 'armchair', 'study', [1.0, 0, 4.8], 40, { fabric: 'navy', wood: 'walnut' }, '阅读椅');
  item(d, 'floorLamp', 'study', [.45, 0, 5.5], 0, { shade: 'warm' }, '落地灯');
  item(d, 'bed', 'bedroom', [7.2, 0, 1.2], 0, { w: 1.5 }, '床');
  item(d, 'nightstand', 'bedroom', [6.1, 0, .33], 0, { side: -1 }, '床头柜');
  item(d, 'rug', 'bedroom', [7.2, 0, 2.4], 0, { w: 2.2, d: 1.6, pattern: 'bedroom' }, '卧室地毯');
  item(d, 'wardrobe', 'bedroom', [8.5, 0, 4.4], -90, { w: 1.2 }, '衣柜');
  item(d, 'plant', 'bedroom', [5.6, 0, 5.4], 0, { kind: 'snake', h: .9, potR: .15, potH: .3 }, '虎尾兰');
  return finish(d);
}

function gallery(name: string) {
  const d = blank(name);
  const names = ['第一厅', '第二厅', '第三厅', '第四厅'];
  const floors = ['oakWarm', 'cement', 'oakWarm', 'tileLarge'] as const;
  const arts = ['mountain', 'sea', 'botanical', 'arch'];
  const W = 4.6;
  for (let i = 0; i < 4; i++) {
    const r = st.addRoom(d, [i * W, 0, (i + 1) * W, 6], true);
    Object.assign(r, { id: 'hall-' + (i + 1), ...roomLabel(names[i], `Hall ${i + 1}`), floor: floors[i] });
  }
  st.computeWallNormals(d);
  for (let i = 0; i < 4; i++) {
    const x0 = i * W;
    if (i) opening(d, 'z', x0, 3, 'door', { s0: 2.3, s1: 3.7 });
    opening(d, 'x', 0, x0 + W / 2, 'window');
    const nWall = wallAt(d, 'x', 0, x0 + 1);
    d.items.push({ id: uid('painting-'), type: 'painting', room: 'hall-' + (i + 1), pos: [x0 + 1.2, 1.7, .105], rot: 0, params: { art: arts[i], w: .6, h: .8 }, wall: nWall?.id, name: t('展墙画作') });
    item(d, 'bench', 'hall-' + (i + 1), [x0 + W / 2, 0, 3.3], 0, { w: 1.4 }, '长凳');
    item(d, 'rug', 'hall-' + (i + 1), [x0 + W / 2, 0, 3.3], 0, { w: 3.0, d: 2.2, pattern: i % 2 ? 'jute' : 'study' }, '地毯');
    item(d, 'sideboard', 'hall-' + (i + 1), [x0 + W / 2, 0, 5.65], 180, { w: 1.6 }, '展柜');
    item(d, 'plant', 'hall-' + (i + 1), [x0 + .5, 0, 5.4], 0, { kind: i % 2 ? 'snake' : 'bush', h: .9, potR: .15, potH: .3 }, '绿植');
  }
  opening(d, 'x', 6, W / 2, 'front');
  return finish(d);
}

export const TEMPLATES: PalaceTemplate[] = [
  { id: 'cottage', name: '小屋', desc: '一个房间 · 适合一个小主题', create: cottage },
  { id: 'twoRooms', name: '两居室', desc: '书房 + 卧室', create: twoRooms },
  { id: 'gallery', name: '长廊', desc: '四个展厅连成一线，适合按顺序记忆', create: gallery },
  { id: 'home', name: '我的家', desc: '八个房间的完整住宅', create: (name) => createHomePalace(name) },
];

export function createFromTemplate(id: string, name: string) {
  const d = (TEMPLATES.find(t => t.id === id) || TEMPLATES[0]).create(name);
  materializeDecor(d.items);
  return d;
}
