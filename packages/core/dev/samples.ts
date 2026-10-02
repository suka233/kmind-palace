// dev-only：演示用的几座宫殿（小镇里的邻居）
import { uid, gid, setBinding, isZh, PALACE_VERSION, PALACE_COMPAT, type PalaceDoc, type PalaceItem } from '../src';

/** 演示数据按界面语言给中文或英文（playground 专用，不走字典） */
export const L = <T,>(zh: T, en: T): T => (isZh() ? zh : en);
/** 房间名：中文界面「名字 + 英文小字」，英文界面只用英文 */
const room = (zh: string, en: string) => (isZh() ? { name: zh, en } : { name: en });
import { materializeDecor } from '../src/decor';
import * as st from '../src/structure';

const H = 2.8;
const blank = (id: string): PalaceDoc => {
  const now = Date.now();
  return { format: 'kmind-palace', version: PALACE_VERSION, compat: PALACE_COMPAT, id: gid('palace-'), name: id, createdAt: now, updatedAt: now, wallHeight: H, rooms: [], walls: [], items: [] };
};
const findWall = (d: PalaceDoc, axis: 'x' | 'z', c: number, s: number) => d.walls.find(w => { const L = st.wallLine(w); return L.axis === axis && Math.abs(L.c - c) < .02 && s > L.lo && s < L.hi; });

function item(d: PalaceDoc, type: string, pos: [number, number, number], rot = 0, params?: any, extra: Partial<PalaceItem> = {}) {
  const it: PalaceItem = { id: uid(type + '-'), type, pos, rot, params, ...extra };
  d.items.push(it);
  return it;
}

// ---------------- 几座宫殿 ----------------
function mkApt() {
  const d = blank('apt');
  const r = st.addRoom(d, [0, 0, 7.2, 5.6], true); Object.assign(r, room('开间', 'Studio'));
  st.computeWallNormals(d);
  st.addOpening(d, findWall(d, 'x', 0, 4), 'window', 4.6);
  st.addOpening(d, findWall(d, 'z', 0, 3), 'window', 3.6);
  st.addOpening(d, findWall(d, 'x', 5.6, 3), 'front', 6.1);
  st.addOpening(d, findWall(d, 'z', 7.2, 3), 'window', 3.2);
  st.setFacePaint(findWall(d, 'x', 0, 2), 1, .1, 3.2, { color: '#b9c2b0' });
  item(d, 'rug', [1.7, 0, 1.9], 0, { w: 2.4, d: 1.8, pattern: 'bedroom' });
  item(d, 'bed', [1.7, 0, 1.2], 0, { w: 1.5 });
  item(d, 'nightstand', [.55, 0, .33], 0, { side: -1 });
  item(d, 'rug', [4.9, 0, 3.6], 0, { w: 2.4, d: 1.8, pattern: 'living' });
  item(d, 'sofa', [4.9, 0, 4.9], 180, { w: 2.0, fabric: 'sage' });
  item(d, 'coffeeTable', [4.9, 0, 3.5]);
  item(d, 'bookshelf', [4.1, 0, .3], 0, { w: 1.0, h: 1.8 });
  item(d, 'desk', [6.2, 0, .45], 0, { w: 1.2 });
  item(d, 'officeChair', [6.2, 0, 1.2], 180);
  item(d, 'plant', [6.8, 0, 3.0], 0, { kind: 'monstera', h: 1.1, potR: .2, potH: .34, pot: 'potWhite' });
  item(d, 'floorLamp', [3.3, 0, 5.1]);
  item(d, 'cat', [2.6, 0, 3.0], 40);
  return d;
}

