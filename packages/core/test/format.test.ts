import { describe, it, expect } from 'vitest';
import {
  PALACE_FORMAT, PALACE_VERSION, PALACE_COMPAT, MEDIA_PARAMS, normalizePalace, palaceMedia, gid, locusKey,
  type PalaceDoc,
} from '../src/schema';
import { WORLD_FORMAT, WORLD_VERSION, normalizeWorld, createWorld, type PalaceWorld } from '../src/world';
import { sha256Hex, sha256Js, mediaIdOf, MEDIA_ID } from '../src/hash';
import { toPublicPalace, toPublicWorld, publicMedia, PUBLIC_SRC } from '../src/publish';
// @ts-expect-error Vite 的 ?raw 导入（读源码文本）
import catalogSource from '../src/catalog.ts?raw';

const BLOCK = '20260101000000-aaaaaaa';

function v3Doc(): any {
  return {
    format: PALACE_FORMAT, version: 3, id: 'palace-a', name: '宫殿', createdAt: 1, updatedAt: 2,
    rooms: [{ id: 'r1', name: '客厅', rect: [0, 0, 5, 4], floor: 'oak' }], walls: [],
    items: [{ id: 'sofa-1', type: 'sofa', pos: [1, 0, 1], bindings: { '': { blockId: BLOCK, title: 'A' } } }],
  };
}

describe('版本兼容（compat）', () => {
  it('v3 → v4：补上 src = siyuan 和 compat', () => {
    const d = normalizePalace(v3Doc());
    expect(d.version).toBe(PALACE_VERSION);
    expect(d.compat).toBe(PALACE_COMPAT);
    expect(d.src).toBe('siyuan');
  });

  it('更高版本但声明兼容的数据：能打开，版本号和不认识的字段原样保留', () => {
    const raw = { ...v3Doc(), version: PALACE_VERSION + 3, compat: PALACE_COMPAT, src: 'obsidian:库', weather: 'rain' };
    raw.items[0].glow = true;
    const d = normalizePalace(raw) as any;
    expect(d.version).toBe(PALACE_VERSION + 3);
    expect(d.compat).toBe(PALACE_COMPAT);
    expect(d.src).toBe('obsidian:库');
    expect(d.weather).toBe('rain');
    expect(d.items[0].glow).toBe(true);
  });

  it('要求更高版本的数据：报错提示升级', () => {
    expect(() => normalizePalace({ ...v3Doc(), version: PALACE_VERSION + 1, compat: PALACE_VERSION + 1 })).toThrow(/升级插件/);
    // 旧数据没有 compat：按 version 判断
    expect(() => normalizePalace({ ...v3Doc(), version: PALACE_VERSION + 1 })).toThrow(/升级插件/);
  });

  it('世界数据同样按 compat 判断', () => {
    const w = createWorld();
    expect(w.compat).toBe(1);
    expect(normalizeWorld({ ...w, version: WORLD_VERSION + 2, compat: 1 }).version).toBe(WORLD_VERSION + 2);
    expect(() => normalizeWorld({ ...w, version: WORLD_VERSION + 1, compat: WORLD_VERSION + 1 })).toThrow(/升级插件/);
    const old = normalizeWorld({ format: WORLD_FORMAT, version: 1, id: 'w', name: 'w', createdAt: 0, updatedAt: 0, regions: [] });
    expect(old.compat).toBe(1);
    expect(old.regions.length).toBe(1);
  });
});

describe('全局 id', () => {
  it('gid：前缀 + 16 位随机，不重复', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => gid('palace-')));
    expect(ids.size).toBe(2000);
    for (const id of [...ids].slice(0, 20)) expect(id).toMatch(/^palace-[0-9a-z]{16}$/);
  });
});

