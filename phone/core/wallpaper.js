// 动态壁纸：WebGL 画底图（折射、水波、鱼影、日夜过渡、故障闪烁），2D 画布画粒子（水面闪光、解锁碎屑）。
// 锁屏和桌面共用这一层；桌面上是虚化的样子。

export const WALLPAPERS = {
  water:  { name: '水中月', day: 'water-day.jpg', night: 'water-night.jpg', aspect: 574 / 1242,
            moonDay: [0.50, 0.523], moonNight: [0.50, 0.523], noticeTop: '29.5%' },
  apple:  { name: '苹果', day: 'apple-day.jpg', night: 'apple-night.jpg', aspect: 852 / 1846,
            moonDay: [.5, .3], moonNight: [.5, .3], noticeTop: '38%' },
};
// 水中月：鱼群绕月亮转圈（圆心、横纵比、每条鱼的起始角度和半径）
const RING = { cx: 0.4796, cy: 0.5536, k: 1.378,
  fish: [[-1.077,.4912],[-2.274,.4506],[-.475,.3628],[-3.056,.3695],[2.791,.3206],[.487,.3533],[1.928,.32],[1.095,.4479]] };

const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
const FS = `
precision highp float;
uniform sampler2D uDay, uNight, uFish, uNoise;
uniform vec2 uRes; uniform float uImgAspect, uTime, uKind, uMixFrom, uMixTo, uUnlock;
uniform vec4 uCrop;   // 自己的壁纸调过位置：只用图里 (x, y, 宽, 高) 这一块
uniform vec3 uReveal; uniform vec4 uRipples[16]; uniform vec2 uMoonDay, uMoonNight; uniform vec2 uDrift; uniform float uZoom; uniform float uGlitch;
// 随机数不在 GPU 上算，查一张 64×64 的随机图（算的话手机 GPU 小数精度不够，闪光会一块一块、一片白）
float hash(vec2 p){ return texture2D(uNoise, (floor(p) + .5) / 64.).r; }
vec3 tap(sampler2D t, vec2 uv, float b){
  if (b < .0004) return texture2D(t, uv).rgb;
  vec3 c = texture2D(t, uv).rgb*.28;
  c += texture2D(t, uv+vec2(b,0.)).rgb*.18; c += texture2D(t, uv-vec2(b,0.)).rgb*.18;
  c += texture2D(t, uv+vec2(0.,b)).rgb*.18; c += texture2D(t, uv-vec2(0.,b)).rgb*.18;
  return c;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes; uv.y = 1. - uv.y;
  float sa = uRes.x / uRes.y;
  vec2 s = sa > uImgAspect ? vec2(1., uImgAspect/sa) : vec2(sa/uImgAspect, 1.);
  vec2 iuv = (uv - .5) * s + .5;
  iuv = (iuv - .5) / uZoom + .5 + uDrift;
  // 切换时的故障闪烁：一条条横块错位
  if (uGlitch > .001) {
    vec2 blk = floor(uv * vec2(5., 34.));
    float hb = hash(blk + mod(floor(uTime * 26.), 64.));
    if (hb < uGlitch * .5) iuv.x += (hash(blk * 1.7 + 3.1) - .5) * .14 * uGlitch;
  }
  vec2 off = vec2(0.), offN = vec2(0.);
  bool own = uKind > 1.5 && uKind < 2.5;
  if (uKind > 2.5) {
    // 苹果：丝绸一样慢慢起伏
    off = vec2(sin(iuv.y*5. + uTime*.22), cos(iuv.x*4. - uTime*.18)) * .0035;
    offN = off;
  } else if (own) {
    // 自己的图片 / Live 图：不加特效，原样铺满
  } else {
    off = vec2(sin(iuv.y*38. + uTime*1.1) + sin((iuv.x+iuv.y)*27. - uTime*.8),
               cos(iuv.x*33. - uTime*.9) + sin((iuv.x-iuv.y)*24. + uTime*1.3)) * .0016;
    // 水波纹：最多 16 圈同时在扩散，按住拖动时会沿着手指一路冒出来
    for (int i = 0; i < 16; i++) {
      vec4 rp = uRipples[i];
      if (rp.w > 0.) {
        vec2 pr = (iuv - rp.xy) * vec2(uImgAspect, 1.);
        float r = length(pr), age = uTime - rp.z, front = age*.3;
        if (age > 0. && age < 3.5) {
          float ring = sin((r-front)*95.) * exp(-abs(r-front)*24.) * exp(-age*1.2) * rp.w;
          off += (r > .0001 ? pr/r : vec2(0.)) * ring * .007;
        }
      }
    }
    offN = off;
  }
  vec2 tuv = clamp(iuv + off, .001, .999), tuvN = clamp(iuv + offN, .001, .999);
  if (own) { tuv = uCrop.xy + tuv * uCrop.zw; tuvN = uCrop.xy + tuvN * uCrop.zw; }
  float b = uUnlock * .007;
  vec3 cD = tap(uDay, tuv, b), cN = tap(uNight, tuvN, b);
  if (own) {   // 调图片时框超出了图片：超出的地方是黑的
    vec2 qD = step(0., tuv) * step(tuv, vec2(1.)), qN = step(0., tuvN) * step(tuvN, vec2(1.));
    cD *= qD.x * qD.y; cN *= qN.x * qN.y;
  }
  if (uGlitch > .001) {   // 色散
    vec2 ca = vec2(.007 * uGlitch, 0.);
    cD.r = texture2D(uDay, clamp(tuv + ca, .001, .999)).r; cD.b = texture2D(uDay, clamp(tuv - ca, .001, .999)).b;
    cN.r = texture2D(uNight, clamp(tuvN + ca, .001, .999)).r; cN.b = texture2D(uNight, clamp(tuvN - ca, .001, .999)).b;
  }
  float d = length((uv - uReveal.xy) * vec2(sa, 1.));
  float rev = 1. - smoothstep(uReveal.z - .14, uReveal.z, d);
  float m = mix(uMixFrom, uMixTo, rev);
  vec3 col = mix(cD, cN, m);
  if (uKind > 2.5) {
    // 苹果：一道很淡的光斜着慢慢扫过去
    float d0 = iuv.x*.8 + iuv.y*.6 - (fract(uTime*.045)*2.6 - .5);
    col += exp(-d0*d0/.018) * mix(.1, .06, m) * mix(vec3(1.), vec3(.8,.86,1.), m);
  }
  if (uKind < 1.5) {
    float fa = texture2D(uFish, clamp(iuv + off*1.5, 0., 1.)).a;
    col = mix(col, col*mix(vec3(.42,.56,.66), vec3(.28,.38,.5), m), fa * mix(.62, .88, m));
  }
  if (uKind < 1.5) {
    vec2 mp = mix(uMoonDay, uMoonNight, m);
    float md = length((iuv - mp) * vec2(uImgAspect, 1.));
    float g = exp(-md*md/.012) * (.06 + .03*sin(uTime*.6));
    col += g * mix(vec3(1.,.93,.8), vec3(.78,.84,1.), m) * .7;
    col += (hash(gl_FragCoord.xy + fract(uTime*7.)*100.) - .5) * .03;
  }
  col *= 1. + uGlitch * .18 * (hash(vec2(floor(uTime*30.), 1.)) - .3);
  gl_FragColor = vec4(col, 1.);
}`;

