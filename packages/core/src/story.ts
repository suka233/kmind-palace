import type { ChatMessage, StoryStyle } from './host';
import { t } from './i18n';

/* =====================================================================
 * 记忆故事（纯数据）：给大模型的提示词、清理输出、配图提示词
 * 位置记忆法的要点：把要记的内容变成发生在「这个位置」上的一个具体、夸张、有感官细节的画面，
 * 让物件本身参与动作；关键信息一个都不能丢。
 * ===================================================================== */

export interface StoryContext {
  /** 位置：物件（和部件）名，例如「书架 · 第 2 层 · 第 5 本」 */
  place: string;
  room?: string;
  palace?: string;
  /** 笔记标题 */
  title: string;
  /** 笔记正文（会被截断） */
  content: string;
  /** 路线上的上一站 / 下一站（可以顺带串起来） */
  prev?: string;
  next?: string;
}

const MAX_CONTENT = 1800;

/** 模块加载时还不知道语言：这里是中文原文，用的时候再 t() */
const STYLE: Record<StoryStyle, string> = {
  vivid: '画面要夸张、荒诞、有动作，越离奇越好记；调动视觉、声音、气味、触感。60–120 字。',
  warm: '画面要具体、生活化、温暖，像回忆里的一个片段；调动视觉、声音、气味、触感。60–120 字。',
  brief: '只用一句话（30 字以内），但必须是一个有动作的画面。',
};

export function storyMessages(ctx: StoryContext, style: StoryStyle = 'vivid'): ChatMessage[] {
  const content = ctx.content.length > MAX_CONTENT ? ctx.content.slice(0, MAX_CONTENT) + '…' : ctx.content;
  const where = [ctx.palace, ctx.room, ctx.place].filter(Boolean).join(' · ');
  const route = [ctx.prev && t('上一站：{p}', { p: ctx.prev }), ctx.next && t('下一站：{p}', { p: ctx.next })].filter(Boolean).join(t('；'));
  return [
    {
      role: 'system',
      content: [
        t('你是记忆宫殿（位置记忆法）教练，帮用户把一条笔记「放」进宫殿里的一个位置。'),
        t('写一个发生在这个位置上的小场景：让这件物件本身参与动作，把笔记里要记住的关键信息（概念、数字、人名、步骤）一个不漏地变成画面里看得见、听得见的东西。'),
        t(STYLE[style]),
        route ? t('如果给了上一站 / 下一站，可以在结尾用半句话把下一站引出来（可选，不要喧宾夺主）。') : '',
        t('只输出故事本身：一段中文，不要标题、不要解释、不要引号、不要列表。'),
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: [
        t('位置：{where}', { where }),
        route,
        t('要记住的笔记：《{title}》', { title: ctx.title }),
        content.trim() || t('（正文为空，按标题编）'),
      ].filter(Boolean).join('\n'),
    },
  ];
}

/** 清理模型输出：去掉标题行、引号、Markdown 标记、「故事：」前缀，压成一段 */
export function cleanStory(raw: string) {
  let s = (raw || '').trim();
  s = s.replace(/^```[\s\S]*?\n|```$/g, '');
  const lines = s.split('\n').map(l => l.trim()).filter(Boolean);
  // 第一行像标题（短、以冒号结尾或是 Markdown 标题）时去掉
  if (lines.length > 1 && (/^#{1,6}\s/.test(lines[0]) || /^[^。！？]{1,16}[:：]$/.test(lines[0]) || /^[^.!?]{1,32}:$/.test(lines[0]) || /^\*\*[^*]+\*\*$/.test(lines[0]))) lines.shift();
  // 中文行直接接上；英文（两边都是 ASCII）之间补一个空格
  s = lines.reduce((acc, l) => (acc && /[\x21-\x7e]$/.test(acc) && /^[\x21-\x7e]/.test(l) ? acc + ' ' + l : acc + l), '');
  s = s.replace(/^((记忆)?故事|(memory |mnemonic )?story)\s*[:：]\s*/i, '').replace(/\*\*|__|`/g, '').replace(/^#+\s*/, '');
  s = s.replace(/^[“"「『]+|[”"」』]+$/g, '').trim();
  return s.length > 400 ? s.slice(0, 400) + '…' : s;
}

/** 配图提示词：故事 + 统一的画风（按界面语言） */
export function imagePrompt(story: string, place: string) {
  return `${story}\n\n` + t('画面主体：{place}。风格：温暖明亮的扁平插画，等距视角，柔和光影，画面干净，不要出现任何文字。', { place });
}
