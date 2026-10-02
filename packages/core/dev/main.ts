import { PalaceView, setLocale, createHomePalace, createFromTemplate, normalizePalace, normalizeWorld, createWorld, createRegion, findFreeSpot, findRegionSpot, boundLoci, type HostAdapter, type PalaceDoc, type PalaceWorld, type ReviewState, type Rating } from '../src';
import * as structure from '../src/structure';
import { samplePalaces, L, SAMPLE_NOTES } from './samples';
import { pickFromList } from './picker';

// Playground：用 localStorage 模拟宿主（世界 + 每座宫殿一份数据），便于脱离思源单独调试 core
// ?profile=b 用另一套数据（模拟另一个人，测试串门）；?server=http://localhost:8787 连串门服务器
const QS = new URLSearchParams(location.search);
const PROFILE = QS.get('profile');
// ?lang=en 用英文界面（不给时按浏览器语言）
const LANG = QS.get('lang') || undefined;
// 演示数据按语言生成，所以在建数据之前就定下语言
setLocale(LANG ?? navigator.language);
const P = PROFILE ? `kmind-palace:pg:${PROFILE}:` : 'kmind-palace:pg:';
if (QS.get('server') !== null) localStorage.setItem('kmind-palace:pg:server', QS.get('server'));
const K = {
  world: P + 'world',
  ids: P + 'ids',
  doc: (id: string) => `${P}doc:${id}`,
  legacy: 'kmind-palace:playground',
  review: P + 'review',
  account: P + 'account',
};
// 模拟笔记本：书架 = 笔记本
const FAKE_NOTEBOOKS: { box: string; name: string; docs: string[] }[] = [
  { box: 'nb-rust', name: L('Rust 学习', 'Learning Rust'), docs: L(
    ['入门指南', '猜数字游戏', '常见编程概念', '认识所有权', '结构体', '枚举与模式匹配', '包、crate 与模块', '常见集合', '错误处理', '泛型、trait 与生命周期', '自动化测试', 'I/O 项目：minigrep', '迭代器与闭包', 'Cargo 与 crates.io', '智能指针', '无畏并发', 'async 与 await', '面向对象特性', '模式与匹配', '高级特征', 'Web 服务器', 'The Rustonomicon', 'Rust by Example'],
    ['Getting Started', 'Guessing Game', 'Common Concepts', 'Understanding Ownership', 'Structs', 'Enums & Patterns', 'Packages & Modules', 'Collections', 'Error Handling', 'Generics & Lifetimes', 'Automated Tests', 'I/O Project: minigrep', 'Iterators & Closures', 'Cargo & crates.io', 'Smart Pointers', 'Fearless Concurrency', 'Async & Await', 'OOP Features', 'Patterns & Matching', 'Advanced Features', 'Web Server', 'The Rustonomicon', 'Rust by Example']) },
  { box: 'nb-read', name: L('读书笔记', 'Reading notes'), docs: L(
    ['三体', '人类简史', '思考，快与慢', '原则', 'Deep Work', '纳瓦尔宝典', '枪炮、病菌与钢铁', '置身事内', '刻意练习', '穷查理宝典'],
    ['The Three-Body Problem', 'Sapiens', 'Thinking, Fast and Slow', 'Principles', 'Deep Work', 'The Almanack of Naval', 'Guns, Germs, and Steel', 'Atomic Habits', 'Peak', "Poor Charlie's Almanack"]) },
];
const fakeDocId = (box: string, i: number) => `20260930${String(300000 + i)}-${box.slice(3)}${i}fake`;
const docWatchers = new Set<() => void>();
const nbDocs = (box: string) => {
  const nb = FAKE_NOTEBOOKS.find(n => n.box === box);
  return nb ? nb.docs.map((title, i) => ({ id: fakeDocId(box, i), title })) : [];
};
// dev-only：在控制台里 renameDoc('nb-rust', 0, '新标题') / removeDoc('nb-rust', 3) 模拟文档树变化
(window as any).renameDoc = (box: string, i: number, t: string) => { FAKE_NOTEBOOKS.find(n => n.box === box).docs[i] = t; docWatchers.forEach(f => f()); };
(window as any).removeDoc = (box: string, i: number) => { FAKE_NOTEBOOKS.find(n => n.box === box).docs.splice(i, 1); docWatchers.forEach(f => f()); };