function mkRust() {
  const d = blank('rust');
  const a = st.addRoom(d, [0, 0, 5, 6], true); Object.assign(a, { floor: 'oakWarm', ...room('书房', 'Study') });
  const b = st.addRoom(d, [5, 0, 8.4, 6], true); Object.assign(b, { floor: 'tileLarge', ...room('茶室', 'Tea room') });
  st.computeWallNormals(d);
  st.addOpening(d, findWall(d, 'z', 5, 3), 'door', 3.2);
  st.addOpening(d, findWall(d, 'x', 6, 6.7), 'front', 6.7);
  st.addOpening(d, findWall(d, 'x', 0, 2.5), 'window', 2.5);
  st.addOpening(d, findWall(d, 'z', 0, 3), 'window', 3.2);
  st.setFacePaint(findWall(d, 'x', 0, 2), 1, .1, 4.94, { color: '#6f8075' });
  // 书架上的书单独绑定（部件编号 b:层:序号，层从下往上数）
  const shelf = item(d, 'bookshelf', [1.0, 0, .3], 0, { w: 1.2, h: 2.0, wood: 'walnut' });
  const books: [string, string][] = L([['b:4:0', '第 4 章 · 所有权'], ['b:4:3', '第 10 章 · 泛型与 trait'], ['b:3:2', '第 16 章 · 无畏并发']], [['b:4:0', 'Ch. 4 · Ownership'], ['b:4:3', 'Ch. 10 · Generics & traits'], ['b:3:2', 'Ch. 16 · Fearless concurrency']]);
  books.forEach(([slot, title], i) => setBinding(shelf, slot, { blockId: `20260930${200000 + i}-rustbook${i}fake`, title, boundAt: Date.now() }));
  // 书架 = 笔记本：摆的是「Rust 学习」里的文档
  item(d, 'bookshelf', [3.8, 0, .3], 0, { w: 1.2, h: 2.0, wood: 'walnut', source: { box: 'nb-rust', path: '/', name: L('Rust 学习', 'Learning Rust') } }, { name: L('笔记书架', 'Notebook shelf') });
  item(d, 'rug', [2.5, 0, 3.4], 0, { w: 2.6, d: 2.0, pattern: 'study' });
  const desk = item(d, 'desk', [2.5, 0, 2.2], 180, { w: 1.4 });
  // 放在书桌上的台灯：挂在书桌下面，随书桌移动
  item(d, 'tableLamp', [.52, .755, -.12], 0, { base: 'sage' }, { parent: desk.id });
  item(d, 'officeChair', [2.5, 0, 1.4], 0);
  item(d, 'armchair', [1.0, 0, 4.9], 40, { fabric: 'navy', wood: 'walnut' });
  item(d, 'floorLamp', [.45, 0, 5.5], 0, { shade: 'warm' });
  item(d, 'globeTable', [4.3, 0, 5.3]);
  item(d, 'coffeeTable', [6.7, 0, 3.0]);
  item(d, 'chair', [6.7, 0, 2.2]);
  item(d, 'chair', [6.7, 0, 3.8], 180);
  item(d, 'plant', [8.0, 0, .45], 0, { kind: 'tree', h: 1.5, potR: .18, potH: .34, pot: 'potWhite' });
  item(d, 'sideboard', [8.15, 0, 3.4], -90, { w: 1.4 });
  return d;
}

function mkHistory() {
  const d = blank('history');
  const names = L(['先秦', '汉唐', '宋元', '明清'], ['Antiquity', 'Middle Ages', 'Renaissance', 'Modern era']);
  const floors = ['oakWarm', 'cement', 'oakWarm', 'tileLarge'] as const;
  for (let i = 0; i < 4; i++) { const r = st.addRoom(d, [i * 4.6, 0, (i + 1) * 4.6, 6], true); r.floor = floors[i]; r.name = names[i]; }
  st.computeWallNormals(d);
  const arts = ['mountain', 'sea', 'botanical', 'arch'];
  for (let i = 0; i < 4; i++) {
    const x0 = i * 4.6;
    if (i) { const w = findWall(d, 'z', x0, 3); const idx = st.addOpening(d, w, 'door', 3); st.updateOpening(w, idx, { s0: 2.3, s1: 3.7 }); }
    st.addOpening(d, findWall(d, 'x', 0, x0 + 2.3), 'window', x0 + 2.3);
    item(d, 'painting', [x0 + 1.1, 1.7, .105], 0, { art: arts[i], w: .6, h: .8 }, { wall: findWall(d, 'x', 0, x0 + 1).id });
    item(d, 'bench', [x0 + 2.3, 0, 3.4], 0, { w: 1.4 });
    item(d, 'rug', [x0 + 2.3, 0, 3.4], 0, { w: 3.0, d: 2.2, pattern: i % 2 ? 'jute' : 'study' });
    item(d, 'sideboard', [x0 + 2.3, 0, 5.65], 180, { w: 1.6 });
    item(d, 'plant', [x0 + .5, 0, 5.4], 0, { kind: i % 2 ? 'snake' : 'bush', h: .9, potR: .15, potH: .3 });
    item(d, 'floorLamp', [x0 + 4.1, 0, .5], 0, { shade: 'warm' });
  }
  st.addOpening(d, findWall(d, 'x', 6, 9.2), 'front', 9.2);
  st.setFacePaint(findWall(d, 'x', 0, 5), 1, 0, 18.4, { color: '#dcc0b2' });
  return d;
}

