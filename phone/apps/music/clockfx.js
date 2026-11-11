// 时计：左边半露着一个表盘（外圈刻度跟着歌的进度转一圈，里面的齿轮跟着时间慢慢倒着转），
// 歌词一行行像表针一样从表盘中心放射出去，换句时整圈歌词跟着转过来，正在唱的那句横着、亮起来。表盘颜色用 --clk，歌词颜色用 --ly。
// 表盘是线画的（要能换颜色，图片换不了色）。
import { h } from '../../core/util.js';

const STEP = 13;   // 相邻两句歌词差几度
const NS = 'http://www.w3.org/2000/svg';
const svg = html => { const d = document.createElementNS(NS, 'svg'); d.setAttribute('viewBox', '-100 -100 200 200'); d.innerHTML = html; return d; };
const ticks = (n, r0, r1, w) => Array.from({ length: n }, (_, k) => { const a = k * 2 * Math.PI / n, c = Math.cos(a), s = Math.sin(a); return `<line x1="${(c * r0).toFixed(2)}" y1="${(s * r0).toFixed(2)}" x2="${(c * r1).toFixed(2)}" y2="${(s * r1).toFixed(2)}" stroke-width="${w}"/>`; }).join('');
const dots = (n, r, size) => Array.from({ length: n }, (_, k) => { const a = k * 2 * Math.PI / n; return `<circle cx="${(Math.cos(a) * r).toFixed(2)}" cy="${(Math.sin(a) * r).toFixed(2)}" r="${size}"/>`; }).join('');
const star = (n, r) => { const p = Array.from({ length: n }, (_, k) => { const a = k * 2 * Math.PI / n - Math.PI / 2; return [Math.cos(a) * r, Math.sin(a) * r]; });
  return p.map((_, k) => p[(k * 2) % n]).map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '); };

export function clockFx(el) {
  // 外圈：刻度 + 罗马数字那一圈换成小圆点；中圈：虚线环 + 七角星；里面：齿轮（粗虚线描边当齿）
  const outer = svg(`<g fill="none" stroke="currentColor">
      <circle r="97" stroke-width=".5"/><circle r="93" stroke-width=".3" opacity=".6"/>
      <g opacity=".75">${ticks(120, 89, 93, .35)}</g>${ticks(12, 84, 93, .9)}
      <circle r="80" stroke-width=".4" stroke-dasharray="1 2.2"/>
    </g><g fill="currentColor" opacity=".8">${dots(12, 75, 1.4)}</g>
    <g fill="none" stroke="currentColor" stroke-width=".45" opacity=".85"><circle r="64"/><polygon points="${star(7, 64)}"/><circle r="40" opacity=".6"/></g>`);
  const gear = svg(`<g fill="none" stroke="currentColor"><circle r="26" stroke-width="7" stroke-dasharray="3.4 3.4" opacity=".55"/><circle r="21" stroke-width=".6"/><circle r="9" stroke-width=".6"/>
    ${ticks(6, 9, 21, .5)}</g><circle r="2.2" fill="currentColor"/>`);
  const hand = svg(`<g stroke="currentColor" stroke-linecap="round"><line x1="0" y1="0" x2="0" y2="-86" stroke-width=".8"/><line x1="0" y1="0" x2="0" y2="14" stroke-width="1.6"/></g><circle cy="-86" r="1.8" fill="currentColor"/>`);
  const dial = h('div.as-ck__dial', h('i.as-ck__glow'), outer, gear, hand), wheel = h('div.as-ck__wheel');
  el.className = 'as-mp__fx is-clock';
  el.replaceChildren(dial, wheel);
  let rows = [], lastL = null, cur = -1;
  return {
    kind: 'clock',
    line(L, i) {
      if (L !== lastL) {   // 换歌（歌词到了）才重排一圈
        lastL = L;
        rows = L.map((x, k) => h('p.as-ck__l', { style: { '--a': k * STEP + 'deg' } }, h('span', x.text), x.tr ? h('small', x.tr) : null));
        wheel.replaceChildren(...rows); cur = -1;
      }
      rows[cur]?.classList.remove('is-cur');
      cur = i; rows[i]?.classList.add('is-cur');
      wheel.style.setProperty('--at', -Math.max(i, 0) * STEP + 'deg');
      rows.forEach((r, k) => r.classList.toggle('is-far', Math.abs(k - Math.max(i, 0)) > 4));
    },
    prog(p) { rows[cur]?.style.setProperty('--p', p * 100 + '%'); },
    time(t, d) {
      outer.style.transform = `rotate(${d ? t / d * 360 : 0}deg)`;
      gear.style.transform = `rotate(${-t * 12}deg)`;
      hand.style.transform = `rotate(${t * 6}deg)`;   // 秒针：一秒走一格
    },
  };
}
