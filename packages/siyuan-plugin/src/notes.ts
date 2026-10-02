import { fetchSyncPost } from 'siyuan';
import { t } from '@kmind-palace/core';

/* =====================================================================
 * 笔记正文（给大模型当素材）、把记忆故事写回笔记
 * ===================================================================== */

const BLOCK_ID = /^\d{14}-[0-9a-z]{7}$/;
const MAX_TEXT = 3000;

async function post(url: string, body: unknown) {
  const res = await fetchSyncPost(url, body);
  if (res.code !== 0) throw new Error(res.msg || url);
  return res.data;
}

async function sql(stmt: string): Promise<any[]> {
  return (await post('/api/query/sql', { stmt })) || [];
}

/** 去掉 kramdown 里的块属性 {: …} */
const stripIal = (s: string) => s.replace(/\{:[^}]*\}/g, '').replace(/\n{3,}/g, '\n\n').trim();

async function kramdown(id: string) {
  const d = await post('/api/block/getBlockKramdown', { id });
  return stripIal(d?.kramdown || '');
}

/** 块的正文：文档导出整篇 Markdown；标题连同它下面的内容；其他块取它自己（容器块含子块） */
export async function getBlockText(id: string) {
  if (!BLOCK_ID.test(id)) return '';
  const [row] = await sql(`SELECT type FROM blocks WHERE id = '${id}' LIMIT 1`);
  let text = '';
  if (row?.type === 'd') {
    // 导出的 Markdown 开头有 YAML 头（title / date），对模型没用
    text = ((await post('/api/export/exportMdContent', { id }))?.content || '').replace(/^---\n[\s\S]*?\n---\n/, '');
  } else if (row?.type === 'h') {
    const kids: string[] = (await post('/api/block/getHeadingChildrenIDs', { id })) || [];
    const parts = await Promise.all([id, ...kids.slice(0, 40)].map(k => kramdown(k).catch(() => '')));
    text = parts.filter(Boolean).join('\n\n');
  } else {
    text = await kramdown(id);
  }
  text = text.trim();
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '…' : text;
}

const attrValue = (s: string) => s.replace(/["\\\n]/g, ' ');
const sqlString = (s: string) => s.replace(/'/g, "''");

/**
 * 写回笔记：在绑定的块下面插一段引述（文档则追加到末尾），带上 custom-kp-story 属性；
 * 同一个记忆桩再写一次时更新那一块。配图先上传到 assets，笔记里引用它（这样也不会被当成未引用资源清理掉）。
 */
export async function writeStory(opts: { blockId: string; ref: string; noteId?: string; palace: string; place: string; story: string; image?: string }, loadImage: (id: string) => Promise<Blob>): Promise<string> {
  const { blockId, ref, noteId, palace, place, story, image } = opts;
  if (!BLOCK_ID.test(blockId)) throw new Error(t('无效的块'));
  const quote = (s: string) => s.split('\n').map(l => `> ${l}`).join('\n');
  let md = quote(`🏛️ **${t('记忆故事')}** · ${palace} · ${place}\n\n${story}`);
  if (image) {
    const blob = await loadImage(image);
    const form = new FormData();
    form.append('assetsDirPath', '/assets/');
    form.append('file[]', new File([blob], `memory-${image}`, { type: blob.type || 'image/webp' }));
    const up = await fetch('/api/asset/upload', { method: 'POST', body: form }).then(r => r.json());
    const path = up?.data?.succMap ? Object.values(up.data.succMap)[0] as string : '';
    if (path) md += '\n>\n' + quote(`![${t('记忆画面')}](${path})`);
  }
  md += `\n{: custom-kp-story="${attrValue(ref)}"}`;
  // 上次写入的那一块：优先按记下的 id 找（SQL 索引有几秒延迟，刚写的块按属性查不到），其次按属性查
  let target = noteId && BLOCK_ID.test(noteId) && (await post('/api/block/checkBlockExist', { id: noteId }).catch(() => false)) ? noteId : '';
  if (!target) {
    const [old] = await sql(`SELECT block_id FROM attributes WHERE name = 'custom-kp-story' AND value = '${sqlString(attrValue(ref))}' LIMIT 1`);
    target = old?.block_id || '';
  }
  if (target) {
    await post('/api/block/updateBlock', { id: target, dataType: 'markdown', data: md });
    return target;
  }
  const [row] = await sql(`SELECT type FROM blocks WHERE id = '${blockId}' LIMIT 1`);
  if (!row) throw new Error(t('绑定的块已不存在'));
  const tx = row.type === 'd'
    ? await post('/api/block/appendBlock', { parentID: blockId, dataType: 'markdown', data: md })
    : await post('/api/block/insertBlock', { previousID: blockId, dataType: 'markdown', data: md });
  return tx?.[0]?.doOperations?.[0]?.id || '';
}
