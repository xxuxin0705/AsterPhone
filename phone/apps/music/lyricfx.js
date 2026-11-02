// 碎语：这一句的字散在空中、歪歪扭扭，唱到哪个字亮哪个字（翻译也一样散开、跟着亮）；后面飘着几个虚化的字。颜色用 --ly。
import { h } from '../../core/util.js';

export function lyricFx(el) {
  const cur = h('div.as-fx__cur'), tr = h('div.as-fx__cur.is-tr'), dust = h('div.as-fx__dust');
  el.className = 'as-mp__fx is-cad';
  el.replaceChildren(dust, cur, tr);
  let a = [], b = [], lit = -1, lastL = null;
  const rnd = (x, y) => x + Math.random() * (y - x);
  const scatter = (box, text, k) => { const s = [...text].map(ch => h('span', { style: { '--y': rnd(-26, 26) * k + 'px', '--r': rnd(-12, 12) + 'deg', '--s': rnd(.8, 1.35), '--d': rnd(0, .25) + 's' } }, ch)); box.replaceChildren(...s); return s; };
  return {
    kind: 'cad',
    line(L, i) {
      const x = L[i] || {};
      if (L !== lastL) {
        lastL = L;
        const all = L.map(y => y.text).join('').replace(/\s/g, '');
        dust.replaceChildren(...Array.from({ length: all ? 12 : 0 }, () => h('i', { style: { left: rnd(4, 90) + '%', top: rnd(4, 90) + '%', fontSize: rnd(16, 46) + 'px', animationDelay: -rnd(0, 14) + 's' } }, all[Math.floor(Math.random() * all.length)])));
      }
      a = scatter(cur, x.text || '', 1); b = scatter(tr, x.tr || '', .45); lit = -1;
      [cur, tr].forEach(e => { e.classList.remove('is-in'); void e.offsetWidth; e.classList.add('is-in'); });
    },
    prog(p) {
      const n = Math.round(p * a.length) * 1000 + Math.round(p * b.length);   // 两行亮到第几个字，变了才动
      if (n === lit) return; lit = n;
      [a, b].forEach(s => s.forEach((c, k) => c.classList.toggle('is-lit', k < Math.round(p * s.length))));
    },
  };
}
