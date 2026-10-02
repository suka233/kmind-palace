import * as z from 'zod';

/* =====================================================================
 * 前后端共用的接口格式：服务端用 zod 校验输入，客户端（core 的 social）只用类型。
 * 路径前缀 /api/v1（应用）、/api/auth（Better Auth）、/api/admin（管理面板）。
 * ===================================================================== */

export const API_VERSION = 1;

// ---------------- 限制（服务端可以在设置里调小 / 调大，这里是默认值） ----------------
export const LIMITS = {
  nameMax: 20,
  guestbookMax: 300,
  chatMax: 80,
  reportMax: 500,
  /** 宫殿公开副本 JSON 的最大字节数 */
  docBytes: 2 * 1024 * 1024,
  worldBytes: 512 * 1024,
  imageBytes: 5 * 1024 * 1024,
  modelBytes: 30 * 1024 * 1024,
};

/** 媒体 id：内容哈希前 32 位 + 扩展名（见 core/hash.ts） */
export const MEDIA_ID_RE = /^[0-9a-f]{32}\.(webp|jpg|jpeg|png|gif|glb)$/;
export const MEDIA_MIME: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', glb: 'model/gltf-binary' };

// ---------------- 通用 ----------------
export interface UserBrief { id: string; name: string }

export type Visibility = 'friends' | 'link';

export interface ApiError { error: string; code?: string; missing?: string[] }

// ---------------- 我 / 好友 ----------------
export interface Me {
  user: UserBrief & { isAnonymous: boolean; createdAt: string };
  friendCode: string;
  announcement?: string;
  /** 服务端时间（毫秒），客户端用来算宠物还有多久回来 */
  now: number;
}

export const nameInput = z.object({ name: z.string().trim().min(1).max(LIMITS.nameMax) });

export interface Friend extends UserBrief {
  since: string;
  /** 发布了几座宫殿 */
  palaces: number;
}

export interface FriendRequest { id: string; from: UserBrief; createdAt: string }

export const friendRequestInput = z.object({ code: z.string().trim().min(4).max(20) });

// ---------------- 发布 ----------------
export const publishInput = z.object({
  doc: z.unknown(),
  visibility: z.enum(['friends', 'link']),
  photos: z.boolean().default(false),
  /** 客户端那份宫殿的 updatedAt */
  sourceUpdatedAt: z.number().int().nonnegative(),
});

export interface PublishedPalace {
  id: string;
  name: string;
  visibility: Visibility;
  /** 凭链接访问的地址（visibility 为 link 时可用） */
  shareUrl: string;
  photos: boolean;
  version: number;
  views: number;
  sourceUpdatedAt: number;
  updatedAt: string;
  takenDown: boolean;
  takedownReason?: string | null;
}

/** 发布时缺媒体：先按 missing 上传再重试 */
export interface PublishMissing { error: string; code: 'missing_media'; missing: string[] }

export const worldInput = z.object({ world: z.unknown() });

export const mediaCheckInput = z.object({ ids: z.array(z.string().regex(MEDIA_ID_RE)).max(500) });

/** 好友的世界：只含已发布宫殿的摆放 */
export interface FriendWorld {
  owner: UserBrief;
  world: unknown;
  palaces: { id: string; name: string; version: number; updatedAt: string }[];
}

/** 打开一座发布的宫殿（好友或凭链接） */
export interface PalaceView {
  id: string;
  owner: UserBrief;
  doc: unknown;
  version: number;
  updatedAt: string;
  /** 是不是自己的 */
  mine: boolean;
  canComment: boolean;
}

// ---------------- 留言 / 举报 / 通知 ----------------
export const guestbookInput = z.object({ text: z.string().trim().min(1).max(LIMITS.guestbookMax) });

export interface GuestbookEntry { id: string; author: UserBrief; text: string; createdAt: string; mine: boolean; hidden?: boolean }

export const reportInput = z.object({
  palaceId: z.string().max(80).optional(),
  shareToken: z.string().max(80).optional(),
  reason: z.enum(['spam', 'abuse', 'illegal', 'privacy', 'other']),
  detail: z.string().trim().max(LIMITS.reportMax).optional(),
});

export type NotificationKind = 'friend_request' | 'friend_accepted' | 'visit' | 'guestbook' | 'pet_visit' | 'pet_back' | 'announcement' | 'takedown';

export interface Notification { id: string; kind: NotificationKind; payload: Record<string, any>; createdAt: string; read: boolean }

export interface Inbox { items: Notification[]; unread: number }

// ---------------- 宠物（S3） ----------------
export interface PetLook {
  species: string;
  colors?: Record<string, string>;
  accessories?: string[];
}

