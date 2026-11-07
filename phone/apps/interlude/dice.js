// 幕间 · 十面骰：WebGL 画两颗琥珀骰子（大的十位、小的血珀个位，照作者选的参考图）。
// 点数先由规则算好，这里只负责演：抛出去、空中翻滚、落盘弹两下、停下来朝上那面刚好是那个点数。
// 十面骰是五方偏方面体：上下两个顶点，腰上十个点高低交错；一面是一个风筝形（顶点 + 腰上三个点）。
const E = .10557, FACES = [], VERTS = [];   // E：腰线高低差（顶点高 1、腰半径 1 时四点共面的解）
{
  const ring = i => { const a = i * Math.PI / 5; return [Math.cos(a), (i % 2 ? -E : E), Math.sin(a)]; };
  const sub = (a, b) => a.map((v, i) => v - b[i]), cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); }, dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  // 上面五个面写 0 2 4 6 8，下面五个写 9 7 5 3 1（对面相加是 9，和真骰子一样）
  for (let k = 0; k < 10; k++) {
    const top = k < 5, i = top ? 2 * k : 2 * (k - 5) + 1, apex = [0, top ? 1 : -1, 0], p = [ring(i), ring(i + 1), ring(i + 2)];
    let n = norm(cross(sub(p[0], apex), sub(p[1], apex)));
    const c = [apex, ...p].reduce((s, q) => s.map((v, j) => v + q[j] / 4), [0, 0, 0]); if (dot(n, c) < 0) n = n.map(x => -x);
    // 贴数字：面上的二维坐标，顶点在上、远端的腰点在下
    const u = norm(sub(p[1], apex)), v = cross(n, u), L = dot(sub(p[1], apex), u), w = Math.abs(dot(sub(p[0], apex), v));
    const uv = q => [.5 + dot(sub(q, apex), v) / (2 * w), dot(sub(q, apex), u) / L];
    const tri = (a, b, cc) => [a, b, cc].forEach(q => VERTS.push(...q, ...n, ...uv(q), k));
    if (dot(cross(sub(p[0], apex), sub(p[1], apex)), n) > 0) { tri(apex, p[0], p[1]); tri(apex, p[1], p[2]); } else { tri(apex, p[1], p[0]); tri(apex, p[2], p[1]); }
    FACES.push({ n, num: top ? 2 * k : 9 - 2 * (k - 5) });
  }
}
const VS = `attribute vec3 p; attribute vec3 n; attribute vec2 t; attribute float f; uniform mat4 M, P; uniform mat3 N; varying vec3 vn, vp; varying vec2 vt; varying float vf;
void main(){ vec4 w = M * vec4(p, 1.); vp = w.xyz; vn = normalize(N * n); vt = t; vf = f; gl_Position = P * w; }`;
const FS = `precision mediump float; uniform sampler2D A; uniform vec3 base, deep, ink; uniform float cam; varying vec3 vn, vp; varying vec2 vt; varying float vf;
void main(){ vec3 L = normalize(vec3(-.45, .7, 1.)), V = normalize(vec3(0., 0., cam) - vp), N = normalize(vn);
  float dif = max(dot(N, L), 0.), fr = pow(1. - max(dot(N, V), 0.), 2.2), sp = pow(max(dot(reflect(-L, N), V), 0.), 48.);
  vec3 col = mix(deep, base, .35 + .65 * dif) + base * .18 * (1. - fr);   // 半透明的料子：迎光处透亮，边上发深
  col = mix(col, vec3(1., .96, .85), fr * .45) + sp * .85;
  vec4 d = texture2D(A, vec2((vt.x + floor(vf + .5)) / 10., vt.y));
  gl_FragColor = vec4(mix(col, ink, d.a * .92), 1.); }`;
const SVS = 'attribute vec2 q; uniform mat4 P; uniform vec3 o; uniform float s; varying vec2 v; void main(){ v = q; gl_Position = P * vec4(o.xy + q * s, .01, 1.); }';
const SFS = 'precision mediump float; uniform float a; varying vec2 v; void main(){ gl_FragColor = vec4(0., 0., .02, a * smoothstep(1., .25, length(v))); }';

