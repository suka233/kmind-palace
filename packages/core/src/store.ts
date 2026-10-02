import { createHomePalace } from './templates/home';
import { normalizePalace, clonePalace, PALACE_VERSION, type PalaceDoc, NEWER_VERSION } from './schema';
import { normalizeWorld, createWorld, cloneWorld, type PalaceWorld } from './world';
import { t, isZh } from './i18n';

/**
 * 宿主提供的文件读写（一个目录下的 JSON 文件；路径用 / 分隔，例如 palaces/<id>.json）。
 * 文件不存在时 load 返回 null。
 */
export interface StorageAdapter {
  load(file: string): Promise<unknown>;
  save(file: string, data: unknown): Promise<void>;
  remove(file: string): Promise<void>;
}

/* =====================================================================
 * 宫殿存储（与宿主无关；思源存在 data/storage/petal/kmind-palace/，Obsidian 存在库里的数据文件夹）：
 *   index.json            宫殿列表 + 上次所在的宫殿
 *   world.json            世界：每座宫殿在岛上的位置、朝向、屋顶
 *   palaces/<id>.json     每座宫殿一个文件（便于多端同步时减少冲突）
 *   backups/<id>.v<n>.json  旧版本数据第一次被升级前的原样备份
 * 世界文件只记录摆放关系；丢失或损坏时会按宫殿列表重新自动摆放，宫殿内容不受影响。
 * ===================================================================== */

interface PalaceIndex {
  version: 1;
  palaces: { id: string; name: string; updatedAt: number }[];
  lastOpened?: string | null;
}

const INDEX = 'index.json';
const WORLD = 'world.json';
const fileOf = (id: string) => `palaces/${id}.json`;
const backupOf = (id: string, version: number) => `backups/${id}.v${version}.json`;
const DEBOUNCE = 500;

export class PalaceStore {
  private index: PalaceIndex | null = null;
  private world: PalaceWorld | null = null;
  /** 世界文件读不了（更新版本的插件写的）：先用一个临时世界，不写回，免得覆盖掉 */
  private worldLocked = false;
  private cache = new Map<string, PalaceDoc>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending = new Map<string, () => Promise<void>>();

  constructor(private storage: StorageAdapter, private onError: (msg: string) => void) { }

  private async loadIndex() {
    if (this.index) return this.index;
    const raw = await this.storage.load(INDEX) as any;
    this.index = raw && typeof raw === 'object' && Array.isArray(raw.palaces) ? raw : { version: 1, palaces: [] };
    return this.index;
  }

  private async loadWorld() {
    if (this.world) return this.world;
    const raw = await this.storage.load(WORLD);
    try {
      this.world = raw && typeof raw === 'object' ? normalizeWorld(raw) : createWorld();
    } catch (e) {
      this.world = createWorld();
      this.worldLocked = !!raw;
      if (raw) this.onError(t('{msg}（岛上的摆放这次不会保存）', { msg: String((e as Error)?.message || e) }));
    }
    return this.world;
  }

  private async readDoc(id: string) {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const raw = await this.storage.load(fileOf(id)) as any;
    if (!raw || typeof raw !== 'object') return null;
    const doc = normalizePalace(raw);
    const from = Number(raw.version) || 1;
    if (from < PALACE_VERSION) await this.backup(id, from, raw);
    this.cache.set(id, doc);
    return doc;
  }

  /** 世界 + 全部宫殿（每次返回新的副本，视图可以随意修改）；一座都没有时用「我的家」模板建一座 */
  async loadAll(): Promise<{ world: PalaceWorld; docs: PalaceDoc[]; lastOpened: string | null }> {
    const idx = await this.loadIndex();
    if (!idx.palaces.length) {
      const doc = createHomePalace();
      doc.color = '#c46d4d';
      await this.writeDoc(doc);
    }
    const failed: string[] = [];
    const docs = (await Promise.all(idx.palaces.map(p => this.readDoc(p.id).catch((e) => {
      // 更新版本的插件写的宫殿：不显示也不改动，提示升级
      if ((e as { code?: string })?.code === NEWER_VERSION) failed.push(p.name || p.id);
      return null;
    })))).filter(Boolean);
    if (failed.length) this.onError(t('{names}是更新版本的插件保存的，请升级插件后再打开', { names: failed.map(n => t('「{name}」', { name: n })).join(isZh() ? '' : ', ') }));
    const world = await this.loadWorld();
    return { world: cloneWorld(world), docs: docs.map(clonePalace), lastOpened: idx.lastOpened || null };
  }

  /** 视图里某座宫殿变了（或新建了一座）：更新缓存并防抖写盘 */
  saveDoc(doc: PalaceDoc) {
    const copy = clonePalace(doc);
    this.cache.set(doc.id, copy);
    this.schedule('doc:' + doc.id, () => this.writeDoc(copy));
  }

  saveWorld(world: PalaceWorld) {
    if (this.worldLocked) return;
    const copy = cloneWorld(world);
    this.world = copy;
    this.schedule('world', async () => { await this.write(WORLD, copy); });
  }

  /** 删除一座宫殿的数据文件 */
  async remove(id: string) {
    const key = 'doc:' + id;
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.pending.delete(key);
    this.cache.delete(id);
    try {
      await this.storage.remove(fileOf(id));
    } catch (e) {
      this.onError(String((e as Error)?.message || e));
    }
    const idx = await this.loadIndex();
    idx.palaces = idx.palaces.filter(p => p.id !== id);
    if (idx.lastOpened === id) idx.lastOpened = null;
    await this.saveIndex();
  }

  async setLastOpened(id: string | null) {
    const idx = await this.loadIndex();
    if (idx.lastOpened === id) return;
    idx.lastOpened = id;
    this.schedule('index', () => this.saveIndex());
  }

  async flush() {
    const jobs = [...this.pending.entries()];
    this.pending.clear();
    this.timers.forEach(t => clearTimeout(t));
    this.timers.clear();
    await Promise.all(jobs.map(([, fn]) => fn()));
  }

  /** 同步 / 其他端改动了存储：丢弃缓存，下次重新读取 */
  async reload() {
    await this.flush();
    this.index = null;
    this.world = null;
    this.worldLocked = false;
    this.cache.clear();
    await this.loadIndex();
  }

  private schedule(key: string, fn: () => Promise<void>) {
    this.pending.set(key, fn);
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      const job = this.pending.get(key);
      this.pending.delete(key);
      void job?.();
    }, DEBOUNCE));
  }

  private async write(file: string, data: unknown) {
    try {
      await this.storage.save(file, data);
      return true;
    } catch (e) {
      this.onError(String((e as Error)?.message || e));
      return false;
    }
  }

  private async writeDoc(doc: PalaceDoc) {
    if (!await this.write(fileOf(doc.id), doc)) return;
    this.cache.set(doc.id, doc);
    const idx = await this.loadIndex();
    const entry = { id: doc.id, name: doc.name, updatedAt: doc.updatedAt };
    const i = idx.palaces.findIndex(p => p.id === doc.id);
    if (i < 0) idx.palaces.push(entry); else idx.palaces[i] = entry;
    await this.saveIndex();
  }

  /** 升级数据格式前留一份原样备份（已有就不覆盖）；备份失败不影响使用 */
  private async backup(id: string, version: number, raw: unknown) {
    const file = backupOf(id, version);
    try {
      const old = await this.storage.load(file);
      if (old && typeof old === 'object') return;
    } catch { /* 没有旧备份 */ }
    await this.write(file, raw);
  }

  private async saveIndex() {
    if (this.index) await this.write(INDEX, this.index);
  }
}
