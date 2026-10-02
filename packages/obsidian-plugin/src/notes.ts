import { App, Component, FuzzySuggestModal, MarkdownRenderer, SuggestModal, TFile, TFolder } from 'obsidian';
import { t, type BlockRef, type DocEntry, type DocSource } from '@kmind-palace/core';
import { parseNoteId, noteId, sectionText, shortTitle, addBlockId, storyMarkdown, upsertStory, headingRange, blockRange, shortHash, type BlockChoice } from './md';

/* =====================================================================
 * 笔记：选块、读标题 / 正文、渲染、写回记忆故事、书架书目（Obsidian 版）
 * ===================================================================== */

const MAX_TEXT = 3000;

export function fileOf(app: App, id: string): TFile | null {
  const f = app.vault.getFileByPath(parseNoteId(id).path);
  return f && f.extension === 'md' ? f : null;
}

/** 块的标题：整篇是文件名，标题是标题文字，其他块是第一行文字；找不到时返回 null */
export async function getBlockRef(app: App, id: string): Promise<BlockRef | null> {
  const file = fileOf(app, id);
  if (!file) return null;
  const n = parseNoteId(id);
  if (n.kind === 'd') return { id, title: file.basename, path: file.path, type: 'd' };
  const text = sectionText(await app.vault.cachedRead(file), n);
  if (text === null) return null;
  return { id, title: n.kind === 'h' ? n.frag : shortTitle(text) || file.basename, path: file.path, type: n.kind === 'h' ? 'h' : 'p' };
}

/** 块的正文（给大模型当素材） */
export async function getBlockText(app: App, id: string) {
  const file = fileOf(app, id);
  if (!file) return '';
  const text = sectionText(await app.vault.cachedRead(file), parseNoteId(id)) || '';
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '…' : text;
}

/** 回忆揭晓时只读渲染块的内容 */
export function renderBlock(app: App, el: HTMLElement, id: string) {
  const comp = new Component();
  comp.load();
  let alive = true;
  const file = fileOf(app, id);
  if (file) {
    void app.vault.cachedRead(file).then((c) => {
      const md = sectionText(c, parseNoteId(id));
      if (md !== null && alive) return MarkdownRenderer.render(app, md, el, file.path, comp);
    });
  }
  return () => { alive = false; comp.unload(); };
}

// =====================================================================
// 选块：先选笔记，再选整篇 / 某个标题 / 某个段落
// =====================================================================

/** 把 Obsidian 的建议框包成 Promise：选中时返回结果，关掉时返回 null */
function choose<T>(make: (resolve: (v: T | null) => void) => { open(): void }): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: T | null) => { if (!done) { done = true; resolve(v); } };
    make(finish).open();
  });
}

class FileSuggest extends FuzzySuggestModal<TFile> {
  constructor(app: App, placeholder: string, private done: (f: TFile | null) => void) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems() { return this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime); }
  getItemText(f: TFile) { return f.path.replace(/\.md$/, ''); }
  onChooseItem(f: TFile) { this.done(f); }
  onClose() { setTimeout(() => this.done(null), 0); }
}

type PartChoice = { kind: 'd' } | { kind: 'h'; heading: string; level: number } | ({ kind: 'b' } & BlockChoice);

class PartSuggest extends SuggestModal<PartChoice> {
  constructor(app: App, private file: TFile, private parts: PartChoice[], private done: (p: PartChoice | null) => void) {
    super(app);
    this.setPlaceholder(t('《{name}》：整篇、某个标题，还是某一段？', { name: file.basename }));
  }
  private label(p: PartChoice) {
    return p.kind === 'd' ? t('整篇：{name}', { name: this.file.basename }) : p.kind === 'h' ? `${'#'.repeat(p.level)} ${p.heading}` : shortTitle(p.text, 60);
  }
  getSuggestions(q: string) {
    const s = q.trim().toLowerCase();
    return s ? this.parts.filter(p => this.label(p).toLowerCase().includes(s)) : this.parts;
  }
  renderSuggestion(p: PartChoice, el: HTMLElement) {
    el.addClass('kmp-part');
    el.createDiv({ text: this.label(p), cls: p.kind === 'h' ? 'kmp-part-h' : '' });
    if (p.kind === 'b') { const kind = ({ paragraph: '段落', list: '列表项', blockquote: '引述', callout: '标注', table: '表格', code: '代码' } as Record<string, string>)[p.type]; el.createEl('small', { text: kind ? t(kind) : p.type }); }
  }
  onChooseSuggestion(p: PartChoice) { this.done(p); }
  onClose() { setTimeout(() => this.done(null), 0); }
}

/** 一篇笔记里能绑定的部分：整篇、各个标题、各段（列表按列表项） */
async function partsOf(app: App, file: TFile): Promise<PartChoice[]> {
  const cache = app.metadataCache.getFileCache(file);
  const content = await app.vault.cachedRead(file);
  const ls = content.split('\n');
  const text = (a: number, b: number) => ls.slice(a, b + 1).join('\n');
  const out: PartChoice[] = [{ kind: 'd' }];
  const blocks: (PartChoice & { line: number })[] = [];
  for (const h of cache?.headings || []) blocks.push({ kind: 'h', heading: h.heading, level: h.level, line: h.position.start.line });
  for (const s of cache?.sections || []) {
    if (s.type === 'heading' || s.type === 'yaml' || s.type === 'thematicBreak' || s.type === 'html') continue;
    if (s.type === 'list') continue;
    blocks.push({ kind: 'b', type: s.type, endLine: s.position.end.line, text: text(s.position.start.line, s.position.end.line), id: s.id, line: s.position.start.line });
  }
  for (const li of cache?.listItems || []) {
    blocks.push({ kind: 'b', type: 'list', endLine: li.position.end.line, text: text(li.position.start.line, li.position.end.line), id: li.id, line: li.position.start.line });
  }
  blocks.sort((a, b) => a.line - b.line);
  return [...out, ...blocks.slice(0, 400)];
}