const rand = (a, b) => a + Math.random() * (b - a);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function sparkle(ctx, x, y, r, a, color) {
  ctx.globalAlpha = a; ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 2.2); ctx.quadraticCurveTo(x, y, x + r * 2.2, y); ctx.quadraticCurveTo(x, y, x, y + r * 2.2); ctx.quadraticCurveTo(x, y, x - r * 2.2, y); ctx.quadraticCurveTo(x, y, x, y - r * 2.2);
  ctx.fill();
  ctx.globalAlpha = a * .35; ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, 6.283); ctx.fill();
}

/** 一条鱼的身体（水中月壁纸的鱼群、连接页的字符海洋都用这一个形状） */
export function drawFishBody(ctx, x, y, ang, L, phase) {
  const N = 14, top = [], bot = [];
  const spine = u => {           // u: 0 = 鱼头，1 = 鱼尾
    const yo = L * .085 * Math.sin(phase - u * 5) * Math.pow(u, 1.5);
    return [L * (.5 - u), yo];
  };
  const width = u => u < .3 ? L * .1 * Math.sin(Math.min(1, (u + .05) / .35) * Math.PI / 2) : L * (.1 - (u - .3) * .13);
  for (let i = 0; i <= N; i++) {
    const u = i / N * .84; const [px, py] = spine(u); const [qx, qy] = spine(Math.min(1, u + .02));
    const tx = qx - px, ty = qy - py, tl = Math.hypot(tx, ty) || 1, nx = -ty / tl, ny = tx / tl, w = width(u);
    top.push([px + nx * w, py + ny * w]); bot.push([px - nx * w, py - ny * w]);
  }
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]);
  for (const p of top) ctx.lineTo(p[0], p[1]);
  const [tx0, ty0] = spine(.84), [tx1, ty1] = spine(1);
  const dx = tx1 - tx0, dy = ty1 - ty0, dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl, nx = -uy, ny = ux;
  const tail = L * .2, spread = L * .1;
  ctx.lineTo(tx0 + ux * tail + nx * spread, ty0 + uy * tail + ny * spread);
  ctx.lineTo(tx0 + ux * tail * .45, ty0 + uy * tail * .45);
  ctx.lineTo(tx0 + ux * tail - nx * spread, ty0 + uy * tail - ny * spread);
  for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
  ctx.closePath(); ctx.fill();
  // 胸鳍
  const [fx0, fy0] = spine(.3);
  ctx.beginPath(); ctx.moveTo(fx0, fy0 + L * .08); ctx.lineTo(fx0 - L * .12, fy0 + L * .16); ctx.lineTo(fx0 - L * .05, fy0 + L * .07); ctx.fill();
  ctx.beginPath(); ctx.moveTo(fx0, fy0 - L * .08); ctx.lineTo(fx0 - L * .12, fy0 - L * .16); ctx.lineTo(fx0 - L * .05, fy0 - L * .07); ctx.fill();
  ctx.restore();
}


