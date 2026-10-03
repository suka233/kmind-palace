// dev-only：模拟宿主的搜索选择框（思源的块选择器 / Obsidian 的笔记搜索），代替 window.prompt，录演示时也看得见
import { html } from '../src/dom';
import { L } from './samples';

export interface PickItem { id: string; title: string; sub?: string }

// 样式写在 index.html 里（.pg-pick-*）

/** 弹出搜索选择框；回车或点击选中，Esc / 点遮罩取消（返回 null） */
export function pickFromList(o: { title: string; placeholder: string; items: PickItem[] }): Promise<string | null> {
  return new Promise(resolve => {
    const mask = document.createElement('div');
    mask.className = 'pg-pick-mask';
    mask.replaceChildren(html`<div class="pg-pick"><h3>${o.title}</h3><input type="text" spellcheck="false" placeholder="${o.placeholder}"><ul></ul></div>`);
    const input = mask.querySelector('input');
    const ul = mask.querySelector('ul');
    let shown: PickItem[] = [], on = 0;
    const render = () => {
      const q = input.value.trim().toLowerCase();
      shown = o.items.filter(x => !q || x.title.toLowerCase().includes(q) || (x.sub || '').toLowerCase().includes(q));
      on = Math.min(on, Math.max(0, shown.length - 1));
      if (shown.length) ul.replaceChildren(); else ul.replaceChildren(html`<div class="pg-empty">${L('没有找到', 'No matches')}</div>`);
      shown.forEach((x, i) => {
        const li = document.createElement('li');
        li.className = i === on ? 'on' : '';
        li.dataset.id = x.id;
        li.replaceChildren(html`<span>${x.title}</span><small>${x.sub || ''}</small>`);
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
    window.setTimeout(() => input.focus(), 0);
  });
}
