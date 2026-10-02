import type { Me, Friend, FriendRequest, Inbox, PublishedPalace, FriendWorld, PalaceView as RemotePalace, GuestbookEntry, PetInfo, PetTrip, GuestPet, PetLook } from '@kmind-palace/protocol';
import type { PalaceDoc } from '../schema';
import type { PalaceWorld } from '../world';
import { palaceMedia } from '../schema';
import { toPublicPalace } from '../publish';
import { t } from '../i18n';

/* =====================================================================
 * 串门服务的客户端：匿名账号（令牌只存在本机 / 插件存储）、好友、发布、参观、留言、宠物。
 * 直接用 fetch（服务端允许跨域，插件端用 Bearer 令牌，不用 cookie）。
 * ===================================================================== */

export interface SocialAccount {
  token: string;
  userId: string;
  name: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) { super(message); }
}

export class SocialApi {
  constructor(
    public base: string,
    private account: () => SocialAccount | null,
    private onAccount: (a: SocialAccount | null) => Promise<void>,
  ) {
    this.base = base.replace(/\/+$/, '');
  }

  get signedIn() { return !!this.account(); }

  private async raw(method: string, path: string, body?: unknown, auth = true, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const headers: Record<string, string> = { ...extraHeaders };
    const a = this.account();
    if (auth && a) headers.authorization = `Bearer ${a.token}`;
    let payload: BodyInit | undefined;
    if (body instanceof Blob || body instanceof Uint8Array || body instanceof ArrayBuffer) payload = body as BodyInit;
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    let res: Response;
    try {
      res = await fetch(this.base + path, { method, headers, body: payload });
    } catch {
      throw new ApiError(0, t('连不上串门服务器，请检查网络或服务器地址'));
    }
    return res;
  }