/* 四元数：[x, y, z, w] */
const qAxis = (ax, ang) => { const s = Math.sin(ang / 2), l = Math.hypot(...ax) || 1; return [ax[0] / l * s, ax[1] / l * s, ax[2] / l * s, Math.cos(ang / 2)]; };
const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
function qSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; if (d < 0) { b = b.map(x => -x); d = -d; }
  if (d > .9995) { const o = a.map((x, i) => x + (b[i] - x) * t), l = Math.hypot(...o); return o.map(x => x / l); }
  const th = Math.acos(d), s = Math.sin(th); return a.map((x, i) => (x * Math.sin((1 - t) * th) + b[i] * Math.sin(t * th)) / s);
}
/** 把物体坐标里的方向 n 转到世界的 +z（朝着镜头）的旋转 */
function qFaceUp(n) {
  const ax = [n[1], -n[0], 0], l = Math.hypot(ax[0], ax[1]);   // n × z
  return l < 1e-4 ? (n[2] > 0 ? [0, 0, 0, 1] : [1, 0, 0, 0]) : qAxis(ax, Math.acos(Math.max(-1, Math.min(1, n[2]))));
}
const mat = (q, s, o) => { const [x, y, z, w] = q, r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
  return { m: [r[0] * s, r[1] * s, r[2] * s, 0, r[3] * s, r[4] * s, r[5] * s, 0, r[6] * s, r[7] * s, r[8] * s, 0, o[0], o[1], o[2], 1], n: r }; };
const persp = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; };

/** 数字贴图：一行十格，第 i 格是第 i 个面的数；大骰子写 00～90，小的写 0～9；6 和 9 下面加一点 */
function atlas(gl, tens) {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 160; const x = c.getContext('2d');
  x.fillStyle = '#3a2410'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i < 10; i++) {
    const n = FACES[i].num, s = tens ? n * 10 + (n ? '' : '0') : String(n); x.font = `${tens ? 46 : 60}px Georgia, "Times New Roman", serif`; x.fillText(s, i * 128 + 64, 96);
    if (!tens && (n === 6 || n === 9)) x.fillRect(i * 128 + 60, 128, 8, 5);
  }
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function prog(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); gl.attachShader(p, sh); }
  gl.linkProgram(p); return p;
}
// 落盘的「嗒」：一小段带通滤波的噪声
let actx = null;
function tick(vol = .5) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const sr = actx.sampleRate, b = actx.createBuffer(1, sr * .05, sr), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * .008));
    const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain(); s.buffer = b; f.type = 'bandpass'; f.frequency.value = 1800 + Math.random() * 600; f.Q.value = 1.2; g.gain.value = vol;
    s.connect(f).connect(g).connect(actx.destination); s.start();
  } catch (e) { /* 不让响就算了 */ }
}

