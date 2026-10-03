import type { PalaceView } from './view';
import { getBinding, locusKey, type LocusBinding, type PalaceItem } from './schema';
import { storyMessages, cleanStory, imagePrompt, type StoryContext } from './story';
import { resolveRoute } from './route';
import { compressImage, storeMedia } from './media';
import { t } from './i18n';
import { html } from './dom';

/* =====================================================================
 * 记忆故事：卡片里的「记忆故事」一节 + 生成 / 配图 / 写回笔记
 * 故事存在绑定上（binding.story / binding.image），自己写也行，有大模型时可以让它编。
 * ===================================================================== */

type Busy = 'story' | 'image' | 'write';

export class StoryController {
  private busy = new Map<string, Busy>();
  private editing: string | null = null;
  private confirmClear: string | null = null;

  constructor(private v: PalaceView) { }

  /** 卡片里的「记忆故事」一节（只在已绑定的记忆桩上显示） */
  section(item: PalaceItem, slot: string, b: LocusBinding): DocumentFragment {
    const host = this.v.host, key = locusKey(item.id, slot), busy = this.busy.get(key);
    const canAi = !!host.ai;
    const canImg = !!host.ai?.image && (host.ai.imageEnabled?.() ?? true) && !!host.saveMedia;
    if (this.editing === key) {
      return html`<div class="kp-story kp-story-editing">
        <div class="kp-story-head"><b>${t('记忆故事')}</b></div>
        <textarea class="kp-story-input" data-field="story" rows="5" maxlength="400" placeholder="${t('把笔记内容想象成发生在这里的一个画面：物件在做什么？有什么声音、气味？')}"></textarea>
        <div class="kp-story-tools"><button data-act="storyCancel">${t('取消')}</button><button class="kp-primary" data-act="storySave">${t('保存')}</button></div>
      </div>`;
    }
    const dis = busy ? 'disabled' : '';
    const tools: DocumentFragment[] = [];
    if (canAi) tools.push(html`<button data-act="storyAi" ${dis}>${busy === 'story' ? t('正在编…') : b.story ? t('✨ 换一个') : t('✨ AI 编一个')}</button>`);
    tools.push(html`<button data-act="storyEdit" ${dis}>${b.story ? t('改') : t('自己写')}</button>`);
    if (b.story && canImg) tools.push(html`<button data-act="storyImage" ${dis}>${busy === 'image' ? t('正在画…') : b.image ? t('重画') : t('🎨 配图')}</button>`);
    if (b.story && host.writeStory && this.v.isLocalNote(b)) tools.push(html`<button data-act="storyWrite" ${dis} title="${t('在笔记里这个块的下面插一段引述')}">${busy === 'write' ? t('写入中…') : t('写回笔记')}</button>`);
    if (b.story || b.image) tools.push(html`<button class="kp-danger" data-act="storyClear" ${dis}>${this.confirmClear === key ? t('确认删除') : t('删除')}</button>`);
    const empty = busy === 'story' ? t('正在把笔记变成这个位置上的一个画面…') : t('把笔记内容想象成发生在这里的一个夸张小场景，会记得更牢。');
    return html`<div class="kp-story">
      <div class="kp-story-head"><b>${t('记忆故事')}</b></div>
      ${b.story ? html`<p class="kp-story-text"></p>` : html`<p class="kp-story-empty">${empty}</p>`}
      ${b.image ? html`<img class="kp-story-img" alt="">` : busy === 'image' ? html`<div class="kp-story-img kp-story-wait">${t('正在画…')}</div>` : ''}
      <div class="kp-story-tools">${tools}</div>
    </div>`;
  }

