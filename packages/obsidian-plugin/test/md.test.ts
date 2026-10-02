import { describe, it, expect } from 'vitest';
import { parseNoteId, noteId, renamePath, sectionText, headingRange, blockRange, shortTitle, addBlockId, storyMarkdown, upsertStory } from '../src/md';

const NOTE = `---
tags: [学习]
---
# 费曼学习法

用自己的话讲给别人听。

## 四个步骤

1. 选一个概念
2. 讲给小孩听 ^kp-step2
3. 查漏补缺

段落第一行
段落第二行 ^kp-para

> 引述一句

^kp-quote

## 另一个标题

\`\`\`
# 代码里的井号不是标题
\`\`\`
结尾`;

describe('笔记 id', () => {
  it('整篇 / 标题 / 块', () => {
    expect(parseNoteId('a/b.md')).toEqual({ path: 'a/b.md', kind: 'd', frag: '' });
    expect(parseNoteId('a/b.md#四个步骤')).toEqual({ path: 'a/b.md', kind: 'h', frag: '四个步骤' });
    expect(parseNoteId('a/b.md#^kp-1')).toEqual({ path: 'a/b.md', kind: 'b', frag: 'kp-1' });
    expect(noteId('a.md', 'b', 'x')).toBe('a.md#^x');
    expect(noteId('a.md', 'h', 'T')).toBe('a.md#T');
  });

  it('改名只认路径分段', () => {
    expect(renamePath('学习/a.md#^x', '学习/a.md', '方法/a.md')).toBe('方法/a.md#^x');
    expect(renamePath('学习/a.md', '学习', '方法')).toBe('方法/a.md');
    expect(renamePath('学习', '学习', '方法')).toBe('方法');
    expect(renamePath('学习笔记/a.md', '学习', '方法')).toBeNull();
  });
});

describe('截取正文', () => {
  it('整篇去掉属性区；标题到下一个同级标题；代码块里的 # 不算', () => {
    expect(sectionText(NOTE, parseNoteId('x.md'))).toMatch(/^# 费曼学习法/);
    const steps = sectionText(NOTE, parseNoteId('x.md#四个步骤'));
    expect(steps).toMatch(/^## 四个步骤/);
    expect(steps).toContain('3. 查漏补缺');
    expect(steps).not.toContain('另一个标题');
    expect(steps).not.toContain('^kp-');
    expect(headingRange(NOTE, '另一个标题')[1]).toBe(NOTE.split('\n').length);
    expect(sectionText(NOTE, parseNoteId('x.md#不存在'))).toBeNull();
  });

  it('块：列表项、多行段落、单独一行 id 的引述', () => {
    expect(sectionText(NOTE, parseNoteId('x.md#^kp-step2'))).toBe('2. 讲给小孩听');
    expect(sectionText(NOTE, parseNoteId('x.md#^kp-para'))).toBe('段落第一行\n段落第二行');
    expect(sectionText(NOTE, parseNoteId('x.md#^kp-quote'))).toBe('> 引述一句');
    expect(blockRange(NOTE, 'nope')).toBeNull();
  });

  it('简短标题', () => {
    expect(shortTitle('- [ ] **加粗** [[链接|别名]] [外链](http://x)')).toBe('加粗 别名 外链');
    expect(shortTitle('x'.repeat(50), 10)).toBe('xxxxxxxxxx…');
  });
});

describe('改笔记', () => {
  it('加块 id：段落写在行尾，引述单独一行', () => {
    const md = '第一段\n\n> 引述\n下一段';
    expect(addBlockId(md, { endLine: 0, type: 'paragraph' }, 'kp-a')).toBe('第一段 ^kp-a\n\n> 引述\n下一段');
    expect(addBlockId(md, { endLine: 2, type: 'blockquote' }, 'kp-b')).toBe('第一段\n\n> 引述\n\n^kp-b\n\n下一段');
  });

  it('写回故事：第一次插在块后面，再写一次整段替换', () => {
    const md = '# 标题\n段落 ^kp-p\n后面';
    const s1 = storyMarkdown({ palace: '我的家', place: '沙发', story: '一只猫\n在讲课' }, 'kps-1');
    const once = upsertStory(md, 'kps-1', s1, 1);
    expect(once).toBe('# 标题\n段落 ^kp-p\n\n> 🏛️ **记忆故事** · 我的家 · 沙发\n>\n> 一只猫\n> 在讲课\n\n^kps-1\n\n后面');
    const s2 = storyMarkdown({ palace: '我的家', place: '沙发', story: '换了', image: 'kmind-palace-a.webp' }, 'kps-1');
    const twice = upsertStory(once, 'kps-1', s2, 1);
    expect(twice).toBe('# 标题\n段落 ^kp-p\n\n> 🏛️ **记忆故事** · 我的家 · 沙发\n>\n> 换了\n>\n> ![[kmind-palace-a.webp]]\n\n^kps-1\n\n后面');
    expect(upsertStory('只有一行', 'kps-2', '> x\n\n^kps-2', -1)).toBe('只有一行\n\n> x\n\n^kps-2');
  });
});
