// 碎语：这一句的字散在空中、歪歪扭扭，唱到哪个字亮哪个字（翻译也一样散开、跟着亮）；下面一点是下一句（还没轮到，暗着）。后面不飘虚化的字（作者说是虚影，不要）。颜色用 --ly。
import { h } from '../../core/util.js';

export function lyricFx(el) {
  const cur = h('div.as-fx__cur'), tr = h('div.as-fx__cur.is-tr'), nx = h('div.as-fx__cur.is-next');
  el.className = 'as-mp__fx is-cad';
  el.replaceChildren(cur, tr, nx);
  let a = [], b = [], lit = -1;
  const rnd = (x, y) => x + Math.random() * (y - x);
  const scatter = (box, text, k) => { const s = [...text].map(ch => h('span', { style: { '--y': rnd(-12, 12) * k + 'px', '--r': rnd(-10, 10) + 'deg', '--s': rnd(.85, 1.2), '--d': rnd(0, .25) + 's' } }, ch)); box.replaceChildren(...s); return s; };
  return {
    kind: 'cad',
    line(L, i) {
      const x = L[i] || {};
      a = scatter(cur, x.text || '', 1); b = scatter(tr, x.tr || '', .45); scatter(nx, (L[i + 1] || {}).text || '', .6); lit = -1;
      [cur, tr, nx].forEach(e => { e.classList.remove('is-in'); void e.offsetWidth; e.classList.add('is-in'); });
    },
    prog(p) {
      const n = Math.round(p * a.length) * 1000 + Math.round(p * b.length);   // 两行亮到第几个字，变了才动
      if (n === lit) return; lit = n;
      [a, b].forEach(s => s.forEach((c, k) => c.classList.toggle('is-lit', k < Math.round(p * s.length))));
    },
  };
}
