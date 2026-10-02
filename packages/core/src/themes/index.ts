import type { ThemePack } from './common';
import { island } from './island';
import { forest } from './forest';
import { snow } from './snow';
import { sky } from './sky';

export type { ThemePack, ThemeCtx, Landmark } from './common';

/** 所有场景主题（选择器按这个顺序显示） */
export const THEMES: ThemePack[] = [island, forest, snow, sky];

export function getTheme(id: string): ThemePack {
  return THEMES.find(t => t.id === id) || island;
}
