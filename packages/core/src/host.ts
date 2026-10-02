import type { PalaceDoc } from './schema';
import type { SocialAccount } from './social/api';
import type { PalaceWorld } from './world';

/** 宿主里的一个笔记块（思源的块 / Obsidian 的标题或块引用 …） */
export interface BlockRef {
  id: string;
  title: string;
  /** 所在文档的可读路径 */
  path?: string;
  /** 块类型，例如 d（文档）/ h（标题）/ p（段落） */
  type?: string;
}

/**
 * 一个笔记块的复习状态（宿主的间隔重复系统，例如思源闪卡）。时间均为毫秒时间戳。
 */
export interface ReviewState {
  /** 是否已经是闪卡；不是时其余字段都没有 */
  card: boolean;
  /** 下次复习时间 */
  due?: number;
  /** FSRS 状态：0 新卡 · 1 学习中 · 2 复习 · 3 重新学习 */
  state?: number;
  reps?: number;
  lapses?: number;
  lastReview?: number;
}

/** 自评：1 忘了 · 2 困难 · 3 记得 · 4 简单（与 FSRS 一致） */
export type Rating = 1 | 2 | 3 | 4;

/** 间隔重复（闪卡）：记忆桩的复习状态、回忆时的自评都交给宿主保存和排期 */
export interface ReviewAdapter {
  /** 一批块的复习状态；不在结果里的块按「不是闪卡」处理 */
  getStates(blockIds: string[]): Promise<Record<string, ReviewState>>;
  /** 记一次自评；块还不是闪卡时先加入闪卡。返回评分后的新状态 */
  rate(blockId: string, rating: Rating): Promise<ReviewState | null>;
}

/** 书架的书目来源：宿主里的一个笔记本（path 为 '/'）或一篇文档（显示它的子文档） */
export interface DocSource {
  /** 笔记本 id */
  box: string;
  /** 笔记本里的路径：'/' 表示笔记本根目录，否则是一篇文档的路径（例如 /20260930-abc.sy） */
  path: string;
  /** 显示名（笔记本名或文档标题），只用于界面 */
  name?: string;
  /** 笔记来源（见 HostAdapter.noteSource）；不填表示和宫殿相同 */
  src?: string;
}

/** 书目里的一篇文档（按宿主文档树里的顺序） */
export interface DocEntry {
  id: string;
  title: string;
  /** 子文档数 */
  subDocs?: number;
}

/** 多模态消息里的一段：文字或图片（data URL），与 OpenAI 的格式一致 */
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] }

/** 记忆故事的风格：vivid 夸张荒诞（记得最牢）· warm 温馨写实 · brief 一句话 */
export type StoryStyle = 'vivid' | 'warm' | 'brief';

/**
 * 大模型（用户自己的 Key，或宿主内置的 AI）：编记忆故事、配图。
 * 调用失败时抛出可以直接展示给用户的错误信息。
 */
export interface AiAdapter {
  chat(messages: ChatMessage[], opts?: { temperature?: number }): Promise<string>;
  /** 生图；返回图片数据 */
  image?(prompt: string): Promise<Blob>;
  /** 当前能不能生图（没配置生图服务时隐藏「配图」） */
  imageEnabled?(): boolean;
  /** 记忆故事的风格偏好 */
  style?(): StoryStyle;
  /** 当前的模型能不能看图（拍照识物；消息里带图片时 chat 会发给支持图片的模型） */
  visionEnabled?(): boolean;
}

/**
 * 宿主适配器：core 只通过这个接口与笔记软件交互。
 * 所有方法都是可选的，缺失时对应的 UI 会自动隐藏。
 */
export interface HostAdapter {
  /** 界面语言（zh-CN、en……，宿主自己的语言设置）；不给时按浏览器语言 */
  locale?: string;
  /** 让用户挑一个块（搜索对话框等），取消时返回 null */
  pickBlock?(opts?: { current?: string; itemName?: string }): Promise<BlockRef | null>;
  /** 打开 / 跳转到块 */
  openBlock?(id: string, opts?: { side?: boolean }): void;
  /** 读取块的最新标题（块被改名、删除时刷新显示） */
  getBlock?(id: string): Promise<BlockRef | null>;
  /** 在屏幕坐标处显示块的悬浮预览 */
  showBlockPreview?(id: string, at: { x: number; y: number }): void;
  /** 宫殿数据发生变化（绑定 / 搭建 / 改名，或新建了一座宫殿），由宿主持久化 */
  onDocChange?(doc: PalaceDoc): void;
  /** 世界数据（宫殿的摆放、屋顶）发生变化，由宿主持久化 */
  onWorldChange?(world: PalaceWorld): void;
  /** 用户删除了一座宫殿 */
  onDocDelete?(id: string): void;
  /** 进入某座宫殿（palaceId）或回到小镇（null），可用于更新页签标题 */
  onLocationChange?(palaceId: string | null, name: string): void;
  /** 轻提示 */
  notify?(message: string, type?: 'info' | 'error'): void;
  /** 间隔重复：回忆模式的自评、记忆桩的新旧程度 */
  review?: ReviewAdapter;
  /** 在 el 里只读渲染块的内容（回忆模式揭晓答案时）；返回清理函数 */
  renderBlock?(el: HTMLElement, id: string): (() => void) | void;
  /** 书架 = 笔记本：列出一个来源下的文档（按文档树顺序） */
  listDocs?(source: DocSource): Promise<DocEntry[]>;
  /** 让用户选一个笔记本或文档作为书架的书目 */
  pickDocSource?(opts?: { current?: DocSource }): Promise<DocSource | null>;
  /** 文档新建、删除、改名、移动时回调（书架刷新书目）；返回取消订阅函数 */
  watchDocs?(cb: () => void): () => void;
  /**
   * 这个宿主里笔记的来源标识：'siyuan'、'obsidian:<库名>'……
   * 宫殿和绑定会记下来源；来源不同的记忆桩（在别的笔记软件里绑定的）不去打开、不拉标题、不查复习状态。
   * 不填时不区分来源。
   */
  noteSource?: string;
  /**
   * 保存一个媒体文件（照片已压缩、模型 .glb）。id 由内核按内容算好（见 mediaIdOf），
   * 形如 <32 位十六进制>.<扩展名>；同一个 id 内容一定相同，已经存在时可以直接跳过。
   */
  saveMedia?(data: Blob, id: string): Promise<void>;
  /** 读取媒体，返回可以直接用作 <img src> 的地址 */
  loadMedia?(id: string): Promise<string>;
  /** 大模型：编记忆故事、配图 */
  ai?: AiAdapter;
  /** 块的正文（纯文本 / Markdown），给大模型当素材 */
  getBlockText?(id: string): Promise<string>;
  /**
   * 把记忆故事写回笔记：在绑定的块下面插一个引述块（同一个记忆桩再写一次时更新那一块）。
   * noteId 是上次写入的那一块（优先更新它），ref 用来在找不到时按属性再找一次。返回写入的块 id。
   */
  writeStory?(opts: { blockId: string; ref: string; noteId?: string; palace: string; place: string; story: string; image?: string }): Promise<string | void>;
  /** 打开插件设置（配置大模型） */
  openSettings?(): void;
  /**
   * 串门（好友、发布、参观、留言）：服务器地址在插件设置里填；没有这一项或地址为空时相关界面隐藏。
   * 账号（令牌）只存在本机的插件数据里，不写进宫殿数据。
   */
  social?: {
    serverUrl(): string;
    loadAccount(): Promise<SocialAccount | null>;
    saveAccount(a: SocialAccount | null): Promise<void>;
  };
}
