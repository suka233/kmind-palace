import { describe, it, expect } from 'vitest';
import { PALACE_FORMAT, PALACE_VERSION, normalizePalace, remapNoteIds } from '../src/schema';
import { scheduleCard, createLocalReview, retrievability, type LocalCards } from '../src/local-review';
import { PalaceStore, type StorageAdapter } from '../src/store';
import { createOpenAiAdapter, OPENAI_DEFAULTS, type HttpPost } from '../src/openai';

const MIN = 60e3, DAY = 86400e3;

describe('本地闪卡（FSRS）', () => {
  const t0 = Date.UTC(2026, 9, 1);

  it('新卡：忘了 / 困难 / 记得进入短步骤，简单直接毕业', () => {
    expect(scheduleCard(undefined, 1, t0)).toMatchObject({ state: 1, due: t0 + MIN, reps: 1 });
    expect(scheduleCard(undefined, 3, t0)).toMatchObject({ state: 1, due: t0 + 10 * MIN });
    const easy = scheduleCard(undefined, 4, t0);
    expect(easy.state).toBe(2);
    expect(easy.due - t0).toBeGreaterThanOrEqual(10 * DAY);
  });

  it('学习中记得 → 复习；越记得间隔越长；忘了 → 重新学习，稳定性下降', () => {
    let c = scheduleCard(undefined, 3, t0);
    c = scheduleCard(c, 3, c.due);
    expect(c.state).toBe(2);
    const first = c.due - c.last;
    expect(first).toBeGreaterThanOrEqual(DAY);
    const good = scheduleCard(c, 3, c.due), hard = scheduleCard(c, 2, c.due), easy = scheduleCard(c, 4, c.due);
    expect(good.due - good.last).toBeGreaterThan(first);
    expect(hard.s).toBeLessThan(good.s);
    expect(easy.s).toBeGreaterThan(good.s);
    const lapse = scheduleCard(good, 1, good.due);
    expect(lapse).toMatchObject({ state: 3, lapses: 1, due: good.due + 10 * MIN });
    expect(lapse.s).toBeLessThan(good.s);
    expect(lapse.d).toBeGreaterThan(good.d);
  });

  it('稳定性 = 记忆率降到 90% 的天数', () => {
    expect(retrievability(0, 5)).toBe(1);
    expect(retrievability(5, 5)).toBeCloseTo(.9, 5);
  });

  it('适配器：状态读写、改名', async () => {
    let saved: LocalCards | null = null;
    let now = t0;
    const r = createLocalReview({ load: async () => ({ a: { due: t0 - DAY, s: 3, d: 5, state: 2, reps: 2, lapses: 0, last: t0 - 4 * DAY }, bad: { x: 1 } }), save: async (c) => { saved = JSON.parse(JSON.stringify(c)); } }, () => now);
    expect(await r.getStates(['a', 'b', 'bad'])).toEqual({ a: { card: true, due: t0 - DAY, state: 2, reps: 2, lapses: 0, lastReview: t0 - 4 * DAY } });
    const st = await r.rate('b', 3);
    expect(st).toMatchObject({ card: true, state: 1, reps: 1 });
    expect(Object.keys(saved)).toEqual(['a', 'b']);
    now += MIN;
    expect(await r.remap(id => (id === 'a' ? 'a2' : null))).toBe(true);
    expect(Object.keys(saved).sort()).toEqual(['a2', 'b']);
  });
});

function memStorage(files: Record<string, unknown> = {}): StorageAdapter & { files: Record<string, unknown> } {
  return {
    files,
    load: async (f) => (f in files ? JSON.parse(JSON.stringify(files[f])) : null),
    save: async (f, d) => { files[f] = JSON.parse(JSON.stringify(d)); },
    remove: async (f) => { delete files[f]; },
  };
}

describe('宫殿存储', () => {
  it('空存储：建「我的家」；保存防抖、flush 写盘', async () => {
    const st = memStorage();
    const store = new PalaceStore(st, (m) => { throw new Error(m); });
    const { docs, world } = await store.loadAll();
    expect(docs.map(d => d.name)).toEqual(['我的家']);
    expect(Object.keys(st.files).sort()).toEqual(['index.json', `palaces/${docs[0].id}.json`]);
    docs[0].name = '新名字';
    store.saveDoc(docs[0]);
    store.saveWorld(world);
    await store.flush();
    expect((st.files[`palaces/${docs[0].id}.json`] as any).name).toBe('新名字');
    expect((st.files['index.json'] as any).palaces[0].name).toBe('新名字');
    expect(st.files['world.json']).toBeTruthy();
  });

  it('旧版本数据：读取时留备份；更新版本的数据：跳过并提示，世界文件不被覆盖', async () => {
    const old = { format: PALACE_FORMAT, version: 3, id: 'p-old', name: '旧宫殿', createdAt: 0, updatedAt: 0, rooms: [], walls: [], items: [] };
    const future = { ...old, id: 'p-new', name: '未来宫殿', version: 99, compat: 99 };
    const worldFuture = { format: 'kmind-palace-world', version: 99, compat: 99, id: 'w', name: 'w', createdAt: 0, updatedAt: 0, regions: [] };
    const st = memStorage({
      'index.json': { version: 1, palaces: [{ id: 'p-old', name: '旧宫殿', updatedAt: 0 }, { id: 'p-new', name: '未来宫殿', updatedAt: 0 }] },
      'palaces/p-old.json': old, 'palaces/p-new.json': future, 'world.json': worldFuture,
    });
    const errs: string[] = [];
    const store = new PalaceStore(st, (m) => errs.push(m));
    const { docs, world } = await store.loadAll();
    expect(docs.map(d => [d.name, d.version])).toEqual([['旧宫殿', PALACE_VERSION]]);
    expect(st.files['backups/p-old.v3.json']).toEqual(old);
    expect(errs.join()).toMatch(/未来宫殿.*升级/);
    expect(errs.join()).toMatch(/世界数据/);
    store.saveWorld(world);
    await store.flush();
    expect(st.files['world.json']).toEqual(worldFuture);
    expect(st.files['palaces/p-new.json']).toEqual(future);
  });
});

