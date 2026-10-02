import { PALACE_COMPAT, MEDIA_PARAMS, palaceMedia, locusKey, type PalaceDoc, type PalaceItem, type LocusBinding } from './schema';
import { WORLD_COMPAT, type PalaceWorld } from './world';

/* =====================================================================
 * 公开副本：发布到服务器、给好友串门时用。
 * 宫殿的样子（房间、墙、家具、积木、模型）原样带上；笔记相关的一律去掉，只有标了 share 的记忆桩
 * 留下标题和记忆故事。笔记本身永远不离开本机。
 * 字段按白名单复制：以后新加的字段默认不公开，要公开时在这里显式加上。
 * ===================================================================== */

export interface PublishOptions {
  /**
   * 带上照片：画作 / 相框里的照片、公开记忆桩的配图。默认不带（家里的照片多半是私人的），
   * 不带时画作显示默认的画，相框显示空白。
   */
  photos?: boolean;
}

/** 公开副本里记忆桩的来源标记：访客那边当成别处的笔记，不会去打开 */
export const PUBLIC_SRC = 'public';

const ITEM_KEYS = ['id', 'type', 'name', 'room', 'parent', 'pos', 'rot', 'wall', 'solid', 'pickable'] as const;
/** 物件参数里的私人数据：书架的书目来源（笔记本 id、路径、名字） */
const PRIVATE_PARAMS = ['source'];
const PHOTO_PARAMS = ['photo'];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function publicBinding(item: PalaceItem, slot: string, b: LocusBinding, opts: PublishOptions): LocusBinding | null {
  if (!b?.blockId || !b.share) return null;
  // 块 id 换成和笔记无关的占位（同一个宫殿里唯一，路线靠位置引用，不靠它）
  const out: LocusBinding = { blockId: '~' + locusKey(item.id, slot), src: PUBLIC_SRC, share: true };
  if (b.title) out.title = b.title;
  if (b.story) out.story = b.story;
  if (b.image && opts.photos) out.image = b.image;
  return out;
}

function publicItem(it: PalaceItem, opts: PublishOptions): PalaceItem {
  const out: Record<string, unknown> = {};
  for (const k of ITEM_KEYS) if (it[k] !== undefined) out[k] = clone(it[k]);
  if (it.params) {
    const params = clone(it.params);
    for (const k of PRIVATE_PARAMS) delete params[k];
    // 笔记本书架上单本书的覆盖按文档 id 记：和书目一起去掉
    if (params.books && typeof params.books === 'object') {
      for (const k of Object.keys(params.books)) if (k.startsWith('doc:')) delete params.books[k];
      if (!Object.keys(params.books).length) delete params.books;
    }
    // 模型文件（src）属于家具本身，保留
    if (!opts.photos) for (const k of PHOTO_PARAMS) if ((MEDIA_PARAMS[it.type] || []).includes(k)) delete params[k];
    out.params = params;
  }
  const bindings: Record<string, LocusBinding> = {};
  for (const [slot, b] of Object.entries(it.bindings || {})) {
    // 笔记本书架上「文档书」的部件编号就是文档 id，书目来源去掉之后这些书也不在了
    if (slot.startsWith('doc:')) continue;
    const pb = publicBinding(it, slot, b, opts);
    if (pb) bindings[slot] = pb;
  }
  if (Object.keys(bindings).length) out.bindings = bindings;
  return out as unknown as PalaceItem;
}

/** 宫殿的公开副本（不改原数据） */
export function toPublicPalace(doc: PalaceDoc, opts: PublishOptions = {}): PalaceDoc {
  const items = doc.items.map(it => publicItem(it, opts));
  const shared = new Set<string>();
  for (const it of items) for (const slot of Object.keys(it.bindings || {})) shared.add(locusKey(it.id, slot));
  const out: PalaceDoc = {
    format: doc.format,
    version: doc.version,
    compat: Math.max(doc.compat || 0, PALACE_COMPAT),
    src: PUBLIC_SRC,
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    rooms: clone(doc.rooms),
    walls: clone(doc.walls),
    items,
  };
  if (doc.color) out.color = doc.color;
  if (doc.wallHeight !== undefined) out.wallHeight = doc.wallHeight;
  if (doc.ground) out.ground = clone(doc.ground);
  // 路线只留公开的站；一站都不剩的路线去掉
  const routes = (doc.routes || [])
    .map(r => ({ id: r.id, name: r.name, stops: r.stops.filter(k => shared.has(k)) }))
    .filter(r => r.stops.length);
  if (routes.length) out.routes = routes;
  return out;
}

/** 公开副本需要一起上传的媒体文件 */
export function publicMedia(pub: PalaceDoc): string[] {
  return palaceMedia(pub);
}

/** 世界的公开副本：只留已发布的宫殿的摆放 */
export function toPublicWorld(world: PalaceWorld, published: Iterable<string>): PalaceWorld {
  const ids = new Set(published);
  return {
    format: world.format,
    version: world.version,
    compat: Math.max(world.compat || 0, WORLD_COMPAT),
    id: world.id,
    name: world.name,
    createdAt: world.createdAt,
    updatedAt: world.updatedAt,
    regions: world.regions.map(r => ({
      id: r.id, name: r.name, theme: r.theme, seed: r.seed,
      ...(r.origin ? { origin: clone(r.origin) } : {}),
      palaces: r.palaces.filter(p => ids.has(p.palaceId)).map(p => clone(p)),
    })),
  };
}