  async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, body);
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 不是 JSON */ }
    if (!res.ok) throw new ApiError(res.status, json?.error || json?.message || `HTTP ${res.status}`, json);
    return json as T;
  }

  /** 第一次用：自动建一个匿名账号 */
  async ensureAccount(): Promise<SocialAccount> {
    const a = this.account();
    if (a) return a;
    const res = await this.raw('POST', '/api/auth/sign-in/anonymous', {}, false);
    const json: any = await res.json().catch(() => null);
    const token = res.headers.get('set-auth-token');
    if (!res.ok || !token) throw new ApiError(res.status, json?.message || t('创建账号失败'));
    const acc = { token, userId: json?.user?.id, name: json?.user?.name || '' };
    await this.onAccount(acc);
    return acc;
  }

  // ---------------- 账号 / 设备 ----------------
  me() { return this.req<Me>('GET', '/api/v1/me'); }
  rename(name: string) { return this.req<{ name: string }>('PATCH', '/api/v1/me', { name }); }
  rotateFriendCode() { return this.req<{ friendCode: string }>('POST', '/api/v1/me/friend-code'); }

  /** 配对码：在另一台设备上输入，登录同一个账号（10 分钟内有效，只能用一次） */
  async pairingCode() { return (await this.req<{ token: string }>('GET', '/api/auth/one-time-token/generate')).token; }

  /** 用另一台设备给的配对码登录（换成那个账号） */
  async redeem(code: string) {
    const res = await this.raw('POST', '/api/auth/one-time-token/verify', { token: code.trim().toUpperCase().replace(/[^0-9A-Z]/g, '') }, false);
    const json: any = await res.json().catch(() => null);
    const token = res.headers.get('set-auth-token');
    if (!res.ok || !token) throw new ApiError(res.status, t('配对码无效或已过期（10 分钟内有效，只能用一次）'));
    const acc = { token, userId: json?.user?.id, name: json?.user?.name || '' };
    await this.onAccount(acc);
    return acc;
  }

  async signOut() { await this.onAccount(null); }

  // ---------------- 好友 / 收件箱 ----------------
  friends() { return this.req<Friend[]>('GET', '/api/v1/friends'); }
  addFriend(code: string) { return this.req<{ status: 'sent' | 'friends'; friend: { id: string; name: string } }>('POST', '/api/v1/friends/requests', { code }); }
  requests() { return this.req<FriendRequest[]>('GET', '/api/v1/friends/requests'); }
  respond(id: string, accept: boolean) { return this.req('POST', `/api/v1/friends/requests/${encodeURIComponent(id)}/${accept ? 'accept' : 'decline'}`); }
  removeFriend(id: string) { return this.req('DELETE', `/api/v1/friends/${encodeURIComponent(id)}`); }
  inbox() { return this.req<Inbox>('GET', '/api/v1/inbox'); }
  markRead() { return this.req('POST', '/api/v1/inbox/read'); }

  // ---------------- 发布 ----------------
  myPalaces() { return this.req<PublishedPalace[]>('GET', '/api/v1/palaces'); }

  /**
   * 发布（或更新）一座宫殿：只上传公开副本；缺的媒体（照片、模型）先传上去。
   * loadMedia 读本机的媒体文件。
   */
  async publish(doc: PalaceDoc, opts: { visibility: 'friends' | 'link'; photos: boolean }, loadMedia: (id: string) => Promise<Blob>): Promise<PublishedPalace> {
    const pub = toPublicPalace(doc, { photos: opts.photos });
    const ids = palaceMedia(pub);
    if (ids.length) {
      const { missing } = await this.req<{ missing: string[] }>('POST', '/api/v1/media/check', { ids });
      for (const id of missing) {
        const blob = await loadMedia(id);
        await this.req('PUT', `/api/v1/media/${encodeURIComponent(id)}`, blob);
      }
    }
    return this.req<PublishedPalace>('PUT', `/api/v1/palaces/${encodeURIComponent(doc.id)}`, { doc: pub, visibility: opts.visibility, photos: opts.photos, sourceUpdatedAt: doc.updatedAt });
  }

  unpublish(id: string) { return this.req('DELETE', `/api/v1/palaces/${encodeURIComponent(id)}`); }
  putWorld(world: PalaceWorld) { return this.req('PUT', '/api/v1/world', { world }); }

  // ---------------- 参观 / 留言 ----------------
  friendWorld(userId: string) { return this.req<FriendWorld>('GET', `/api/v1/friends/${encodeURIComponent(userId)}/world`); }
  palace(id: string) { return this.req<RemotePalace>('GET', `/api/v1/palaces/${encodeURIComponent(id)}`); }
  guestbook(id: string) { return this.req<GuestbookEntry[]>('GET', `/api/v1/palaces/${encodeURIComponent(id)}/guestbook`); }
  postGuestbook(id: string, text: string) { return this.req<{ id: string }>('POST', `/api/v1/palaces/${encodeURIComponent(id)}/guestbook`, { text }); }
  deleteGuestbook(id: string) { return this.req('DELETE', `/api/v1/guestbook/${encodeURIComponent(id)}`); }
  report(palaceId: string, reason: string, detail?: string) { return this.req('POST', '/api/v1/reports', { palaceId, reason, detail }); }

  /** 媒体的网址（好友宫殿里的照片、模型直接从服务器读） */
  mediaUrl(id: string) { return `${this.base}/api/v1/media/${encodeURIComponent(id)}`; }

  // ---------------- 宠物（S3） ----------------
  pet() { return this.req<PetInfo>('GET', '/api/v1/pet'); }
  savePet(name: string, look: PetLook) { return this.req<PetInfo>('PUT', '/api/v1/pet', { name, look }); }
  sendPet(friendId?: string) { return this.req<PetTrip>('POST', '/api/v1/pet/trips', friendId ? { friendId } : {}); }
  trips() { return this.req<PetTrip[]>('GET', '/api/v1/pet/trips'); }
  guests() { return this.req<GuestPet[]>('GET', '/api/v1/pet/guests'); }

  /** 实时房间（S2）的 WebSocket 地址 */
  roomUrl(palaceId: string) {
    const a = this.account();
    return `${this.base.replace(/^http/, 'ws')}/api/v1/rooms/${encodeURIComponent(palaceId)}?token=${encodeURIComponent(a?.token || '')}`;
  }
}