/** 演示用的笔记块：标题、路径、正文（回忆揭晓时显示） */
const FAKE_BLOCKS = L([
  { id: '20260930120000-aaaaaaa', title: '费曼学习法', path: '/学习方法', body: '用最简单的话把一个概念讲给外行听；讲不下去的地方，就是自己还没懂的地方。' },
  { id: '20260930120000-bbbbbbb', title: '艾宾浩斯遗忘曲线', path: '/学习方法', body: '学完 20 分钟后忘掉 42%，一天后忘掉 66%。在快要忘的时候复习，记得最牢。' },
  { id: '20260930120000-eeeeeee', title: '间隔重复', path: '/学习方法', body: '每次答对，下次复习的间隔就拉长；答错，间隔就缩短。' },
  { id: '20260930120000-fffffff', title: '番茄工作法', path: '/学习方法', body: '专注 25 分钟，休息 5 分钟；每四个番茄钟休息一次长的。' },
  { id: '20260930120000-ccccccc', title: '三体 · 黑暗森林法则', path: '/读书笔记', body: '宇宙就是一座黑暗森林，每个文明都是带枪的猎人。' },
  { id: '20260930120000-ddddddd', title: 'Rust 所有权与借用', path: '/编程', body: '每个值只有一个所有者；可以有多个不可变借用，或者一个可变借用。' },
], [
  { id: '20260930120000-aaaaaaa', title: 'The Feynman technique', path: '/Learning', body: 'Explain a concept in plain words to a beginner. Wherever you get stuck is where your understanding has gaps.' },
  { id: '20260930120000-bbbbbbb', title: 'Ebbinghaus forgetting curve', path: '/Learning', body: 'We forget 42% within 20 minutes and 66% within a day. Reviewing right before you forget makes memories stick.' },
  { id: '20260930120000-eeeeeee', title: 'Spaced repetition', path: '/Learning', body: 'Every correct answer stretches the interval to the next review; a miss shrinks it.' },
  { id: '20260930120000-fffffff', title: 'The Pomodoro technique', path: '/Learning', body: 'Focus for 25 minutes, rest for 5. Take a longer break after four rounds.' },
  { id: '20260930120000-ccccccc', title: 'The dark forest theory', path: '/Reading notes', body: 'The universe is a dark forest, and every civilization is an armed hunter.' },
  { id: '20260930120000-ddddddd', title: 'Rust ownership & borrowing', path: '/Programming', body: 'Each value has exactly one owner; you may have many immutable borrows or one mutable borrow.' },
]);

// ---------------- 模拟闪卡：简化的间隔重复（只为 playground 演示） ----------------
type MockCard = ReviewState & { ivl?: number };
const DAY = 864e5;
const loadCards = (): Record<string, MockCard> => { try { return JSON.parse(localStorage.getItem(K.review) || '{}'); } catch { return {}; } };
const saveCards = (c: Record<string, MockCard>) => localStorage.setItem(K.review, JSON.stringify(c));

function mockRate(id: string, r: Rating): MockCard {
  const all = loadCards(), now = Date.now();
  const c: MockCard = all[id] || { card: true, reps: 0, lapses: 0, state: 0 };
  let ivl = c.ivl || 0;
  if (r === 1) { c.lapses = (c.lapses || 0) + 1; ivl = 0; c.due = now + 10 * 60e3; c.state = c.reps ? 3 : 1; }
  else { ivl = r === 2 ? Math.max(1, ivl * 1.2) : r === 3 ? Math.max(1, ivl * 2.5) : Math.max(4, ivl * 3.5); c.due = now + ivl * DAY; c.state = 2; }
  Object.assign(c, { card: true, ivl, reps: (c.reps || 0) + 1, lastReview: now });
  all[id] = c;
  saveCards(all);
  return c;
}

/** 第一次打开：给演示宫殿的记忆桩预置几种复习状态（记得牢 / 该复习 / 很久没复习） */
function seedCards(docs: PalaceDoc[]) {
  const all: Record<string, MockCard> = {}, now = Date.now();
  const kinds: [number, number][] = [[3 * DAY, 2], [-DAY / 2, 2], [-9 * DAY, 2], [0, 0]];
  docs.forEach(d => boundLoci(d).forEach((l, i) => {
    const [off, state] = kinds[i % kinds.length];
    all[l.binding.blockId] = state ? { card: true, reps: 3, lapses: 0, state, due: now + off, lastReview: now - 4 * DAY, ivl: 4 } : { card: true, reps: 0, state: 0, due: now };
  }));
  saveCards(all);
}

function saveDoc(doc: PalaceDoc) {
  localStorage.setItem(K.doc(doc.id), JSON.stringify(doc));
  const ids: string[] = JSON.parse(localStorage.getItem(K.ids) || '[]');
  if (!ids.includes(doc.id)) localStorage.setItem(K.ids, JSON.stringify([...ids, doc.id]));
}

