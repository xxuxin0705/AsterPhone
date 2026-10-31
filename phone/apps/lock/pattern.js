// 手势密码：3×3 圆点，手指划过的点亮起、点之间连线。
// 备用图案是 Z 字形：左上 → 右上 → 中心 → 左下 → 右下（点编号 0~8，就是 0-1-2-4-6-7-8）。
import { h } from '../../core/util.js';

export const BACKUP_Z = '0124678';
const NS = 'http://www.w3.org/2000/svg';

/** 做一个图案板。onDone(序列字符串) 返回 true = 对了，false = 错了（会变红抖一下） */
export function patternPad({ onDone, hintZ = false } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 300 300'); svg.classList.add('as-lock-pattern');
  const pts = [];
  for (let i = 0; i < 9; i++) pts.push({ x: 50 + (i % 3) * 100, y: 50 + Math.floor(i / 3) * 100 });
  if (hintZ) {
    const z = document.createElementNS(NS, 'polyline');
    z.setAttribute('points', '50,50 250,50 150,150 50,250 250,250'); z.classList.add('as-lock-pattern__hint'); svg.appendChild(z);
  }
  const line = document.createElementNS(NS, 'polyline'); line.classList.add('as-lock-pattern__line'); svg.appendChild(line);
  const tail = document.createElementNS(NS, 'line'); tail.classList.add('as-lock-pattern__line'); svg.appendChild(tail);
  const dots = pts.map(p => {
    const g = document.createElementNS(NS, 'g');
    const ring = document.createElementNS(NS, 'circle'); ring.setAttribute('cx', p.x); ring.setAttribute('cy', p.y); ring.setAttribute('r', 26); ring.classList.add('as-lock-pattern__ring');
    const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); dot.setAttribute('r', 8); dot.classList.add('as-lock-pattern__dot');
    g.append(ring, dot); svg.appendChild(g); return g;
  });
  let seq = [], drawing = false;
  const toLocal = e => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * 300, y: (e.clientY - r.top) / r.height * 300 }; };
  const hit = q => pts.findIndex(p => Math.hypot(p.x - q.x, p.y - q.y) < 34);
  const paint = () => {
    line.setAttribute('points', seq.map(i => `${pts[i].x},${pts[i].y}`).join(' '));
    dots.forEach((d, i) => d.classList.toggle('is-active', seq.includes(i)));
  };
  const add = i => {
    if (i < 0 || seq.includes(i)) return;
    // 跨过中间点时把中间那个也连上（比如 0 → 2 会经过 1）
    const last = seq[seq.length - 1];
    if (last != null) { const mid = (last + i) / 2; if (Number.isInteger(mid) && Math.abs((last % 3) - (i % 3)) !== 1 && Math.abs(Math.floor(last / 3) - Math.floor(i / 3)) !== 1 && !seq.includes(mid)) seq.push(mid); }
    seq.push(i); paint(); if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) { /* 忽略 */ }
  };
  const reset = () => { seq = []; tail.removeAttribute('x1'); paint(); svg.classList.remove('is-error', 'is-ok'); };
  svg.addEventListener('pointerdown', e => { e.preventDefault(); reset(); drawing = true; try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ } add(hit(toLocal(e))); });
  svg.addEventListener('pointermove', e => {
    if (!drawing) return; const q = toLocal(e); add(hit(q));
    const l = seq[seq.length - 1]; if (l == null) return;
    tail.setAttribute('x1', pts[l].x); tail.setAttribute('y1', pts[l].y); tail.setAttribute('x2', q.x); tail.setAttribute('y2', q.y);
  });
  const end = () => {
    if (!drawing) return; drawing = false;
    tail.setAttribute('x2', tail.getAttribute('x1') || 0); tail.setAttribute('y2', tail.getAttribute('y1') || 0);
    if (!seq.length) return;
    const ok = onDone ? onDone(seq.join('')) : true;
    if (ok === false) { svg.classList.add('is-error'); setTimeout(reset, 800); }
    else if (ok === true) { svg.classList.add('is-ok'); setTimeout(reset, 400); }
    else reset();
  };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  return { el: h('div.as-lock-pattern-wrap', svg), reset };
}
