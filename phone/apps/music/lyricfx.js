// 播放页的两种动态歌词，颜色都用 --ly（换样式里能改）：
// 流光：只放一句大字，唱到哪亮到哪；心象：这一句的字散在空中，唱到哪个字哪个字亮，后面飘着几个虚化的字。
import { h } from '../../core/util.js';

export function lyricFx(el, kind) {
  const cur = h('div.as-fx__cur'), tr = h('div.as-fx__tr'), nx = h('div.as-fx__next'), dust = h('div.as-fx__dust');
  el.className = 'as-mp__fx is-' + kind;
  el.replaceChildren(...(kind === 'cad' ? [dust] : []), cur, tr, nx);
  let chars = [], lit = -1, lastL = null;
  const rnd = (a, b) => a + Math.random() * (b - a);
  return {
    line(L, i) {
      const x = L[i] || {};
      if (kind === 'cad' && L !== lastL) {
        lastL = L;
        const all = L.map(y => y.text).join('').replace(/\s/g, '');
        dust.replaceChildren(...Array.from({ length: all ? 12 : 0 }, () => h('i', { style: { left: rnd(4, 90) + '%', top: rnd(4, 90) + '%', fontSize: rnd(16, 46) + 'px', animationDelay: -rnd(0, 14) + 's' } }, all[Math.floor(Math.random() * all.length)])));
      }
      if (kind === 'cad') {
        chars = [...(x.text || '')].map(ch => h('span', { style: { '--y': rnd(-26, 26) + 'px', '--r': rnd(-12, 12) + 'deg', '--s': rnd(.8, 1.35), '--d': rnd(0, .25) + 's' } }, ch));
        cur.replaceChildren(...chars); lit = -1;
      } else cur.replaceChildren(h('span', x.text || ''));
      tr.textContent = x.tr || ''; nx.textContent = kind === 'lumi' ? (L[i + 1] || {}).text || '' : '';
      cur.classList.remove('is-in'); void cur.offsetWidth; cur.classList.add('is-in');
    },
    prog(p) {
      if (kind === 'lumi') { el.style.setProperty('--p', p * 100 + '%'); return; }
      const n = Math.round(p * chars.length);
      if (n !== lit) { chars.forEach((c, k) => c.classList.toggle('is-lit', k < n)); lit = n; }
    },
  };
}