describe('笔记改名', () => {
  it('改写绑定、写回记录、文档书部件、路线、书目文件夹', () => {
    const d = normalizePalace({
      format: PALACE_FORMAT, version: 4, compat: 4, id: 'p', name: 'p', createdAt: 0, updatedAt: 0, rooms: [], walls: [],
      items: [
        { id: 'sofa', type: 'sofa', pos: [0, 0, 0], bindings: { '': { blockId: '学习/费曼.md#^abc', storyNote: '学习/费曼.md#^kp1' } } },
        { id: 'shelf', type: 'bookshelf', pos: [0, 0, 0], params: { source: { box: 'v', path: '学习', name: '学习' }, books: { 'doc:学习/费曼.md': { lean: 1 }, 'b:0:2': { hide: true } } }, bindings: { 'doc:学习/费曼.md': { blockId: '学习/费曼.md' }, 'b:0:1': { blockId: '其他.md' } } },
      ],
      routes: [{ id: 'r', name: 'r', stops: ['sofa', 'shelf#doc:学习/费曼.md', 'shelf#b:0:1'] }],
    });
    const f = (id: string) => (id === '学习' || id.startsWith('学习/') ? '方法' + id.slice(2) : null);
    expect(remapNoteIds(d, f)).toBe(true);
    const [sofa, shelf] = d.items;
    expect(sofa.bindings['']).toEqual({ blockId: '方法/费曼.md#^abc', storyNote: '方法/费曼.md#^kp1' });
    expect(Object.keys(shelf.bindings)).toEqual(['doc:方法/费曼.md', 'b:0:1']);
    expect(shelf.bindings['doc:方法/费曼.md'].blockId).toBe('方法/费曼.md');
    expect(shelf.params.source.path).toBe('方法');
    expect(shelf.params.books).toEqual({ 'doc:方法/费曼.md': { lean: 1 }, 'b:0:2': { hide: true } });
    expect(d.routes[0].stops).toEqual(['sofa', 'shelf#doc:方法/费曼.md', 'shelf#b:0:1']);
    expect(remapNoteIds(d, f)).toBe(false);
  });
});

describe('OpenAI 兼容客户端', () => {
  it('文字、识图走识图模型、错误信息、生图', async () => {
    const calls: any[] = [];
    const post: HttpPost = async (url, headers, body: any) => {
      calls.push({ url, headers, body });
      if (url.endsWith('chat/completions')) return { status: 200, text: JSON.stringify({ choices: [{ message: { content: '<think>嗯</think>故事' } }] }) };
      if (body.prompt === 'bad') return { status: 401, text: JSON.stringify({ error: { message: 'invalid key' } }) };
      return { status: 200, text: JSON.stringify({ data: [{ b64_json: btoa('png') }] }) };
    };
    const cfg = { ...OPENAI_DEFAULTS, textBase: 'https://api.example.com/v1/', textKey: 'sk-1', visionModel: 'vl', imageEnabled: true };
    const ai = createOpenAiAdapter(() => cfg, post);
    expect(await ai.chat([{ role: 'user', content: 'hi' }])).toBe('故事');
    expect(calls[0]).toMatchObject({ url: 'https://api.example.com/v1/chat/completions', headers: { Authorization: 'Bearer sk-1' }, body: { model: 'gpt-4o-mini' } });
    await ai.chat([{ role: 'user', content: [{ type: 'text', text: 'x' }] }]);
    expect(calls[1].body.model).toBe('vl');
    expect((await ai.image('画')).size).toBe(3);
    await expect(ai.image('bad')).rejects.toThrow('401 invalid key');
    const noKey = createOpenAiAdapter(() => ({ ...cfg, textKey: '' }), post);
    await expect(noKey.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/API Key/);
    const local = createOpenAiAdapter(() => ({ ...cfg, textKey: '', textBase: 'http://127.0.0.1:11434/v1' }), post);
    expect(await local.chat([{ role: 'user', content: 'hi' }])).toBe('故事');
  });
});
