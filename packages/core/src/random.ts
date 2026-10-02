// 可复现的随机数：同一份宫殿数据在任何设备上生成相同的细节（书的颜色、植物的叶子……）
let state = 1;

export function seed(n: number) {
  state = n | 0 || 1;
}

export function seedFromString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  seed(h);
}

export function rand() {
  state |= 0; state = state + 0x6D2B79F5 | 0;
  let t = Math.imul(state ^ state >>> 15, 1 | state);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

export const rr = (a: number, b: number) => a + (b - a) * rand();
export const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
