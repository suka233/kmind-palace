// 界面图标（线性 SVG，跟随 currentColor）与少量 DOM 小工具
import { t } from './i18n';

export const ICONS = {
  logo: '<svg class="kp-i" viewBox="0 0 24 24"><path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 5 9-5" opacity=".5"/></svg>',
  rotl: '<svg class="kp-i" viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/></svg>',
  rotr: '<svg class="kp-i" viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/></svg>',
  walls: '<svg class="kp-i" viewBox="0 0 24 24"><path d="M3 20h18"/><path d="M5 20V9h5v11"/><path d="M14 20v-6h5v6"/></svg>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  reset: '<svg class="kp-i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  walk: '<svg class="kp-i" viewBox="0 0 24 24"><circle cx="13" cy="4.5" r="1.8"/><path d="m9 21 2.5-6.5L14 17v4"/><path d="M7.5 11.5 10 8.5h4l2 3.5 2.5 1"/><path d="m11.5 14.5.8-6"/></svg>',
  build: '<svg class="kp-i" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13 7 4 4"/><path d="M14 20h6"/></svg>',
  plus: '<svg class="kp-i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  undo: '<svg class="kp-i" viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  redo: '<svg class="kp-i" viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
  grid: '<svg class="kp-i" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/></svg>',
  check: '<svg class="kp-i" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  route: '<svg class="kp-i" viewBox="0 0 24 24" style="width:14px;height:14px"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"/></svg>',
  pin: '<svg class="kp-i" viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M12 21s-6-5.5-6-11a6 6 0 1 1 12 0c0 5.5-6 11-6 11Z"/><circle cx="12" cy="10" r="2"/></svg>',
  back: '<svg class="kp-i" viewBox="0 0 24 24"><path d="M15 5 8 12l7 7"/></svg>',
  search: '<svg class="kp-i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  house: '<svg class="kp-i" viewBox="0 0 24 24"><path d="M4 11 12 4l8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/></svg>',
  move: '<svg class="kp-i" viewBox="0 0 24 24"><path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></svg>',
  gear: '<svg class="kp-i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.2"/></svg>',
  users: '<svg class="kp-i" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-6 6.5-6s5.9 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2 .8 3.2 2.9 3.5 5.7"/></svg>',
  hash: '<svg class="kp-i" viewBox="0 0 24 24"><path d="M9.5 3.5 7.5 20.5M16.5 3.5l-2 17M4 8.5h16.5M3.5 15.5H20"/></svg>',
  list: '<svg class="kp-i" viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
  planet: '<svg class="kp-i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/><path d="M4.6 15.8C2.4 17.6 1.6 19 2.2 19.7c1.1 1.3 7.2-1.4 12.7-6.2 5.5-4.7 8.4-9.3 7.3-10.4-.6-.6-2.2-.2-4.4 1"/></svg>',
  globe: '<svg class="kp-i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5s1.2-6.1 3.8-8.5Z"/></svg>',
  map: '<svg class="kp-i" viewBox="0 0 24 24"><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z"/><path d="M9 4v14M15 6v14"/></svg>',
};

export function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 「3 天前」这类相对时间 */
export function timeAgo(ts: number, now = Date.now()) {
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 60) return t('刚刚');
  if (s < 3600) return t('{n} 分钟前', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n} 小时前', { n: Math.floor(s / 3600) });
  if (s < 86400 * 30) return t('{n} 天前', { n: Math.floor(s / 86400) });
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