function mkRoots() {
  const d = blank('roots');
  const a = st.addRoom(d, [0, 0, 6, 8], true); Object.assign(a, room('客厅', 'Living room'));
  const b = st.addRoom(d, [6, 0, 10.5, 4.4], true); Object.assign(b, room('卧室', 'Bedroom'));
  const c = st.addRoom(d, [6, 4.4, 10.5, 8], true); Object.assign(c, { floor: 'tileBath', ...room('浴室', 'Bathroom') });
  st.computeWallNormals(d);
  st.addOpening(d, findWall(d, 'z', 6, 2), 'door', 2.2);
  st.addOpening(d, findWall(d, 'z', 6, 6), 'door', 6.2);
  st.addOpening(d, findWall(d, 'x', 8, 3), 'slide', 3);
  st.addOpening(d, findWall(d, 'x', 0, 3), 'window', 3);
  st.addOpening(d, findWall(d, 'x', 0, 8.3), 'window', 8.3);
  st.setFacePaint(findWall(d, 'x', 0, 2), 1, .1, 5.94, { color: '#aebac0' });
  item(d, 'mediaConsole', [.33, 0, 4], 90, { w: 1.8 });
  item(d, 'rug', [2.8, 0, 4], 90, { w: 3.0, d: 2.4, pattern: 'living' });
  item(d, 'sofa', [4.6, 0, 4], -90, { w: 2.2, fabric: 'navy', pillows: ['mustard', 'cushion'] });
  item(d, 'coffeeTable', [2.8, 0, 4]);
  item(d, 'bookshelf', [1.2, 0, .3], 0, { w: 1.4, h: 2.0 });
  item(d, 'plant', [.5, 0, 7.4], 0, { kind: 'tree', h: 1.8, potR: .2, potH: .38 });
  item(d, 'diningTable', [3.4, 0, 1.6], 0, { w: 1.4, d: .8 });
  item(d, 'bed', [8.25, 0, 1.15], 0, { w: 1.6, throwColor: 'mustard' });
  item(d, 'nightstand', [7.1, 0, .33], 0, { side: -1 });
  item(d, 'wardrobe', [10.0, 0, 2.6], -90, { w: 1.2 });
  item(d, 'bathtub', [8.3, 0, 7.55], 180);
  item(d, 'vanity', [6.5, 0, 5.1], 90);
  item(d, 'toilet', [10.1, 0, 5.2], -90);
  return d;
}


/** 演示笔记的正文（回忆揭晓时显示），按块 id */
export const SAMPLE_NOTES = new Map<string, { title: string; body: string }>();

/** 给前几个物件绑上假的笔记块，让名牌上的记忆桩数量有意义；「标题 :: 正文」会登记成演示笔记 */
function bindSome(d: PalaceDoc, titles: string[]) {
  const cands = d.items.filter(i => !['rug', 'painting'].includes(i.type));
  titles.forEach((raw, i) => {
    const [t, body] = raw.split(' :: ');
    const it = cands[i % cands.length];
    const blockId = `20260930${String(100000 + i)}-${d.name.length}${i}fake`;
    if (body) SAMPLE_NOTES.set(blockId, { title: t, body });
    if (it) setBinding(it, '', { blockId, title: t, boundAt: Date.now() });
  });
}

export function samplePalaces(): PalaceDoc[] {
  const roots = Object.assign(mkRoots(), { name: L('英语词根宫殿', 'Latin Roots Palace'), color: '#3e4d66' });
  bindSome(roots, L(['spect = 看', 'port = 拿、运', 'dict = 说', 'duct = 引导', 'scrib = 写', 'mit = 送', 'fer = 带来', 'struct = 建造'],
    ['spect = look', 'port = carry', 'dict = say', 'duct = lead', 'scrib = write', 'mit = send', 'fer = bring', 'struct = build']));
  const rust = Object.assign(mkRust(), { name: L('Rust 书房', 'Rust Study'), color: '#6d4a3a' });
  bindSome(rust, L([
    '所有权三原则 :: 每个值都有一个所有者；同一时刻只能有一个所有者；所有者离开作用域，值就被丢弃。',
    '生命周期与借用 :: 引用不能比它指向的值活得更久；编译器用生命周期标注检查这一点。',
    'trait 与泛型 :: trait 定义一组共同行为，泛型函数用 trait bound 约束参数必须实现它。',
    '错误处理：Result :: 可恢复的错误用 Result<T, E>，? 运算符把错误往上传。',
    '智能指针 Box / Rc :: Box 把值放到堆上；Rc 用引用计数让多个所有者共享同一个值。',
  ], [
    'Three rules of ownership :: Each value has one owner; there is only one owner at a time; when the owner goes out of scope, the value is dropped.',
    'Lifetimes & borrowing :: A reference must never outlive the value it points to — lifetimes let the compiler check that.',
    'Traits & generics :: A trait defines shared behavior; generic functions use trait bounds to require it.',
    'Error handling: Result :: Recoverable errors use Result<T, E>; the ? operator passes errors up the call stack.',
    'Smart pointers Box / Rc :: Box puts a value on the heap; Rc shares one value between several owners with reference counting.',
  ]));
  const apt = Object.assign(mkApt(), { name: L('小公寓 · 考研政治', 'Studio · Psychology 101'), color: '#b8563c' });
  bindSome(apt, L(['唯物辩证法', '认识论', '剩余价值'], ['Classical conditioning', 'Cognitive dissonance', 'Maslow\'s hierarchy']));
  const history = Object.assign(mkHistory(), { name: L('中国历史长廊', 'History Gallery'), color: '#5f7a6c' });
  bindSome(history, L(['商鞅变法', '贞观之治', '王安石变法', '郑和下西洋', '戊戌变法', '洋务运动'],
    ['Code of Hammurabi', 'Fall of Rome', 'Magna Carta', 'Printing press', 'French Revolution', 'Industrial Revolution']));
  for (const d of [roots, rust, apt, history]) { st.computeWallNormals(d); materializeDecor(d.items); }
  return [roots, rust, apt, history];
}
