import { Dialog, fetchSyncPost, type Plugin } from 'siyuan';
import { t, html, type DocEntry, type DocSource } from '@kmind-palace/core';

/* =====================================================================
 * 书架 = 笔记本：列文档、选书目来源、文档树变化时通知；用户照片的存取
 * ===================================================================== */

interface FileItem { id: string; name: string; path: string; subFileCount: number }

async function listFiles(box: string, path: string): Promise<FileItem[]> {
  const res = await fetchSyncPost('/api/filetree/listDocsByPath', { notebook: box, path });
  if (res.code !== 0) throw new Error(res.msg || t('读取文档列表失败'));
  return res.data?.files || [];
}

/** 一个来源下的文档，按用户在文档树里的排序 */
export async function listDocs(src: DocSource): Promise<DocEntry[]> {
  const files = await listFiles(src.box, src.path);
  return files.map(f => ({ id: f.id, title: (f.name || '').replace(/\.sy$/, '') || f.id, subDocs: f.subFileCount || 0 }));
}

/** 这些消息意味着文档树变了（新建、删除、改名、移动文档，改笔记本名） */
const TREE_CMDS = new Set(['create', 'createdailynote', 'removeDoc', 'removeDocs', 'rename', 'moveDoc', 'moveDocs', 'renamenotebook', 'unmount', 'mount', 'reloadFiletree', 'sortDocs']);

export function watchDocs(plugin: Plugin, cb: () => void) {
  const handler = ({ detail }: CustomEvent<any>) => { if (TREE_CMDS.has(detail?.cmd)) cb(); };
  plugin.eventBus.on('ws-main', handler);
  return () => plugin.eventBus.off('ws-main', handler);
}

/**
 * 选书目来源：笔记本（摆它的顶层文档），或展开后选一篇文档（摆它的子文档）。
 */
export function openSourcePicker(plugin: Plugin, opts: { current?: DocSource; mobile?: boolean }): Promise<DocSource | null> {
  const i18n = (key: string) => (plugin.i18n[key] as string ?? key);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: DocSource | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
      dialog.destroy();
    };
    const dialog = new Dialog({
      title: i18n('sourceTitle'),
      content: '<div class="kmp-picker"><div class="kmp-caption"></div><div class="kmp-list kmp-tree"></div></div>',
      width: opts.mobile ? '92vw' : '560px',
      height: opts.mobile ? '80vh' : '560px',
      destroyCallback: () => { if (!settled) { settled = true; resolve(null); } },
    });
    const tree = dialog.element.querySelector('.kmp-tree') as HTMLElement;
    dialog.element.querySelector('.kmp-picker .kmp-caption').textContent = i18n('sourceHint');
    const cur = opts.current;

    const row = (o: { box: string; path: string; name: string; depth: number; kids: number; notebook?: boolean }) => html`
      <div class="kmp-node${cur && cur.box === o.box && cur.path === o.path ? ' kmp-current' : ''}" data-box="${o.box}" data-path="${o.path}" data-name="${o.name}" style="padding-left:${8 + o.depth * 18}px">
        <span class="kmp-toggle${o.kids ? '' : ' kmp-leaf'}" data-act="toggle">${o.kids ? '›' : ''}</span>
        <span class="kmp-node-name">${o.notebook ? '📚' : '📄'} ${o.name}${o.kids ? html`<small>${o.notebook ? '' : t('{n} 篇', { n: o.kids })}</small>` : ''}</span>
        ${o.kids ? html`<button class="b3-button b3-button--small b3-button--outline" data-act="choose">${i18n('sourceChoose')}</button>` : ''}
      </div><div class="kmp-kids" hidden></div>`;

    void fetchSyncPost('/api/notebook/lsNotebooks', {}).then((res) => {
      const nbs = (res.code === 0 ? res.data?.notebooks || [] : []).filter((n: any) => !n.closed);
      const rows = nbs.map((n: any) => row({ box: n.id, path: '/', name: n.name, depth: 0, kids: 1, notebook: true }));
      tree.replaceChildren(...(rows.length ? rows : [html`<div class="kmp-empty">${i18n('noNotebooks')}</div>`]));
    });

    tree.addEventListener('click', (e) => void (async () => {
      const el = e.target as HTMLElement;
      const node = el.closest<HTMLElement>('.kmp-node');
      if (!node) return;
      const { box, path, name } = node.dataset;
      if (el.closest('[data-act="choose"]')) { finish({ box, path, name }); return; }
      // 展开 / 收起子文档
      const kids = node.nextElementSibling as HTMLElement;
      const toggle = node.querySelector('.kmp-toggle');
      if (!toggle || toggle.classList.contains('kmp-leaf')) return;
      if (!kids.hidden) { kids.hidden = true; toggle.classList.remove('kmp-open'); return; }
      kids.hidden = false;
      toggle.classList.add('kmp-open');
      if (kids.dataset.loaded) return;
      kids.dataset.loaded = '1';
      const depth = Math.round((parseInt(node.style.paddingLeft) - 8) / 18) + 1;
      try {
        const files = await listFiles(box, path);
        const rows = files.map(f => row({ box, path: f.path, name: (f.name || '').replace(/\.sy$/, ''), depth, kids: f.subFileCount || 0 }));
        kids.replaceChildren(...(rows.length ? rows : [html`<div class="kmp-empty" style="padding-left:${8 + depth * 18}px">${i18n('noDocs')}</div>`]));
      } catch (err) {
        kids.replaceChildren(html`<div class="kmp-empty">${String((err as Error)?.message || err)}</div>`);
      }
    })());
  });
}

// =====================================================================
// 用户照片：存在插件存储 data/storage/petal/kmind-palace/media/ 下（随思源同步）。
// 不放进 assets：思源的「清理未引用资源」只看笔记里的引用，会把它们当成未引用删掉。
// =====================================================================

const mediaPath = (plugin: Plugin, id: string) => `/data/storage/petal/${plugin.name}/media/${id}`;

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', glb: 'model/gltf-binary' };

/** id 是内容哈希（内核算好），同名即同内容 */
export async function saveMedia(plugin: Plugin, blob: Blob, id: string) {
  if (!/^[\w-]{1,80}\.[a-z0-9]{1,5}$/i.test(id)) throw new Error(t('无效的媒体 id'));
  const form = new FormData();
  form.append('path', mediaPath(plugin, id));
  form.append('isDir', 'false');
  form.append('modTime', String(Date.now()));
  form.append('file', blob, id);
  const res = await fetch('/api/file/putFile', { method: 'POST', body: form }).then(r => r.json());
  if (res.code !== 0) throw new Error(res.msg || t('保存文件失败'));
}

const mediaUrls = new Map<string, string>();

export async function loadMedia(plugin: Plugin, id: string) {
  const hit = mediaUrls.get(id);
  if (hit) return hit;
  const res = await fetch('/api/file/getFile', { method: 'POST', body: JSON.stringify({ path: mediaPath(plugin, id) }) });
  const type = res.headers.get('content-type') || '';
  // 文件不存在时返回的是 JSON 错误
  if (!res.ok || type.includes('application/json')) throw new Error(t('文件不存在'));
  const ext = id.split('.').pop() || '';
  const blob = new Blob([await res.arrayBuffer()], { type: MIME[ext] || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  mediaUrls.set(id, url);
  return url;
}
