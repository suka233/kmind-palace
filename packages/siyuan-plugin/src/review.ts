import { Protyle, fetchSyncPost, type App } from 'siyuan';
import { t, type Rating, type ReviewAdapter, type ReviewState } from '@kmind-palace/core';

/* =====================================================================
 * 思源闪卡：记忆桩的复习状态、回忆时的自评
 * 用思源的内置卡包——和「闪卡」里复习的是同一张卡，两边的进度互通。
 * ===================================================================== */

/** 思源内置卡包（kernel/model/flashcard.go builtinDeckID） */
const BUILTIN_DECK = '20230218211946-2kw8jgx';
const BATCH = 200;

interface RiffBlock {
  id: string;
  riffCardID?: string;
  riffCard?: { due: string; reps: number; lapses: number; state: number; lastReview: string } | null;
}

const time = (s?: string) => {
  const t = s ? Date.parse(s) : NaN;
  return t > 0 ? t : undefined;
};

function toState(b: RiffBlock | undefined): ReviewState | null {
  if (!b?.riffCardID || !b.riffCard) return null;
  const c = b.riffCard;
  return { card: true, due: time(c.due), state: c.state, reps: c.reps, lapses: c.lapses, lastReview: time(c.lastReview) };
}

/** 按块查闪卡；有块已被删除时整批请求会失败，这时逐个查并跳过出错的 */
async function riffBlocks(ids: string[]): Promise<RiffBlock[]> {
  const res = await fetchSyncPost('/api/riff/getRiffCardsByBlockIDs', { blockIDs: ids });
  if (res.code === 0) return res.data?.blocks || [];
  if (ids.length === 1) return [];
  const parts = await Promise.all(ids.map(id => riffBlocks([id]).catch(() => [] as RiffBlock[])));
  return parts.flat();
}

export function createReview(): ReviewAdapter {
  return {
    async getStates(ids) {
      const out: Record<string, ReviewState> = {};
      for (let i = 0; i < ids.length; i += BATCH) {
        for (const b of await riffBlocks(ids.slice(i, i + BATCH))) {
          const s = toState(b);
          if (s) out[b.id] = s;
        }
      }
      return out;
    },
    async rate(id: string, rating: Rating) {
      let [b] = await riffBlocks([id]);
      if (!b?.riffCardID) {
        const add = await fetchSyncPost('/api/riff/addRiffCards', { deckID: BUILTIN_DECK, blockIDs: [id] });
        if (add.code !== 0) throw new Error(add.msg || t('加入闪卡失败'));
        [b] = await riffBlocks([id]);
      }
      if (!b?.riffCardID) throw new Error(t('无法把这个块加入闪卡'));
      const r = await fetchSyncPost('/api/riff/reviewRiffCard', { deckID: BUILTIN_DECK, cardID: b.riffCardID, rating, reviewedCards: [] });
      if (r.code !== 0) throw new Error(r.msg || t('记录复习失败'));
      [b] = await riffBlocks([id]);
      return toState(b);
    },
  };
}

/**
 * 回忆模式揭晓答案：用思源编辑器只读显示块的内容（和悬浮预览一样：普通块只显示这个块，文档显示开头）。
 * 返回清理函数；编辑器是异步创建的，清理可能早于创建完成。
 */
export function renderBlock(app: App, el: HTMLElement, id: string) {
  let editor: Protyle | null = null, gone = false;
  void fetchSyncPost('/api/block/getBlockInfo', { id }).then((info) => {
    if (gone || !el.isConnected) return;
    if (info.code !== 0) { el.textContent = info.msg || t('这个块已不存在'); return; }
    const isDoc = info.data?.rootID === id;
    editor = new Protyle(app, el, {
      blockId: id,
      action: [isDoc ? 'cb-get-context' : 'cb-get-all'],
      render: { background: false, title: false, gutter: false, breadcrumb: false, scroll: true },
      typewriterMode: false,
      after: (p) => { try { p.disable(); } catch { /* 旧版本没有 disable */ } },
    });
  });
  return () => {
    gone = true;
    try { editor?.destroy(); } catch { /* 已销毁 */ }
    editor = null;
  };
}
