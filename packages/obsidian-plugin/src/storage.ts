import { App, normalizePath } from 'obsidian';
import { t, type StorageAdapter, type LocalCards } from '@kmind-palace/core';

/* =====================================================================
 * 数据放在库里的一个文件夹（默认「KMind Palace」），随库一起同步（Obsidian 同步、iCloud、git 都行）：
 *   index.json / world.json / palaces/<id>.json / backups/   宫殿数据（读写逻辑在 core 的 PalaceStore）
 *   review.json   记忆桩的闪卡排期（Obsidian 没有自带闪卡）
 *   media/        照片、配图、导入的 3D 模型（文件名是内容哈希）
 * 大模型的 Key 不放这里，放在插件自己的设置里。
 * ===================================================================== */

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', glb: 'model/gltf-binary' };

export class VaultData {
  /** 自己刚写过的文件：文件监听收到的修改事件来自自己时忽略 */
  private writes = new Map<string, number>();
  private mediaUrls = new Map<string, string>();

  constructor(private app: App, private folder: () => string) { }

  path(file: string) { return normalizePath(`${this.folder()}/${file}`); }

  /** 库路径在不在数据文件夹里 */
  isInside(path: string) {
    const root = normalizePath(this.folder());
    return path === root || path.startsWith(root + '/');
  }

  /** 数据文件夹里、且不是自己刚写的文件（别的设备同步过来的改动） */
  isExternalChange(path: string) {
    if (!this.isInside(path)) return false;
    const t = this.writes.get(path);
    return !t || Date.now() - t > 3000;
  }

  private async ensureDir(path: string) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir && !(await this.app.vault.adapter.exists(dir))) await this.app.vault.adapter.mkdir(dir);
  }

  async readJson(file: string): Promise<unknown> {
    const p = this.path(file);
    if (!(await this.app.vault.adapter.exists(p))) return null;
    try { return JSON.parse(await this.app.vault.adapter.read(p)); } catch { return null; }
  }

  async writeJson(file: string, data: unknown) {
    const p = this.path(file);
    await this.ensureDir(p);
    this.writes.set(p, Date.now());
    await this.app.vault.adapter.write(p, JSON.stringify(data, null, 1));
  }

  storage(): StorageAdapter {
    return {
      load: (f) => this.readJson(f),
      save: (f, d) => this.writeJson(f, d),
      remove: async (f) => {
        const p = this.path(f);
        if (await this.app.vault.adapter.exists(p)) { this.writes.set(p, Date.now()); await this.app.vault.adapter.remove(p); }
      },
    };
  }

  reviewIo() {
    return { load: () => this.readJson('review.json'), save: (c: LocalCards) => this.writeJson('review.json', c) };
  }

  async saveMedia(blob: Blob, id: string) {
    if (!/^[\w-]{1,80}\.[a-z0-9]{1,5}$/i.test(id)) throw new Error(t('无效的媒体 id'));
    const p = this.path(`media/${id}`);
    // 文件名是内容哈希：已经有了就不用再写
    if (await this.app.vault.adapter.exists(p)) return;
    await this.ensureDir(p);
    this.writes.set(p, Date.now());
    await this.app.vault.adapter.writeBinary(p, await blob.arrayBuffer());
  }

  async loadMedia(id: string) {
    const hit = this.mediaUrls.get(id);
    if (hit) return hit;
    const p = this.path(`media/${id}`);
    if (!(await this.app.vault.adapter.exists(p))) throw new Error(t('文件不存在'));
    const ext = id.split('.').pop() || '';
    const url = URL.createObjectURL(new Blob([await this.app.vault.adapter.readBinary(p)], { type: MIME[ext] || 'application/octet-stream' }));
    this.mediaUrls.set(id, url);
    return url;
  }

  async mediaBlob(id: string) {
    return fetch(await this.loadMedia(id)).then(r => r.blob());
  }

  dispose() {
    this.mediaUrls.forEach(u => URL.revokeObjectURL(u));
    this.mediaUrls.clear();
  }
}