describe('内容哈希', () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it('SHA-256 标准向量（纯 JS 和 crypto.subtle 一致）', async () => {
    const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    expect(hex(sha256Js(enc('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256Js(enc('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    // 跨过 64 字节分块边界（55 / 56 / 64 字节）
    for (const n of [55, 56, 63, 64, 65, 1000]) {
      const data = enc('x'.repeat(n));
      expect(hex(sha256Js(data))).toBe(await sha256Hex(data));
    }
    expect(await sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('媒体 id：同内容同 id，扩展名规范化', async () => {
    const a = await mediaIdOf(new Blob([enc('photo')]), 'WebP');
    const b = await mediaIdOf(enc('photo'), 'webp');
    expect(a).toBe(b);
    expect(a).toMatch(MEDIA_ID);
    expect(await mediaIdOf(enc('photo2'), 'webp')).not.toBe(a);
    expect(await mediaIdOf(enc('x'), '.g/lb')).toMatch(/\.glb$/);
  });
});

describe('媒体引用', () => {
  it('MEDIA_PARAMS 覆盖目录里所有照片 / 模型参数', () => {
    const src: string = catalogSource;
    const found: Record<string, string[]> = {};
    for (const line of src.split('\n')) {
      const t = line.match(/^\s+(\w+): E\(/)?.[1];
      if (!t) continue;
      for (const m of line.matchAll(/\{ key: '(\w+)', label: '[^']*', kind: '(photo|model)' \}/g)) (found[t] ||= []).push(m[1]);
    }
    expect(Object.keys(found).length).toBeGreaterThan(0);
    expect(found).toEqual(MEDIA_PARAMS);
  });

  it('palaceMedia：照片、模型、配图，去重', () => {
    const d = normalizePalace({
      ...v3Doc(), items: [
        { id: 'p1', type: 'painting', pos: [0, 0, 0], params: { photo: 'a.webp' } },
        { id: 'p2', type: 'photoFrame', pos: [0, 0, 0], params: { photo: 'a.webp' } },
        { id: 'm', type: 'model', pos: [0, 0, 0], params: { src: 'm.glb' }, bindings: { '': { blockId: BLOCK, image: 'i.webp' } } },
        { id: 's', type: 'sofa', pos: [0, 0, 0], params: { src: 'not-media' } },
      ],
    });
    expect(palaceMedia(d).sort()).toEqual(['a.webp', 'i.webp', 'm.glb']);
  });
});

describe('公开副本', () => {
  function privateDoc(): PalaceDoc {
    return normalizePalace({
      ...v3Doc(),
      routes: [{ id: 'route-1', name: '期末复习', stops: ['sofa-1', 'lamp-1', 'shelf-1#b:0:1'] }],
      items: [
        { id: 'sofa-1', type: 'sofa', pos: [1, 0, 1], bindings: { '': { blockId: BLOCK, title: '公开的标题', story: '沙发上的故事', image: 'story.webp', share: true, boundAt: 9, storyNote: '20260101000000-bbbbbbb' } } },
        { id: 'lamp-1', type: 'floorLamp', pos: [2, 0, 2], bindings: { '': { blockId: '20260101000000-ccccccc', title: '私密日记', story: '私密的故事' } } },
        {
          id: 'shelf-1', type: 'bookshelf', pos: [3, 0, 0], params: { w: 1.2, source: { box: '20260101000000-nbnbnbn', path: '/', name: '私人笔记本' }, books: { 'doc:20260101000000-fffffff': { c: '#112233' } } },
          bindings: { 'doc:20260101000000-ddddddd': { blockId: '20260101000000-ddddddd', title: '文档书', share: true }, 'b:0:1': { blockId: '20260101000000-eeeeeee', title: '书', share: true } },
        },
        { id: 'pic', type: 'painting', pos: [0, 1.5, 0], params: { photo: 'family.webp', w: .6 } },
        { id: 'm', type: 'model', pos: [0, 0, 0], params: { src: 'chair.glb', h: 1 } },
      ],
    });
  }

  it('只留公开的记忆桩：没有块 id、笔记来源、写回记录，私密的整个去掉', () => {
    const doc = privateDoc();
    const before = JSON.stringify(doc);
    const pub = toPublicPalace(doc);
    expect(JSON.stringify(doc)).toBe(before); // 不改原数据
    const json = JSON.stringify(pub);
    for (const secret of ['20260101000000', '私密', '私人笔记本', 'storyNote', 'boundAt', 'family.webp', 'story.webp']) {
      expect(json).not.toContain(secret);
    }
    expect(pub.src).toBe(PUBLIC_SRC);
    const sofa = pub.items.find(i => i.id === 'sofa-1');
    expect(sofa.bindings['']).toEqual({ blockId: '~' + locusKey('sofa-1', ''), src: PUBLIC_SRC, share: true, title: '公开的标题', story: '沙发上的故事' });
    expect(pub.items.find(i => i.id === 'lamp-1').bindings).toBeUndefined();
    const shelf = pub.items.find(i => i.id === 'shelf-1');
    expect(shelf.params).toEqual({ w: 1.2 });
    expect(Object.keys(shelf.bindings)).toEqual(['b:0:1']);
    // 模型属于家具本身，保留；照片默认不带
    expect(pub.items.find(i => i.id === 'm').params.src).toBe('chair.glb');
    expect(pub.items.find(i => i.id === 'pic').params.photo).toBeUndefined();
    expect(publicMedia(pub)).toEqual(['chair.glb']);
    // 路线只剩公开的站
    expect(pub.routes).toEqual([{ id: 'route-1', name: '期末复习', stops: ['sofa-1', 'shelf-1#b:0:1'] }]);
  });

  it('photos：带上照片和公开记忆桩的配图', () => {
    const pub = toPublicPalace(privateDoc(), { photos: true });
    expect(pub.items.find(i => i.id === 'pic').params.photo).toBe('family.webp');
    expect(pub.items.find(i => i.id === 'sofa-1').bindings[''].image).toBe('story.webp');
    expect(publicMedia(pub).sort()).toEqual(['chair.glb', 'family.webp', 'story.webp']);
    // 私密记忆桩的配图仍然不带
    expect(JSON.stringify(pub)).not.toContain('私密');
  });

  it('白名单：以后新加的字段默认不公开', () => {
    const doc = privateDoc() as any;
    doc.secretField = 'x';
    doc.items[0].secretItemField = 'y';
    const json = JSON.stringify(toPublicPalace(doc));
    expect(json).not.toContain('secretField');
    expect(json).not.toContain('secretItemField');
  });

  it('公开副本可以被正常读取', () => {
    const pub = toPublicPalace(privateDoc(), { photos: true });
    const back = normalizePalace(JSON.parse(JSON.stringify(pub)));
    expect(back.items.length).toBe(pub.items.length);
    expect(back.src).toBe(PUBLIC_SRC);
  });

  it('世界：只留已发布的宫殿', () => {
    const w: PalaceWorld = createWorld();
    w.regions[0].palaces = [{ palaceId: 'a', pos: [0, 0], rot: 0 }, { palaceId: 'secret', pos: [10, 0], rot: 90 }];
    const pub = toPublicWorld(w, ['a']);
    expect(pub.regions[0].palaces.map(p => p.palaceId)).toEqual(['a']);
    expect(w.regions[0].palaces.length).toBe(2);
    expect(JSON.stringify(pub)).not.toContain('secret');
  });
});
