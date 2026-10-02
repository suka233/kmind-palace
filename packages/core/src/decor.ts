import type { PalaceItem, Vec3 } from './schema';

/* =====================================================================
 * 家具默认带的摆件（纯数据）
 * 茶几上的书和杯子、餐桌上的花瓶、书桌上的绿植……原来写死在家具的构建函数里，
 * 现在作为真正的子物件放在家具上：可以挪、删、换，也可以单独绑定记忆桩。
 * 坐标是家具的局部坐标（原点 = 底部中心、正面朝 +z），角度单位：度。
 * ===================================================================== */

export interface DecorSpec {
  type: string;
  name?: string;
  pos: Vec3;
  rot?: number;
  params?: Record<string, any>;
  /** 放在这件摆件上的摆件（托盘上的杯子） */
  children?: DecorSpec[];
}

const pampas = (h: number, potR: number, potH: number, pot: string) => ({ kind: 'pampas', h, potR, potH, pot });

export const DECOR: Record<string, (p: Record<string, any>) => DecorSpec[]> = {
  coffeeTable: () => [
    { type: 'bookStack', pos: [-.12, .38, .08], rot: 17, params: { colors: ['navy', 'cream'] } },
    {
      type: 'tray', pos: [.15, .38, -.1], children: [
        { type: 'cup', pos: [-.03, .015, .02], params: { color: 'ceramic' } },
        { type: 'cup', pos: [.05, .015, -.04], params: { color: 'terracotta' } },
      ],
    },
    { type: 'plant', name: '干花', pos: [.05, .38, .2], params: pampas(.5, .05, .16, 'ceramic') },
  ],
  diningTable: () => [
    { type: 'plant', name: '鲜花', pos: [0, .755, 0], params: { kind: 'flowers', h: .5, potR: .06, potH: .18, pot: 'ceramic' } },
    { type: 'candle', pos: [-.28, .755, .02] },
    { type: 'candle', pos: [.28, .755, .02] },
    ...([[-.5, .3], [.5, .3], [-.5, -.3], [.5, -.3]] as [number, number][]).map(([x, z]): DecorSpec => ({ type: 'placeSetting', pos: [x, .755, z], rot: z > 0 ? 0 : 180 })),
  ],
  desk: () => [
    { type: 'plant', name: '绿植', pos: [.62, .755, -.22], params: { kind: 'bush', h: .26, potR: .06, potH: .1, pot: 'potWhite' } },
    { type: 'cup', name: '马克杯', pos: [.5, .755, .12], params: { color: 'terracotta', r: .035, h: .09 } },
  ],
  mediaConsole: ({ w = 2.0 }) => [
    { type: 'plant', name: '虎尾兰', pos: [-w / 2 + .18, .54, 0], params: { kind: 'snake', h: .55, potR: .08, potH: .14, pot: 'potWhite' } },
    { type: 'bookStack', pos: [w / 2 - .25, .54, .02], params: { colors: ['terracotta', 'navy'] } },
    { type: 'vase', pos: [w / 2 - .12, .54, -.05], params: { color: 'ceramic', h: .26 } },
  ],
  sideboard: ({ w = 1.8, h = .78 }) => [
    { type: 'tableLamp', pos: [-w / 2 + .25, h, 0], params: { h: .52, shade: 'warm', base: 'terracotta' } },
    { type: 'bookStack', pos: [.1, h, .02], params: { colors: ['mustard', 'cream'] } },
    { type: 'plant', name: '干花', pos: [w / 2 - .22, h, -.02], params: pampas(.75, .07, .26, 'potGrey') },
  ],
  kitchenIsland: () => [
    { type: 'fruitBowl', pos: [-.35, .9, .05] },
    { type: 'plant', name: '鲜花', pos: [.55, .9, 0], params: { kind: 'flowers', h: .45, potR: .05, potH: .16, pot: 'glass' } },
  ],
  dresser: ({ h = .78 }) => [
    { type: 'plant', name: '干花', pos: [.28, h, -.04], params: pampas(.55, .06, .16, 'potWhite') },
  ],
};

/**
 * 把家具默认的摆件变成子物件（新放下的家具、旧数据迁移、模板）。
 * 做过的家具标 params.decor = false，之后不再重复添加（用户删掉的摆件不会回来）。
 * 子物件 id 由家具 id 推出：多台设备各自迁移，结果一致。返回是否有改动。
 */
export function materializeDecor(items: PalaceItem[], only?: PalaceItem): boolean {
  let changed = false;
  const ids = new Set(items.map(i => i.id));
  const add = (specs: DecorSpec[], parent: PalaceItem) => specs.forEach((s, i) => {
    const id = `${parent.id}~d${i}`;
    if (ids.has(id)) return;
    const child: PalaceItem = { id, type: s.type, parent: parent.id, pos: [...s.pos] as Vec3, rot: s.rot || 0 };
    if (parent.room) child.room = parent.room;
    if (s.name) child.name = s.name;
    if (s.params) child.params = JSON.parse(JSON.stringify(s.params));
    items.push(child);
    ids.add(id);
    if (s.children) add(s.children, child);
  });
  for (const it of only ? [only] : [...items]) {
    const f = DECOR[it.type];
    if (!f || it.params?.decor === false) continue;
    const specs = f(it.params || {});
    it.params = { ...(it.params || {}), decor: false };
    add(specs, it);
    changed = true;
  }
  return changed;
}
