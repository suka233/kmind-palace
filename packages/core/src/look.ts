/* =====================================================================
 * 角色外观（纯数据，与 three.js 无关）：物种、三种颜色、配饰。
 * 宫殿世界数据、服务器（宠物、串门的小人）都用这份定义校验。
 * ===================================================================== */

export type Species = 'owl' | 'cat' | 'fox' | 'bear' | 'rabbit';
export type Accessory = 'party' | 'tophat' | 'crown' | 'scarf' | 'glasses' | 'bow' | 'backpack';

export interface Look {
  species: Species | string;
  colors?: { body?: string; belly?: string; accent?: string };
  accessories?: (Accessory | string)[];
}

export const SPECIES: { id: Species; name: string; colors: { body: string; belly: string; accent: string } }[] = [
  { id: 'owl', name: '猫头鹰', colors: { body: '#8b6a4f', belly: '#efe0c8', accent: '#f0a33c' } },
  { id: 'cat', name: '猫', colors: { body: '#e3a15c', belly: '#fbf1e4', accent: '#f2a7a0' } },
  { id: 'fox', name: '狐狸', colors: { body: '#d9682e', belly: '#fbf3ea', accent: '#3a2a22' } },
  { id: 'bear', name: '小熊', colors: { body: '#9a6b4b', belly: '#e8cfae', accent: '#3a2a22' } },
  { id: 'rabbit', name: '兔子', colors: { body: '#efe9e2', belly: '#ffffff', accent: '#f2a7a0' } },
];

export const ACCESSORIES: { id: Accessory; name: string }[] = [
  { id: 'scarf', name: '围巾' }, { id: 'party', name: '派对帽' }, { id: 'tophat', name: '礼帽' }, { id: 'crown', name: '王冠' },
  { id: 'glasses', name: '眼镜' }, { id: 'bow', name: '蝴蝶结' }, { id: 'backpack', name: '书包' },
];

export const DEFAULT_LOOK: Look = { species: 'owl', colors: { ...SPECIES[0].colors }, accessories: ['scarf'] };

/** 外观规范化：不认识的物种、颜色、配饰去掉 */
export function cleanLook(raw: unknown): Look {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Look;
  const sp = SPECIES.find(s => s.id === r.species) || SPECIES[0];
  const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
  return {
    species: sp.id,
    colors: { body: hex(r.colors?.body, sp.colors.body), belly: hex(r.colors?.belly, sp.colors.belly), accent: hex(r.colors?.accent, sp.colors.accent) },
    accessories: [...new Set((r.accessories || []).filter(a => ACCESSORIES.some(x => x.id === a)))].slice(0, 4),
  };
}

/** 没换过装时的默认外观：按世界 id 定一个（每个人的小管家一开始就不一样） */
export function seededLook(seed: string): Look {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const r = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
  const sp = SPECIES[Math.floor(r() * SPECIES.length)];
  const acc = ACCESSORIES[Math.floor(r() * ACCESSORIES.length)].id;
  return { species: sp.id, colors: { ...sp.colors }, accessories: [acc] };
}
