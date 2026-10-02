import type { Plugin } from 'siyuan';
import type { StorageAdapter } from '@kmind-palace/core';

/** 思源插件存储：data/storage/petal/kmind-palace/（随思源同步）。宫殿的读写逻辑在 core 的 PalaceStore 里 */
export function siyuanStorage(plugin: Plugin): StorageAdapter {
  return {
    load: (file) => plugin.loadData(file),
    async save(file, data) {
      const res = await plugin.saveData(file, data);
      if (res && typeof res === 'object' && 'code' in res && res.code !== 0) throw new Error(res.msg || `code ${res.code}`);
    },
    async remove(file) { await plugin.removeData(file); },
  };
}
