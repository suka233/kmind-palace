/* 英文字典：键是中文原文，值是英文。按模块分文件，便于维护；这里合并成一张表。 */
import { common } from './common';
import { catalog } from './catalog';
import { content } from './content';
import { view } from './view';
import { town } from './town';
import { social } from './social';
import { plugins } from './plugins';

export const EN: Record<string, string> = Object.assign({}, common, catalog, content, view, town, social, plugins);
