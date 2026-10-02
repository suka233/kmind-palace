import { Setting, fetchSyncPost, showMessage, type Plugin } from 'siyuan';
import { t, type AiAdapter, type ChatMessage, type StoryStyle } from '@kmind-palace/core';

/* =====================================================================
 * 大模型：编记忆故事、配图
 * 文字默认用思源里配好的 AI（设置 → AI）；也可以填自己的 OpenAI 兼容接口。生图需要单独配置。
 * Key 只存在插件自己的配置文件 ai.json 里，不会进宫殿数据（宫殿导出分享时不会带出去）。
 * 请求经思源内核转发（/api/network/forwardProxy，没有跨域限制，手机上也能用）；
 * 本机 / 内网地址（例如本地的 Ollama）内核出于安全不转发，改由页面直接请求。
 * ===================================================================== */

export interface AiConfig {
  style: StoryStyle;
  textProvider: 'siyuan' | 'custom';
  textBase: string;
  textKey: string;
  textModel: string;
  /** 看图（拍照识物）用的模型；留空时：文字用自定义接口就用同一个模型 */
  visionModel: string;
  imageEnabled: boolean;
  /** 留空时用文字接口的地址 / Key */
  imageBase: string;
  imageKey: string;
  imageModel: string;
  imageSize: string;
}

