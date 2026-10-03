import type { HostAdapter } from './host';
import { mediaIdOf } from './hash';
import { t } from './i18n';

/* =====================================================================
 * 用户照片：选文件、压缩（与宿主无关；存取交给宿主的 saveMedia / loadMedia）
 * ===================================================================== */

/** 按内容算出媒体 id，交给宿主保存，返回 id */
export async function storeMedia(host: HostAdapter, data: Blob, ext: string): Promise<string> {
  if (!host.saveMedia) throw new Error(t('当前环境不能保存文件'));
  const id = await mediaIdOf(data, ext);
  await host.saveMedia(data, id);
  return id;
}

/** 打开系统的文件选择框选一张图片；取消时返回 null（旧浏览器取消时不会回调） */
export function pickImageFile(): Promise<File | null> {
  return pickFile('image/*');
}

/** 读成 data URL（给视觉模型的图片） */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);   // readAsDataURL 的结果是字符串
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/** 打开系统的文件选择框；accept 同 <input type="file"> */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    document.body.appendChild(input);
    let done = false;
    const finish = (f: File | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(f);
    };
    input.addEventListener('change', () => finish(input.files?.[0] || null));
    input.addEventListener('cancel', () => finish(null));
    input.click();
  });
}

/**
 * 缩到长边不超过 max 像素并重新编码（优先 webp，不支持时 jpeg）。
 * 手机拍的照片动辄几 MB，压缩后一般一两百 KB，随笔记同步也不占地方。
 */
export async function compressImage(file: Blob, max = 1280, quality = .85): Promise<{ blob: Blob; ext: string; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const encode = (type: string) => new Promise<Blob | null>(r => c.toBlob(r, type, quality));
  let blob = await encode('image/webp'), ext = 'webp';
  if (!blob || blob.type !== 'image/webp') { blob = await encode('image/jpeg'); ext = 'jpg'; }
  if (!blob) throw new Error(t('无法处理这张图片'));
  return { blob, ext, w, h };
}