function load(): { world?: PalaceWorld; docs: PalaceDoc[]; fresh?: boolean } {
  try {
    const ids: string[] = JSON.parse(localStorage.getItem(K.ids) || '[]');
    if (ids.length) {
      const docs = ids.map(id => localStorage.getItem(K.doc(id))).filter(Boolean).map(s => normalizePalace(JSON.parse(s)));
      const raw = localStorage.getItem(K.world);
      return { world: raw ? normalizeWorld(JSON.parse(raw)) : undefined, docs };
    }
  } catch (e) { console.warn(e); }
  // 第一次打开：旧版 playground 的单座宫殿（如果有）+ 几座演示宫殿
  let home: PalaceDoc;
  try { const raw = PROFILE ? null : localStorage.getItem(K.legacy); home = raw ? normalizePalace(JSON.parse(raw)) : createHomePalace(); } catch { home = createHomePalace(); }
  home.color ??= '#c46d4d';
  const [roots, rust, apt, history] = samplePalaces();
  const sky = Object.assign(createFromTemplate('twoRooms', L('云端书屋', 'Cloud Library')), { color: '#4f7f8a' });
  const docs = [home, roots, rust, apt, history, sky];
  docs.forEach(saveDoc);
  seedCards(docs);
  // 四座岛：海岛 / 森林 / 雪山 / 浮空岛（固定种子，截图可复现）
  const map = new Map(docs.map(d => [d.id, d]));
  const world = createWorld();
  world.regions = [];
  const groups: [string, string, number, PalaceDoc[]][] = [
    [L('岛上小镇', 'Island Town'), 'island', 101, [home, apt]],
    [L('林间小岛', 'Forest Isle'), 'forest', 202, [rust, roots]],
    [L('雪山小岛', 'Snowy Isle'), 'snow', 303, [history]],
    [L('浮空岛', 'Sky Isle'), 'sky', 404, [sky]],
  ];
  for (const [name, theme, seedN, list] of groups) {
    const r = createRegion(name, theme);
    r.seed = seedN;
    for (const d of list) r.palaces.push({ palaceId: d.id, pos: findFreeSpot(r, map, d), rot: 0 });
    r.origin = findRegionSpot(world, map, r);
    world.regions.push(r);
  }
  return { world, docs, fresh: true };
}