const DEFAULTS: AiConfig = {
  style: 'vivid',
  textProvider: 'siyuan',
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

const FILE = 'ai.json';

export class AiService {
  config: AiConfig = { ...DEFAULTS };

  constructor(private plugin: Plugin) { }

  async load() {
    try {
      const raw = await this.plugin.loadData(FILE);
      if (raw && typeof raw === 'object') this.config = { ...DEFAULTS, ...raw };
    } catch { /* 用默认配置 */ }
  }

  private async save() {
    await this.plugin.saveData(FILE, this.config);
  }

  adapter(): AiAdapter {
    return {
      chat: (messages, opts) => this.chat(messages, opts?.temperature ?? .8),
      image: (prompt) => this.image(prompt),
      imageEnabled: () => this.config.imageEnabled && !!this.config.imageModel,
      style: () => this.config.style,
      visionEnabled: () => !!this.visionModel(),
    };
  }

  /** 看图用的模型：单独填了就用它；否则文字走自定义接口时用同一个模型；思源内置 AI 不能看图 */
  private visionModel() {
    const c = this.config;
    if (!c.textKey && !isLocal(c.textBase)) return '';
    return c.visionModel || (c.textProvider === 'custom' ? c.textModel : '');
  }

  // =====================================================================
  // 调用
  // =====================================================================

  async chat(messages: ChatMessage[], temperature = .8): Promise<string> {
    const c = this.config;
    // 带图片的消息（拍照识物）只能发给自定义接口上的视觉模型
    if (messages.some(m => Array.isArray(m.content))) {
      const model = this.visionModel();
      if (!model) throw new Error(t('拍照识物需要能看图的模型：在插件设置里填好自定义接口和「识图模型」（例如 gpt-4o-mini、qwen-vl-plus）'));
      const data = await postJson(join(c.textBase, 'chat/completions'), c.textKey, { model, messages, temperature }, 120e3);
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error(t('模型没有返回内容'));
      return stripThink(String(text));
    }
    if (c.textProvider === 'siyuan') {
      // 思源内置 AI 只收一段文字
      const msg = messages.map(m => m.content as string).join('\n\n');
      const res = await fetchSyncPost('/api/ai/chatGPT', { msg });
      if (res.code !== 0) throw new Error(res.msg || t('思源 AI 调用失败'));
      const text = String(res.data || '').trim();
      if (!text) throw new Error(t('思源的 AI 还没配置（设置 → AI），也可以在思维宫殿的插件设置里填自己的模型接口'));
      return stripThink(text);
    }
    if (!c.textKey && !isLocal(c.textBase)) throw new Error(t('还没有填写模型接口的 API Key'));
    const data = await postJson(join(c.textBase, 'chat/completions'), c.textKey, { model: c.textModel, messages, temperature }, 120e3);
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error(t('模型没有返回内容'));
    return stripThink(String(text));
  }

  async image(prompt: string): Promise<Blob> {
    const c = this.config;
    if (!c.imageEnabled) throw new Error(t('还没有开启生图（插件设置 → 配图）'));
    const base = c.imageBase || c.textBase, key = c.imageKey || c.textKey;
    if (!key && !isLocal(base)) throw new Error(t('还没有填写生图接口的 API Key'));
    const data = await postJson(join(base, 'images/generations'), key, { model: c.imageModel, prompt, size: c.imageSize, n: 1 }, 180e3);
    const item = data?.data?.[0] || data?.images?.[0];
    if (item?.b64_json) return b64Blob(item.b64_json, 'image/png');
    if (item?.url) return download(item.url);
    throw new Error(t('生图接口没有返回图片'));
  }

  // =====================================================================
  // 设置面板
  // =====================================================================

  setupSettings(i18n: (key: string) => string) {
    const els: Record<string, HTMLInputElement | HTMLSelectElement> = {};
    const input = (key: keyof AiConfig, type = 'text', placeholder = '') => {
      const el = document.createElement('input');
      el.className = 'b3-text-field fn__flex-center fn__size200';
      el.type = type;
      el.placeholder = placeholder;
      el.value = String(this.config[key] ?? '');
      els[key] = el;
      return el;
    };
    const select = (key: keyof AiConfig, options: [string, string][]) => {
      const el = document.createElement('select');
      el.className = 'b3-select fn__flex-center fn__size200';
      el.innerHTML = options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
      el.value = String(this.config[key]);
      els[key] = el;
      return el;
    };
    const setting = new Setting({
      confirmCallback: () => {
        const c = this.config as any;
        for (const [k, el] of Object.entries(els)) c[k] = el.type === 'checkbox' ? (el as HTMLInputElement).checked : el.value.trim();
        void this.save().then(() => showMessage(i18n('aiSaved')));
      },
    });
    setting.addItem({ title: i18n('aiStyle'), description: i18n('aiStyleDesc'), createActionElement: () => select('style', [['vivid', i18n('styleVivid')], ['warm', i18n('styleWarm')], ['brief', i18n('styleBrief')]]) });
    setting.addItem({ title: i18n('aiText'), description: i18n('aiTextDesc'), createActionElement: () => select('textProvider', [['siyuan', i18n('providerSiyuan')], ['custom', i18n('providerCustom')]]) });
    setting.addItem({ title: i18n('aiBase'), description: i18n('aiBaseDesc'), createActionElement: () => input('textBase', 'text', 'https://api.openai.com/v1') });
    setting.addItem({ title: 'API Key', description: i18n('aiKeyDesc'), createActionElement: () => input('textKey', 'password', 'sk-…') });
    setting.addItem({ title: i18n('aiModel'), description: i18n('aiModelDesc'), createActionElement: () => input('textModel', 'text', 'gpt-4o-mini') });
    setting.addItem({ title: i18n('aiVision'), description: i18n('aiVisionDesc'), createActionElement: () => input('visionModel', 'text', i18n('aiVisionPh')) });
    setting.addItem({
      title: i18n('aiImage'), description: i18n('aiImageDesc'),
      createActionElement: () => {
        const el = document.createElement('input');
        el.type = 'checkbox';
        el.className = 'b3-switch fn__flex-center';
        el.checked = this.config.imageEnabled;
        els.imageEnabled = el;
        return el;
      },
    });
    setting.addItem({ title: i18n('aiImageBase'), description: i18n('aiImageBaseDesc'), createActionElement: () => input('imageBase', 'text', i18n('sameAsText')) });
    setting.addItem({ title: i18n('aiImageKey'), description: i18n('aiImageBaseDesc'), createActionElement: () => input('imageKey', 'password', i18n('sameAsText')) });
    setting.addItem({ title: i18n('aiImageModel'), description: i18n('aiImageModelDesc'), createActionElement: () => input('imageModel', 'text', 'gpt-image-1') });
    setting.addItem({ title: i18n('aiImageSize'), createActionElement: () => select('imageSize', [['1024x1024', '1024 × 1024'], ['768x768', '768 × 768'], ['512x512', '512 × 512']]) });
    setting.addItem({
      title: i18n('aiTest'), description: i18n('aiTestDesc'),
      createActionElement: () => {
        const b = document.createElement('button');
        b.className = 'b3-button b3-button--outline fn__flex-center fn__size200';
        b.textContent = i18n('aiTestBtn');
        b.addEventListener('click', async () => {
          // 用面板上还没保存的值测试
          const saved = this.config;
          const c: any = { ...saved };
          for (const [k, el] of Object.entries(els)) c[k] = el.type === 'checkbox' ? (el as HTMLInputElement).checked : el.value.trim();
          this.config = c;
          b.disabled = true;
          try {
            const text = await this.chat([{ role: 'user', content: t('只回复两个字：你好') }], 0);
            showMessage(`${i18n('aiTestOk')}${text.slice(0, 40)}`, 5000);
          } catch (e) {
            showMessage(`${i18n('aiTestFail')}${(e as Error)?.message || e}`, 8000, 'error');
          } finally {
            this.config = saved;
            b.disabled = false;
          }
        });
        return b;
      },
    });
    return setting;
  }
}

// =====================================================================

const join = (base: string, path: string) => base.replace(/\/+$/, '') + '/' + path;

/** 本机 / 内网地址：思源内核不转发（防 SSRF），改由页面直接请求 */
function isLocal(url: string) {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '::1' || h === '[::1]' || h.endsWith('.local') || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  } catch { return false; }
}

