// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { html, rich } from '../src/dom';

const out = (f: DocumentFragment) => { const d = document.createElement('div'); d.append(f); return d.innerHTML; };

describe('html``', () => {
  it('插值永远是文字', () => {
    const evil = '<img src=x onerror="alert(1)">';
    const d = document.createElement('div');
    d.append(html`<b class="x">${evil}</b><i>${1 + 1}</i>`);
    expect(d.querySelector('img')).toBeNull();
    expect(d.querySelector('b').textContent).toBe(evil);
    expect(d.querySelector('i').textContent).toBe('2');
  });

  it('属性值：原样写入，不需要再转义', () => {
    const f = html`<button data-id="${'a&b"c'}" title="${'说明'} · ${'更多'}">x</button>`;
    const b = f.querySelector('button');
    expect(b.dataset.id).toBe('a&b"c');
    expect(b.title).toBe('说明 · 更多');
  });

  it('属性值没加引号也行', () => {
    const f = html`<input value=${'1 2'}>`;
    expect(f.querySelector('input').getAttribute('value')).toBe('1 2');
  });

  it('布尔属性 / 一组属性', () => {
    const f = html`<input type="checkbox" ${true ? 'checked' : ''}><option ${'selected'} value="a">a</option><button ${''}>b</button>`;
    expect(f.querySelector('input').hasAttribute('checked')).toBe(true);
    expect(f.querySelector('button').attributes.length).toBe(0);
  });

  it('动态的事件属性、javascript: 链接会被拦下', () => {
    expect(() => html`<b ${'onclick="x()"'}>x</b>`).toThrow();
    expect(() => html`<b onclick="${'x()'}">x</b>`).toThrow();
    expect(html`<a href="${'javascript:alert(1)'}">x</a>`.querySelector('a').getAttribute('href')).toBe('');
    expect(html`<img src="${'data:image/png;base64,AA'}">`.querySelector('img').getAttribute('src')).toBe('data:image/png;base64,AA');
  });

  it('嵌套片段、数组、空值', () => {
    const items = ['a', 'b'];
    const f = html`<ul>${items.map(x => html`<li>${x}</li>`)}</ul>${null}${false}${undefined}${html`<p>${'p'}</p>`}`;
    expect(out(f)).toBe('<ul><li>a</li><li>b</li></ul><p>p</p>');
  });

  it('textarea 里放文字', () => {
    const f = html`<textarea>${'<b>x</b>'}</textarea>`;
    expect(f.querySelector('textarea').value).toBe('<b>x</b>');
  });

  it('select 里放 option 片段', () => {
    const f = html`<select>${['1', '2'].map(v => html`<option value="${v}" ${v === '2' ? 'selected' : ''}>${v}</option>`)}</select>`;
    const s = f.querySelector('select');
    expect(s.options.length).toBe(2);
    expect(s.options[1].selected).toBe(true);
  });

  it('同一个模板多次调用互不影响（缓存）', () => {
    const mk = (x: string) => html`<b>${x}</b>`;
    expect(out(mk('1'))).toBe('<b>1</b>');
    expect(out(mk('2'))).toBe('<b>2</b>');
  });
});

describe('rich()', () => {
  it('保留白名单标签，丢掉其余标签和所有不在白名单的属性', () => {
    const f = html`<p>${rich('按 <b>R</b> 旋转<br><kbd>W</kbd><img src=x onerror=alert(1)><script>alert(1)</script><a href="javascript:x">链接</a><b onclick="x()">粗</b>')}</p>`;
    expect(out(f)).toBe('<p>按 <b>R</b> 旋转<br><kbd>W</kbd>链接<b>粗</b></p>');
  });

  it('SVG 图标', () => {
    const f = html`<button>${rich('<svg class="kp-i" viewBox="0 0 24 24" onload="x()"><path d="M1 1"/></svg>')}</button>`;
    const svg = f.querySelector('svg');
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.hasAttribute('onload')).toBe(false);
    expect(svg.querySelector('path').getAttribute('d')).toBe('M1 1');
  });

  it('只有 <path> 的图标、单独写的 SVG 片段放进 <svg> 也是 SVG 元素', () => {
    const f = html`<svg viewBox="0 0 24 24">${rich('<path d="M1 1"/>')}${html`<rect x="${1}" width="2" height="2"/>`}${[1, 2].map(i => html`<circle r="${i}"/>`)}</svg>`;
    const svg = f.querySelector('svg');
    expect([...svg.children].map(c => c.namespaceURI)).toEqual(Array(4).fill('http://www.w3.org/2000/svg'));
    expect(svg.querySelector('rect').getAttribute('x')).toBe('1');
  });

  it('没包 <svg> 的多元素图标：<circle/> 和 <path> 是兄弟', () => {
    const f = html`<svg>${rich('<circle cx="12" cy="12" r="4"/><path d="M1 1"/>')}</svg>`;
    const svg = f.querySelector('svg');
    expect([...svg.children].map(c => c.localName)).toEqual(['circle', 'path']);
    expect(svg.children[1].namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  it('放在属性里时只取文字', () => {
    expect(html`<b title="${rich('<b>R</b> 旋转')}"></b>`.querySelector('b').title).toBe('R 旋转');
  });
});
