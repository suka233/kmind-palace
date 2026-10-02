import { Dialog, fetchSyncPost, type Plugin } from 'siyuan';
import { t, type BlockRef } from '@kmind-palace/core';

/* =====================================================================
 * 块选择器：搜索文档 / 块，或粘贴块引用、块链接、块 ID
 * ===================================================================== */

const BLOCK_ID = /\d{14}-[0-9a-z]{7}/;

const TYPE_LABEL: Record<string, string> = {
  NodeDocument: '文档', NodeHeading: '标题', NodeParagraph: '段落', NodeList: '列表', NodeListItem: '列表项',
  NodeBlockquote: '引述', NodeSuperBlock: '超级块', NodeCodeBlock: '代码', NodeTable: '表格', NodeMathBlock: '公式',
  NodeHTMLBlock: 'HTML', NodeCallout: '标注', d: '文档', h: '标题', p: '段落', l: '列表', i: '列表项', b: '引述', s: '超级块', c: '代码', t: '表格', m: '公式',
};

interface Row { id: string; html: string; text: string; path: string; type: string }

/** 只保留搜索高亮的 <mark>，其余标签去掉 */
function sanitize(html: string) {
  return (html || '').replace(/<(?!\/?mark>)[^>]*>/g, '');
}
function textOf(html: string) {
  const d = document.createElement('div');
  d.innerHTML = sanitize(html);
  return (d.textContent || '').trim();
}
function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function getBlockRef(id: string): Promise<BlockRef | null> {
  const exist = await fetchSyncPost('/api/block/checkBlockExist', { id });
  if (exist.code !== 0) throw new Error(exist.msg);
  if (!exist.data) return null;
  const ref = await fetchSyncPost('/api/block/getRefText', { id });
  const title = textOf(ref.code === 0 ? ref.data : '') || id;
  return { id, title };
}

export function openBlockPicker(plugin: Plugin, opts: { itemName?: string; current?: string; mobile?: boolean }): Promise<BlockRef | null> {
  const i18n = (key: string, vars: Record<string, string> = {}) =>
    String(plugin.i18n[key] ?? key).replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? '');

  return new Promise((resolve) => {
    let settled = false;
    let rows: Row[] = [];
    let active = 0;
    let seq = 0;
    const finish = (ref: BlockRef | null) => {
      if (settled) return;
      settled = true;
      resolve(ref);
      dialog.destroy();
    };

    const dialog = new Dialog({
      title: i18n('pickTitle', { name: opts.itemName || '' }),
      content: `<div class="kmp-picker">
        <input class="b3-text-field fn__block kmp-input" placeholder="${escapeHtml(i18n('searchPlaceholder'))}">
        <div class="kmp-caption"></div>
        <div class="kmp-list"></div>
        <div class="kmp-foot">${escapeHtml(i18n('pickHint'))}</div>
      </div>`,
      width: opts.mobile ? '92vw' : '600px',
      height: opts.mobile ? '80vh' : '560px',
      destroyCallback: () => { if (!settled) { settled = true; resolve(null); } },
    });

    const root = dialog.element.querySelector('.kmp-picker') as HTMLElement;
    const input = root.querySelector('.kmp-input') as HTMLInputElement;
    const list = root.querySelector('.kmp-list') as HTMLElement;
    const caption = root.querySelector('.kmp-caption') as HTMLElement;

    const render = () => {
      if (!rows.length) {
        list.innerHTML = `<div class="kmp-empty">${escapeHtml(i18n('noResults'))}</div>`;
        return;
      }
      list.innerHTML = rows.map((r, i) => `
        <div class="kmp-row${i === active ? ' kmp-active' : ''}${r.id === opts.current ? ' kmp-current' : ''}" data-i="${i}">
          <span class="kmp-type">${escapeHtml(t(TYPE_LABEL[r.type] || '块'))}</span>
          <div class="kmp-main">
            <div class="kmp-text">${r.html || escapeHtml(r.text)}</div>
            ${r.path ? `<div class="kmp-path">${escapeHtml(r.path)}</div>` : ''}
          </div>
        </div>`).join('');
      list.querySelector('.kmp-active')?.scrollIntoView({ block: 'nearest' });
    };

    const choose = (i: number) => {
      const r = rows[i];
      if (r) finish({ id: r.id, title: r.text.slice(0, 120) || r.id, path: r.path, type: r.type });
    };

    const showRecent = async () => {
      const my = ++seq;
      caption.textContent = i18n('recent');
      const res = await fetchSyncPost('/api/storage/getRecentDocs', { sortBy: 'viewedAt' });
      if (my !== seq) return;
      rows = (res.code === 0 && Array.isArray(res.data) ? res.data : []).slice(0, 30).map((d: any) => ({
        id: d.rootID, html: '', text: d.title || d.rootID, path: '', type: 'NodeDocument',
      }));
      active = 0; render();
    };

    const search = async (q: string) => {
      const my = ++seq;
      const id = q.match(BLOCK_ID)?.[0];
      if (id) {
        caption.textContent = '';
        const ref = await getBlockRef(id).catch(() => null);
        if (my !== seq) return;
        rows = ref ? [{ id, html: '', text: ref.title, path: '', type: '' }] : [];
        active = 0; render();
        return;
      }
      caption.textContent = '';
      const res = await fetchSyncPost('/api/search/fullTextSearchBlock', { query: q, method: 0, page: 1, pageSize: 40, groupBy: 0, orderBy: 0 });
      if (my !== seq) return;
      const blocks = res.code === 0 ? (res.data?.blocks || []) : [];
      rows = blocks.map((b: any) => ({
        id: b.id, html: sanitize(b.content), text: textOf(b.content), path: b.hPath || '', type: b.type || '',
      }));
      active = 0; render();
    };

    let timer: ReturnType<typeof setTimeout>;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      timer = setTimeout(() => (q ? search(q) : showRecent()), q ? 220 : 0);
    });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown') { active = Math.min(rows.length - 1, active + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter') { choose(active); e.preventDefault(); }
      else if (e.key === 'Escape') { finish(null); e.preventDefault(); }
    });
    list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.kmp-row');
      if (row) choose(Number(row.dataset.i));
    });

    void showRecent();
    setTimeout(() => input.focus(), 50);
  });
}
