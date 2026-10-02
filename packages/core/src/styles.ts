// 视图样式：全部限定在 .kp-root 下，避免污染宿主（思源 / Obsidian）的样式
const CSS = /* i18n-ignore：只有 CSS 注释含中文 */ `
.kp-root {
  --kp-ink: #2f2a25; --kp-ink-2: #6f655b;
  --kp-glass: rgba(255, 252, 247, .78); --kp-glass-line: rgba(255, 255, 255, .65);
  --kp-shadow: 0 12px 34px rgba(70, 48, 26, .16);
  --kp-accent: #ef8235; --kp-primary-bg: #2f2a25; --kp-primary-fg: #fffaf3; --kp-fade: #f1e9df;
  position: relative; width: 100%; height: 100%; overflow: hidden; outline: none; container: kp / inline-size;
  background: #e9dfd2; color: var(--kp-ink);
  font-family: var(--b3-font-family, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif);
  -webkit-font-smoothing: antialiased; user-select: none; -webkit-user-select: none; font-size: 13px; line-height: 1.5;
}
.kp-root.kp-night {
  --kp-ink: #efe7dc; --kp-ink-2: #aa9f93;
  --kp-glass: rgba(34, 34, 44, .7); --kp-glass-line: rgba(255, 255, 255, .08);
  --kp-shadow: 0 12px 34px rgba(0, 0, 0, .35);
  --kp-primary-bg: #f2d7a8; --kp-primary-fg: #2a2520; --kp-fade: #151821;
}
.kp-root * { box-sizing: border-box; }
.kp-root canvas { display: block; position: absolute; inset: 0; touch-action: none; }
.kp-root .kp-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 0; isolation: isolate; }
.kp-root .kp-glass {
  background: var(--kp-glass);
  backdrop-filter: blur(16px) saturate(1.4); -webkit-backdrop-filter: blur(16px) saturate(1.4);
  box-shadow: var(--kp-shadow), inset 0 0 0 1px var(--kp-glass-line);
  transition: background .6s, color .6s;
}
.kp-root button { all: unset; cursor: pointer; box-sizing: border-box; }
.kp-root svg.kp-i { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex: none; }

.kp-brand { position: absolute; left: 14px; top: 12px; display: flex; align-items: center; gap: 11px; padding: 8px 10px 8px 10px; border-radius: 15px; max-width: calc(100% - 28px); }
.kp-brand .kp-mark { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; background: var(--kp-primary-bg); color: var(--kp-primary-fg); flex: none; }
.kp-brand .kp-title { font-size: 14px; letter-spacing: .05em; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kp-brand .kp-sub { font-size: 11.5px; color: var(--kp-ink-2); letter-spacing: .03em; white-space: nowrap; }
.kp-brand .kp-loci-btn { margin-left: 4px; padding: 6px 10px; border-radius: 10px; font-size: 12px; background: rgba(239, 130, 53, .14); color: #b85a1c; display: flex; gap: 5px; align-items: center; white-space: nowrap; }
.kp-night .kp-brand .kp-loci-btn { color: #f5b27a; }

.kp-loci { position: absolute; left: 14px; top: 70px; width: 290px; max-height: calc(100% - 170px); overflow: auto; padding: 8px; border-radius: 15px; }
.kp-loci.kp-hidden { display: none; }
.kp-loci .kp-empty { padding: 10px 10px 12px; color: var(--kp-ink-2); font-size: 12.5px; }
.kp-loci .kp-row { display: flex; flex-direction: column; gap: 1px; width: 100%; padding: 8px 10px; border-radius: 10px; }
.kp-loci .kp-row:hover { background: rgba(127, 110, 90, .12); }
.kp-loci .kp-row b { font-weight: 600; font-size: 13px; }
.kp-loci .kp-row span { font-size: 12px; color: var(--kp-ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.kp-bar { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; align-items: center; gap: 3px; padding: 5px; border-radius: 17px; max-width: calc(100% - 24px); overflow-x: auto; scrollbar-width: none; }
.kp-bar button { display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px; border-radius: 12px; font-size: 13px; color: var(--kp-ink); white-space: nowrap; transition: background .2s, transform .1s; }
.kp-bar button:hover { background: rgba(127, 110, 90, .13); }
.kp-bar button:active { transform: scale(.96); }
.kp-bar button.kp-icon { padding: 0; width: 36px; justify-content: center; }
.kp-bar button.kp-primary { background: var(--kp-primary-bg); color: var(--kp-primary-fg); padding: 0 15px; }
.kp-bar .kp-sep { width: 1px; height: 22px; background: rgba(127, 110, 90, .25); margin: 0 3px; flex: none; }

.kp-room-label {
  font-size: 12px; letter-spacing: .12em; padding: 3px 10px 3px 11px; border-radius: 999px;
  background: rgba(255, 252, 247, .86); color: #4a4139; box-shadow: 0 3px 10px rgba(60, 40, 20, .14);
  white-space: nowrap; pointer-events: none;
  font-family: var(--b3-font-family, -apple-system, "PingFang SC", system-ui, sans-serif);
}
.kp-room-label small { opacity: .5; margin-left: 6px; font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; }
.kp-night .kp-room-label { background: rgba(30, 30, 40, .78); color: #eee4d6; }

.kp-tip { position: absolute; left: 0; top: 0; pointer-events: none; padding: 6px 11px; border-radius: 10px; background: rgba(38, 33, 29, .92); color: #fff8ee; font-size: 12px; opacity: 0; transition: opacity .15s; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; z-index: 3; }
.kp-tip small { color: #cbbba8; margin-left: 6px; }
.kp-tip .kp-bound { display: block; color: #ffc48f; margin-top: 2px; }

.kp-card { position: absolute; left: 14px; bottom: 16px; width: 272px; padding: 15px; border-radius: 18px; transition: opacity .25s, transform .25s; z-index: 2; }
.kp-card.kp-hidden { opacity: 0; transform: translateY(8px); pointer-events: none; }
.kp-card .kp-room { font-size: 11px; color: var(--kp-ink-2); letter-spacing: .12em; }
.kp-card h3 { margin: 3px 0 10px; font-size: 17px; font-weight: 650; padding-right: 20px; }
.kp-card .kp-slot { border: 1.5px dashed rgba(127, 110, 90, .35); border-radius: 12px; padding: 9px 11px; font-size: 12px; color: var(--kp-ink-2); line-height: 1.6; }
.kp-card .kp-slot.kp-linked { border-style: solid; border-color: rgba(239, 130, 53, .5); background: rgba(239, 130, 53, .08); color: var(--kp-ink); cursor: pointer; }
.kp-card .kp-slot.kp-linked:hover { background: rgba(239, 130, 53, .14); }
.kp-card .kp-slot.kp-missing { border-color: rgba(200, 60, 40, .5); background: rgba(200, 60, 40, .06); }
.kp-card .kp-slot b { display: block; font-size: 13.5px; font-weight: 600; word-break: break-all; }
.kp-card .kp-slot small { display: block; color: var(--kp-ink-2); font-size: 11.5px; margin-top: 2px; word-break: break-all; }
.kp-card .kp-row, .kp-shelfed .kp-row { display: flex; gap: 7px; margin-top: 10px; }
.kp-card .kp-row button, .kp-shelfed .kp-row button { flex: 1; text-align: center; font-size: 12.5px; padding: 8px 0; border-radius: 10px; background: rgba(127, 110, 90, .13); color: var(--kp-ink); }
.kp-card .kp-row button:hover { background: rgba(127, 110, 90, .2); }
.kp-card .kp-row button.kp-primary, .kp-shelfed .kp-row button.kp-primary { background: var(--kp-primary-bg); color: var(--kp-primary-fg); }
.kp-card .kp-row button.kp-danger, .kp-shelfed .kp-row button.kp-danger { flex: none; padding: 8px 11px; color: #b44a36; }
.kp-card .kp-close { position: absolute; right: 10px; top: 8px; padding: 2px 8px; font-size: 17px; color: var(--kp-ink-2); }

.kp-walk-hud { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 7px 7px 7px 16px; border-radius: 16px; font-size: 12.5px; color: var(--kp-ink-2); white-space: nowrap; max-width: calc(100% - 24px); }
.kp-walk-hud kbd { font-family: inherit; font-size: 11px; padding: 2px 6px; border-radius: 6px; background: rgba(127, 110, 90, .16); color: var(--kp-ink); }
.kp-walk-hud button { padding: 8px 13px; border-radius: 11px; background: var(--kp-primary-bg); color: var(--kp-primary-fg); font-size: 13px; }
.kp-crosshair { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: rgba(255, 255, 255, .9); box-shadow: 0 0 0 1.5px rgba(0, 0, 0, .25); pointer-events: none; }
.kp-focus { position: absolute; left: 50%; top: calc(50% + 22px); transform: translateX(-50%); padding: 7px 13px; border-radius: 12px; font-size: 12.5px; white-space: nowrap; pointer-events: none; max-width: 80%; overflow: hidden; text-overflow: ellipsis; }
.kp-focus b { color: var(--kp-accent); font-weight: 600; }
.kp-joy { position: absolute; left: 22px; bottom: 80px; width: 120px; height: 120px; border-radius: 50%; touch-action: none; }
.kp-joy i { position: absolute; left: 50%; top: 50%; width: 48px; height: 48px; margin: -24px 0 0 -24px; border-radius: 50%; background: var(--kp-primary-bg); opacity: .85; }
.kp-root .kp-walk-only, .kp-root.kp-walking .kp-iso-only { display: none !important; }
.kp-root.kp-walking .kp-walk-only { display: flex !important; }
.kp-root.kp-walking .kp-crosshair.kp-walk-only { display: block !important; }
.kp-root:not(.kp-touch) .kp-joy { display: none !important; }
.kp-root .kp-focus.kp-hidden { display: none !important; }

.kp-fade { position: absolute; inset: 0; background: var(--kp-fade); opacity: 0; pointer-events: none; transition: opacity .35s ease; z-index: 5; }
.kp-loading { position: absolute; inset: 0; display: grid; place-items: center; background: #efe7dc; color: #7a6d60; font-size: 13px; letter-spacing: .2em; transition: opacity .8s ease; z-index: 6; }
.kp-loading.kp-done { opacity: 0; pointer-events: none; }

@container kp (max-width: 760px) {
  .kp-bar button:not(.kp-icon):not(.kp-primary) span { display: none; }
  .kp-bar button:not(.kp-icon):not(.kp-primary) { padding: 0 10px; }
  .kp-card { left: 10px; right: 10px; width: auto; bottom: 70px; }
  .kp-brand .kp-sub { display: none; }
}
@container kp (max-width: 1100px) { .kp-card { bottom: 72px; } }

/* ---------------- 编辑模式 ---------------- */
.kp-root .kp-edit-only, .kp-root .kp-placing-only { display: none !important; }
.kp-root.kp-editing .kp-edit-only { display: flex !important; }
.kp-root.kp-editing .kp-edit-hint.kp-edit-only { display: block !important; }
.kp-root.kp-editing .kp-view-only { display: none !important; }
.kp-root.kp-placing .kp-placing-only { display: flex !important; }
.kp-root.kp-placing .kp-editbar { display: none !important; }
.kp-root.kp-editing.kp-drawer-open .kp-edit-hint.kp-edit-only { display: none !important; }
.kp-bar button[disabled] { opacity: .32; pointer-events: none; }
.kp-bar button.kp-accent { background: rgba(239, 130, 53, .16); color: #b85a1c; }
.kp-night .kp-bar button.kp-accent { color: #f5b27a; }
.kp-edit-hint { position: absolute; right: 14px; top: 12px; max-width: 340px; padding: 8px 12px; border-radius: 12px; font-size: 11.5px; color: var(--kp-ink-2); line-height: 1.75; }
.kp-edit-hint b { color: var(--kp-ink); font-weight: 600; }
.kp-place { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); align-items: center; gap: 12px; padding: 7px 7px 7px 16px; border-radius: 16px; font-size: 12.5px; white-space: nowrap; max-width: calc(100% - 24px); }
.kp-place span { overflow: hidden; text-overflow: ellipsis; }
.kp-root .kp-place button { padding: 8px 13px; border-radius: 11px; background: rgba(127, 110, 90, .15); font-size: 13px; }

.kp-drawer { position: absolute; right: 14px; top: 12px; bottom: 72px; width: 316px; border-radius: 18px; display: flex; flex-direction: column; overflow: hidden; z-index: 3; }
.kp-drawer.kp-hidden { display: none; }
.kp-drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 12px 6px 16px; font-size: 14px; }
.kp-root .kp-drawer-head .kp-close { padding: 2px 8px; font-size: 17px; color: var(--kp-ink-2); }
.kp-chips { display: flex; gap: 6px; padding: 4px 12px 10px; overflow-x: auto; scrollbar-width: none; flex: none; }
.kp-root .kp-chip { flex: none; padding: 5px 11px; border-radius: 999px; font-size: 12px; background: rgba(127, 110, 90, .12); white-space: nowrap; }
.kp-root .kp-chip.kp-on { background: var(--kp-primary-bg); color: var(--kp-primary-fg); }
.kp-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 0 10px 14px; overflow-y: auto; align-content: start; }
.kp-root .kp-tile { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 4px 8px; border-radius: 12px; }
.kp-root .kp-tile:hover { background: rgba(127, 110, 90, .12); }
.kp-thumb { width: 100%; aspect-ratio: 1; border-radius: 10px; background: rgba(255, 255, 255, .5); display: grid; place-items: center; overflow: hidden; }
.kp-night .kp-thumb { background: rgba(255, 255, 255, .08); }
.kp-thumb img { width: 92%; height: 92%; object-fit: contain; opacity: 0; transition: opacity .3s; }
.kp-thumb img.kp-loaded { opacity: 1; }
.kp-tile-name { font-size: 11.5px; text-align: center; line-height: 1.3; color: var(--kp-ink); }

.kp-card .kp-name { width: 100%; margin: 3px 0 10px; font: inherit; font-size: 16px; font-weight: 650; color: var(--kp-ink); background: transparent; border: none; border-bottom: 1.5px dashed rgba(127, 110, 90, .35); padding: 2px 22px 4px 0; outline: none; }
.kp-card .kp-name:focus { border-bottom-color: var(--kp-accent); }
.kp-card .kp-tools { display: flex; flex-wrap: wrap; gap: 6px; }
.kp-card .kp-tools button { padding: 6px 10px; border-radius: 9px; font-size: 12px; background: rgba(127, 110, 90, .13); color: var(--kp-ink); }
.kp-card .kp-tools button:hover { background: rgba(127, 110, 90, .22); }
.kp-card .kp-tools button.kp-danger, .kp-card .kp-bindline button.kp-danger { color: #b44a36; }
.kp-card .kp-params { margin-top: 12px; display: flex; flex-direction: column; gap: 7px; max-height: 210px; overflow-y: auto; padding-right: 2px; }
.kp-field { display: grid; grid-template-columns: 64px 1fr auto; align-items: center; gap: 8px; font-size: 12px; color: var(--kp-ink-2); }
.kp-field select { grid-column: 2 / 4; font: inherit; font-size: 12.5px; color: var(--kp-ink); background: rgba(255, 255, 255, .55); border: 1px solid rgba(127, 110, 90, .25); border-radius: 8px; padding: 4px 6px; }
.kp-night .kp-field select { background: rgba(255, 255, 255, .08); }
.kp-field input[type=range] { width: 100%; accent-color: var(--kp-accent); margin: 0; }
.kp-field output { font-variant-numeric: tabular-nums; min-width: 44px; text-align: right; color: var(--kp-ink); }
.kp-card .kp-bindline { display: flex; align-items: center; gap: 6px; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(127, 110, 90, .18); font-size: 12px; }
.kp-card .kp-bindline span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--kp-ink-2); }
.kp-card .kp-bindline b { color: var(--kp-ink); font-weight: 600; }
.kp-card .kp-bindline button { padding: 5px 10px; border-radius: 8px; background: rgba(127, 110, 90, .13); font-size: 12px; color: var(--kp-ink); }

@container kp (max-width: 760px) {
  .kp-root.kp-editing .kp-edit-hint.kp-edit-only { display: none !important; }
  .kp-drawer { left: 10px; right: 10px; width: auto; top: auto; height: 46%; bottom: 70px; }
}

/* ---------------- 搭建子模式：物件 / 房间 / 墙体 ---------------- */
.kp-root .kp-em-items, .kp-root .kp-em-rooms, .kp-root .kp-em-walls { display: none !important; }
.kp-root.kp-emode-items .kp-em-items, .kp-root.kp-emode-rooms .kp-em-rooms, .kp-root.kp-emode-walls .kp-em-walls { display: flex !important; }
.kp-root.kp-emode-rooms.kp-placing .kp-editbar, .kp-root.kp-emode-walls.kp-placing .kp-editbar { display: flex !important; }
.kp-root.kp-emode-rooms.kp-placing .kp-place, .kp-root.kp-emode-walls.kp-placing .kp-place { bottom: 70px; }
.kp-seg { display: flex; padding: 3px; gap: 2px; border-radius: 12px; background: rgba(127, 110, 90, .12); flex: none; margin-right: 4px; }
.kp-root .kp-bar .kp-seg button { height: 30px; padding: 0 11px; border-radius: 9px; font-size: 12.5px; }
.kp-root .kp-bar .kp-seg button.kp-on { background: var(--kp-primary-bg); color: var(--kp-primary-fg); }
.kp-root .kp-bar button.kp-accent.kp-on { background: #ef8235; color: #fff; }
.kp-card { max-height: calc(100% - 100px); overflow-y: auto; scrollbar-width: thin; }
.kp-card .kp-subtitle { margin: 12px 0 7px; font-size: 11.5px; color: var(--kp-ink-2); letter-spacing: .04em; }
.kp-swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 7px; }
.kp-root .kp-swatch { display: block; aspect-ratio: 1; border-radius: 8px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .14); cursor: pointer; transition: transform .1s; }
.kp-root .kp-swatch:hover { transform: scale(1.08); }
.kp-root .kp-swatch.kp-on { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .14), 0 0 0 2px #fffaf3, 0 0 0 3.5px var(--kp-accent); }
.kp-card .kp-tip { margin-top: 10px; font-size: 11.5px; color: var(--kp-ink-2); line-height: 1.6; }
.kp-field .kp-text { grid-column: 2 / 4; font: inherit; font-size: 12.5px; color: var(--kp-ink); background: rgba(255, 255, 255, .55); border: 1px solid rgba(127, 110, 90, .25); border-radius: 8px; padding: 4px 8px; outline: none; min-width: 0; }
.kp-night .kp-field .kp-text { background: rgba(255, 255, 255, .08); }
.kp-field .kp-inline { grid-column: 2 / 4; display: flex; align-items: center; gap: 6px; color: var(--kp-ink); }
.kp-place .kp-check { display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; color: var(--kp-ink); cursor: pointer; }

/* ---------------- 小镇 ---------------- */
.kp-brand .kp-back { width: 30px; height: 32px; margin: 0 -4px 0 -2px; border-radius: 10px; display: grid; place-items: center; color: var(--kp-ink); flex: none; }
.kp-brand .kp-back:hover { background: rgba(127, 110, 90, .14); }
.kp-topright { position: absolute; right: 14px; top: 12px; display: flex; align-items: center; gap: 8px; z-index: 2; }
.kp-topright .kp-seg { margin: 0; padding: 4px; border-radius: 14px; background: var(--kp-glass); }
.kp-root .kp-topright .kp-seg button { display: flex; align-items: center; gap: 5px; height: 30px; padding: 0 11px; border-radius: 10px; font-size: 12.5px; color: var(--kp-ink-2); }
.kp-root .kp-topright .kp-seg button svg { width: 15px; height: 15px; }
.kp-root .kp-topright .kp-seg button.kp-on { background: var(--kp-primary-bg); color: var(--kp-primary-fg); }
.kp-root .kp-search { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 10px 0 12px; border-radius: 14px; font-size: 12.5px; color: var(--kp-ink-2); }
.kp-root .kp-search svg { width: 16px; height: 16px; }
.kp-root kbd { font-family: inherit; font-size: 10.5px; padding: 1px 6px; border-radius: 6px; background: rgba(127, 110, 90, .15); color: var(--kp-ink-2); }
.kp-root.kp-editing .kp-topright, .kp-root.kp-drawer-open .kp-topright, .kp-root.kp-town-placing .kp-topright { display: none !important; }

.kp-tag {
  position: relative; display: flex; align-items: center; gap: 7px; margin-bottom: 7px; padding: 5px 12px 5px 10px; border-radius: 999px;
  background: rgba(255, 252, 247, .92); color: #2f2a25; font-size: 12.5px; font-weight: 600; letter-spacing: .02em; white-space: nowrap;
  box-shadow: 0 6px 18px rgba(60, 40, 20, .16), inset 0 0 0 1px rgba(255, 255, 255, .7);
  pointer-events: auto; cursor: pointer; transition: box-shadow .15s, background .3s;
  font-family: var(--b3-font-family, -apple-system, "PingFang SC", system-ui, sans-serif);
}
.kp-tag::after { content: ''; position: absolute; left: 50%; bottom: -6px; margin-left: -6px; border: 6px solid transparent; border-bottom: 0; border-top-color: rgba(255, 252, 247, .92); }
.kp-tag i { width: 8px; height: 8px; border-radius: 50%; background: var(--c, #c46d4d); flex: none; }
.kp-tag .kp-more { display: none; color: #b85a1c; font-weight: 500; font-size: 11.5px; }
.kp-tags-near .kp-tag .kp-more, .kp-tag.kp-hot .kp-more, .kp-tag.kp-sel .kp-more { display: inline; }
.kp-tag.kp-hot, .kp-tag.kp-sel { box-shadow: 0 8px 22px rgba(60, 40, 20, .2), inset 0 0 0 1.5px var(--c, #c46d4d); }
.kp-night .kp-tag { background: rgba(34, 34, 44, .84); color: #efe7dc; }
.kp-night .kp-tag::after { border-top-color: rgba(34, 34, 44, .84); }
.kp-night .kp-tag .kp-more { color: #f5b27a; }
.kp-town-editing .kp-tag, .kp-town-placing .kp-tag { pointer-events: none; }

.kp-bar .kp-bar-hint { padding: 0 8px 0 10px; font-size: 12px; color: var(--kp-ink-2); white-space: nowrap; }
.kp-bar .kp-bar-hint b { color: var(--kp-ink); font-weight: 600; }
.kp-root .kp-town-edit, .kp-root .kp-town-placing-only { display: none !important; }
.kp-root.kp-town-editing .kp-town-edit { display: flex !important; }
.kp-root.kp-town-placing .kp-town-placing-only { display: flex !important; }
.kp-root.kp-town-editing .kp-town-view, .kp-root.kp-town-placing .kp-town-view { display: none !important; }

.kp-card .kp-stats { font-size: 12px; color: var(--kp-ink-2); margin-top: -4px; }
.kp-card .kp-mini { display: flex; flex-direction: column; gap: 3px; }
.kp-root .kp-card .kp-mini button { display: flex; align-items: baseline; gap: 8px; padding: 6px 9px; border-radius: 9px; background: rgba(239, 130, 53, .08); font-size: 12.5px; min-width: 0; }
.kp-root .kp-card .kp-mini button:hover { background: rgba(239, 130, 53, .15); }
.kp-card .kp-mini b { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kp-card .kp-mini span { color: var(--kp-ink-2); font-size: 11.5px; white-space: nowrap; }
.kp-card .kp-more-note { font-size: 11.5px; color: var(--kp-ink-2); padding: 2px 9px; }
.kp-drawer-head .kp-drawer-tool { margin-left: auto; padding: 5px 10px; border-radius: 9px; background: rgba(239, 130, 53, .14); color: #b85a1c; font-size: 12px; white-space: nowrap; }
.kp-drawer-head .kp-drawer-tool + .kp-drawer-tool { margin-left: 6px; }
.kp-drawer-head .kp-drawer-tool[disabled] { opacity: .5; cursor: default; }
.kp-drawer-status { margin: 0 4px 8px; padding: 7px 10px; border-radius: 10px; background: rgba(239, 130, 53, .1); color: #b85a1c; font-size: 12px; }
.kp-card .kp-blocks-help { font-size: 11.5px; color: var(--kp-ink-2); line-height: 1.6; margin: 4px 0 8px; }
.kp-card .kp-blocks-json { width: 100%; height: 260px; font: 11.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--kp-ink); background: rgba(255, 255, 255, .6); border: 1px solid rgba(127, 110, 90, .25); border-radius: 10px; padding: 8px; resize: vertical; outline: none; user-select: text; -webkit-user-select: text; margin-bottom: 8px; }
.kp-night .kp-card .kp-blocks-json { background: rgba(255, 255, 255, .08); }
.kp-field.kp-field-color select { grid-column: 2 / 3; }
.kp-field .kp-color { width: 34px; height: 26px; padding: 0; border: 1px solid rgba(127, 110, 90, .3); border-radius: 7px; background: none; cursor: pointer; }
.kp-card .kp-field-src .kp-src { grid-column: 2 / 4; flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; }
.kp-card .kp-field-src .kp-src b { flex: 1; min-width: 0; font-weight: 600; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kp-root .kp-card .kp-field-src .kp-src button { flex: none; padding: 4px 9px; border-radius: 8px; background: rgba(127, 110, 90, .13); font-size: 12px; }
.kp-root .kp-card .kp-field-src .kp-src button:hover { background: rgba(127, 110, 90, .2); }
.kp-card { max-height: calc(100% - 110px); overflow: auto; }
.kp-card .kp-story { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(127, 110, 90, .18); display: flex; flex-direction: column; gap: 7px; }
.kp-card .kp-story-head { font-size: 11.5px; color: var(--kp-ink-2); letter-spacing: .04em; }
.kp-card .kp-story-text { margin: 0; font-size: 13px; line-height: 1.7; color: var(--kp-ink); user-select: text; -webkit-user-select: text; }
.kp-card .kp-story-empty { margin: 0; font-size: 12px; line-height: 1.6; color: var(--kp-ink-2); }
.kp-card .kp-story-img { width: 100%; height: 168px; object-fit: cover; border-radius: 12px; background: rgba(127, 110, 90, .1); }
.kp-card .kp-story-wait { display: grid; place-items: center; font-size: 12px; color: var(--kp-ink-2); }
.kp-card .kp-story-input { width: 100%; font: inherit; font-size: 13px; line-height: 1.6; color: var(--kp-ink); background: rgba(255, 255, 255, .6); border: 1px solid rgba(127, 110, 90, .25); border-radius: 10px; padding: 8px 10px; resize: vertical; outline: none; user-select: text; -webkit-user-select: text; }
.kp-night .kp-card .kp-story-input { background: rgba(255, 255, 255, .08); }
.kp-card .kp-story-input:focus { border-color: var(--kp-accent); }
.kp-card .kp-story-tools { display: flex; flex-wrap: wrap; gap: 6px; }
.kp-root .kp-card .kp-story-tools button { padding: 5px 10px; border-radius: 9px; background: rgba(127, 110, 90, .13); font-size: 12px; }
.kp-root .kp-card .kp-story-tools button:hover { background: rgba(127, 110, 90, .2); }
.kp-root .kp-card .kp-story-tools button.kp-primary { background: var(--kp-primary-bg); color: var(--kp-primary-fg); }
.kp-root .kp-card .kp-story-tools button.kp-danger { color: #b44a36; }
.kp-root .kp-card .kp-story-tools button[disabled] { opacity: .5; cursor: default; }
.kp-recall-story { display: flex; gap: 10px; align-items: flex-start; }
.kp-recall-story p { margin: 0; flex: 1; font-size: 13px; line-height: 1.7; user-select: text; -webkit-user-select: text; }
.kp-recall .kp-recall-img { width: 96px; height: 96px; flex: none; object-fit: cover; border-radius: 10px; background: rgba(127, 110, 90, .1); }
.kp-recall > .kp-recall-img { width: 100%; height: auto; max-height: 30vh; object-fit: contain; }
.kp-card .kp-shelf-src { font-size: 12px; color: var(--kp-ink-2); margin: -4px 0 9px; line-height: 1.6; }
.kp-card .kp-shelf-src em { font-style: normal; color: #b8392a; }
.kp-card .kp-slot.kp-docbook { border-color: rgba(63, 90, 107, .4); background: rgba(63, 90, 107, .07); }
.kp-card .kp-part { display: flex; align-items: center; gap: 8px; margin: -6px 0 10px; font-size: 12.5px; }
.kp-card .kp-part span { flex: 1; min-width: 0; color: var(--kp-accent); font-weight: 600; }
.kp-card .kp-part button { flex: none; padding: 4px 9px; border-radius: 8px; background: rgba(127, 110, 90, .13); font-size: 11.5px; color: var(--kp-ink); }
.kp-card .kp-part button:hover { background: rgba(127, 110, 90, .2); }
.kp-swatches.kp-swatches-10 { grid-template-columns: repeat(10, minmax(0, 28px)); gap: 5px; }
.kp-root:not(.kp-level-town) .kp-tag { display: none !important; }
.kp-root .kp-seg.kp-seg-full { display: flex; margin: 0; }
.kp-root .kp-seg.kp-seg-full button { flex: 1; text-align: center; padding: 5px 0; border-radius: 9px; font-size: 12px; color: var(--kp-ink-2); }
.kp-root .kp-seg.kp-seg-full button.kp-on { background: var(--kp-primary-bg); color: var(--kp-primary-fg); }
.kp-card .kp-row button.kp-grow { flex: 2; }
.kp-card .kp-row button svg { width: 16px; height: 16px; vertical-align: -3px; }

.kp-panel { position: absolute; border-radius: 18px; display: flex; flex-direction: column; overflow: hidden; z-index: 3; }
.kp-panel.kp-hidden { display: none; }
.kp-panel-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 10px 8px 16px; font-size: 14px; flex: none; }
.kp-root .kp-panel-head .kp-close { padding: 2px 8px; font-size: 17px; color: var(--kp-ink-2); }
.kp-build { left: 50%; bottom: 76px; transform: translateX(-50%); width: min(620px, calc(100% - 24px)); padding-bottom: 12px; }
.kp-build .kp-name-field { grid-template-columns: 40px 1fr; padding: 0 16px 10px; }
.kp-build .kp-name-field .kp-text { grid-column: 2; font-size: 13.5px; padding: 6px 10px; }
.kp-templates { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 0 12px; }
.kp-root .kp-tpl { display: flex; flex-direction: column; gap: 3px; padding: 8px 8px 10px; border-radius: 13px; background: rgba(255, 255, 255, .4); box-shadow: inset 0 0 0 1px rgba(127, 110, 90, .16); }
.kp-night .kp-tpl { background: rgba(255, 255, 255, .05); }
.kp-root .kp-tpl:hover { box-shadow: inset 0 0 0 1.5px var(--kp-accent); background: rgba(239, 130, 53, .08); }
.kp-tpl-art { height: 70px; display: grid; place-items: center; margin-bottom: 4px; }
.kp-tpl-art svg { width: 100%; height: 100%; }
.kp-tpl b { font-size: 13px; font-weight: 600; }
.kp-tpl small { font-size: 11px; color: var(--kp-ink-2); line-height: 1.4; }
.kp-build .kp-note { padding: 10px 16px 0; font-size: 11.5px; color: var(--kp-ink-2); }

.kp-list { left: 14px; top: 70px; bottom: 16px; width: 320px; }
.kp-list-body { flex: 1; overflow-y: auto; padding: 0 8px; }
.kp-list-row { display: flex; align-items: center; border-radius: 12px; }
.kp-list-row.kp-hot, .kp-list-row:hover { background: rgba(127, 110, 90, .1); }
.kp-list-row.kp-on { background: rgba(239, 130, 53, .12); }
.kp-root .kp-list-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 9px 6px 9px 10px; }
.kp-list-main i { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.kp-list-main span { display: flex; flex-direction: column; min-width: 0; }
.kp-list-main b { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kp-list-main small { font-size: 11.5px; color: var(--kp-ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kp-root .kp-list-go { flex: none; width: 34px; height: 34px; margin-right: 4px; border-radius: 10px; display: grid; place-items: center; font-size: 15px; color: var(--kp-ink-2); }
.kp-root .kp-list-go:hover { background: var(--kp-primary-bg); color: var(--kp-primary-fg); }
.kp-root .kp-list-add { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 8px 12px 12px; padding: 9px 0; border-radius: 12px; font-size: 13px; background: rgba(239, 130, 53, .14); color: #b85a1c; flex: none; }
.kp-list .kp-empty { padding: 14px 10px; font-size: 12.5px; color: var(--kp-ink-2); }

.kp-overlay { position: absolute; inset: 0; z-index: 8; display: flex; justify-content: center; align-items: flex-start; padding: 11vh 12px 12px; background: rgba(40, 30, 20, .14); }
.kp-overlay.kp-center { align-items: center; padding-top: 12px; }
.kp-overlay.kp-hidden { display: none; }
.kp-palette { width: min(580px, 100%); max-height: 70%; border-radius: 18px; display: flex; flex-direction: column; overflow: hidden; }
.kp-pal-input { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid rgba(127, 110, 90, .16); color: var(--kp-ink-2); }
.kp-pal-input input { flex: 1; min-width: 0; font: inherit; font-size: 15px; color: var(--kp-ink); background: transparent; border: none; outline: none; }
.kp-pal-list { flex: 1; overflow-y: auto; padding: 6px; }
.kp-root .kp-pal-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border-radius: 11px; }
.kp-root .kp-pal-row.kp-on, .kp-root .kp-pal-row:hover { background: rgba(239, 130, 53, .12); }
.kp-pal-row i { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.kp-pal-row em { font-style: normal; font-size: 12px; margin: 0 -4px 0 -2px; }
.kp-pal-row span { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.kp-pal-row b { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kp-pal-row small { font-size: 11.5px; color: var(--kp-ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kp-pal-list .kp-empty { padding: 16px; font-size: 12.5px; color: var(--kp-ink-2); text-align: center; }
.kp-pal-foot { display: flex; gap: 14px; padding: 8px 16px; border-top: 1px solid rgba(127, 110, 90, .14); font-size: 11.5px; color: var(--kp-ink-2); }
.kp-confirm { width: min(380px, 100%); padding: 18px 18px 14px; border-radius: 18px; }
.kp-confirm b { font-size: 15px; font-weight: 650; }
.kp-confirm p { margin: 8px 0 4px; font-size: 12.5px; color: var(--kp-ink-2); line-height: 1.65; }
.kp-confirm .kp-row { display: flex; gap: 8px; margin-top: 12px; }
.kp-root .kp-confirm .kp-row button { flex: 1; text-align: center; padding: 9px 0; border-radius: 11px; font-size: 13px; background: rgba(127, 110, 90, .14); }
.kp-root .kp-confirm .kp-row button.kp-danger-strong { background: #c2503a; color: #fff; }

@container kp (max-width: 760px) {
  .kp-root .kp-search span, .kp-root .kp-search kbd, .kp-root .kp-topright .kp-seg button span { display: none; }
  .kp-list { right: 10px; left: 10px; width: auto; top: 64px; bottom: 76px; }
  .kp-templates { grid-template-columns: repeat(2, 1fr); }
  .kp-build { bottom: 70px; }
  .kp-tpl-art { height: 52px; }
  .kp-card .kp-mini button:nth-child(n+3), .kp-card .kp-more-note { display: none; }
  .kp-card { max-height: 56%; }
}

/* ---------------- 群岛 ---------------- */
.kp-root.kp-far .kp-near-only, .kp-root:not(.kp-far) .kp-far-only { display: none !important; }
.kp-root.kp-far .kp-tag { display: none !important; }
.kp-root.kp-planet .kp-no-planet, .kp-root:not(.kp-planet) .kp-planet-only { display: none !important; }
.kp-root.kp-planet .kp-region-tag { box-shadow: 0 8px 26px rgba(10, 10, 40, .35), inset 0 0 0 1px rgba(255, 255, 255, .7); }
.kp-region-tag {
  position: relative; display: flex; align-items: center; gap: 9px; margin-bottom: 8px; padding: 7px 14px 7px 9px; border-radius: 16px;
  background: rgba(255, 252, 247, .93); color: #2f2a25; white-space: nowrap; pointer-events: auto; cursor: pointer;
  box-shadow: 0 8px 22px rgba(60, 40, 20, .18), inset 0 0 0 1px rgba(255, 255, 255, .7); transition: box-shadow .15s, transform .15s;
  font-family: var(--b3-font-family, -apple-system, "PingFang SC", system-ui, sans-serif);
}
.kp-region-tag::after { content: ''; position: absolute; left: 50%; bottom: -7px; margin-left: -7px; border: 7px solid transparent; border-bottom: 0; border-top-color: rgba(255, 252, 247, .93); }
.kp-region-tag em { font-style: normal; font-size: 20px; line-height: 1; }
.kp-region-tag span { display: flex; flex-direction: column; line-height: 1.3; }
.kp-region-tag b { font-size: 14px; font-weight: 650; letter-spacing: .03em; }
.kp-region-tag small { font-size: 11px; color: #7a6d60; }
.kp-region-tag.kp-hot, .kp-region-tag.kp-sel { box-shadow: 0 10px 26px rgba(60, 40, 20, .24), inset 0 0 0 1.5px #ef8235; transform: translateY(-2px); }
.kp-region-tag.kp-bad { box-shadow: 0 10px 26px rgba(60, 40, 20, .24), inset 0 0 0 2px #d9483b; }
.kp-night .kp-region-tag { background: rgba(34, 34, 44, .86); color: #efe7dc; }
.kp-night .kp-region-tag::after { border-top-color: rgba(34, 34, 44, .86); }
.kp-night .kp-region-tag small { color: #aa9f93; }
.kp-brand .kp-mark:not(:has(svg)) { font-size: 18px; background: rgba(127, 110, 90, .14); }
.kp-themes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.kp-root .kp-theme { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 2px 7px; border-radius: 11px; font-size: 11.5px; color: var(--kp-ink-2); }
.kp-root .kp-theme:hover { background: rgba(127, 110, 90, .1); }
.kp-root .kp-theme.kp-on { background: rgba(239, 130, 53, .12); color: var(--kp-ink); box-shadow: inset 0 0 0 1.5px var(--kp-accent); }
.kp-theme i { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; font-style: normal; font-size: 17px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .1); }
.kp-card .kp-note-sm { font-size: 11.5px; color: var(--kp-ink-2); margin-top: 10px; line-height: 1.6; }
.kp-card .kp-row button[disabled] { opacity: .35; pointer-events: none; }
.kp-card .kp-move-to { grid-template-columns: 36px 1fr auto; margin-top: 12px; }
.kp-root .kp-list-group { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 10px 4px; font-size: 12px; color: var(--kp-ink-2); }
.kp-list-group em { font-style: normal; font-size: 15px; }
.kp-list-group b { color: var(--kp-ink); font-weight: 650; font-size: 12.5px; }
.kp-list-group small { margin-left: auto; font-size: 11px; }
.kp-root .kp-list-group:hover b { color: var(--kp-accent); }
.kp-list .kp-empty.kp-empty-sm { padding: 4px 12px 8px; font-size: 11.5px; }

/* 层级：小镇 / 宫殿（放在最后，优先级最高） */
.kp-root.kp-level-town .kp-palace-only { display: none !important; }
.kp-root:not(.kp-level-town) .kp-town-only { display: none !important; }

/* ---------------- 记忆路线 / 回忆 ---------------- */
.kp-root { --kp-m-fresh: #4f9a78; --kp-m-learning: #e0a23a; --kp-m-due: #dc4632; --kp-m-stale: #9a948c; --kp-m-none: #ef8235; }
.kp-brand .kp-routes-btn { background: rgba(127, 110, 90, .13); color: var(--kp-ink); }
.kp-brand .kp-routes-btn.kp-has-due { background: rgba(220, 70, 50, .13); color: #b8392a; }
.kp-night .kp-brand .kp-routes-btn.kp-has-due { color: #ff9b86; }
.kp-routes { position: absolute; left: 14px; top: 70px; width: 312px; max-height: calc(100% - 170px); overflow: auto; padding: 12px; border-radius: 15px; display: flex; flex-direction: column; gap: 9px; z-index: 2; }
.kp-routes.kp-hidden { display: none; }
.kp-routes-head { display: flex; align-items: center; justify-content: space-between; font-size: 14px; }
.kp-routes .kp-close { padding: 0 6px; font-size: 17px; color: var(--kp-ink-2); }
.kp-route-pick { display: flex; gap: 6px; }
.kp-route-pick select, .kp-route-name { flex: 1; min-width: 0; font: inherit; font-size: 13px; color: var(--kp-ink); background: rgba(127, 110, 90, .1); border: 1px solid rgba(127, 110, 90, .2); border-radius: 9px; padding: 6px 8px; outline: none; }
.kp-route-name:focus { border-color: var(--kp-accent); }
.kp-route-pick button, .kp-route-tools button, .kp-route-missing button { padding: 6px 10px; border-radius: 9px; background: rgba(127, 110, 90, .13); font-size: 12px; white-space: nowrap; }
.kp-route-pick button.kp-danger { color: #b44a36; }
.kp-route-stats { font-size: 12px; color: var(--kp-ink-2); }
.kp-route-stats b.kp-m-due, .kp-due-text { color: var(--kp-m-due); font-weight: 600; }
.kp-route-go { display: flex; gap: 6px; }
.kp-route-go button { flex: 1; text-align: center; padding: 8px 6px; border-radius: 10px; background: rgba(127, 110, 90, .13); font-size: 12.5px; }
.kp-route-go button.kp-primary { background: var(--kp-primary-bg); color: var(--kp-primary-fg); font-weight: 600; }
.kp-root .kp-routes button[disabled] { opacity: .4; cursor: default; }
.kp-stops { display: flex; flex-direction: column; gap: 2px; margin: 0 -4px; }
.kp-stops .kp-empty { padding: 6px 6px 8px; font-size: 12.5px; color: var(--kp-ink-2); }
.kp-stop-row { display: flex; align-items: center; gap: 2px; border-radius: 10px; padding-right: 4px; }
.kp-stop-row:hover { background: rgba(127, 110, 90, .1); }
.kp-stop-row.kp-off { opacity: .5; }
.kp-root .kp-stop-go { flex: 1; min-width: 0; display: flex !important; align-items: center; gap: 9px; padding: 6px 4px 6px 6px; }
.kp-stop-go span { min-width: 0; display: flex; flex-direction: column; }
.kp-stop-go b { font-weight: 600; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kp-stop-go small { font-size: 11px; color: var(--kp-ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kp-dot { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: 11px; font-weight: 700; color: #fff; background: var(--kp-m-none); }
.kp-dot.kp-m-fresh { background: var(--kp-m-fresh); } .kp-dot.kp-m-learning { background: var(--kp-m-learning); } .kp-dot.kp-m-due { background: var(--kp-m-due); } .kp-dot.kp-m-stale { background: var(--kp-m-stale); }
.kp-root .kp-mini-btn { width: 22px; height: 22px; border-radius: 7px; display: grid !important; place-items: center; color: var(--kp-ink-2); font-size: 12px; flex: none; }
.kp-root .kp-mini-btn:hover { background: rgba(127, 110, 90, .16); color: var(--kp-ink); }
.kp-route-missing { font-size: 12px; color: var(--kp-ink-2); display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.kp-route-tools { display: flex; gap: 6px; }
.kp-route-tools button { flex: 1; text-align: center; }
.kp-route-tools button.kp-on { background: var(--kp-accent); color: #fff; }
.kp-root.kp-route-picking canvas { cursor: copy; }

.kp-stop-badge { min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; display: grid; place-items: center; font-size: 11.5px; font-weight: 700; color: #fff; background: var(--kp-m-none); box-shadow: 0 3px 10px rgba(60, 40, 20, .25), 0 0 0 2px rgba(255, 255, 255, .9); transform: translateY(-50%); }
.kp-stop-badge.kp-m-fresh { background: var(--kp-m-fresh); } .kp-stop-badge.kp-m-learning { background: var(--kp-m-learning); } .kp-stop-badge.kp-m-due { background: var(--kp-m-due); } .kp-stop-badge.kp-m-stale { background: var(--kp-m-stale); }
.kp-stop-badge.kp-todo { background: rgba(90, 80, 70, .55); }
.kp-stop-badge.kp-cur { position: relative; z-index: 2; background: var(--kp-accent); transform: translateY(-50%) scale(1.3); box-shadow: 0 0 0 3px #fff, 0 0 0 7px rgba(239, 130, 53, .35); }
.kp-stop-badge.kp-done.kp-r-again { background: #c9453a; } .kp-stop-badge.kp-done.kp-r-hard { background: #d08a2c; }
.kp-stop-badge.kp-done.kp-r-good { background: #4f9a78; } .kp-stop-badge.kp-done.kp-r-easy { background: #3f7fa8; }

.kp-root.kp-recalling .kp-bar, .kp-root.kp-recalling .kp-card, .kp-root.kp-recalling .kp-loci, .kp-root.kp-recalling .kp-routes,
.kp-root.kp-recalling .kp-brand .kp-loci-btn, .kp-root.kp-recalling .kp-tip { display: none !important; }
.kp-recall { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); width: min(460px, calc(100% - 24px)); padding: 12px 14px 14px; border-radius: 18px; z-index: 3; display: flex; flex-direction: column; gap: 9px; }
.kp-recall.kp-hidden { display: none; }
.kp-recall-top { display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: var(--kp-ink-2); letter-spacing: .04em; }
.kp-recall-top button { padding: 0 6px; font-size: 16px; color: var(--kp-ink-2); }
.kp-recall-bar { height: 4px; border-radius: 2px; background: rgba(127, 110, 90, .16); overflow: hidden; margin-top: -4px; }
.kp-recall-bar i { display: block; height: 100%; background: var(--kp-accent); border-radius: 2px; transition: width .3s; }
.kp-recall-where { display: flex; flex-direction: column; }
.kp-recall-where small { font-size: 11px; color: var(--kp-ink-2); }
.kp-recall-where b { font-size: 16px; font-weight: 650; }
.kp-recall-q { font-size: 13px; color: var(--kp-ink-2); }
.kp-recall-actions { display: flex; gap: 7px; }
.kp-recall-actions button, .kp-rate button { text-align: center; padding: 9px 12px; border-radius: 11px; background: rgba(127, 110, 90, .13); font-size: 13px; }
.kp-recall-actions button.kp-primary { background: var(--kp-primary-bg); color: var(--kp-primary-fg); font-weight: 600; }
.kp-recall-actions button.kp-grow, .kp-recall-actions button.kp-primary { flex: 1; }
.kp-recall-actions button[disabled] { opacity: .4; cursor: default; }
.kp-touch .kp-recall kbd { display: none; }
.kp-recall kbd { font: inherit; font-size: 10.5px; opacity: .6; margin-left: 6px; padding: 0 5px; border-radius: 5px; border: 1px solid currentColor; }
.kp-recall-answer { display: flex; flex-direction: column; gap: 6px; }
.kp-recall-title { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.kp-recall-title b { font-size: 15px; color: var(--kp-accent); font-weight: 650; word-break: break-all; }
.kp-recall-title button { flex: none; font-size: 12px; color: var(--kp-ink-2); text-decoration: underline; }
.kp-recall-note { max-height: min(38vh, 320px); overflow: auto; border-radius: 12px; background: rgba(255, 255, 255, .55); padding: 4px 2px; user-select: text; -webkit-user-select: text; font-size: 13.5px; }
.kp-night .kp-recall-note { background: rgba(0, 0, 0, .18); }
.kp-recall-note:empty { display: none; }
.kp-rate { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.kp-rate button { padding: 9px 4px; font-weight: 600; color: #fff; }
.kp-rate .kp-r-again { background: #c9453a; } .kp-rate .kp-r-hard { background: #d08a2c; } .kp-rate .kp-r-good { background: #4f9a78; } .kp-rate .kp-r-easy { background: #3f7fa8; }
.kp-rate button:hover { filter: brightness(1.08); }
.kp-recall-done { font-size: 15px; } .kp-recall-done b { font-size: 22px; margin-right: 2px; }
.kp-recall-sum { display: flex; flex-wrap: wrap; gap: 6px; font-size: 12px; }
.kp-recall-sum span { padding: 3px 9px; border-radius: 9px; background: rgba(127, 110, 90, .12); }
.kp-recall-sum .kp-r-again b { color: #c9453a; } .kp-recall-sum .kp-r-hard b { color: #d08a2c; } .kp-recall-sum .kp-r-good b { color: #4f9a78; } .kp-recall-sum .kp-r-easy b { color: #3f7fa8; }

.kp-brand .kp-numbers-btn { background: rgba(127, 110, 90, .13); color: var(--kp-ink); }
.kp-num-digits { flex: none; min-height: 64px; word-break: break-all; width: 100%; resize: vertical; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .06em; color: var(--kp-ink); background: rgba(127, 110, 90, .1); border: 1px solid rgba(127, 110, 90, .2); border-radius: 9px; padding: 6px 8px; outline: none; }
.kp-num-digits:focus { border-color: var(--kp-accent); }
.kp-root .kp-num-row { width: 100%; display: flex; align-items: center; gap: 8px; padding: 5px 6px; text-align: left; }
.kp-num-row span { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.kp-num-row b, .kp-num-card b { font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .05em; }
.kp-num-row small { font-size: 11.5px; color: var(--kp-ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kp-num-card { display: flex; flex-direction: column; gap: 2px; margin-top: 10px; padding: 9px 11px; border-radius: 12px; background: rgba(79, 154, 120, .12); }
.kp-num-card small { font-size: 11px; color: var(--kp-ink-2); }
.kp-num-card span { font-size: 13px; }
.kp-stop-badge.kp-num-badge { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .04em; white-space: nowrap; }
.kp-num-input { font: 600 22px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .18em; text-align: center; color: var(--kp-ink); background: rgba(127, 110, 90, .1); border: 1.5px solid rgba(127, 110, 90, .25); border-radius: 12px; padding: 9px 10px; outline: none; width: 100%; }
.kp-num-input:focus { border-color: var(--kp-accent); }
.kp-num-hint { font-size: 14px; padding: 8px 11px; border-radius: 10px; background: rgba(239, 130, 53, .12); }
.kp-num-result { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 12px; }
.kp-num-result.kp-ok { background: rgba(79, 154, 120, .14); } .kp-num-result.kp-bad { background: rgba(201, 69, 58, .1); }
.kp-num-result b { font-size: 13px; }
.kp-num-answer { font: 600 22px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .14em; }
.kp-num-answer i { font-style: normal; } .kp-num-answer i.kp-miss { color: #c9453a; text-decoration: underline; }
.kp-num-result small { font-size: 13px; color: var(--kp-ink-2); }
.kp-pao { width: min(560px, 100%); height: min(80%, 720px); border-radius: 18px; display: flex; flex-direction: column; overflow: hidden; }
.kp-pao-tools { display: flex; align-items: center; gap: 10px; padding: 0 14px 8px; font-size: 11.5px; color: var(--kp-ink-2); }
.kp-pao-tools input { flex: 1; }
.kp-pao-head, .kp-pao-row { display: grid; grid-template-columns: 36px 1fr 1fr 1fr; gap: 6px; align-items: center; padding: 0 14px; }
.kp-pao-head { font-size: 11px; color: var(--kp-ink-2); padding-bottom: 4px; }
.kp-pao-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-bottom: 8px; }
.kp-pao-row b { font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--kp-ink-2); }
.kp-pao-row input { min-width: 0; font: inherit; font-size: 13px; color: var(--kp-ink); background: rgba(127, 110, 90, .08); border: 1px solid transparent; border-radius: 8px; padding: 5px 7px; outline: none; }
.kp-pao-row input:focus { border-color: var(--kp-accent); background: rgba(255, 255, 255, .5); }
.kp-pao-import { padding: 8px 14px 12px; border-top: 1px solid rgba(127, 110, 90, .18); font-size: 12.5px; }
.kp-pao-import summary { cursor: pointer; color: var(--kp-ink-2); }
.kp-pao-import textarea { width: 100%; margin: 8px 0 6px; font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--kp-ink); background: rgba(127, 110, 90, .1); border: 1px solid rgba(127, 110, 90, .2); border-radius: 9px; padding: 6px 8px; outline: none; resize: vertical; }
.kp-pao-import button { padding: 6px 12px; border-radius: 9px; background: rgba(239, 130, 53, .14); color: #b85a1c; font-size: 12px; }
.kp-night .kp-pao-row input:focus { background: rgba(0, 0, 0, .2); }
.kp-shelfed { width: min(620px, 100%); max-height: 94%; border-radius: 18px; display: flex; flex-direction: column; overflow-y: auto; scrollbar-width: thin; }
.kp-shelfed-sub { padding: 0 16px 8px; font-size: 12px; color: var(--kp-ink-2); }
.kp-root .kp-shelfed-sub button { color: var(--kp-accent); font-size: 12px; }
.kp-shelf2d-wrap { flex: none; display: flex; justify-content: center; padding: 4px 16px 10px; }
.kp-shelf2d { position: relative; height: min(40vh, 400px); max-width: 100%; background: #efe4d2; border: 6px solid #a98b63; border-bottom-width: 10px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .08); }
.kp-night .kp-shelf2d { background: #3a3128; }
.kp-board { position: absolute; left: 0; right: 0; height: 4px; background: #a98b63; transform: translateY(50%); }
.kp-root .kp-b2d { position: absolute; border-radius: 1.5px; box-shadow: inset 0 0 0 .5px rgba(0, 0, 0, .25); transform-origin: 50% 50%; cursor: pointer; }
.kp-root .kp-b2d:hover { outline: 2px solid rgba(239, 130, 53, .7); z-index: 2; }
.kp-root .kp-b2d.kp-on { outline: 2.5px solid var(--kp-accent); outline-offset: 1px; z-index: 3; }
.kp-b2d.kp-bound::after { content: ''; position: absolute; left: 50%; top: 3px; width: 6px; height: 6px; margin-left: -3px; border-radius: 50%; background: #ef8235; box-shadow: 0 0 0 1.5px #fff; }
.kp-b2d.kp-pulled { box-shadow: inset 0 0 0 .5px rgba(0, 0, 0, .25), 0 2px 4px rgba(0, 0, 0, .35); }
.kp-root .kp-b2d.kp-hole { border: 1.5px dashed rgba(90, 70, 50, .45); background: transparent; box-shadow: none; }
.kp-shelfed-book { flex: none; padding: 10px 16px 14px; border-top: 1px solid rgba(127, 110, 90, .18); display: flex; flex-direction: column; gap: 8px; }
.kp-shelfed-book .kp-empty { font-size: 12.5px; color: var(--kp-ink-2); line-height: 1.6; }
.kp-shelfed-title { display: flex; flex-direction: column; gap: 2px; }
.kp-shelfed-title b { font-size: 14px; }
.kp-shelfed-title small { font-size: 12px; color: var(--kp-ink-2); }
.kp-shelfed-row { display: grid; grid-template-columns: 40px 1fr; align-items: center; gap: 8px; font-size: 12px; color: var(--kp-ink-2); }
.kp-swatches { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.kp-root .kp-sw { width: 20px; height: 20px; border-radius: 6px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .15); }
.kp-root .kp-sw.kp-on { outline: 2px solid var(--kp-accent); outline-offset: 1.5px; }
.kp-swatches input[type="color"] { width: 26px; height: 22px; padding: 0; border: none; background: none; cursor: pointer; }
.kp-shelfed-btns { display: flex; flex-wrap: wrap; gap: 6px; }
.kp-root .kp-shelfed-btns button { padding: 6px 10px; border-radius: 9px; background: rgba(127, 110, 90, .13); font-size: 12px; color: var(--kp-ink); }
.kp-root .kp-shelfed-btns button.kp-on { background: var(--kp-accent); color: #fff; }
.kp-root .kp-shelfed-btns button:disabled { opacity: .45; cursor: default; }
/* ---------- 串门 ---------- */
.kp-root .kp-friends-btn { position: relative; display: flex; align-items: center; gap: 6px; height: 38px; padding: 0 12px; border-radius: 14px; font-size: 12.5px; color: var(--kp-ink); }
.kp-root .kp-friends-btn svg { width: 16px; height: 16px; }
.kp-root .kp-friends-btn.kp-hidden { display: none; }
.kp-badge { position: absolute; top: -4px; right: -4px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: var(--kp-m-due); color: #fff; font-size: 10.5px; font-style: normal; font-weight: 700; display: grid; place-items: center; box-shadow: 0 0 0 2px #fff; }
.kp-badge.kp-hidden { display: none; }
.kp-social { right: 14px; left: auto; }
.kp-soc-me { display: flex; flex-direction: column; gap: 6px; }
.kp-soc-code { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--kp-ink-2); }
.kp-soc-code b { font: 700 15px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--kp-ink); letter-spacing: .06em; margin-right: auto; }
.kp-root .kp-soc-code button, .kp-root .kp-soc-ghost, .kp-root .kp-soc-link { padding: 4px 8px; border-radius: 8px; background: rgba(127, 110, 90, .12); font-size: 11.5px; color: var(--kp-ink); }
.kp-root .kp-soc-link { background: none; color: var(--kp-accent); padding: 0 4px; }
.kp-soc-ann { font-size: 12.5px; padding: 8px 10px; border-radius: 10px; background: rgba(239, 130, 53, .12); }
.kp-soc-inbox { display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; }
.kp-soc-note { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--kp-ink-2); }
.kp-soc-note.kp-unread { color: var(--kp-ink); font-weight: 600; }
.kp-soc-note small { flex: none; font-size: 10.5px; font-weight: 400; color: var(--kp-ink-2); }
.kp-soc-pair { display: flex; flex-direction: column; gap: 2px; font-size: 12px; padding: 8px 10px; border-radius: 10px; background: rgba(79, 154, 120, .12); }
.kp-soc-pair b { font: 700 20px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .14em; }
.kp-soc-pair small { color: var(--kp-ink-2); }
.kp-soc-redeem { display: flex; flex-direction: column; gap: 6px; }
.kp-soc-opt { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; color: var(--kp-ink-2); cursor: pointer; }
.kp-soc-down { color: #b44a36; }
.kp-root .kp-soc-share { display: block; width: 100%; margin-top: 8px; padding: 7px 10px; border-radius: 10px; font-size: 12.5px; text-align: center; background: rgba(127, 110, 90, .1); color: var(--kp-ink-2); }
.kp-root .kp-soc-share.kp-on { background: rgba(79, 154, 120, .16); color: #2f6b52; }
.kp-guestbook { right: 14px; left: auto; }
.kp-soc-guest { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; }
.kp-soc-gb { padding: 8px 10px; border-radius: 10px; background: rgba(127, 110, 90, .08); }
.kp-soc-gb.kp-off { opacity: .5; }
.kp-soc-gb > div { display: flex; align-items: baseline; gap: 6px; font-size: 12px; }
.kp-soc-gb small { color: var(--kp-ink-2); font-size: 10.5px; margin-right: auto; }
.kp-soc-gb p { margin: 4px 0 0; font-size: 13px; white-space: pre-wrap; word-break: break-word; }
.kp-visit-bar { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 6px 6px 6px 14px; border-radius: 14px; font-size: 13px; z-index: 4; white-space: nowrap; }
.kp-visit-bar.kp-hidden { display: none; }
.kp-root .kp-visit-bar button { padding: 7px 12px; border-radius: 10px; font-size: 12.5px; background: var(--kp-primary-bg); color: var(--kp-primary-fg); }
.kp-brand .kp-guest-btn { background: rgba(127, 110, 90, .13); color: var(--kp-ink); }
.kp-brand .kp-guest-btn.kp-hidden { display: none; }
.kp-ro-name { margin: 2px 0 4px; font-size: 18px; }
/* 只读（网页查看器、参观好友）：搭建、绑定、编辑类的入口都藏起来 */
.kp-root.kp-readonly [data-act="buildPalace"], .kp-root.kp-readonly [data-act="townEdit"], .kp-root.kp-readonly [data-act="newIsland"],
.kp-root.kp-readonly [data-act="edit"], .kp-root.kp-readonly [data-act="numbers"], .kp-root.kp-readonly [data-act="viewJourneys"],
.kp-root.kp-readonly [data-act="regionSettings"], .kp-root.kp-readonly [data-act="routePick"], .kp-root.kp-readonly [data-act="routeAuto"],
.kp-root.kp-readonly [data-act="routeDelete"], .kp-root.kp-readonly .kp-route-journeys, .kp-root.kp-readonly .kp-story-tools,
.kp-root.kp-readonly .kp-stop-row .kp-mini-btn, .kp-root.kp-readonly [data-act="shelfEdit"], .kp-root.kp-readonly [data-field="route"] option[value="__new"] { display: none !important; }
.kp-root.kp-visiting .kp-topright { top: 58px; }
.kp-tag .kp-jorder { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--kp-accent); color: #fff; font-size: 10.5px; font-weight: 700; display: grid; place-items: center; line-height: 1; }
.kp-tag.kp-in-journey { box-shadow: 0 0 0 2px var(--kp-accent); }
.kp-route-journeys { display: flex; flex-direction: column; gap: 7px; border-top: 1px solid rgba(127, 110, 90, .18); padding-top: 10px; }
.kp-route-sub { font-size: 11.5px; color: var(--kp-ink-2); letter-spacing: .04em; }
.kp-journey-row { display: flex; align-items: center; gap: 8px; }
.kp-journey-row span { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.kp-journey-row b { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kp-journey-row small { font-size: 11px; color: var(--kp-ink-2); }
.kp-journey-row button, .kp-jp-add button { padding: 6px 10px; border-radius: 9px; background: rgba(239, 130, 53, .14); color: #b85a1c; font-size: 12px; white-space: nowrap; }
.kp-jp-add { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid rgba(127, 110, 90, .18); padding-top: 10px; }
.kp-journeys .kp-empty { font-size: 12.5px; color: var(--kp-ink-2); line-height: 1.6; }
.kp-recall-next { display: flex; flex-direction: column; gap: 1px; }
.kp-recall-next small { font-size: 11px; color: var(--kp-ink-2); }
.kp-recall-next b { font-size: 16px; font-weight: 650; }
.kp-recall-next span { font-size: 12px; color: var(--kp-ink-2); }
.kp-recall-done small { margin-left: 8px; font-size: 12px; color: var(--kp-ink-2); }
.kp-tag .kp-due { min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--kp-m-due); color: #fff; font-size: 10.5px; font-weight: 700; display: grid; place-items: center; line-height: 1; }
.kp-card .kp-recall-row button { display: flex; align-items: center; justify-content: center; gap: 6px; }

@container kp (max-width: 760px) {
  .kp-routes { left: 10px; right: 10px; width: auto; top: 64px; max-height: calc(100% - 150px); }
  .kp-recall { bottom: 10px; width: calc(100% - 20px); }
  .kp-brand .kp-routes-btn span { display: none; }
  .kp-brand .kp-numbers-btn span { display: none; }
  .kp-brand .kp-routes-btn.kp-has-due span { display: inline; }
}

/* 小管家 */
.kp-pet-bubble { max-width: 220px; padding: 7px 10px; border-radius: 12px 12px 12px 4px; background: rgba(255, 252, 247, .96); color: #3b3027; font-size: 12px; line-height: 1.45; box-shadow: 0 4px 16px rgba(60, 40, 20, .18); transform: translate(-6px, -100%); white-space: normal; transition: opacity .25s; }
.kp-pet-bubble.kp-hidden { opacity: 0; }
.kp-pet-bubble b { color: var(--kp-accent); }
.kp-pet-panel { right: 14px; left: auto; width: 296px; }
.kp-pet-hero { display: flex; align-items: center; gap: 10px; }
.kp-pet-hero img { width: 72px; height: 72px; border-radius: 16px; background: rgba(127, 110, 90, .1); flex: none; }
.kp-pet-hero > div { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
.kp-pet-hero small { font-size: 11.5px; color: var(--kp-ink-2); }
.kp-pet-species { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
.kp-root .kp-pet-species button { display: flex; flex-direction: column; align-items: center; padding: 3px 0 5px; border-radius: 10px; font-size: 11px; color: var(--kp-ink-2); }
.kp-pet-species img { width: 44px; height: 44px; }
.kp-root .kp-pet-species button.kp-on { background: rgba(239, 130, 53, .16); color: var(--kp-ink); font-weight: 600; }
.kp-pet-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
.kp-root .kp-pet-sw { width: 24px; height: 24px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .15); }
.kp-root .kp-pet-sw.kp-on { box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--kp-accent); }
.kp-pet-acc { display: flex; flex-wrap: wrap; gap: 5px; }
.kp-root .kp-pet-acc button { padding: 4px 9px; border-radius: 9px; background: rgba(127, 110, 90, .12); font-size: 12px; }
.kp-root .kp-pet-acc button.kp-on { background: var(--kp-accent); color: #fff; }
/* 实时房间 */
.kp-live { position: absolute; right: 14px; bottom: 14px; width: 280px; padding: 10px 12px; border-radius: 15px; display: flex; flex-direction: column; gap: 8px; z-index: 2; font-size: 12.5px; }
.kp-live.kp-hidden { display: none; }
.kp-live-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.kp-live-dot { width: 8px; height: 8px; border-radius: 50%; background: #4f9a78; box-shadow: 0 0 0 3px rgba(79, 154, 120, .2); flex: none; }
.kp-live-dot.kp-off { background: #a59a8e; box-shadow: none; }
.kp-live-chip { padding: 2px 7px; border-radius: 8px; background: rgba(127, 110, 90, .12); font-size: 11.5px; }
.kp-live-chip.kp-owner { background: rgba(239, 130, 53, .18); }
.kp-live-log { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--kp-ink-2); }
.kp-live-log > div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kp-live-log b { color: var(--kp-ink); font-weight: 600; }
.kp-live-emotes { display: flex; gap: 4px; }
.kp-root .kp-live-emotes button { flex: 1; font-size: 17px; padding: 4px 0; border-radius: 9px; background: rgba(127, 110, 90, .1); }
.kp-root .kp-live-emotes button:hover { background: rgba(127, 110, 90, .2); }
.kp-live-chat input { width: 100%; box-sizing: border-box; font: inherit; font-size: 12.5px; color: var(--kp-ink); background: rgba(127, 110, 90, .1); border: 1px solid rgba(127, 110, 90, .2); border-radius: 9px; padding: 6px 8px; outline: none; }
.kp-live-chat input:focus { border-color: var(--kp-accent); }
.kp-live .kp-soc-opt { margin: 0; }
.kp-peer-name { padding: 1px 7px; border-radius: 8px; background: rgba(255, 255, 255, .88); font-size: 11px; color: #3b3027; white-space: nowrap; box-shadow: 0 2px 6px rgba(60, 40, 20, .15); transform: translateY(8px); }
.kp-peer-name.kp-owner { background: var(--kp-accent); color: #fff; }
.kp-emote { font-size: 26px; line-height: 1; }
.kp-pet-trip { font-size: 12.5px; padding: 8px 10px; border-radius: 10px; background: rgba(79, 134, 198, .12); }
.kp-pet-souvenir { padding: 7px 10px; border-radius: 10px; background: rgba(239, 130, 53, .09); display: flex; flex-direction: column; gap: 2px; }
.kp-pet-souvenir b { font-size: 12.5px; }
.kp-pet-souvenir small { font-size: 11px; color: var(--kp-ink-2); }
.kp-pet-souvenir p { margin: 2px 0 0; font-size: 12px; line-height: 1.5; }
/* 设置、新手引导、小提示 */
.kp-root .kp-gear-btn { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; color: var(--kp-ink-2); }
.kp-root .kp-gear-btn:hover { color: var(--kp-ink); }
.kp-settings { position: absolute; right: 14px; top: 60px; width: 300px; max-height: calc(100% - 90px); overflow-y: auto; padding: 12px; border-radius: 15px; display: flex; flex-direction: column; gap: 9px; z-index: 5; }
.kp-settings.kp-hidden { display: none; }
.kp-settings .kp-close { padding: 0 6px; font-size: 17px; color: var(--kp-ink-2); }
.kp-root.kp-visiting .kp-settings { top: 106px; }
.kp-route-sub small { font-weight: 400; color: var(--kp-ink-2); margin-left: 4px; }
.kp-set-seg { display: flex; gap: 4px; padding: 3px; border-radius: 12px; background: rgba(127, 110, 90, .1); }
.kp-root .kp-set-seg button { flex: 1; padding: 6px 0; border-radius: 9px; font-size: 12.5px; color: var(--kp-ink-2); text-align: center; justify-content: center; }
.kp-root .kp-set-seg button.kp-on { background: var(--kp-primary-bg); color: var(--kp-primary-fg); }
.kp-set-keys { font-size: 11.5px; color: var(--kp-ink-2); line-height: 1.6; }
.kp-set-keys b { color: var(--kp-ink); margin-right: 4px; }
.kp-guide { position: relative; width: min(420px, calc(100% - 32px)); box-sizing: border-box; padding: 26px 24px 20px; border-radius: 22px; text-align: center; display: flex; flex-direction: column; gap: 10px; }
.kp-guide-icon { font-size: 54px; line-height: 1; margin-top: 6px; }
.kp-guide h2 { margin: 4px 0 0; font-size: 19px; color: var(--kp-ink); }
.kp-guide p { margin: 0; font-size: 13.5px; line-height: 1.7; color: var(--kp-ink-2); min-height: 92px; }
.kp-guide p b { color: var(--kp-ink); }
.kp-guide-dots { display: flex; justify-content: center; gap: 6px; margin: 4px 0; }
.kp-guide-dots i { width: 7px; height: 7px; border-radius: 4px; background: rgba(127, 110, 90, .25); cursor: pointer; transition: width .2s; }
.kp-guide-dots i.kp-on { width: 18px; background: var(--kp-accent); }
.kp-root .kp-guide .kp-guide-skip { position: absolute; right: 12px; top: 10px; font-size: 12.5px; padding: 2px 6px; color: var(--kp-ink-2); }
.kp-coach { position: absolute; left: 50%; bottom: 86px; transform: translateX(-50%); width: max-content; max-width: min(440px, calc(100% - 32px)); padding: 9px 10px 9px 14px; border-radius: 14px; display: flex; align-items: center; gap: 10px; font-size: 12.5px; line-height: 1.55; z-index: 4; box-shadow: 0 8px 26px rgba(60, 40, 20, .18); }
.kp-coach.kp-anchored { left: auto; transform: none; bottom: auto; max-width: 300px; }
.kp-coach.kp-hidden { display: none; }
.kp-root .kp-coach button { flex: none; padding: 5px 10px; border-radius: 9px; background: var(--kp-primary-bg); color: var(--kp-primary-fg); font-size: 12px; }
`;

export function ensureStyles(doc: Document = document) {
  let s = doc.getElementById('kp-style') as HTMLStyleElement | null;
  if (!s) {
    s = doc.createElement('style');
    s.id = 'kp-style';
    doc.head.appendChild(s);
  }
  if (s.textContent !== CSS) s.textContent = CSS;
}
