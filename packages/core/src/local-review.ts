import type { Rating, ReviewAdapter, ReviewState } from './host';

/* =====================================================================
 * 本地闪卡：宿主没有自己的间隔重复系统时用（例如 Obsidian）。
 * 排期用 FSRS-5（默认参数，目标记忆率 90%），新卡和忘了的卡先过几分钟的短步骤。
 * 卡片状态是一个以块 id 为键的 JSON，由宿主存取（随笔记一起同步）。
 * ===================================================================== */

export interface LocalCard {
  /** 下次复习时间（毫秒） */
  due: number;
  /** 稳定性（天）：记忆率降到 90% 需要的天数 */
  s: number;
  /** 难度 1–10 */
  d: number;
  /** 0 新卡 · 1 学习中 · 2 复习 · 3 重新学习 */
  state: 0 | 1 | 2 | 3;
  reps: number;
  lapses: number;
  /** 上次复习时间（毫秒） */
  last?: number;
}

export type LocalCards = Record<string, LocalCard>;

// FSRS-5 默认参数
const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5;
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;
const RETENTION = 0.9;
const MIN = 60e3, DAY = 86400e3;
/** 学习 / 重新学习的短步骤：忘了、困难、记得各隔多久再看 */
const STEPS: Record<1 | 2 | 3, number> = { 1: MIN, 2: 5 * MIN, 3: 10 * MIN };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const initD = (g: Rating) => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);
const initS = (g: Rating) => W[g - 1];
/** 过了 t 天之后还记得的概率 */
export const retrievability = (t: number, s: number) => Math.pow(1 + FACTOR * t / s, DECAY);
/** 稳定性为 s 时，到下次复习隔几天（记忆率降到 RETENTION 时） */
const intervalDays = (s: number) => clamp(Math.round(s / FACTOR * (Math.pow(RETENTION, 1 / DECAY) - 1)), 1, 36500);

function nextD(d: number, g: Rating) {
  const delta = -W[6] * (g - 3);
  const d1 = d + delta * (10 - d) / 9;
  return clamp(W[7] * initD(4) + (1 - W[7]) * d1, 1, 10);
}

function recallS(d: number, s: number, r: number, g: Rating) {
  const hard = g === 2 ? W[15] : 1, easy = g === 4 ? W[16] : 1;
  return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy);
}

function forgetS(d: number, s: number, r: number) {
  return Math.min(s, W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
}

/** 同一天之内的短期复习 */
const shortS = (s: number, g: Rating) => s * Math.exp(W[17] * (g - 3 + W[18]));

/** 记一次自评，返回新的卡片状态（不修改传入的卡片） */
export function scheduleCard(card: LocalCard | undefined, g: Rating, now: number): LocalCard {
  const c: LocalCard = card ? { ...card } : { due: now, s: 0, d: 0, state: 0, reps: 0, lapses: 0 };
  if (c.state === 0) {
    c.d = initD(g);
    c.s = initS(g);
    if (g === 4) { c.state = 2; c.due = now + intervalDays(c.s) * DAY; } else { c.state = 1; c.due = now + STEPS[g]; }
  } else if (c.state === 1 || c.state === 3) {
    c.s = Math.max(.01, shortS(c.s, g));
    c.d = nextD(c.d, g);
    if (g >= 3) { c.state = 2; c.due = now + intervalDays(c.s) * DAY; } else c.due = now + STEPS[g];
  } else {
    const t = Math.max(0, (now - (c.last ?? now)) / DAY);
    const r = retrievability(t, c.s);
    c.d = nextD(c.d, g);
    if (g === 1) {
      c.lapses++;
      c.s = Math.max(.01, forgetS(c.d, c.s, r));
      c.state = 3;
      c.due = now + STEPS[3];
    } else {
      c.s = recallS(c.d, c.s, r, g);
      c.due = now + intervalDays(c.s) * DAY;
    }
  }
  c.reps++;
  c.last = now;
  return c;
}

export function cardState(c: LocalCard | undefined): ReviewState {
  if (!c) return { card: false };
  return { card: true, due: c.due, state: c.state, reps: c.reps, lapses: c.lapses, lastReview: c.last };
}

function sanitize(raw: unknown): LocalCards {
  const out: LocalCards = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, c] of Object.entries(raw as Record<string, any>)) {
    if (!c || typeof c !== 'object' || !Number.isFinite(c.due) || !Number.isFinite(c.s)) continue;
    out[id] = { due: c.due, s: c.s, d: Number.isFinite(c.d) ? c.d : 5, state: [0, 1, 2, 3].includes(c.state) ? c.state : 2, reps: c.reps | 0, lapses: c.lapses | 0, ...(Number.isFinite(c.last) ? { last: c.last } : {}) };
  }
  return out;
}

export interface LocalReview extends ReviewAdapter {
  /** 块 id 变了（例如 Obsidian 里文件改名）：f 返回新 id，不变时返回 null */
  remap(f: (id: string) => string | null): Promise<boolean>;
  /** 卡片文件被别处改动（同步）：下次读取时重新加载 */
  reload(): void;
}

/** 本地闪卡适配器：io 负责读写卡片 JSON */
export function createLocalReview(io: { load(): Promise<unknown>; save(cards: LocalCards): Promise<void> }, now = () => Date.now()): LocalReview {
  let cards: LocalCards | null = null;
  let loading: Promise<LocalCards> | null = null;
  const ready = () => cards ? Promise.resolve(cards) : (loading ||= io.load().then(sanitize, () => ({})).then(c => { cards = c; loading = null; return c; }));
  return {
    async getStates(ids) {
      const c = await ready();
      const out: Record<string, ReviewState> = {};
      for (const id of ids) if (c[id]) out[id] = cardState(c[id]);
      return out;
    },
    async rate(id, g) {
      const c = await ready();
      c[id] = scheduleCard(c[id], g, now());
      await io.save(c);
      return cardState(c[id]);
    },
    async remap(f) {
      const c = await ready();
      let changed = false;
      for (const id of Object.keys(c)) {
        const to = f(id);
        if (to && to !== id) { c[to] = c[id]; delete c[id]; changed = true; }
      }
      if (changed) await io.save(c);
      return changed;
    },
    reload() { cards = null; },
  };
}
