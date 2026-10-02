import type { AiAdapter, ChatMessage, StoryStyle } from './host';
import { t } from './i18n';

/* =====================================================================
 * OpenAI 兼容接口的大模型客户端（与宿主无关）：文字、识图、生图。
 * 网络请求交给宿主（Obsidian 的 requestUrl、思源内核转发……），这样没有跨域限制，手机上也能用。
 * Key 只存在宿主的插件配置里，不进宫殿数据。
 * ===================================================================== */

export interface OpenAiConfig {
  style: StoryStyle;
  textBase: string;
  textKey: string;
  textModel: string;
  /** 看图（拍照识物）用的模型；留空时用文字模型 */
  visionModel: string;
  imageEnabled: boolean;
  /** 留空时用文字接口的地址 / Key */
  imageBase: string;
  imageKey: string;
  imageModel: string;
  imageSize: string;
}

export const OPENAI_DEFAULTS: OpenAiConfig = {
  style: 'vivid',
  textBase: 'https://api.openai.com/v1',
  textKey: '',
  textModel: 'gpt-4o-mini',
  visionModel: '',
  imageEnabled: false,
  imageBase: '',
  imageKey: '',
  imageModel: 'gpt-image-1',
  imageSize: '1024x1024',
};

/** 宿主提供的 HTTP：POST JSON，返回状态码和响应文本 */
export type HttpPost = (url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) => Promise<{ status: number; text: string }>;
/** 宿主提供的下载（生图接口返回图片地址时） */
export type HttpGet = (url: string) => Promise<Blob>;

export const joinUrl = (base: string, path: string) => base.replace(/\/+$/, '') + '/' + path;

/** 本机 / 内网地址（例如本地的 Ollama）：不需要 Key */
export function isLocalUrl(url: string) {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '::1' || h === '[::1]' || h.endsWith('.local') || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  } catch { return false; }
}

/** 推理模型会把思考过程放在 <think> 里 */
export const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

export function apiErrorText(status: number, body: string) {
  try {
    const j = JSON.parse(body);
    const m = j?.error?.message || j?.message || j?.msg || j?.error;
    if (m) return `${status} ${typeof m === 'string' ? m : JSON.stringify(m)}`;
  } catch { /* 不是 JSON */ }
  return `HTTP ${status} ${body.slice(0, 160)}`;
}

export function b64ToBlob(b64: string, type: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function createOpenAiAdapter(config: () => OpenAiConfig, post: HttpPost, get?: HttpGet): AiAdapter & { test(): Promise<string> } {
  const call = async (base: string, key: string, path: string, body: unknown, timeout: number) => {
    if (!key && !isLocalUrl(base)) throw new Error(t('还没有填写模型接口的 API Key（插件设置）'));
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await post(joinUrl(base, path), headers, body, timeout);
    if (res.status >= 400) throw new Error(apiErrorText(res.status, res.text || ''));
    try { return JSON.parse(res.text); } catch { throw new Error(t('接口返回的不是 JSON：') + String(res.text).slice(0, 120)); }
  };
  const vision = () => config().visionModel || config().textModel;
  const chat = async (messages: ChatMessage[], temperature = .8) => {
    const c = config();
    const model = messages.some(m => Array.isArray(m.content)) ? vision() : c.textModel;
    const data = await call(c.textBase, c.textKey, 'chat/completions', { model, messages, temperature }, 120e3);
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error(t('模型没有返回内容'));
    return stripThink(String(text));
  };
  return {
    chat: (messages, opts) => chat(messages, opts?.temperature ?? .8),
    async image(prompt) {
      const c = config();
      if (!c.imageEnabled) throw new Error(t('还没有开启生图（插件设置 → 配图）'));
      const data = await call(c.imageBase || c.textBase, c.imageKey || c.textKey, 'images/generations', { model: c.imageModel, prompt, size: c.imageSize, n: 1 }, 180e3);
      const item = data?.data?.[0] || data?.images?.[0];
      if (item?.b64_json) return b64ToBlob(item.b64_json, 'image/png');
      if (item?.url && get) return get(item.url);
      throw new Error(t('生图接口没有返回图片'));
    },
    imageEnabled: () => config().imageEnabled && !!config().imageModel,
    style: () => config().style,
    visionEnabled: () => !!(config().textKey || isLocalUrl(config().textBase)) && !!vision(),
    test: () => chat([{ role: 'user', content: t('只回复两个字：你好') }], 0),
  };
}
