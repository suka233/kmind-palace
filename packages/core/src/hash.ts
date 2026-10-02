/* =====================================================================
 * 内容哈希：媒体 id = 文件内容的 SHA-256 前 32 位十六进制 + 扩展名。
 * 同一张照片在不同设备、不同宿主（思源 / Obsidian / 独立应用）上 id 相同，
 * 串门时访客按 id 判断本地是否已经缓存，导入导出也不会重复存。
 * crypto.subtle 只在安全上下文（https / localhost）里有；通过局域网 http 打开思源时用纯 JS 实现。
 * ===================================================================== */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** 纯 JS 的 SHA-256（没有 crypto.subtle 时用） */
export function sha256Js(data: Uint8Array): Uint8Array {
  const len = data.length, bits = len * 8;
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(total - 4, bits >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      W[i] = W[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10));
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
  return out;
}

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

/** SHA-256 的十六进制串 */
export async function sha256Hex(data: Uint8Array | ArrayBuffer | Blob): Promise<string> {
  const bytes = data instanceof Uint8Array ? data
    : data instanceof ArrayBuffer ? new Uint8Array(data)
      : new Uint8Array(await data.arrayBuffer());
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try { return hex(new Uint8Array(await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))); } catch { /* 退回纯 JS */ }
  }
  return hex(sha256Js(bytes));
}

/** 媒体 id 的格式：32 位十六进制 + 扩展名（旧数据里还有时间戳格式的 id，一样能读） */
export const MEDIA_ID = /^[0-9a-f]{32}\.[a-z0-9]{1,5}$/;

/** 按内容算媒体 id；ext 不带点（webp、jpg、glb） */
export async function mediaIdOf(data: Uint8Array | ArrayBuffer | Blob, ext: string): Promise<string> {
  const e = ext.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
  return (await sha256Hex(data)).slice(0, 32) + '.' + e;
}
