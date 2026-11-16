// 在地图上选地区：搜「日本」地图就移过去，拖一拖、放大缩小，点「用这里」。
// 地图图块用 CARTO（OpenStreetMap 的数据），搜地名、认地名用 Nominatim，都是网页直接连，不用后端，两边酒馆都一样
import { h } from './util.js';
import { page, btn, toast, icon, busy } from './ui.js';
import { log } from './log.js';
import * as nav from './nav.js';

const T = 256, N = 'https://nominatim.openstreetmap.org/';
const tile = (z, x, y) => `https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}@2x.png`;
// 经纬度 ↔ 第 z 层地图上的像素
const px = (lat, lng, z) => { const s = T * 2 ** z, r = lat * Math.PI / 180; return [(lng + 180) / 360 * s, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * s]; };
const ll = (x, y, z) => { const s = T * 2 ** z, n = Math.PI - 2 * Math.PI * y / s; return [180 / Math.PI * Math.atan(Math.sinh(n)), x / s * 360 - 180]; };
async function ask(path, signal) {
  const r = await fetch(N + path + '&format=json&accept-language=zh-CN', { signal });
  if (!r.ok) throw new Error(`地图那边回了 ${r.status}`);
  return r.json();
}

/** 选好返回 { name 地名, cc 国家代码, ip 照微博 IP 属地的写法（国内写省，国外写国家） }；点左下（默认「按正文定」）返回 { name: '' }；退出返回 null */
export function pickPlace(title = '选地区', none = '按正文定') {
  return new Promise(done => {
    let z = 3, cx, cy, end = v => { end = () => {}; done(v); };
    [cx, cy] = px(35, 115, z);
    const tiles = new Map(), layer = h('div.as-map__tiles'), map = h('div.as-map', layer, h('i.as-map__pin'),
      h('div.as-map__zoom', h('button', { 'aria-label': '放大', onclick: () => zoom(1) }, '+'), h('button', { 'aria-label': '缩小', onclick: () => zoom(-1) }, '−')),
      h('small.as-map__credit', '© OpenStreetMap · © CARTO'));
    function draw() {
      const W = map.clientWidth, H = map.clientHeight, n = 2 ** z, seen = new Set();
      for (let ty = Math.floor((cy - H / 2) / T); ty <= Math.floor((cy + H / 2) / T); ty++) for (let tx = Math.floor((cx - W / 2) / T); tx <= Math.floor((cx + W / 2) / T); tx++) {
        if (ty < 0 || ty >= n) continue;
        const k = `${z}/${tx}/${ty}`; seen.add(k);
        let im = tiles.get(k); if (!im) { im = h('img', { src: tile(z, ((tx % n) + n) % n, ty), alt: '', draggable: false, onerror: e => { e.target.style.visibility = 'hidden'; } }); tiles.set(k, im); layer.append(im); }
        im.style.transform = `translate(${tx * T - cx + W / 2}px, ${ty * T - cy + H / 2}px)`;
      }
      for (const [k, im] of tiles) if (!seen.has(k)) { im.remove(); tiles.delete(k); }
    }
    function zoom(d, to) {
      const nz = Math.max(2, Math.min(17, to ?? z + d)), k = 2 ** (nz - z); cx *= k; cy *= k; z = nz; draw();
    }
    // 拖着走；两根手指捏着放大缩小
    const pts = new Map(); let pinch = 0;
    map.onpointerdown = e => { if (e.target.closest('button')) return; map.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); };
    map.onpointermove = e => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 1) { cx -= e.clientX - p[0]; cy -= e.clientY - p[1]; draw(); }
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (!pinch) pinch = d; else if (d / pinch > 1.6 || d / pinch < .62) { zoom(d > pinch ? 1 : -1); pinch = d; }
      }
    };
    map.onpointerup = map.onpointercancel = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
    map.onwheel = e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1); };
    map.ondblclick = () => zoom(1);

    const q = h('input.as-input', { placeholder: '地名', enterkeyhint: 'search', onkeydown: e => { if (e.key === 'Enter') go.click(); } });
    const go = btn('搜索', 'secondary', () => busy(go, async signal => {
      if (!q.value.trim()) return;
      const [r] = await ask('search?limit=1&q=' + encodeURIComponent(q.value.trim()), signal).catch(e => { if (!signal.aborted) { toast('连不上地图'); log('warn', '地图', '搜地名失败：' + e.message); } return []; });
      if (signal.aborted) return;
      if (!r) { toast('没找到这个地方'); return; }
      // 放大到这个地方刚好装得下
      const [s, nn, w, ee] = r.boundingbox.map(Number), W = map.clientWidth * .8, H = map.clientHeight * .8;
      let nz = 17; while (nz > 2) { const [x1, y1] = px(nn, w, nz), [x2, y2] = px(s, ee, nz); if (x2 - x1 < W && y2 - y1 < H) break; nz--; }
      z = nz; [cx, cy] = px(+r.lat, +r.lon, z); draw();
    }));
    const use = btn('用这里', 'primary', () => busy(use, async signal => {
      const [lat, lng] = ll(cx, cy, z);
      const r = await ask(`reverse?lat=${lat}&lon=${lng}&zoom=${Math.min(z, 10)}`, signal).catch(e => { if (!signal.aborted) { toast('连不上地图'); log('warn', '地图', '认地名失败：' + e.message); } return null; });
      if (signal.aborted || !r) return;
      if (!r.address) { toast('这里没有地名，挪一挪'); return; }
      const a = r.address, place = a.city || a.town || a.state || a.county || a.province || '';
      nav.pop(); end({ name: ((a.country || '') + (place && place !== a.country ? place : '')).slice(0, 20), cc: a.country_code || '', ip: (a.country_code === 'cn' ? a.state || a.province || place : a.country || '').slice(0, 12) });
    }));
    const p = page({ app: 'settings', id: 'map-pick', title, back: true, onBack: () => { nav.pop(); end(null); } });
    p.body.append(h('div.as-map-pick', h('div.as-map-pick__search', q, go), map,
      h('div.as-lib-actions.is-two', btn(none, 'secondary', () => { nav.pop(); end({ name: '' }); }), use)));
    nav.push(p.el);
    requestAnimationFrame(draw);
  });
}
