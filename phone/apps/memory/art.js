// 岁岁砂上面那张画：时间是沙漏、关系是轨道、地点是迷雾地图，三张之间能接着变过去。
// 像一张测绘图纸：纸色、墨色、一种钴蓝，平涂、细线、边上撒点，全是代码画的；白天 / 夜里跟着手机走。
// 人和地点的名字是真的字（能点、能拖），每帧挪到画上对应的位置。页面被盖住、离开就停。
import { h } from '../../core/util.js';

const PAL = { day: { paper: '#ecebe4', ink: '#17171c', blue: '#1f2fc4', pencil: 'rgba(23,23,28,.3)' }, night: { paper: '#121216', ink: '#eceae2', blue: '#3d4ff0', pencil: 'rgba(236,234,226,.28)' } };
const cl = v => Math.max(0, Math.min(1, v)), ease = p => p * p * (3 - 2 * p), mix = (a, b, p) => a + (b - a) * p;
const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(11);
const dots = [...Array(2800)].map(() => [rnd(), rnd(), rnd()]);   // 撒点用的随机数，定死了每帧都一样
const NX = 86, NY = 345, R = 220, OC = 250, tall = i => i ? 500 : 410;   // 沙漏的腰在 (NX, NY)，下面那道沙就是时间轴；轨道的正中在 OC 这么高