/** 推理模型会把思考过程放在 <think> 里 */
const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

function errorText(status: number, body: string) {
  try {
    const j = JSON.parse(body);
    const m = j?.error?.message || j?.message || j?.msg || j?.error;
    if (m) return `${status} ${typeof m === 'string' ? m : JSON.stringify(m)}`;
  } catch { /* 不是 JSON */ }
  return `HTTP ${status} ${body.slice(0, 160)}`;
}

async function postJson(url: string, key: string, body: unknown, timeout: number) {
  const headers: Record<string, string> = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  if (isLocal(url)) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const text = await r.text();
    if (!r.ok) throw new Error(errorText(r.status, text));
    return JSON.parse(text);
  }
  const res = await fetchSyncPost('/api/network/forwardProxy', {
    url, method: 'POST', timeout, contentType: 'application/json',
    headers: Object.entries(headers).map(([k, v]) => ({ [k]: v })),
    payload: body as any, responseEncoding: 'text',
  });
  if (res.code !== 0) throw new Error(res.msg || t('请求失败'));
  const d = res.data as { status: number; body: string };
  if (d.status >= 400) throw new Error(errorText(d.status, d.body || ''));
  try { return JSON.parse(d.body); } catch { throw new Error(t('接口返回的不是 JSON：{body}', { body: String(d.body).slice(0, 120) })); }
}

function b64Blob(b64: string, type: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** 生图接口只给了图片地址：经内核转发下载（有的图床没有跨域头） */
async function download(url: string): Promise<Blob> {
  if (isLocal(url)) return (await fetch(url)).blob();
  const res = await fetchSyncPost('/api/network/forwardProxy', { url, method: 'GET', timeout: 60e3, responseEncoding: 'base64' });
  const d = res.data as { status: number; body: string; contentType: string };
  if (res.code !== 0 || d.status >= 400) throw new Error(res.msg || t('下载图片失败 {status}', { status: String(d?.status) }));
  return b64Blob(d.body, d.contentType || 'image/png');
}