  /** 卡片渲染之后：填文字（故事正文不放进模板）、加载配图、绑定输入框的快捷键 */
  hydrate(root: HTMLElement, b: LocusBinding) {
    const txt = root.querySelector('.kp-story-text');
    if (txt) txt.textContent = b.story;
    const img = root.querySelector<HTMLImageElement>('img.kp-story-img');
    if (img && b.image) {
      this.v.mediaUrl(b.image).then(u => { img.src = u; }).catch(() => img.remove());
    }
    const ta = root.querySelector<HTMLTextAreaElement>('textarea[data-field="story"]');
    if (ta) {
      ta.value = b.story || '';
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.onAction('storySave'); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.onAction('storyCancel'); }
      });
      window.setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
    }
  }

  onAction(act: string): boolean {
    if (!act.startsWith('story')) return false;
    const sel = this.v.selected;
    if (!sel) return true;
    const item = sel.userData.item as PalaceItem, slot = this.v.selectedSlot, key = locusKey(item.id, slot);
    const b = getBinding(item, slot);
    if (!b) return true;
    if (act !== 'storyClear') this.confirmClear = null;
    switch (act) {
      case 'storyAi': void this.generate(item, slot); break;
      case 'storyEdit': this.editing = key; this.refresh(item, slot); break;
      case 'storyCancel': this.editing = null; this.refresh(item, slot); break;
      case 'storySave': {
        const ta = this.v.ui.card.querySelector<HTMLTextAreaElement>('textarea[data-field="story"]');
        this.editing = null;
        this.update(item, slot, { story: ta?.value.trim() || undefined });
        break;
      }
      case 'storyImage': void this.illustrate(item, slot); break;
      case 'storyWrite': void this.writeBack(item, slot); break;
      case 'storyClear':
        if (this.confirmClear !== key) { this.confirmClear = key; this.refresh(item, slot); break; }
        this.confirmClear = null;
        // 已经写回笔记的那一块留在笔记里（那是用户的内容），这里只断开关联
        this.update(item, slot, { story: undefined, image: undefined, storyNote: undefined });
        break;
    }
    return true;
  }

  /** 换了选中对象：退出编辑 */
  reset() {
    this.editing = null;
    this.confirmClear = null;
  }

  // =====================================================================

  private update(item: PalaceItem, slot: string, patch: Partial<LocusBinding>) {
    const b = getBinding(item, slot);
    if (!b) return;
    for (const [k, val] of Object.entries(patch)) {
      if (val === undefined || val === null || val === '') delete (b as any)[k];
      else (b as any)[k] = val;
    }
    this.v.emitChange();
    this.refresh(item, slot);
  }

  private refresh(item: PalaceItem, slot: string) {
    const sel = this.v.selected;
    if (sel?.userData.item === item && this.v.selectedSlot === slot) this.v.showCard(sel);
  }

  private fail(what: string, e: unknown) {
    const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
    const hint = this.v.host.openSettings ? t('（可以在插件设置里配置大模型）') : '';
    this.v.host.notify?.(t('{what}：{msg}', { what, msg }) + hint, 'error');
  }

  /** 给大模型的素材：位置、笔记正文、路线上的前后两站 */
  private async context(item: PalaceItem, slot: string): Promise<StoryContext> {
    const v = this.v, b = getBinding(item, slot), key = locusKey(item.id, slot);
    let content = '';
    if (v.isLocalNote(b)) {
      try { content = (await v.host.getBlockText?.(b.blockId)) || ''; } catch { /* 读不到正文时只按标题编 */ }
    }
    const stops = resolveRoute(v.doc, v.recall.current() || { stops: [] }).filter(s => s.binding);
    const i = stops.findIndex(s => s.key === key);
    const near = (j: number) => (j >= 0 && j < stops.length ? v.locusName(stops[j].item, stops[j].slot) : undefined);
    return {
      place: v.locusName(item, slot),
      room: v.built?.roomOf(item.room)?.name,
      palace: v.doc?.name,
      title: b.title || b.blockId,
      content,
      prev: i >= 0 ? near(i - 1) : undefined,
      next: i >= 0 ? near(i + 1) : undefined,
    };
  }

  private async run(item: PalaceItem, slot: string, kind: Busy, fn: () => Promise<void>) {
    const key = locusKey(item.id, slot);
    if (this.busy.has(key)) return;
    this.busy.set(key, kind);
    this.refresh(item, slot);
    try { await fn(); } finally {
      this.busy.delete(key);
      this.refresh(item, slot);
    }
  }

  /** 让大模型编一个记忆故事 */
  async generate(item: PalaceItem, slot: string) {
    const ai = this.v.host.ai;
    if (!ai) return;
    await this.run(item, slot, 'story', async () => {
      try {
        const ctx = await this.context(item, slot);
        const raw = await ai.chat(storyMessages(ctx, ai.style?.() || 'vivid'), { temperature: .9 });
        const story = cleanStory(raw);
        if (!story) throw new Error(t('模型没有返回内容'));
        this.update(item, slot, { story });
      } catch (e) { this.fail(t('没能编出记忆故事'), e); }
    });
  }

  /** 按故事画一张配图，压缩后交给宿主保存 */
  async illustrate(item: PalaceItem, slot: string) {
    const host = this.v.host, b = getBinding(item, slot);
    if (!host.ai?.image || !host.saveMedia || !b?.story) return;
    await this.run(item, slot, 'image', async () => {
      try {
        const blob = await host.ai.image(imagePrompt(b.story, this.v.locusName(item, slot)));
        const c = await compressImage(blob, 1024, .85);
        const id = await storeMedia(host, c.blob, c.ext);
        this.update(item, slot, { image: id });
      } catch (e) { this.fail(t('没能画出配图'), e); }
    });
  }

  /** 写回笔记：在绑定的块下面插一段引述（再写一次时更新同一块） */
  async writeBack(item: PalaceItem, slot: string) {
    const host = this.v.host, b = getBinding(item, slot), doc = this.v.doc;
    if (!host.writeStory || !b?.story || !doc || !this.v.isLocalNote(b)) return;
    await this.run(item, slot, 'write', async () => {
      try {
        const id = await host.writeStory({ blockId: b.blockId, ref: `${doc.id}/${locusKey(item.id, slot)}`, noteId: b.storyNote, palace: doc.name, place: this.v.locusName(item, slot), story: b.story, image: b.image });
        if (id && id !== b.storyNote) this.update(item, slot, { storyNote: id });
        host.notify?.(t('记忆故事已写回笔记'));
      } catch (e) { this.fail(t('没能写回笔记'), e); }
    });
  }
}
