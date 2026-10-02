// dev-only：模拟宿主的搜索选择框（思源的块选择器 / Obsidian 的笔记搜索），代替 window.prompt，录演示时也看得见
import { L } from './samples';

export interface PickItem { id: string; title: string; sub?: string }

const CSS = `
.pg-pick-mask { position: fixed; inset: 0; z-index: 50; display: grid; place-items: start center; padding-top: 14vh; background: rgba(40, 30, 20, .18); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif; }
.pg-pick { width: min(520px, calc(100% - 32px)); border-radius: 14px; background: #fffdf9; box-shadow: 0 18px 50px rgba(50, 35, 20, .28); overflow: hidden; color: #2f2925; }
.pg-pick h3 { margin: 0; padding: 14px 16px 6px; font-size: 13px; font-weight: 600; color: #7a6d60; }
.pg-pick input { box-sizing: border-box; width: calc(100% - 24px); margin: 4px 12px 8px; padding: 9px 12px; border: 1px solid #e3d9cc; border-radius: 10px; font: inherit; outline: none; background: #fff; }
.pg-pick input:focus { border-color: #ef8235; box-shadow: 0 0 0 3px rgba(239, 130, 53, .15); }
.pg-pick ul { list-style: none; margin: 0; padding: 0 6px 8px; max-height: 300px; overflow: auto; }
.pg-pick li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 10px; border-radius: 9px; cursor: pointer; }
.pg-pick li small { color: #9a8d80; white-space: nowrap; }
.pg-pick li.on, .pg-pick li:hover { background: rgba(239, 130, 53, .12); }
.pg-pick .pg-empty { padding: 10px 14px 14px; color: #9a8d80; }
`;

/** 弹出搜索选择框；回车或点击选中，Esc / 点遮罩取消（返回 null） */
export function pickFromList(o: { title: string; placeholder: string; items: PickItem[] }): Promise<string | null> {
  if (!document.getElementById('pg-pick-css')) {
    const st = document.createElement('style');
    st.id = 'pg-pick-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  return new Promise(resolve => {
    const mask = document.createElement('div');
    mask.className = 'pg-pick-mask';
    mask.innerHTML = `<div class="pg-pick"><h3></h3><input type="text" spellcheck="false"><ul></ul></div>`;
    mask.querySelector('h3').textContent = o.title;
    const input = mask.querySelector('input');
    input.placeholder = o.placeholder;
    const ul = mask.querySelector('ul');
    let shown: PickItem[] = [], on = 0;
    const render = () => {
      const q = input.value.trim().toLowerCase();
      shown = o.items.filter(x => !q || x.title.toLowerCase().includes(q) || (x.sub || '').toLowerCase().includes(q));
      on = Math.min(on, Math.max(0, shown.length - 1));
      ul.innerHTML = shown.length ? '' : `<div class="pg-empty">${L('没有找到', 'No matches')}</div>`;
      shown.forEach((x, i) => {
        const li = document.createElement('li');
        li.className = i === on ? 'on' : '';
        li.dataset.id = x.id;
        li.innerHTML = '<span></span><small></small>';
        li.querySelector('span').textContent = x.title;
        li.querySelector('small').textContent = x.sub || '';
        li.addEventListener('mousedown', e => { e.preventDefault(); done(x.id); });
        ul.appendChild(li);
      });
    };
    const done = (id: string | null) => { mask.remove(); resolve(id); };
    input.addEventListener('input', () => { on = 0; render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { on = Math.min(shown.length - 1, on + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { on = Math.max(0, on - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (shown[on]) done(shown[on].id); e.preventDefault(); }
      else if (e.key === 'Escape') { done(null); e.preventDefault(); }
      e.stopPropagation();
    });
    mask.addEventListener('mousedown', e => { if (e.target === mask) done(null); });
    render();
    document.body.appendChild(mask);
    setTimeout(() => input.focus(), 0);
  });
}