export class Wallpaper {
  constructor({ gl: glc, fx: fxc, host, base }) {
    this.glc = glc; this.fxc = fxc; this.host = host; this.base = base;
    this.kind = 'water'; this.images = {}; this.bound = {};   // bound：哪套自带的图已经传给显卡了
    this.mix = { from: 0, to: 0, start: -10, dur: 1.1, cx: .5, cy: .2 };
    this.unlock = { from: 0, to: 0, start: -10, dur: .55 };
    this.glitchT = -10; this.ripples = new Float32Array(64); this.rIdx = 0; this.lastDrop = { t: -1, x: 0, y: 0 }; this.finger = null; this.prevFinger = null; this.startle = 0;
    this.zoom = 1.04; this.drift = [0, 0]; this.running = false; this.t0 = performance.now(); this.last = 0;
    this.glints = []; this.bursts = [];
    this.fish = RING.fish.map(([a, r]) => ({ a, r, sp: rand(.9, 1.15), ph: rand(0, 6.28), len: rand(.15, .21), wob: rand(0, 6.28) }));
    this.fx = fxc.getContext('2d');
    this.seed();
    this.frame = this.frame.bind(this);
    addEventListener('resize', () => this.resize());
    // 切回来时只有切走前本来在动才接着动：开着 App（壁纸被盖住、本来停着）时别在后面白跑，切回来会卡
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.wasRunning = this.running; this.pause(); } else if (this.wasRunning) this.resume(); });
  }
  now() { return (performance.now() - this.t0) / 1000; }
  get w() {
    if (this.kind !== 'custom') return WALLPAPERS[this.kind];
    return { aspect: this.custom.aspect, moonDay: [.5, .3], moonNight: [.5, .3], noticeTop: '38%' };
  }

  /** src：'water'，或者自己的图 { id, img, video, aspect } */
  async init(src) {
    this.useSrc(src || 'water');
    this.snap = document.createElement('canvas'); this.snap.className = 'as-layer'; this.snap.setAttribute('aria-hidden', 'true');
    Object.assign(this.snap.style, { zIndex: 0, pointerEvents: 'none', opacity: 0 }); this.glc.after(this.snap);
    this.resize();
    try { this.initGL(); } catch (e) { console.warn('[AsterPhone] WebGL 不可用，改用静态壁纸', e); this.gl = null; }
    const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = this.base + src; });
    // 只等现在要用的这套图（自己的图一张都不用等），另一套在后台慢慢读；读好时正好换到了它，就再绑一次
    const sets = {};
    for (const k of Object.keys(WALLPAPERS)) {
      const C = WALLPAPERS[k], L = ['day', 'night'].map(f => load(C[f]).then(i => { this.images[k + f] = i; }));
      sets[k] = Promise.allSettled(L).then(() => { if (this.kind === k && this.gl && !this.bound[k]) this.bind(); });
    }
    if (sets[this.kind]) await sets[this.kind];
    this.bind();
    this.resume();
  }
  initGL() {
    const gl = this.glc.getContext('webgl', { antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('no webgl');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.U = {};
    ['uDay', 'uNight', 'uFish', 'uNoise', 'uRes', 'uImgAspect', 'uTime', 'uKind', 'uMixFrom', 'uMixTo', 'uUnlock', 'uReveal', 'uRipples', 'uMoonDay', 'uMoonNight', 'uDrift', 'uZoom', 'uGlitch', 'uCrop']
      .forEach(n => { this.U[n] = gl.getUniformLocation(prog, n); });
    gl.uniform1i(this.U.uDay, 0); gl.uniform1i(this.U.uNight, 1); gl.uniform1i(this.U.uFish, 2); gl.uniform1i(this.U.uNoise, 5);
    const mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); return t; };
    this.tex = { day: mk(), night: mk(), fish: mk() };
    gl.activeTexture(gl.TEXTURE5); const nz = mk(); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 64, 64, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, crypto.getRandomValues(new Uint8Array(64 * 64))); gl.activeTexture(gl.TEXTURE0);
    this.fishCanvas = document.createElement('canvas'); this.fishCanvas.width = 512; this.fishCanvas.height = Math.round(512 / WALLPAPERS.water.aspect);
    this.fishCtx = this.fishCanvas.getContext('2d');
    gl.bindTexture(gl.TEXTURE_2D, this.tex.fish); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.fishCanvas);
    this.gl = gl;
  }
  useSrc(src) {
    this.stopVideo();
    if (typeof src === 'string') { this.kind = WALLPAPERS[src] ? src : 'water'; this.custom = null; this.srcKey = this.kind; }
    else {
      this.kind = 'custom'; this.custom = src; this.srcKey = 'custom:' + src.id + ':' + (src.crop || []).join(',');
      // 太大的图先缩一下，免得手机显卡吃不下
      const im = src.img;
      if (im && !src.still) {
        const k = Math.min(1, 2048 / Math.max(im.naturalWidth, im.naturalHeight));
        if (k < 1) { const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); src.still = c; }
        else src.still = im;
      }
      if (src.video) { src.video.onended = () => this.liveStop(); }
    }
  }
  upload(el) {
    const gl = this.gl; if (!gl || !el) return;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex.day);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el); } catch (e) { /* 视频还没准备好 */ }
  }
  bind() {
    const gl = this.gl, k = this.kind;
    this.host.style.setProperty('--notice-top', this.w.noticeTop);
    if (k === 'custom') {
      const c = this.custom;
      if (gl) this.upload(c.still || c.video);
      else this.glc.style.background = c.img ? `center / cover url("${c.img.src}")` : '#121826';
      this.seed(); this.syncLive(); return;
    }
    this.glc.style.background = '';
    if (gl && this.images[k + 'day'] && this.images[k + 'night']) {
      this.bound[k] = true;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex.day);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.images[k + 'day']);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tex.night);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.images[k + 'night']);
    } else {
      this.glc.style.background = `center / cover url("${this.base + (this.mix.to > .5 ? this.w.night : this.w.day)}")`;
    }
    this.seed();
  }
  setKind(kind) { this.setSource(kind, { glitch: true }); }
  /** 换壁纸：截一张当前画面盖在上面，换好后慢慢淡掉（交叉淡入，不闪黑） */
  setSource(src, { glitch = false } = {}) {
    const key = typeof src === 'string' ? src : 'custom:' + src.id + ':' + (src.crop || []).join(',');
    if (key === this.srcKey) return;
    if (glitch) this.glitch();
    const apply = () => { this.useSrc(src); this.bind(); };
    if (!this.gl || !this.running || !this.snap) { apply(); return; }
    this.snapReq = apply;
  }
  crossfade(fn) {
    const c = this.snap;
    c.width = this.glc.width; c.height = this.glc.height;
    try { c.getContext('2d').drawImage(this.glc, 0, 0); } catch (e) { fn(); return; }
    c.style.transition = 'none'; c.style.opacity = 1; this.fxc.style.transition = 'none'; this.fxc.style.opacity = 0;
    fn();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      c.style.transition = 'opacity 560ms ease'; c.style.opacity = 0;
      this.fxc.style.transition = 'opacity 560ms ease'; this.fxc.style.opacity = 1;
    }));
  }

  /* ---------- Live 图：按住播放 / 一直循环；亮屏时也可以自己播一次 ---------- */
  get video() { return this.kind === 'custom' && this.custom ? this.custom.video : null; }
  setLiveMode(mode) { this.liveMode = mode || 'press'; this.syncLive(); }
  syncLive() {
    const v = this.video; if (!v) return;
    v.loop = this.liveMode === 'loop';
    if (this.liveMode === 'loop') { if (this.running) v.play().catch(() => {}); }
    else if (!this.livePlaying) { v.pause(); }
  }
  livePlay() {
    const v = this.video; if (!v || this.liveMode === 'loop') return false;
    this.livePlaying = true; try { v.currentTime = 0; } catch (e) { /* 忽略 */ }
    v.play().catch(() => { this.livePlaying = false; });
    return true;
  }
  liveStop() {
    const v = this.video; if (!v || this.liveMode === 'loop' || !this.livePlaying) return;
    this.livePlaying = false; v.pause();
    const back = () => this.upload(this.custom.still || v);
    if (this.running && this.gl) this.snapReq = back; else back();
  }
  stopVideo() { const v = this.video; if (v) { v.pause(); v.onended = null; } this.livePlaying = false; }
  resize() {
    const r = this.host.getBoundingClientRect(); this.W = r.width; this.H = r.height;
    this.DPR = Math.min(devicePixelRatio || 1, 2);
    for (const c of [this.glc, this.fxc]) { c.width = Math.max(1, Math.round(this.W * this.DPR)); c.height = Math.max(1, Math.round(this.H * this.DPR)); }
    if (this.gl) this.gl.viewport(0, 0, this.glc.width, this.glc.height);
  }
  /* 日夜：origin 是圆形扩散的起点（0~1） */
  currentMix(t) { const s = this.mix, p = Math.min(1, Math.max(0, (t - s.start) / s.dur)); return p >= 1 ? s.to : s.from + (s.to - s.from) * p; }
  setNight(night, origin, instant) {
    const t = this.now(), cur = this.currentMix(t);
    Object.assign(this.mix, { from: cur, to: night ? 1 : 0, start: instant ? -10 : t });
    if (origin) { this.mix.cx = origin[0]; this.mix.cy = origin[1]; }
    if (!instant) this.glitch();
    if (!this.gl) this.bind();
  }
  unlockValue(t) { const s = this.unlock, p = Math.min(1, Math.max(0, (t - s.start) / s.dur)); return s.from + (s.to - s.from) * (1 - Math.pow(1 - p, 3)); }
  setBlur(v) { const t = this.now(); Object.assign(this.unlock, { from: this.unlockValue(t), to: v, start: t }); }
  glitch() { if (!reduceMotion) this.glitchT = this.now(); }
  glitchNow(t) { const k = (t - this.glitchT) / .55; return k < 0 || k > 1 ? 0 : Math.sin(k * Math.PI) * (1 - k * .4); }

  /** 手指按下 / 拖动 / 抬起：水面一路冒波纹、鱼躲开 */
  tap(x, y) { this.drop(x, y, 1); this.pointer(x, y); }
  drag(x, y) {
    const t = this.tt(), L = this.lastDrop;
    if (t - L.t > .06 && Math.hypot(x - L.x, y - L.y) > 14) this.drop(x, y, .6);
    this.pointer(x, y);
  }
  release() { this.finger = null; }

  drop(x, y, w) {
    const [u, v] = this.screenToImg(x, y), i = this.rIdx++ % 16;
    this.ripples.set([u, v, this.tt(), w], i * 4);
    this.lastDrop = { t: this.tt(), x, y };
    if (this.kind === 'water') this.startle = Math.max(this.startle, w);
  }
  pointer(x, y) { this.finger = this.screenToImg(x, y); }
  burst(x, y) {
    const t = this.tt(), m = this.currentMix(this.now());
    const cols = m > .5 ? ['rgb(255,190,140)', 'rgb(255,240,220)', 'rgb(200,215,255)'] : ['rgb(242,150,90)', 'rgb(255,236,200)', 'rgb(255,255,255)'];
    for (let i = 0; i < 26; i++) { const a = rand(0, 6.283), d = rand(40, 130); this.bursts.push({ x, y, vx: Math.cos(a) * d, vy: Math.sin(a) * d - 30, r: rand(1.4, 3.4), t0: t, life: rand(.6, 1.1), c: cols[i % 3] }); }
  }
  tt() { const t = this.now(); return reduceMotion ? t * .15 : t; }

  imgToScreen(u, v) {
    const a = this.w.aspect, sa = this.W / this.H, s = sa > a ? [1, a / sa] : [sa / a, 1];
    const px = (u - .5 - this.drift[0]) * this.zoom + .5, py = (v - .5 - this.drift[1]) * this.zoom + .5;
    return [((px - .5) / s[0] + .5) * this.W, ((py - .5) / s[1] + .5) * this.H];
  }
  screenToImg(x, y) {
    const a = this.w.aspect, sa = this.W / this.H, s = sa > a ? [1, a / sa] : [sa / a, 1];
    const iu = (x / this.W - .5) * s[0] + .5, iv = (y / this.H - .5) * s[1] + .5;
    return [(iu - .5) / this.zoom + .5 + this.drift[0], (iv - .5) / this.zoom + .5 + this.drift[1]];
  }
  seed() {
    this.glints = Array.from({ length: 14 }, () => ({ u: rand(.3, .7), v: rand(.45, .98), s: rand(2, 4.5), sp: rand(1.5, 3.2), ph: rand(0, 6.28) }));
  }
  pause() { this.running = false; const v = this.video; if (v) v.pause(); this.livePlaying = false; }
  resume() { if (this.running) return; this.running = true; this.last = this.now(); this.syncLive(); requestAnimationFrame(this.frame); }

  frame() {
    if (!this.running) return;
    const t = this.now(), dt = Math.min(.05, t - this.last); this.last = t;
    const tt = reduceMotion ? t * .15 : t, dd = reduceMotion ? dt * .15 : dt;
    const m = this.currentMix(t), u = this.unlockValue(t);
    this.zoom = 1.035 + .015 * Math.sin(tt * .07) + u * .07;
    this.drift = [Math.sin(tt * .05) * .006, Math.cos(tt * .043) * .006];
    const gl = this.gl;
    const custom = this.kind === 'custom';
    if (gl && (custom || this.images[this.kind + 'day'])) {
      const w = this.w, U = this.U;
      if (this.kind === 'water') this.drawFish(tt, dd);
      const v = this.video;
      if (v && !v.paused && v.readyState >= 2) this.upload(v);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex.day);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, custom ? this.tex.day : this.tex.night);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.tex.fish);
      gl.uniform2f(U.uRes, this.glc.width, this.glc.height);
      gl.uniform1f(U.uImgAspect, w.aspect); gl.uniform4fv(U.uCrop, custom && this.custom.crop ? this.custom.crop : [0, 0, 1, 1]); gl.uniform1f(U.uTime, tt); gl.uniform1f(U.uKind, custom ? 2 : this.kind === 'apple' ? 3 : 1);
      const s = this.mix, p = Math.min(1, Math.max(0, (t - s.start) / s.dur));
      gl.uniform1f(U.uMixFrom, p >= 1 ? s.to : s.from); gl.uniform1f(U.uMixTo, s.to);
      gl.uniform3f(U.uReveal, s.cx, s.cy, p >= 1 ? 3 : (1 - Math.pow(1 - p, 2)) * 1.6);
      gl.uniform1f(U.uUnlock, u);
      gl.uniform4fv(U.uRipples, this.ripples);
      gl.uniform2f(U.uMoonDay, ...w.moonDay); gl.uniform2f(U.uMoonNight, ...w.moonNight);
      gl.uniform2f(U.uDrift, ...this.drift); gl.uniform1f(U.uZoom, this.zoom);
      gl.uniform1f(U.uGlitch, this.glitchNow(t));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (this.snapReq) { const f = this.snapReq; this.snapReq = null; this.crossfade(f); }
    }
    this.drawFx(tt, dd, m, u);
    requestAnimationFrame(this.frame);
  }

  drawFish(t, dt) {
    const fc = this.fishCtx, fw = this.fishCanvas.width, fh = this.fishCanvas.height, gl = this.gl;
    fc.clearRect(0, 0, fw, fh); fc.fillStyle = 'rgba(0,0,0,1)';
    this.startle *= Math.pow(.25, dt);
    const base = (Math.PI * 2) / 80;
    for (const f of this.fish) {
      const sp = base * f.sp * (1 + this.startle * 3.5);
      f.a += sp * dt; f.ph += dt * (5 + this.startle * 14) * f.sp;
      // 手指靠近时鱼往外躲，离开后慢慢游回原来的圈
      f.rp = f.rp || 0;
      if (this.finger) {
        const x0 = RING.cx + f.r * Math.cos(f.a), y0 = RING.cy + f.r * (fw / fh) * Math.sin(f.a) / RING.k;
        const dd = Math.hypot((x0 - this.finger[0]) * WALLPAPERS.water.aspect, y0 - this.finger[1]);
        if (dd < .16) f.rp = Math.min(.12, f.rp + (.16 - dd) * dt * 2.2);
      }
      f.rp *= Math.pow(.45, dt);
      const r = f.r * (1 + .05 * Math.sin(t * .3 + f.wob)) + f.rp;
      const X = (RING.cx + r * Math.cos(f.a)) * fw, Y = RING.cy * fh + r * fw * Math.sin(f.a) / RING.k;
      const ang = Math.atan2(r * fw * Math.cos(f.a) / RING.k, -r * fw * Math.sin(f.a)) + Math.sin(f.ph * .5) * .06;
      fc.globalAlpha = .9; drawFishBody(fc, X, Y, ang, f.len * fw, f.ph);
    }
    fc.globalAlpha = 1;
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.tex.fish);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.fishCanvas);
  }

  drawFx(t, dt, m, blur) {
    const fx = this.fx, W = this.W, H = this.H;
    fx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0); fx.clearRect(0, 0, W, H);
    fx.globalCompositeOperation = 'lighter';
    const dim = 1 - blur * .6;     // 桌面上（虚化时）粒子淡一些
    if (this.kind === 'water') {
      for (const g of this.glints) {
        const tw = Math.pow(Math.max(0, Math.sin(t * g.sp + g.ph)), 6);
        if (tw < .02) { if (Math.sin(t * g.sp + g.ph) < -.98) { g.u = rand(.3, .7); g.v = rand(.45, .98); } continue; }
        const [x, y] = this.imgToScreen(g.u, g.v);
        sparkle(fx, x, y, g.s * (.5 + .5 * tw), tw * .9 * dim, m < .5 ? 'rgb(255,250,232)' : 'rgb(236,242,255)');
      }
    }
    this.bursts = this.bursts.filter(p => t - p.t0 < p.life);
    for (const p of this.bursts) {
      const k = (t - p.t0) / p.life, e = 1 - Math.pow(1 - k, 3);
      sparkle(fx, p.x + p.vx * e, p.y + p.vy * e + 30 * k * k, p.r * (1 - k * .6), (1 - k) * .95, p.c);
    }
    fx.globalAlpha = 1; fx.globalCompositeOperation = 'source-over';
  }
}