export const petInput = z.object({
  name: z.string().trim().min(1).max(LIMITS.nameMax),
  look: z.object({ species: z.string().max(20), colors: z.record(z.string(), z.string().regex(/^#[0-9a-f]{6}$/i)).optional(), accessories: z.array(z.string().max(20)).max(8).optional() }),
});

export interface Souvenir { palaceName: string; owner: UserBrief; place?: string; title?: string; story?: string }

export interface PetTrip {
  id: string;
  host: UserBrief;
  palaceId: string;
  palaceName: string;
  startedAt: string;
  returnsAt: string;
  status: 'out' | 'back';
  souvenir?: Souvenir | null;
}

export interface PetInfo {
  name: string;
  look: PetLook;
  trip: PetTrip | null;
  /** 今天还能出门几次 */
  tripsLeft: number;
}

export const petTripInput = z.object({ friendId: z.string().max(80).optional() });

/** 来自己家做客的宠物 */
export interface GuestPet { owner: UserBrief; name: string; look: PetLook; palaceId: string; returnsAt: string }

// ---------------- 实时房间（S2） ----------------
/** 一个人在房间里的状态：平面位置、朝向、动作 */
export interface PeerState { p: [number, number]; yaw: number; anim: 'idle' | 'walk' | 'wave' | 'sit' }

export interface Peer extends UserBrief { look: PetLook; state: PeerState | null; owner: boolean }

export const roomClientMsg = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), look: petInput.shape.look }),
  z.object({ t: z.literal('state'), p: z.tuple([z.number().finite(), z.number().finite()]), yaw: z.number().finite(), anim: z.enum(['idle', 'walk', 'wave', 'sit']) }),
  z.object({ t: z.literal('emote'), e: z.enum(['wave', 'heart', 'laugh', 'clap', 'question', 'idea']) }),
  z.object({ t: z.literal('chat'), text: z.string().trim().min(1).max(LIMITS.chatMax) }),
  /** 主人带大家走路线：第几站（-1 结束） */
  z.object({ t: z.literal('guide'), stop: z.number().int().min(-1).max(10000), key: z.string().max(200).optional() }),
  z.object({ t: z.literal('ping') }),
]);
export type RoomClientMsg = z.infer<typeof roomClientMsg>;

export type RoomServerMsg =
  | { t: 'welcome'; you: string; peers: Peer[] }
  | { t: 'join'; peer: Peer }
  | { t: 'leave'; id: string }
  | { t: 'state'; id: string; s: PeerState }
  | { t: 'look'; id: string; look: PetLook }
  | { t: 'emote'; id: string; e: string }
  | { t: 'chat'; id: string; text: string }
  | { t: 'guide'; id: string; stop: number; key?: string }
  | { t: 'pong' }
  | { t: 'error'; error: string };

// ---------------- 管理面板 ----------------
export interface AdminStats {
  users: { total: number; anonymous: number; new24h: number; active24h: number; banned: number };
  palaces: { published: number; link: number; takenDown: number };
  media: { count: number; bytes: number };
  guestbook: number;
  reports: { open: number };
  rooms: { online: number; people: number };
  trips: { out: number; total: number };
  series: { name: string; points: [number, number][] }[];
}

export interface ServerSettings {
  announcement: string;
  maintenance: boolean;
  maxPalacesPerUser: number;
  maxStorageMBPerUser: number;
  imageMB: number;
  modelMB: number;
  petTripMinutes: [number, number];
  petTripsPerDay: number;
  /** 一座宫殿的实时房间最多几个人 */
  roomMax: number;
  /** 以后开放注册（邮箱 / 第三方）时打开 */
  registration: boolean;
}

export const DEFAULT_SETTINGS: ServerSettings = {
  announcement: '',
  maintenance: false,
  maxPalacesPerUser: 50,
  maxStorageMBPerUser: 500,
  imageMB: 5,
  modelMB: 30,
  petTripMinutes: [30, 120],
  petTripsPerDay: 3,
  roomMax: 12,
  registration: false,
};

export const settingsInput = z.object({
  announcement: z.string().max(500),
  maintenance: z.boolean(),
  maxPalacesPerUser: z.number().int().min(1).max(10000),
  maxStorageMBPerUser: z.number().int().min(1).max(100000),
  imageMB: z.number().min(.1).max(50),
  modelMB: z.number().min(.1).max(500),
  petTripMinutes: z.tuple([z.number().int().min(1).max(1440), z.number().int().min(1).max(1440)]),
  petTripsPerDay: z.number().int().min(0).max(100),
  roomMax: z.number().int().min(2).max(100),
  registration: z.boolean(),
}).partial();