/** host：放画的元素。on：tap 到了什么 —— rel(第几个人)、center(第几个人被拖到了正中)、place(名字, 里面的小地点)、move(地点名, x, y)、blank()（点了空白，回 true 是收起了底下那张纸） */
export function art(host, on) {
  const cv = h('canvas.as-ss-art'), men = h('div.as-ss-ov.as-ss-men'), names = h('div.as-ss-ov.as-ss-names'), back = h('button.as-ss-back', { onclick: () => zin ? zoom(-1) : on.up() }, '‹ 全部'), where = h('b.as-ss-at');
  host.append(cv, names, men, back, where); men.dataset.noSwipe = names.dataset.noSwipe = '';   // 在名字上横着拖不是「右滑返回」
  const g = cv.getContext('2d'), page = host.closest('.as-page');
  // 地点页画多高：一直铺到底下页签上面（作者：下面空一截）。页面还没摆出来量不到时先按 500
  let roomH = 0;
  const room = () => { if (!roomH) { const v = page.getBoundingClientRect().bottom - host.getBoundingClientRect().top - 96; if (v > 300) roomH = Math.max(500, Math.round(v)); } return roomH || 500; };
  const tallOf = i => i === 2 ? room() : tall(i);
  let W = 0, H = 410, cur = 0, from = 0, t0 = -1e9, raf = 0, phone = null, fresh = false;
  let GONE = new Set(), NAMES = [], LINK = [], POS = [], ctr = 0, selP = -1, drag = null, press = null;
  let AREAS = [], LONE = [], here = '', sel = null, zk = -1, zin = false, zT0 = -1e9, needle = 0;
  const size = () => { const d = devicePixelRatio || 1; W = cv.clientWidth; cv.style.height = H + 'px'; cv.width = W * d; cv.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); };

  const line = (pts, c, w = 1, dash) => { g.beginPath(); g.setLineDash(dash || []); pts.forEach(([a, b], i) => i ? g.lineTo(a, b) : g.moveTo(a, b)); g.strokeStyle = c; g.lineWidth = w; g.stroke(); g.setLineDash([]); };
  const ring = (cx, cy, r, c, w = 1, dash, a0 = 0, a1 = 7) => { g.beginPath(); g.setLineDash(dash || []); g.arc(cx, cy, Math.max(0, r), a0, a1); g.strokeStyle = c; g.lineWidth = w; g.stroke(); g.setLineDash([]); };
  const disc = (cx, cy, r, c) => { g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fillStyle = c; g.fill(); };
  // 圆里撒一片点：越靠 (dx, dy) 那边越密，像版画的颗粒
  const stipple = (cx, cy, r, c, dx, dy, n, k) => { g.fillStyle = c; for (let i = 0; i < n; i++) { const [a, b, p] = dots[i], ang = a * 6.283, rr = Math.sqrt(b) * r, px = Math.cos(ang) * rr, py = Math.sin(ang) * rr; if (p < Math.pow((px * dx + py * dy) / r * .5 + .5, k)) g.fillRect(cx + px, cy + py, 1.3, 1.3); } };

  /* 沙漏：只看得到上半只，沙从腰漏下去，一直漏到页面底 —— 下面整页就是下半只 */
  const bulb = () => { g.beginPath(); g.moveTo(NX - R, 35); g.lineTo(NX + R, 35); g.bezierCurveTo(NX + R, 215, NX + 16, 250, NX + 5, NY); g.lineTo(NX - 5, NY); g.bezierCurveTo(NX - 16, 250, NX - R, 215, NX - R, 35); g.closePath(); };
  // 点沙漏（作者要的）：点沙面戳一个坑，点进沙里那儿空一下、上面的塌下来，再慢慢填平；点下面出沙口一下子漏得快
  let rush = -9, flowP = 0, flowT = 0;
  const pokes = [], grains = [], SURF = [[-200, NX - 70, NX - 40, NX, 150, 150, 184, 184], [NX, NX + 40, NX + 70, 460, 184, 184, 150, 150]];
  const bz = (a, b, c, d, u) => (1 - u) ** 3 * a + 3 * (1 - u) ** 2 * u * b + 3 * (1 - u) * u * u * c + u ** 3 * d;
  // 坑有多深（0～1）：戳沙面的是一下陷下去再填平；戳进沙里的（hole）先空出一个洞，上面的沙往下塌（沙面跟着陷），再慢慢填平
  const sink = (p, a) => p.hole ? (a < .12 ? 0 : a < .72 ? 1 - (1 - (a - .12) / .6) ** 2 : Math.max(0, 1 - (a - .72) / 1.6) ** 2) : a < .12 ? a / .12 : Math.max(0, 1 - (a - .12) / 1.6) ** 2;
  const dent = (x, now) => pokes.reduce((s, p) => s + p.d * sink(p, now - p.t) * Math.exp(-(((x - p.x) / p.w) ** 2)), 0);
  const surfY = x => { let y = 184; for (const q of SURF) for (let u = 0; u <= 1; u += .02) if (Math.abs(bz(q[0], q[1], q[2], q[3], u) - x) < 6) y = bz(q[4], q[5], q[6], q[7], u); return y; };
  function poke(x, y) {
    const now = performance.now() / 1000;
    if (y > NY - 25) { rush = now; return; }   // 点下面：出沙口忽然漏得快，再慢慢缓回来（作者定的）
    if (y < 35 || y > NY || x < NX - R || x > NX + R) return;
    const sy = surfY(x);
    if (y > sy + 14) { pokes.push({ x, y: Math.min(y, NY - 30), d: 18, w: 28, t: now, hole: true }); return; }   // 点在沙里面：那儿空一下，上面的塌下来
    pokes.push({ x, d: 20, w: 26, t: now });
    for (let i = 0; i < 16; i++) { const [a, b] = dots[(i * 37 + Math.round(x)) % 2800]; grains.push({ x: x + (a - .5) * 16, y: sy + 4, vx: (a - .5) * 120, vy: -90 - b * 110, t: now }); }
  }
  function glass(P, t) {
    line([[0, NY], [W, NY]], P.pencil, .7); ring(NX, NY, 96, P.pencil, .7, [2, 5]); line([[NX + R, 35], [NX - 70, NY + 99]], P.pencil, .6);
    g.save(); bulb(); g.clip();
    const now = performance.now() / 1000; while (pokes.length && now - pokes[0].t > 2) pokes.shift();
    g.beginPath(); for (const q of SURF) for (let u = 0; u <= 1.001; u += .04) { const x = bz(q[0], q[1], q[2], q[3], u); g.lineTo(x, bz(q[4], q[5], q[6], q[7], u) + dent(x, now)); }
    g.lineTo(460, 400); g.lineTo(-200, 400); g.fillStyle = P.blue; g.fill();
    stipple(NX + 70, 262, 150, P.paper, .55, -.75, 1500, 2.6);
    // 沙里空出来的洞：一下张开，上面的沙一粒粒落进去，洞从上往下被填满
    for (const p of pokes) { if (!p.hole) continue; const a = now - p.t, r = 17 * Math.min(1, a / .12) * (a < .12 ? 1 : Math.max(0, 1 - (a - .12) / .6)); if (r < 1) continue;
      g.beginPath(); g.ellipse(p.x, p.y + (17 - r), r * 1.15, r, 0, 0, 7); g.fillStyle = P.paper; g.fill(); g.fillStyle = P.blue;
      for (let i = 0; i < 8; i++) { const [u, v] = dots[i * 7 + 3]; g.fillRect(p.x + (u - .5) * r * 1.6, p.y + (17 - r) - r + ((a * 140 + v * 40) % (2 * r)), 1.8, 1.8); } }
    g.fillStyle = P.blue; for (let i = 0; i < 300; i++) { const [a, b, p] = dots[i + 1500]; g.fillRect(NX - R + a * 2 * R, 182 - b * b * 80 - p * 6, 1.4, 1.4); }
    for (let i = grains.length - 1; i >= 0; i--) { const q = grains[i], a = now - q.t, x = q.x + q.vx * a, y = q.y + q.vy * a + 320 * a * a; if (a > .15 && y > surfY(x) + dent(x, now)) grains.splice(i, 1); else g.fillRect(x, y, 2, 2); }
    g.restore();
    bulb(); g.strokeStyle = P.ink; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = P.ink; g.fillRect(NX - R - 12, 26, 2 * R + 24, 9); g.fillRect(NX - 9, NY - 3, 18, 6);
    g.beginPath(); g.moveTo(NX + 6, NY + 3); g.bezierCurveTo(NX + 20, NY + 44, 230, NY + 52, W + 20, NY + 58); g.moveTo(NX - 6, NY + 3); g.bezierCurveTo(NX - 18, NY + 40, 30, NY + 52, -10, NY + 56); g.strokeStyle = P.ink; g.lineWidth = 1.3; g.stroke();
    flowP += Math.min(.05, now - (flowT || now)) * 18 * (1 + 6 * Math.exp(-(now - rush) / .9)); flowT = now;
    g.fillStyle = P.blue; for (let y = NY + 4 - 8 + flowP % 8; y < H; y += 8) g.fillRect(NX - 1, Math.max(NY + 4, y), 2, 4);
  }

  /* 轨道：正中是「现在看谁」，TA 认识的人各是一颗星，离得越近越亲；从星往外的那串小圈是以前待过的位置。整张图慢慢转 */
  const tag = (i, px, py, dy = 0, al = 1) => { const b = men.children[i]; if (!b) return; b.style.transform = `translate(${Math.max(22, Math.min(W - 22, px)).toFixed(1)}px, ${(py + dy).toFixed(1)}px) translate(-50%, -18px)`; b.style.opacity = (al * (GONE.has(i) ? .5 : 1)).toFixed(2); b.style.pointerEvents = al > .5 ? '' : 'none'; };
  const rad = r => mix(46, Math.min(W / 2 - 16, 184), (r + .5) / 6);
  function orbit(P, t, b) {
    const cx = W / 2, rot = t * .025, Rm = rad(5.5);
    line([[0, OC], [W, OC]], P.pencil, .6); line([[cx, 0], [cx, H]], P.pencil, .6);
    for (let j = 0; j < 6; j++) ring(cx, OC, rad(j) * b, P.pencil, .6, [2, 5]);
    ring(cx, OC, Rm * b, P.ink, 1.2); for (let i = 0; i < 72; i++) { const a = rot + i * .0873, r1 = Rm * b + (i % 6 ? 4 : 9); line([[cx + Math.cos(a) * Rm * b, OC + Math.sin(a) * Rm * b], [cx + Math.cos(a) * r1, OC + Math.sin(a) * r1]], P.ink, .8); }
    if (drag && Math.hypot(drag.x - cx, drag.y - OC) < 44) ring(cx, OC, 26, P.blue, 1.4, [3, 4]);
    const A0 = g.globalAlpha;
    NAMES.forEach((name, i) => {
      // 亲近度 5 最亲、离得最近：st 里存的是「离多远」= 5 - 亲近度
      const lk = LINK[ctr][i], a = i * 2.39996 + rot, jt = (i % 3 - 1) * 5, me = i === ctr, r = me ? 0 : lk ? rad(lk.st[0][2]) + jt : Rm + 70;
      // 每个人慢慢滑向自己该在的位置；被手指拖着的那颗跟着手指
      const T = [cx + Math.cos(a) * r, OC + Math.sin(a) * r, me || lk ? 1 : 0], S = POS[i] || (POS[i] = T.slice());
      if (drag && drag.i === i) { S[0] = drag.x; S[1] = drag.y; S[2] = 1; } else for (let k = 0; k < 3; k++) S[k] += (T[k] - S[k]) * .13;
      const px = mix(cx, S[0], b), py = mix(OC, S[1], b), al = S[2];
      if (al < .02) return tag(i, px, py, 0, 0);
      g.globalAlpha = A0 * al * (GONE.has(i) && !me ? .45 : 1);   // 不在了的人：留在原位，淡下去，外面一圈虚线（作者挑的）
      if (me) { disc(px, py, 16, P.blue); g.save(); g.beginPath(); g.arc(px, py, 16, 0, 7); g.clip(); stipple(px, py, 16, P.paper, -.7, -.6, 50, 2); g.restore(); return tag(i, px, py, 13, al); }
      if (lk && !(drag && drag.i === i)) { const at = q => [cx + Math.cos(a) * q * b, OC + Math.sin(a) * q * b]; ring(cx, OC, Math.hypot(px - cx, py - OC), P.pencil, .9, null, a - .8, a);
        if (lk.st.length > 1) { line([at(rad(lk.st[lk.st.length - 1][2]) + jt), [px, py]], P.blue, 1); lk.st.slice(1).forEach(s => { const q = at(rad(s[2]) + jt); disc(q[0], q[1], 2.6, P.paper); ring(q[0], q[1], 2.6, P.blue, 1.1); }); } }
      const kind = lk ? lk.kind : '';
      // 恋人、暧昧、夫妻是蓝点，对手是空心，最好的朋友在白点外面套一圈细线（作者挑的），别的是白点
      disc(px, py, 4.8, kind === '对手' ? P.paper : /^(恋人|暧昧|夫妻)$/.test(kind) ? P.blue : P.ink); if (kind === '对手') ring(px, py, 4.8, P.ink, 1.4);
      if (/^(挚友|密友|闺蜜|死党)$/.test(kind)) ring(px, py, 8, P.ink, 1);
      if (GONE.has(i)) ring(px, py, 11, P.ink, 1, [2, 3]);
      if (i === selP) ring(px, py, 11, P.blue, 1.2);
      tag(i, px, py, 0, al);
    });
    g.globalAlpha = A0;
  }

  /* 迷雾地图：先只看到大地方；点一个，别处的雾合上，这一片的雾散开，里面的小地方才出来 */
  const BIG = () => [W / 2, room() / 2, W / 2 - 22, Math.min(room() / 2 - 62, (W / 2 - 22) * 1.15)];   // 钻进一片：圈摆在画的正中
  /* 地图怎么看（作者定的）：位置定死了不让拖；两指捏着放大缩小，一指拖着挪。名字大小不变、只是散开，挤在一起的放大就分得开 */
  let V = [1, 0, 0];   // 放大几倍、往右挪了多少、往下挪了多少
  const T = (x, y) => [x * V[0] + V[1], y * V[0] + V[2]];
  const spot = () => { const s = W / 400, k = AREAS.findIndex(a => a.name === here || a.all.includes(here)), l = LONE.find(o => o.name === here), o = k >= 0 ? AREAS[k] : l || AREAS[0] || LONE[0]; return o ? T(o.x * s, o.y) : [W / 2, 200]; };
  function fog(P, t, b, fall = 0) {
    const s = W / 400, z = ease(cl((performance.now() - zT0) / 600)), zz = zin ? z : 1 - z, B = BIG();
    const holes = AREAS.map((a, k) => { const r = Math.min(70, 38 + a.list.length * 4) * V[0], o = [...T(a.x * s, a.y), r, r]; return k === zk ? o.map((v, j) => mix(v, B[j], zz)) : [o[0], o[1], r * (1 - zz), r * (1 - zz)]; }).concat(LONE.map(l => [...T(l.x * s, l.y), 27 * V[0] * (1 - zz), 27 * V[0] * (1 - zz)])).concat([[38, H - 44, 24, 24]]);
    for (let q = 0; q < W; q += 34) line([[q, 0], [q, H]], P.pencil, .35); for (let q = 0; q < H; q += 34) line([[0, q], [W, q]], P.pencil, .35);
    if (zz < 1 && AREAS.length > 1) { const A = g.globalAlpha; g.globalAlpha = A * (1 - zz); line(AREAS.map(a => T(a.x * s, a.y)), P.blue, 1.3, [1.5, 5]); g.globalAlpha = A; }
    holes.slice(0, -1).forEach(o => { if (o[2] < 2) return; g.beginPath(); g.setLineDash([2, 4]); g.ellipse(o[0], o[1], o[2] * b, o[3] * b, 0, 0, 7); g.strokeStyle = P.pencil; g.lineWidth = .7; g.stroke(); g.setLineDash([]); });
    if (sel) ring(sel[0], sel[1], 30, P.blue, 1.2);
    // 指南针：指着点开的那个地方；没点开就指着现在所在的地方
    { const to = sel || (zin ? [B[0], B[1]] : spot()), want = Math.atan2(to[0] - 38, -(to[1] - (H - 44))); needle += Math.atan2(Math.sin(want - needle), Math.cos(want - needle)) * .07;
      ring(38, H - 44, 15, P.ink, 1); g.save(); g.translate(38, H - 44); g.rotate(needle + Math.sin(t * 2.3) * .035); g.beginPath(); [[0, -19], [4, 0], [0, -4], [-4, 0]].forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fillStyle = P.ink; g.fill(); line([[0, 0], [0, 17]], P.ink, 1); g.restore(); }
    g.fillStyle = P.ink;
    for (let i = 0, n = 5600 * H / 410; i < n; i++) {
      const d = dots[i % 2800], k = i / 2800 | 0, p = d[2]; let px = (d[0] + k * .371) % 1 * W + Math.sin(t * .35 + i) * 3, py = (d[1] + k * .613) % 1 * H + Math.cos(t * .3 + i * 1.7) * 2, m = 1e9;
      for (const o of holes) if (o[2] > 1) m = Math.min(m, (Math.hypot((px - o[0]) / o[2], (py - o[1]) / o[3]) - b) * o[3]);
      if (p > m / 30 - .08) continue;
      if (fall) { px = mix(px, NX, fall * (.4 + p * .6)); py += fall * fall * (H + 40) * (.5 + p); }
      g.fillRect(px, py, p > .7 ? 1.8 : 1.3, p > .7 ? 1.8 : 1.3);
    }
  }

  /* 换页（作者定的）：三页是同一把沙。时间页它装在沙漏里，关系页它聚成正中那个人，地点页它散成满图的雾。
     换页时每粒沙从这一页的位置飞到下一页的位置：各自晚一点出发、路上拐个弯；飞进地图的由蓝变墨，飞回来的由墨变蓝。两页别的线条一淡一显 */
  const SC = [(P, t) => glass(P, t), orbit, fog];
  const show = (i, a, P, t, b, f) => { if (a <= 0) return; g.globalAlpha = a; SC[i](P, t, b, f); g.globalAlpha = 1; };
  const N = 900; let sand = [], sandW = 0;
  const home = [i => sand[i % sand.length], i => { const a = dots[i][0] * 6.283, r = Math.sqrt(dots[i][1]) * 15; return [W / 2 + Math.cos(a) * r, OC + Math.sin(a) * r]; }, i => [dots[i + N][0] * W, dots[i + N][1] * H]];
  function flow(P, t, p) {
    if (sandW !== W) {   // 沙漏里那兜沙的位置：在瓶身里、沙面以下随手撒，落在瓶外的不要
      sandW = W; sand = []; const q = new Path2D(), d = devicePixelRatio || 1;
      q.moveTo(NX - R, 35); q.lineTo(NX + R, 35); q.bezierCurveTo(NX + R, 215, NX + 16, 250, NX + 5, NY); q.lineTo(NX - 5, NY); q.bezierCurveTo(NX - 16, 250, NX - R, 215, NX - R, 35);
      for (let i = 0; i < 2800 && sand.length < N; i++) { const x = dots[i][2] * Math.min(W, NX + R), y = 190 + dots[(i * 7) % 2800][0] * (NY - 192); if (g.isPointInPath(q, x * d, y * d)) sand.push([x, y]); }
    }
    show(from, 1 - cl(p * 2.6), P, t, 1); show(cur, cl(p * 2.6 - 1.6), P, t, ease(cl(p * 2.6 - 1.6)));
    g.globalAlpha = Math.min(1, (1 - p) / .12);
    for (let i = 0; i < N; i++) {
      const d = dots[i], q = ease(cl(p * 1.5 - d[2] * .5)), a = home[from](i), b = home[cur](i), dx = b[0] - a[0], dy = b[1] - a[1], bend = Math.sin(q * Math.PI) * (d[1] - .5) * .5;
      g.fillStyle = (cur === 2 ? q > .55 : from === 2 && q < .45) ? P.ink : P.blue;
      g.fillRect(mix(a[0], b[0], q) - dy * bend, mix(a[1], b[1], q) + dx * bend, 1.7, 1.7);
    }
    g.globalAlpha = 1;
  }
  function draw(now) {
    if (page.classList.contains('is-behind') || !page.isConnected) { raf = 0; return; }   // 被别的页面盖住、离开了：停
    raf = requestAnimationFrame(draw);
    phone = phone || page.closest('.as-phone');
    const P = PAL[phone.dataset.mode === 'night' ? 'night' : 'day'], t = now / 1000, p = cl((now - t0) / 1300);
    const hh = Math.round(mix(tallOf(from), tallOf(cur), ease(p))); if (hh !== H || !W) { H = hh; size(); }
    if (fresh && W) { fresh = false; fillNames(); }   // 名字要知道画多宽才摆得了
    g.clearRect(0, 0, W, H);
    if (p >= 1 || from === cur) show(cur, 1, P, t, 1);
    else flow(P, t, p);
  }

  /* 地点的名字：大地方点一下钻进去；里面的小地方、不属于哪片的地方点一下出纸 */
  const at = (b, px, py) => { b.style.left = px + 'px'; b.style.top = py + 'px'; };
  const tapPlace = (b, o, px, py, subs) => { mark(null); b.classList.add('sel'); sel = [px, py]; on.place(o.name, subs); };
  const place = () => { const s = W / 400; names.querySelectorAll(':scope > button').forEach(b => at(b, ...T(b._o.x * s, b._o.y))); };
  // 现在在哪一层（ROOT，'' 是最外面）：左上角那个按钮往回退一步（钻进一片里时退回这一层，在这一层时退到上一层），正上方写这一层的名字
  let ROOT = '', UP = '', DEEP = new Set(), want = '';
  const crumb = () => { back.textContent = '‹ ' + ((zin ? ROOT : UP) || '全部'); back.classList.toggle('on', cur === 2 && (zin || !!ROOT)); where.textContent = ROOT; where.classList.toggle('on', cur === 2 && !!ROOT && !zin); };
  function zoom(k) {
    on.blank(); zin = k >= 0; if (zin) { zk = k; V = [1, 0, 0]; } zT0 = performance.now(); const B = BIG();
    names.classList.toggle('zoom', zin); crumb(); place();
    names.querySelectorAll('button.area').forEach(b => { const me = zin && +b.dataset.k === k; b.classList.toggle('cur', me); if (me) at(b, B[0], B[1]); });
    names.querySelectorAll('.sub').forEach(q => q.classList.toggle('on', zin && +q.dataset.k === k));
  }
  function fillNames() {
    const B = BIG(), s = W / 400; zin = false; zk = -1; V = [1, 0, 0]; names.classList.remove('zoom');
    names.replaceChildren(...AREAS.flatMap((a, k) => {
      const b = h('button.area', { dataset: { k, n: a.name } }, a.name), sub = h('div.sub', { dataset: { k } }, a.list.map((n, i) => {
        const ang = (a.list.length === 2 ? 0 : -Math.PI / 2) + (i + .5) / a.list.length * 6.283,   // 只有两个时摆在上下：摆左右会压住中间的大名字
          rr = a.list.length > 5 && i % 2 && Math.abs(Math.sin(ang)) > .5 ? .6 : 1,   // 多了就里外两圈；正左正右的不往里收（会压住正中的大名字）
          px = B[0] + Math.cos(ang) * (B[2] - 50) * rr, py = B[1] + Math.sin(ang) * (B[3] - 44) * rr;
        const c = h('button' + (DEEP.has(n) ? '.deep' : ''), { dataset: { n } }, n); c._tap = () => DEEP.has(n) ? on.dive(n, a.name) : tapPlace(c, { name: n }, px, py); at(c, px, py); return c;   // 里面还有地方的：再往下钻
      }));
      b._o = a; b._tap = () => zin ? tapPlace(b, a, B[0], B[1], a.all) : zoom(k);
      return [b, sub];
    }), ...LONE.map(l => { const b = h('button', { dataset: { n: l.name } }, l.name); b._o = l; b._tap = () => tapPlace(b, l, ...T(l.x * s, l.y)); return b; }));
    place(); crumb();
    if (want) { const k = AREAS.findIndex(a => a.name === want); want = ''; if (k >= 0) zoom(k); }
  }
  // 手指：按在名字上没挪就是点它；按在空白没挪 = 收起 / 退回全部；挪了就是拖地图，两根手指就是放大缩小（钻进一片里时不能拖）
  const pts = new Map(); let g0 = null, moved = false, downT = null;
  host.addEventListener('pointerdown', e => {
    if (cur !== 2 || e.target.closest('.as-ss-back')) return;
    host.setPointerCapture(e.pointerId); if (!pts.size) { moved = false; downT = e.target.closest('button'); }
    pts.set(e.pointerId, [e.clientX, e.clientY]); g0 = null;
  });
  host.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]); if (zin) return;
    const p = [...pts.values()], q = p[1] || p[0], r = cv.getBoundingClientRect(), c = [(p[0][0] + q[0]) / 2 - r.left, (p[0][1] + q[1]) / 2 - r.top], d = Math.hypot(p[0][0] - q[0], p[0][1] - q[1]);
    if (!g0) { g0 = { c, d, V: [...V] }; return; }
    if (!moved) { if (!p[1] && Math.hypot(c[0] - g0.c[0], c[1] - g0.c[1]) < 8) return; moved = true; on.blank(); names.classList.add('pan'); }
    const k = Math.max(1, Math.min(4, g0.V[0] * (g0.d ? d / g0.d : 1))), lim = (v, max) => Math.min(0, Math.max(max - max * k, v));
    V = [k, lim(c[0] - (g0.c[0] - g0.V[1]) / g0.V[0] * k, W), lim(c[1] - (g0.c[1] - g0.V[2]) / g0.V[0] * k, H)];   // 手指中间底下的那个地方跟着手指走，不拖出边
    place();
  });
  const lift = e => {
    if (!pts.delete(e.pointerId)) return; g0 = null; if (pts.size) return; names.classList.remove('pan');
    if (!moved && e.type === 'pointerup') downT && downT._tap ? downT._tap() : cv.onclick();
  };
  host.addEventListener('pointerup', lift); host.addEventListener('pointercancel', lift);

  // 人：点一下出纸（正中这个人眼里的 TA）；按住拖到正中，TA 就成了中心
  men.onpointerdown = e => { const b = e.target.closest('button'), i = [...men.children].indexOf(b); if (cur !== 1 || i < 0) return; b.setPointerCapture(e.pointerId); press = { i, x: e.clientX, y: e.clientY }; };
  men.onpointermove = e => { if (!press || press.i === ctr || (!drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 8)) return; const r = cv.getBoundingClientRect(); on.blank(); drag = { i: press.i, x: e.clientX - r.left, y: e.clientY - r.top }; };
  men.onpointerup = men.onpointercancel = e => {
    if (!press) return; const p = press, d = drag; press = drag = null;
    if (p.i === ctr) { if (e.type === 'pointerup') on.self(); return; }   // 点正中这个人自己：TA 的成长
    if (!d) { if (e.type === 'pointerup' && LINK[ctr][p.i]) { mark(null); selP = p.i; men.children[p.i].classList.add('sel'); on.rel(p.i); } return; }
    if (Math.hypot(d.x - W / 2, d.y - OC) < 44) on.center(p.i);
  };
  cv.onclick = e => { if (cur === 0 && e) { const r = cv.getBoundingClientRect(); poke(e.clientX - r.left, e.clientY - r.top); return; } if (!on.blank() && cur === 2 && zin) zoom(-1); };
  /** 收起选中的（那圈蓝环、蓝字） */
  function mark() { host.querySelectorAll('.as-ss-ov .sel').forEach(b => b.classList.remove('sel')); sel = null; selP = -1; }

  return {
    mark, mid: () => room() / 2,
    /** names：所有人（第 0 个是你）；link[a][b] = { kind, st: [[日期, 是什么, 离多远]…]（第 0 条是现在）}；areas：[{ name, x, y, list: 摆出来的小地点, all: 里面所有的小地点 }]；lone：[{ name, x, y }]；here：现在在哪 */
    set(d) {
      const same = d.names.join('|') === NAMES.join('|');
      ({ names: NAMES, link: LINK, areas: AREAS, lone: LONE, here, root: ROOT, up: UP, deep: DEEP } = d); GONE = d.gone || new Set();
      if (!same) { POS = []; men.replaceChildren(...NAMES.map(n => h('button', n))); if (ctr >= NAMES.length) ctr = 0; }
      fresh = true;
    },
    tab(i) { if (i === cur) return; from = cur; cur = i; t0 = performance.now(); names.classList.toggle('on', i === 2); host.classList.toggle('map', i === 2); if (i === 2) cv.dataset.noSwipe = ''; else delete cv.dataset.noSwipe;   // 在地图上横着拖是挪地图，不是「右滑返回」
      men.classList.toggle('on', i === 1); crumb(); },
    /** 下一次摆好名字以后直接钻进这一片（往下钻一层时用） */
    zoomTo(n) { want = n; },
    /** 换一个人到正中（别的星会慢慢滑到新的位置） */
    center(i) { ctr = i; },
    resume() { if (!raf) raf = requestAnimationFrame(draw); },
    stop() { cancelAnimationFrame(raf); raf = 0; },
  };
}
