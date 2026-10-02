import { describe, it, expect, afterEach } from 'vitest';
import { setLocale } from '../src/i18n';
import { storyMessages, cleanStory, imagePrompt } from '../src/story';

const ctx = { place: '书架 · 第 2 层 · 第 5 本', room: '书房', palace: 'Rust 书房', title: '所有权三原则', content: '每个值都有一个所有者；同一时间只有一个所有者；所有者离开作用域时值被丢弃。', next: '办公椅' };

describe('记忆故事', () => {

  it('提示词带上位置、笔记和下一站', () => {
    const [sys, user] = storyMessages(ctx);
    expect(sys.role).toBe('system');
    expect(sys.content).toContain('夸张');
    expect(user.content).toContain('Rust 书房 · 书房 · 书架 · 第 2 层 · 第 5 本');
    expect(user.content).toContain('《所有权三原则》');
    expect(user.content).toContain('下一站：办公椅');
    expect(storyMessages(ctx, 'brief')[0].content).toContain('一句话');
  });

  it('正文太长时截断', () => {
    const long = storyMessages({ ...ctx, content: '字'.repeat(5000) })[1].content;
    expect(long.length).toBeLessThan(2100);
  });

  it('清理模型输出', () => {
    expect(cleanStory('故事：书架上的书突然张开嘴。')).toBe('书架上的书突然张开嘴。');
    expect(cleanStory('## 记忆场景\n“书架上的书突然张开嘴，\n吐出三把钥匙。”')).toBe('书架上的书突然张开嘴，吐出三把钥匙。');
    expect(cleanStory('**画面**\n一只猫**跳**上书桌。')).toBe('一只猫跳上书桌。');
    expect(cleanStory('')).toBe('');
  });

  it('配图提示词', () => {
    const p = imagePrompt('一只猫跳上书桌。', '书桌');
    expect(p).toContain('一只猫跳上书桌');
    expect(p).toContain('不要出现任何文字');
  });
});

describe('记忆故事 · 英文', () => {
  afterEach(() => setLocale('zh-CN'));

  it('英文界面：提示词全是英文，要求模型用英文回答', () => {
    setLocale('en');
    const [sys, user] = storyMessages({ ...ctx, room: 'Study', palace: 'Rust study', place: 'Bookshelf', title: 'Ownership', content: 'Each value has one owner.' });
    expect(sys.content).toContain('in English');
    expect(sys.content).not.toMatch(/[一-鿿]/);
    expect(user.content).toContain('Location: Rust study · Study · Bookshelf');
    expect(user.content).toContain('Next stop: 办公椅');
    expect(imagePrompt('A cat.', 'Desk')).toContain('Main subject: Desk');
  });

  it('清理英文输出：去掉 Story: 前缀，行之间补空格', () => {
    expect(cleanStory('Story: "The bookshelf\nsuddenly sneezes."')).toBe('The bookshelf suddenly sneezes.');
    expect(cleanStory('Memory scene:\nA cat jumps.')).toBe('A cat jumps.');
  });
});
