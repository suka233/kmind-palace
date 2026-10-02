import { gid, type PalaceDoc, type PalaceRoute } from './schema';
import type { PalaceWorld, PalaceJourney } from './world';
import { AUTO_ROUTE_ID, autoRoute, resolveRoute, type RouteStop, type SlotSort } from './route';
import { t } from './i18n';

/* =====================================================================
 * 旅程（跨宫殿路线，纯数据）：把几座宫殿里的路线按顺序串起来。
 * 一段 = 一座宫殿里的一条路线；同一座宫殿可以出现在多段里。
 * 旅程存在世界数据里（PalaceWorld.journeys），宫殿或路线被删掉时，对应的段跳过 / 清理掉。
 * ===================================================================== */

export interface ResolvedLeg {
  /** 在旅程里是第几段 */
  index: number;
  palaceId: string;
  routeId: string;
  /** 宫殿已被删除时为 null */
  doc: PalaceDoc | null;
  /** 路线已被删除时为 null */
  route: PalaceRoute | null;
  stops: RouteStop[];
}

type DocLookup = Map<string, PalaceDoc> | ((id: string) => PalaceDoc | undefined);
const lookup = (docs: DocLookup, id: string) => (typeof docs === 'function' ? docs(id) : docs.get(id)) || null;

/** 宫殿里的一条路线；'auto' 是按位置排的默认路线（宫殿保存过路线时也能用） */
export function legRoute(doc: PalaceDoc, routeId: string, slotSort?: SlotSort): PalaceRoute | null {
  if (routeId === AUTO_ROUTE_ID) return { id: AUTO_ROUTE_ID, name: t('全部记忆桩'), stops: autoRoute(doc, slotSort) };
  return doc.routes?.find(r => r.id === routeId) || null;
}

/** 旅程的每一段解析成一站站（宫殿或路线不在了的段，doc / route 为 null、没有站） */
export function resolveJourney(j: PalaceJourney, docs: DocLookup, slotSort?: SlotSort): ResolvedLeg[] {
  return j.legs.map((leg, index) => {
    const doc = lookup(docs, leg.palaceId);
    const route = doc ? legRoute(doc, leg.routeId, slotSort) : null;
    return { index, palaceId: leg.palaceId, routeId: leg.routeId, doc, route, stops: doc && route ? resolveRoute(doc, route) : [] };
  });
}

/** 新建一个空旅程，放到世界数据里 */
export function createJourney(world: PalaceWorld, name?: string): PalaceJourney {
  const list = world.journeys || (world.journeys = []);
  const j: PalaceJourney = { id: gid('journey-'), name: name || t('旅程 {n}', { n: list.length + 1 }), legs: [] };
  list.push(j);
  return j;
}

export function deleteJourney(world: PalaceWorld, id: string) {
  world.journeys = (world.journeys || []).filter(j => j.id !== id);
  if (!world.journeys.length) delete world.journeys;
}

/** 经过某座宫殿的旅程 */
export function journeysWith(world: PalaceWorld, palaceId: string): PalaceJourney[] {
  return (world.journeys || []).filter(j => j.legs.some(l => l.palaceId === palaceId));
}

/**
 * 清理旅程里失效的段：宫殿已删除（exists 返回 false），或某座宫殿的某条路线已删除（route 指定时只清这一条）。
 * 返回是否有改动。
 */
export function pruneJourneys(world: PalaceWorld, exists: (palaceId: string) => boolean, route?: { palaceId: string; routeId: string }): boolean {
  let changed = false;
  for (const j of world.journeys || []) {
    const legs = j.legs.filter(l => exists(l.palaceId) && !(route && l.palaceId === route.palaceId && l.routeId === route.routeId));
    if (legs.length !== j.legs.length) { j.legs = legs; changed = true; }
  }
  return changed;
}