const host: HostAdapter = {
  async pickBlock({ itemName } = {}) {
    // 模拟宿主的块选择器（思源 / Obsidian 里是它们自己的搜索框）
    const b = await pickFromList({
      title: L(`为「${itemName}」绑定笔记块`, `Bind a block to "${itemName}"`),
      placeholder: L('搜索文档或块内容', 'Search notes and blocks'),
      items: FAKE_BLOCKS.map(x => ({ id: x.id, title: x.title, sub: x.path })),
    });
    return b ? FAKE_BLOCKS.find(x => x.id === b) || null : null;
  },
  openBlock(id) { console.info('[playground] open block', id); },
  async getBlock(id) {
    const doc = FAKE_NOTEBOOKS.flatMap(n => nbDocs(n.box)).find(d => d.id === id);
    return FAKE_BLOCKS.find(b => b.id === id) || doc || (id.endsWith('fake') && !/^20260930(3\d{5})-/.test(id) ? { id, title: '' } : null);
  },
  onDocChange: saveDoc,
  onWorldChange(world) { localStorage.setItem(K.world, JSON.stringify(world)); },
  onDocDelete(id) {
    localStorage.removeItem(K.doc(id));
    const ids: string[] = JSON.parse(localStorage.getItem(K.ids) || '[]');
    localStorage.setItem(K.ids, JSON.stringify(ids.filter(x => x !== id)));
  },
  onLocationChange(id, name) { document.title = `${name} · ${L('思维宫殿', 'KMind Palace')}`; void id; },
  notify(msg) { console.info('[notify]', msg); },
  review: {
    async getStates(ids) {
      const all = loadCards(), out: Record<string, ReviewState> = {};
      for (const id of ids) if (all[id]) out[id] = all[id];
      return out;
    },
    async rate(id, r) { return mockRate(id, r); },
  },
  async listDocs(src) { return nbDocs(src.box); },
  async pickDocSource() {
    const box = await pickFromList({
      title: L('把哪个笔记本摆上书架？', 'Which notebook goes on the shelf?'),
      placeholder: L('搜索笔记本', 'Search notebooks'),
      items: FAKE_NOTEBOOKS.map(nb => ({ id: nb.box, title: nb.name, sub: L(`${nb.docs.length} 篇`, `${nb.docs.length} docs`) })),
    });
    const nb = FAKE_NOTEBOOKS.find(n => n.box === box);
    return nb ? { box: nb.box, path: '/', name: nb.name } : null;
  },
  watchDocs(cb) { docWatchers.add(cb); return () => docWatchers.delete(cb); },
  async saveMedia(blob, id) {
    const url = await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(blob); });
    localStorage.setItem('kmind-palace:pg:media:' + id, url);
  },
  async loadMedia(id) {
    const url = localStorage.getItem('kmind-palace:pg:media:' + id);
    if (!url) throw new Error(L('照片不存在', 'Photo not found'));
    return url;
  },
  social: {
    serverUrl: () => localStorage.getItem('kmind-palace:pg:server') || '',
    loadAccount: async () => { try { return JSON.parse(localStorage.getItem(K.account) || 'null'); } catch { return null; } },
    saveAccount: async (a) => { if (a) localStorage.setItem(K.account, JSON.stringify(a)); else localStorage.removeItem(K.account); },
  },
  // 模拟大模型：不联网，按提示词里的位置和标题拼一段故事；配图用画布画
  ai: {
    async chat(messages) {
      await new Promise(r => setTimeout(r, 700));
      const last = messages[messages.length - 1].content;
      // 模拟识图：横图 → 按平均颜色给一张沙发；竖图 → 用积木拼一个小书柜
      if (Array.isArray(last)) {
        const img = last.find(p => p.type === 'image_url');
        if (img?.type === 'image_url') {
          const el = new Image();
          await new Promise(r => { el.onload = r; el.src = img.image_url.url; });
          const c = document.createElement('canvas'); c.width = c.height = 1;
          const g = c.getContext('2d'); g.drawImage(el, 0, 0, 1, 1);
          const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
          const hex = '#' + [r, gg, b].map(v => v.toString(16).padStart(2, '0')).join('');
          if (el.width >= el.height) return `\`\`\`json\n{"name":"${L('照片里的沙发', 'Sofa from the photo')}","type":"sofa","params":{"w":2.1,"fabric":"${hex}"}}\n\`\`\``;
          return JSON.stringify({ name: L('小书柜', 'Small bookcase'), type: 'blocks', parts: [
            { shape: 'box', size: [.6, 1.1, .3], pos: [0, .55, 0], color: hex, round: .01 },
            { shape: 'box', size: [.54, .02, .26], pos: [0, .4, .02], color: '#f3ead8', repeat: { count: 3, step: [0, .3, 0] } },
            { shape: 'box', size: [.04, .22, .18], pos: [-.2, .52, .02], color: '#3f5a6b', repeat: { count: 6, step: [.05, 0, 0] }, slot: 'books', name: L('一排书', 'Row of books') },
          ] });
        }
      }
      // 按提示词里的位置、标题、下一站拼一段故事（中英文提示词都认）
      const u = String(last);
      const place = (/(?:位置|Location|Place)\s*[：:]\s*(.*)/i.exec(u)?.[1] || L('这里', 'this spot')).split(' · ').pop().trim();
      const title = /《(.*?)》/.exec(u)?.[1] || /(?:标题|Title|Note)\s*[：:]\s*(.*)/i.exec(u)?.[1]?.trim() || /[“"]([^”"]{2,60})[”"]/.exec(u)?.[1] || L('这条笔记', 'this note');
      const next = /(?:下一站|Next stop)\s*[：:]\s*(.*)/i.exec(u)?.[1]?.trim();
      return L(
        `故事：${place}忽然抖了抖身子，从里面蹦出一个举着牌子的小人，牌子上写着「${title}」。它大声念了三遍，声音震得灰尘在灯光里跳舞，空气里全是旧纸和咖啡的味道。${next ? `念完它一个跟头翻向${next}。` : ''}`,
        `Story: The ${place.toLowerCase()} suddenly shivers, and a tiny figure hops out holding a sign that reads "${title}". It shouts the words three times, so loudly that dust dances in the lamplight and the air smells of old paper and coffee.${next ? ` Then it somersaults off toward the ${next}.` : ''}`);
    },
    imageEnabled: () => true,
    async image(prompt) {
      await new Promise(r => setTimeout(r, 900));
      const c = document.createElement('canvas');
      c.width = c.height = 768;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 768, 768);
      gr.addColorStop(0, '#f7d9a8'); gr.addColorStop(1, '#8fb8c9');
      g.fillStyle = gr; g.fillRect(0, 0, 768, 768);
      g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(560, 200, 90, 0, 7); g.fill();
      g.fillStyle = '#3b3530'; g.font = '600 34px sans-serif';
      const text = prompt.split('\n')[0].replace(/^(故事：|Story:\s*)/, '');
      const per = /[\u4e00-\u9fff]/.test(text) ? 16 : 30;
      for (let i = 0; i < 6; i++) g.fillText(text.slice(i * per, i * per + per), 60, 420 + i * 48);
      return await new Promise<Blob>(r => c.toBlob(b => r(b), 'image/png'));
    },
    style: () => 'vivid',
    visionEnabled: () => true,
  },
  async getBlockText(id) {
    const b = FAKE_BLOCKS.find(x => x.id === id);
    return b ? `${b.title}: ${b.body}` : '';
  },
  async writeStory(o) { console.info('[playground] write story back', o); },
  openSettings() { console.info('[playground] settings'); },
  renderBlock(el, id) {
    // 宿主把真实的块渲染进来；playground 显示演示笔记的标题和正文
    const b = FAKE_BLOCKS.find(x => x.id === id) || SAMPLE_NOTES.get(id);
    const esc = (x: string) => x.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    el.innerHTML = `<div style="padding:8px 12px;line-height:1.7"><p style="margin:0 0 6px"><b>${esc(b?.title || L('示例笔记', 'Sample note'))}</b></p><p style="margin:0">${esc(b?.body || L('这里显示笔记的内容。', 'The note content shows up here.'))}</p></div>`;
    return () => { el.innerHTML = ''; };
  },
};