/** host 上铺一块画布画骰子。view = 画面竖着有几个单位高（骰子半径是 1）。返回 { ok, roll(十位, 个位) → Promise, rest(十位, 个位), dispose } */
export function diceBox(host, { view = 9 } = {}) {
  const cv = document.createElement('canvas'), gl = cv.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) return { ok: false, roll: async () => {}, rest() {}, dispose() {} };
  cv.className = 'as-int-dice'; host.append(cv);
  const P = prog(gl, VS, FS), S = prog(gl, SVS, SFS), buf = gl.createBuffer(), sbuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(VERTS), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, sbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const tex = [atlas(gl, true), atlas(gl, false)];
  const loc = n => gl.getUniformLocation(P, n), sloc = n => gl.getUniformLocation(S, n);
  // 两颗：大的蜜蜡色封着羽毛（深褐数字），小的血珀（金数字）
  const dice = [{ s: 1, base: [.95, .72, .32], deep: [.62, .36, .08], ink: [.3, .15, .04], o: [-1.25, .15, 1], q: [0, 0, 0, 1] },
    { s: .72, base: [.86, .3, .12], deep: [.5, .08, .02], ink: [.98, .8, .42], o: [1.3, -.45, .72], q: [0, 0, 0, 1] }];
  let W = 0, H = 0, proj = null, raf = 0;
  const fit = () => {
    const r = Math.min(2, devicePixelRatio || 1); W = Math.max(1, Math.round(host.clientWidth * r)); H = Math.max(1, Math.round(host.clientHeight * r));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const fov = .5, D = (view / 2) / Math.tan(fov / 2); proj = persp(fov, W / H, 1, D + 10); proj.D = D; proj.h = view; proj.w = view * W / H;
  };
  function draw() {
    fit(); gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const V = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -proj.D, 1];   // 镜头在 +z 往下看
    const mul = (a, b) => a.map((_, i) => { const r = i % 4, c = i - r; return a[r] * b[c] + a[r + 4] * b[c + 1] + a[r + 8] * b[c + 2] + a[r + 12] * b[c + 3]; });
    const PV = mul(proj, V);
    // 影子
    gl.useProgram(S); gl.depthMask(false); gl.bindBuffer(gl.ARRAY_BUFFER, sbuf); const qa = gl.getAttribLocation(S, 'q'); gl.enableVertexAttribArray(qa); gl.vertexAttribPointer(qa, 2, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(sloc('P'), false, PV);
    for (const dd of dice) { const hgt = Math.max(0, dd.o[2] - dd.s); gl.uniform3f(sloc('o'), dd.o[0] + hgt * .25, dd.o[1] - hgt * .2, 0); gl.uniform1f(sloc('s'), dd.s * 1.45 + hgt * .3); gl.uniform1f(sloc('a'), .42 / (1 + hgt * .6)); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    gl.depthMask(true);
    // 骰子
    gl.useProgram(P); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [n, size, off] of [['p', 3, 0], ['n', 3, 12], ['t', 2, 24], ['f', 1, 32]]) { const a = gl.getAttribLocation(P, n); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, size, gl.FLOAT, false, 36, off); }
    gl.uniformMatrix4fv(loc('P'), false, PV); gl.uniform1f(loc('cam'), proj.D); gl.uniform1i(loc('A'), 0); gl.activeTexture(gl.TEXTURE0);
    dice.forEach((dd, i) => {
      const { m, n } = mat(dd.q, dd.s, dd.o);
      gl.uniformMatrix4fv(loc('M'), false, m); gl.uniformMatrix3fv(loc('N'), false, n);
      gl.uniform3fv(loc('base'), dd.base); gl.uniform3fv(loc('deep'), dd.deep); gl.uniform3fv(loc('ink'), dd.ink); gl.bindTexture(gl.TEXTURE_2D, tex[i]);
      gl.drawArrays(gl.TRIANGLES, 0, VERTS.length / 9);
    });
  }
  const faceOf = num => FACES.findIndex(f => f.num === num);
  const rest = (t, u) => { dice[0].q = qMul(qAxis([0, 0, 1], .4), qFaceUp(FACES[faceOf(t)].n)); dice[1].q = qMul(qAxis([0, 0, 1], -.7), qFaceUp(FACES[faceOf(u)].n)); dice[0].o[2] = 1; dice[1].o[2] = .72; cancelAnimationFrame(raf); draw(); };
  /** 抛：从右下角飞进来，弹两下停住 */
  function roll(t, u) {
    cancelAnimationFrame(raf); fit();
    const T = 1700, t0 = performance.now(), plan = dice.map((dd, i) => {
      const end = qMul(qAxis([0, 0, 1], Math.random() * 6.28), qFaceUp(FACES[faceOf(i ? u : t)].n)), ax = [Math.random() - .5, Math.random() - .5, Math.random() - .5];
      return { dd, end, ax, spin: 9 + Math.random() * 5, q0: qAxis([1, .3, .2], Math.random() * 6), from: [proj.w * .45 + i * .9, -proj.h * .55 - i * .4], to: dd.o.slice(0, 2), delay: i * 90 };
    });
    let ticked = 0;
    return new Promise(res => {
      const step = now => {
        let busy = false;
        for (const p of plan) {
          const k = Math.min(1, Math.max(0, (now - t0 - p.delay) / T)), e = 1 - Math.pow(1 - k, 2.2); busy = busy || k < 1;
          p.dd.o[0] = p.from[0] + (p.to[0] - p.from[0]) * e; p.dd.o[1] = p.from[1] + (p.to[1] - p.from[1]) * e;
          // 高度：一个大抛物线，落地后两个小弹跳
          const z = k < .55 ? Math.sin(k / .55 * Math.PI) * 3.2 : k < .78 ? Math.sin((k - .55) / .23 * Math.PI) * .9 : k < .92 ? Math.sin((k - .78) / .14 * Math.PI) * .3 : 0;
          p.dd.o[2] = p.dd.s + z;
          const spin = qMul(qAxis(p.ax, p.spin * k * (1.4 - k * .6)), p.q0), tt = Math.min(1, Math.max(0, (k - .5) / .42));
          p.dd.q = qSlerp(spin, p.end, tt * tt * (3 - 2 * tt));
        }
        const k0 = (now - t0) / T; if ((ticked === 0 && k0 > .55) || (ticked === 1 && k0 > .78) || (ticked === 2 && k0 > .92)) { tick([.5, .3, .15][ticked]); ticked++; }
        draw();
        if (busy) raf = requestAnimationFrame(step); else res();
      };
      raf = requestAnimationFrame(step);
    });
  }
  const ro = new ResizeObserver(() => draw()); ro.observe(host);
  return { ok: true, roll, rest, dispose() { cancelAnimationFrame(raf); ro.disconnect(); cv.remove(); } };
}