/** 选一个块；选中还没有 id 的段落时，在笔记里给它加上 ^kp-xxxx */
export async function pickBlock(app: App, opts: { itemName?: string } = {}): Promise<BlockRef | null> {
  const file = await choose<TFile>(done => new FileSuggest(app, opts.itemName ? t('「{name}」要记住哪篇笔记？', { name: opts.itemName }) : t('选择一篇笔记'), done));
  if (!file) return null;
  const parts = await partsOf(app, file);
  const part = parts.length > 1 ? await choose<PartChoice>(done => new PartSuggest(app, file, parts, done)) : parts[0];
  if (!part) return null;
  if (part.kind === 'd') return { id: noteId(file.path), title: file.basename, path: file.path, type: 'd' };
  if (part.kind === 'h') return { id: noteId(file.path, 'h', part.heading), title: part.heading, path: file.path, type: 'h' };
  let id = part.id;
  if (!id) {
    id = 'kp-' + Math.random().toString(36).slice(2, 8);
    await app.vault.process(file, (c) => addBlockId(c, part, id));
  }
  return { id: noteId(file.path, 'b', id), title: shortTitle(part.text) || file.basename, path: file.path, type: 'p' };
}

// =====================================================================
// 写回记忆故事
// =====================================================================

/**
 * 在绑定的块下面插一段引述（整篇则追加到文末；标题插在标题行下面），末尾带一个由记忆桩决定的块 id，
 * 再写一次时按这个 id 找到原来那段整段替换。配图复制成库里的附件。返回故事那一段的笔记 id。
 */
export async function writeStory(app: App, opts: { blockId: string; ref: string; palace: string; place: string; story: string; image?: string }, loadImage: (id: string) => Promise<Blob>): Promise<string> {
  const file = fileOf(app, opts.blockId);
  if (!file) throw new Error(t('绑定的笔记已不存在'));
  const n = parseNoteId(opts.blockId);
  let image: string | undefined;
  if (opts.image) {
    const name = `kmind-palace-${opts.image}`;
    const existing = app.metadataCache.getFirstLinkpathDest(name, file.path);
    if (existing) image = existing.name;
    else {
      const path = await app.fileManager.getAvailablePathForAttachment(name, file.path);
      const created = await app.vault.createBinary(path, await (await loadImage(opts.image)).arrayBuffer());
      image = created.name;
    }
  }
  const id = 'kps-' + shortHash(opts.ref);
  const md = storyMarkdown({ palace: opts.palace, place: opts.place, story: opts.story, image }, id);
  let missing = false;
  await app.vault.process(file, (c) => {
    let after = -1;
    if (n.kind === 'h') after = headingRange(c, n.frag)?.[0] ?? -2;
    else if (n.kind === 'b') { const r = blockRange(c, n.frag); after = r ? r[1] - 1 : -2; }
    if (after === -2) { missing = true; return c; }
    // 块 id 单独一行的块（引述、表格）：插在 id 那一行后面
    if (n.kind === 'b') { const ls = c.split('\n'); if (ls[after + 1]?.trim() === '' && ls[after + 2]?.trim() === `^${n.frag}`) after += 2; }
    return upsertStory(c, id, md, after);
  });
  if (missing) throw new Error(t('在笔记里找不到绑定的那一段了'));
  return noteId(file.path, 'b', id);
}

// =====================================================================
// 书架 = 文件夹
// =====================================================================

const collator = new Intl.Collator('zh', { numeric: true });

export function listDocs(app: App, src: DocSource): DocEntry[] {
  const folder = src.path === '/' ? app.vault.getRoot() : app.vault.getFolderByPath(src.path);
  if (!folder) return [];
  return folder.children
    .filter((f): f is TFile => f instanceof TFile && f.extension === 'md')
    .sort((a, b) => collator.compare(a.basename, b.basename))
    .map(f => ({ id: f.path, title: f.basename }));
}

class FolderSuggest extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private done: (f: TFolder | null) => void) {
    super(app);
    this.setPlaceholder(t('选一个文件夹：里面的笔记会摆上书架'));
  }
  getItems() { return this.app.vault.getAllFolders(true); }
  getItemText(f: TFolder) { return f.isRoot() ? t('/（整个库的根目录）') : f.path; }
  onChooseItem(f: TFolder) { this.done(f); }
  onClose() { setTimeout(() => this.done(null), 0); }
}

export async function pickDocSource(app: App): Promise<DocSource | null> {
  const f = await choose<TFolder>(done => new FolderSuggest(app, done));
  if (!f) return null;
  return { box: 'vault', path: f.isRoot() ? '/' : f.path, name: f.isRoot() ? app.vault.getName() : f.name };
}