const { world, docs, fresh } = load();
const params = new URLSearchParams(location.search);
const view = new PalaceView(document.getElementById('app')!, { world, docs, host, enter: params.get('enter'), locale: LANG });
if (!world || fresh) host.onWorldChange(view.world);
(window as any).palaceView = view;
(window as any).structure = structure;
(window as any).resetPalace = () => {
  Object.keys(localStorage).filter(k => k.startsWith('kmind-palace:')).forEach(k => localStorage.removeItem(k));
  location.reload();
};

// dev-only：推进若干帧、渲染并把画面发给 vite 写到 .snapshots/（浏览器窗口隐藏时也能看效果）
const v: any = view;
(window as any).step = (frames = 30, dt = 1 / 30) => { for (let i = 0; i < frames; i++) v.tick(dt); v.render(); };
(window as any).snapshot = async (name = 'snap', frames = 0) => {
  for (let i = 0; i < frames; i++) v.tick(1 / 30);
  v.render();
  const blob: Blob = await new Promise(r => v.renderer.domElement.toBlob(r, 'image/jpeg', .88));
  return (await fetch(`/__snapshot?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob })).text();
};

// dev-only：?demo=card|list|build|palette|edit|night|inside —— 打开页面后直接进入某个界面状态，方便无头浏览器截图
const demo = params.get('demo');
if (demo) setTimeout(() => {
  const c: any = v.townCtl;
  const first = [...v.docs.values()].sort((a: PalaceDoc, b: PalaceDoc) => b.items.length - a.items.length)[1];
  if (demo === 'card') c.select(first.id);
  if (demo === 'list') c.toggleList(true);
  if (demo === 'build') c.openBuild();
  if (demo === 'palette') { c.openPalette(); const i = v.ui.paletteInput; i.value = params.get('q') || '法'; i.dispatchEvent(new Event('input')); }
  if (demo === 'edit') { c.setEditing(true); c.select(first.id); }
  if (demo === 'night') v.toggleNight();
  if (demo === 'inside') v.enterPalace(first.id, { instant: true });
  if (demo === 'recall' || demo === 'routes') {
    const rust = [...v.docs.values()].find((d: PalaceDoc) => d.name === L('Rust 书房', 'Rust Study')) || first;
    v.enterPalace(rust.id, { instant: true });
    if (demo === 'recall') v.recall.start(false); else v.recall.togglePanel(true);
  }
  if (demo === 'far') v.flyToWorld(.01);
  if (demo === 'planet') v.flyToPlanet(.01);
  if (demo === 'region') { v.flyToWorld(.01); setTimeout(() => c.selectRegion(v.world.regions[1].id), 600); }
  if (demo === 'island') { v.flyToWorld(.01); setTimeout(() => c.openNewIsland(), 600); }
  if (demo.startsWith('go:')) v.flyToRegion(v.world.regions[Number(demo.slice(3))].id, .01);
}, 2400);
