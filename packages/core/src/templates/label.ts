import { t, isZh } from '../i18n';

/**
 * 模板里房间的名字：中文界面是「中文名 + 英文小字」（卧室 / Bedroom），
 * 英文界面只用英文名（不重复两遍英文）。
 */
export function roomLabel(zh: string, en: string): { name: string; en?: string } {
  return isZh() ? { name: zh, en } : { name: t(zh) };
}
