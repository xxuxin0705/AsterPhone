// 动态壁纸：WebGL 画底图（折射、光束、花丛摆动、日夜过渡、故障闪烁），2D 画布画粒子（星星、流星、挂星、鱼、花瓣、萤火、解锁碎屑）。
// 锁屏和桌面共用这一层；桌面上是虚化的样子。

export const WALLPAPERS = {
  castle: { name: '月夜城堡', day: 'castle-day.jpg', night: 'castle-night.jpg', aspect: 852 / 1846,
            moonDay: [0.434, 0.236], moonNight: [0.44, 0.238], noticeTop: '38%',
            starsDay: 'castle-day-stars.png', starsNight: 'castle-night-stars.png' },
  water:  { name: '水中月', day: 'water-day.jpg', night: 'water-night.jpg', aspect: 574 / 1242,
            moonDay: [0.50, 0.523], moonNight: [0.50, 0.523], noticeTop: '29.5%' },
};
// 城堡的挂星：每一根线一张精灵图（黑底，叠加着画），绕线的顶端摆动
const IMG_W = 852, IMG_H = 1846;
const PEND = {
  night: [{ax:0,aw:101,ah:293,px:474,py:0,sx:424,sy:0,len:243},{ax:103,aw:61,ah:150,px:638,py:0,sx:608,sy:0,len:120},{ax:166,aw:83,ah:483,px:687,py:0,sx:646,sy:0,len:442},{ax:251,aw:59,ah:253,px:765,py:456,sx:736,sy:456,len:224},{ax:312,aw:59,ah:350,px:607,py:586,sx:578,sy:586,len:321},{ax:373,aw:35,ah:141,px:825,py:456,sx:808,sy:456,len:124}],
  day:   [{ax:0,aw:105,ah:280,px:479,py:0,sx:427,sy:0,len:228},{ax:107,aw:59,ah:142,px:639,py:0,sx:610,sy:0,len:113},{ax:168,aw:91,ah:502,px:713,py:0,sx:668,sy:0,len:457},{ax:261,aw:84,ah:513,px:813,py:0,sx:768,sy:0,len:468},{ax:347,aw:63,ah:245,px:774,py:476,sx:743,sy:476,len:214},{ax:412,aw:59,ah:196,px:612,py:596,sx:583,sy:596,len:167}]
};
for (const k in PEND) PEND[k].forEach((p, i) => { p.ph = i * 1.7 + .4; p.amp = 1; p.w = Math.sqrt(9.8 / Math.max(.12, p.len / 420)) * .55; });
let swingKick = 0;
for (const k in PEND) PEND[k].forEach((p, i) => { p.ph = i * 1.7 + .4; p.w = Math.sqrt(9.8 / Math.max(.12, p.len / 420)) * .55; });
// 水中月：鱼群绕月亮转圈（圆心、横纵比、每条鱼的起始角度和半径）
const RING = { cx: 0.4796, cy: 0.5536, k: 1.378,
  fish: [[-1.077,.4912],[-2.274,.4506],[-.475,.3628],[-3.056,.3695],[2.791,.3206],[.487,.3533],[1.928,.32],[1.095,.4479]] };

const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
const FS = `
precision highp float;
uniform sampler2D uDay, uNight, uFish;
uniform vec2 uRes; uniform float uImgAspect, uTime, uKind, uMixFrom, uMixTo, uUnlock;
uniform vec3 uReveal; uniform vec4 uRipples[16]; uniform vec3 uTouch; uniform vec2 uMoonDay, uMoonNight; uniform vec2 uDrift; uniform float uZoom; uniform float uGlitch;
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=.5; } return v; }
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
    float hb = hash(blk + floor(uTime * 26.));
    if (hb < uGlitch * .5) iuv.x += (hash(blk * 1.7 + 3.1) - .5) * .14 * uGlitch;
  }
  vec2 off = vec2(0.);
  if (uKind < .5) {
    // 花丛随风摆：最下面一大片 + 左边花丛；越靠下（越近）摆得越多；风一阵一阵的
    float wB = smoothstep(.70, .90, iuv.y);
    float wL = smoothstep(.44, .60, iuv.y) * (1. - smoothstep(.24, .40, iuv.x));
    float w = max(wB, wL) * (.45 + iuv.y * .75);
    float gust = .55 + .45 * sin(uTime * .33 + iuv.x * 2.2) * sin(uTime * .21 + 1.7);
    off.x += (sin(uTime*1.55 + iuv.y*15. + iuv.x*6.) * .0060 + sin(uTime*.72 + iuv.x*9. + iuv.y*4.) * .0038) * w * gust;
    off.y += (sin(uTime*1.2 + iuv.x*12. + iuv.y*5.) * .0024) * w * gust;
    // 手指划过：附近的花被拨开，松手后慢慢回弹
    if (uTouch.z > .001) {
      vec2 d = (iuv - uTouch.xy) * vec2(uImgAspect, 1.);
      float r = length(d);
      off += (r > .0001 ? d / r : vec2(0.)) * exp(-r*r/.0045) * .016 * uTouch.z * max(w, .25 * wB) / max(.45, w);
    }
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
  }
  vec2 tuv = clamp(iuv + off, .001, .999);
  float b = uUnlock * .007;
  vec3 cD = tap(uDay, tuv, b), cN = tap(uNight, tuv, b);
  if (uGlitch > .001) {   // 色散
    vec2 ca = vec2(.007 * uGlitch, 0.);
    cD.r = texture2D(uDay, clamp(tuv + ca, .001, .999)).r; cD.b = texture2D(uDay, clamp(tuv - ca, .001, .999)).b;
    cN.r = texture2D(uNight, clamp(tuv + ca, .001, .999)).r; cN.b = texture2D(uNight, clamp(tuv - ca, .001, .999)).b;
  }
  float d = length((uv - uReveal.xy) * vec2(sa, 1.));
  float rev = 1. - smoothstep(uReveal.z - .14, uReveal.z, d);
  float m = mix(uMixFrom, uMixTo, rev);
  vec3 col = mix(cD, cN, m);
  if (uKind > .5) {
    float fa = texture2D(uFish, clamp(iuv + off*1.5, 0., 1.)).a;
    col = mix(col, col*mix(vec3(.42,.56,.66), vec3(.28,.38,.5), m), fa * mix(.62, .88, m));
    float lum = dot(col, vec3(.3,.59,.11));
    float sh = smoothstep(.58, .95, lum);
    float n = noise(iuv*vec2(34.,90.) + vec2(uTime*.6, -uTime*.5));
    col += sh * pow(n, 4.) * .55;
  } else {
    // 云层上缓慢流动的光
    float n = fbm(iuv*vec2(2.2,3.6) + vec2(uTime*.016, uTime*.005));
    float band = smoothstep(.25,.45,iuv.y)*(1.-smoothstep(.62,.8,iuv.y));
    col = mix(col, mix(vec3(1.,1.,1.), vec3(.62,.66,.95), m), n*n*.13*band);
    // 月光光束：从月亮放射出去，缓慢扫动
    vec2 mp0 = mix(uMoonDay, uMoonNight, m);
    vec2 pr = (iuv - mp0) * vec2(uImgAspect, 1.);
    float ang = atan(pr.y, pr.x), rr = length(pr);
    float beams = pow(.5 + .5*sin(ang*7. + uTime*.13) * sin(ang*11. - uTime*.09 + 1.3), 3.);
    float beamMask = smoothstep(.07, .13, rr) * exp(-rr*3.2) * (.55 + .45*sin(uTime*.35));
    col += beams * beamMask * mix(vec3(1.,.96,.88), vec3(.72,.78,1.), m) * mix(.16, .2, m);
    // 城堡窗户的灯：暖色亮点轻轻闪
    float lum0 = dot(col, vec3(.3,.59,.11));
    float warm = smoothstep(.1, .3, col.r - col.b) * smoothstep(.45, .75, lum0);
    float cell = hash(floor(iuv*vec2(70.,150.)));
    col += col * warm * (.16*sin(uTime*(1.6 + cell*2.5) + cell*6.283) + .05*sin(uTime*13. + cell*40.));
  }
  vec2 mp = mix(uMoonDay, uMoonNight, m);
  float md = length((iuv - mp) * vec2(uImgAspect, 1.));
  float g = exp(-md*md/.012) * (.06 + .03*sin(uTime*.6));
  col += g * mix(vec3(1.,.93,.8), vec3(.78,.84,1.), m) * (uKind > .5 ? .7 : 1.);
  col += (hash(gl_FragCoord.xy + fract(uTime*7.)*100.) - .5) * (uKind > .5 ? .03 : .014);
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

function drawFishBody(ctx, x, y, ang, L, phase) {
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
    this.kind = 'castle'; this.images = {}; this.atlas = {};
    this.mix = { from: 0, to: 0, start: -10, dur: 1.1, cx: .5, cy: .2 };
    this.unlock = { from: 0, to: 0, start: -10, dur: .55 };
    this.glitchT = -10; this.ripples = new Float32Array(64); this.rIdx = 0; this.lastDrop = { t: -1, x: 0, y: 0 }; this.touch = [.5, .5, 0]; this.finger = null; this.swingKick = 0; this.startle = 0;
    this.zoom = 1.04; this.drift = [0, 0]; this.running = false; this.t0 = performance.now(); this.last = 0;
    this.stars = []; this.motes = []; this.glints = []; this.meteors = []; this.bursts = []; this.nextMeteor = 2;
    this.fish = RING.fish.map(([a, r]) => ({ a, r, sp: rand(.9, 1.15), ph: rand(0, 6.28), len: rand(.15, .21), wob: rand(0, 6.28) }));
    this.fx = fxc.getContext('2d');
    this.seed();
    this.frame = this.frame.bind(this);
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); else this.resume(); });
  }
  now() { return (performance.now() - this.t0) / 1000; }
  get w() { return WALLPAPERS[this.kind]; }

  async init(kind) {
    this.kind = kind || 'castle';
    this.resize();
    try { this.initGL(); } catch (e) { console.warn('[AsterPhone] WebGL 不可用，改用静态壁纸', e); this.gl = null; }
    const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = this.base + src; });
    const all = [];
    for (const k of Object.keys(WALLPAPERS)) for (const f of ['day', 'night']) all.push(load(WALLPAPERS[k][f]).then(i => { this.images[k + f] = i; }));
    load(WALLPAPERS.castle.starsDay).then(i => { this.atlas.day = i; }).catch(() => {});
    load(WALLPAPERS.castle.starsNight).then(i => { this.atlas.night = i; }).catch(() => {});
    await Promise.allSettled(all);
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
    ['uDay', 'uNight', 'uFish', 'uRes', 'uImgAspect', 'uTime', 'uKind', 'uMixFrom', 'uMixTo', 'uUnlock', 'uReveal', 'uRipples', 'uTouch', 'uMoonDay', 'uMoonNight', 'uDrift', 'uZoom', 'uGlitch']
      .forEach(n => { this.U[n] = gl.getUniformLocation(prog, n); });
    gl.uniform1i(this.U.uDay, 0); gl.uniform1i(this.U.uNight, 1); gl.uniform1i(this.U.uFish, 2);
    const mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); return t; };
    this.tex = { day: mk(), night: mk(), fish: mk() };
    this.fishCanvas = document.createElement('canvas'); this.fishCanvas.width = 512; this.fishCanvas.height = Math.round(512 / WALLPAPERS.water.aspect);
    this.fishCtx = this.fishCanvas.getContext('2d');
    gl.bindTexture(gl.TEXTURE_2D, this.tex.fish); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.fishCanvas);
    this.gl = gl;
  }
  bind() {
    const gl = this.gl, k = this.kind;
    this.host.style.setProperty('--notice-top', this.w.noticeTop);
    if (gl && this.images[k + 'day'] && this.images[k + 'night']) {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex.day);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.images[k + 'day']);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tex.night);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.images[k + 'night']);
    } else {
      this.glc.style.background = `center / cover url("${this.base + (this.mix.to > .5 ? this.w.night : this.w.day)}")`;
    }
    this.seed();
  }
  setKind(kind) {
    if (kind === this.kind || !WALLPAPERS[kind]) return;
    this.glitch();
    this.glc.style.opacity = 0; this.fxc.style.opacity = 0;
    setTimeout(() => { this.kind = kind; this.bind(); this.glc.style.opacity = 1; this.fxc.style.opacity = 1; }, 260);
  }
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

  /** 点画面：水面起涟漪、鱼被惊动；城堡的挂星被风吹 */
  /** 手指按下 / 拖动 / 抬起：水面一路冒波纹、鱼躲开；城堡的花被拨开、挂星被风吹 */
  tap(x, y) { this.drop(x, y, 1); this.pointer(x, y, true); this.swingKick = 1; }
  drag(x, y) {
    const t = this.tt(), L = this.lastDrop;
    if (t - L.t > .06 && Math.hypot(x - L.x, y - L.y) > 14) this.drop(x, y, .6);
    this.pointer(x, y, true); this.swingKick = Math.max(this.swingKick, .45);
  }
  release() { this.finger = null; }
  drop(x, y, w) {
    const [u, v] = this.screenToImg(x, y), i = this.rIdx++ % 16;
    this.ripples.set([u, v, this.tt(), w], i * 4);
    this.lastDrop = { t: this.tt(), x, y };
    if (this.kind === 'water') this.startle = Math.max(this.startle, w);
  }
  pointer(x, y) { const [u, v] = this.screenToImg(x, y); this.finger = [u, v]; this.touch = [u, v, 1]; }
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
    const w = WALLPAPERS.castle;
    this.stars = Array.from({ length: 34 }, () => ({ u: rand(.04, .96), v: rand(.03, .5), s: rand(1.6, 4.2), sp: rand(.6, 1.8), ph: rand(0, 6.28), warm: Math.random() < .35 }))
      .filter(s => [w.moonDay, w.moonNight].every(mp => Math.hypot((s.u - mp[0]) * w.aspect, s.v - mp[1]) > .12));
    this.motes = Array.from({ length: 24 }, () => ({ u: rand(0, 1), v: rand(.45, 1.02), r: rand(.8, 2.4), sp: rand(.006, .016), sw: rand(.4, 1.2), ph: rand(0, 6.28), rot: rand(0, 6.28), vr: rand(-1.5, 1.5) }));
    this.glints = Array.from({ length: 14 }, () => ({ u: rand(.3, .7), v: rand(.45, .98), s: rand(2, 4.5), sp: rand(1.5, 3.2), ph: rand(0, 6.28) }));
  }
  pause() { this.running = false; }
  resume() { if (this.running) return; this.running = true; this.last = this.now(); requestAnimationFrame(this.frame); }

  frame() {
    if (!this.running) return;
    const t = this.now(), dt = Math.min(.05, t - this.last); this.last = t;
    const tt = reduceMotion ? t * .15 : t, dd = reduceMotion ? dt * .15 : dt;
    const m = this.currentMix(t), u = this.unlockValue(t);
    this.zoom = 1.035 + .015 * Math.sin(tt * .07) + u * .07;
    this.drift = [Math.sin(tt * .05) * .006, Math.cos(tt * .043) * .006];
    const gl = this.gl;
    if (gl && this.images[this.kind + 'day']) {
      const w = this.w, U = this.U;
      if (this.kind === 'water') this.drawFish(tt, dd);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex.day);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tex.night);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.tex.fish);
      gl.uniform2f(U.uRes, this.glc.width, this.glc.height);
      gl.uniform1f(U.uImgAspect, w.aspect); gl.uniform1f(U.uTime, tt); gl.uniform1f(U.uKind, this.kind === 'water' ? 1 : 0);
      const s = this.mix, p = Math.min(1, Math.max(0, (t - s.start) / s.dur));
      gl.uniform1f(U.uMixFrom, p >= 1 ? s.to : s.from); gl.uniform1f(U.uMixTo, s.to);
      gl.uniform3f(U.uReveal, s.cx, s.cy, p >= 1 ? 3 : (1 - Math.pow(1 - p, 2)) * 1.6);
      gl.uniform1f(U.uUnlock, u);
      gl.uniform4fv(U.uRipples, this.ripples);
      if (!this.finger) this.touch[2] *= Math.pow(.08, dd);
      gl.uniform3f(U.uTouch, ...this.touch);
      gl.uniform2f(U.uMoonDay, ...w.moonDay); gl.uniform2f(U.uMoonNight, ...w.moonNight);
      gl.uniform2f(U.uDrift, ...this.drift); gl.uniform1f(U.uZoom, this.zoom);
      gl.uniform1f(U.uGlitch, this.glitchNow(t));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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

  drawPendulums(t, dt, m) {
    const fx = this.fx;
    this.swingKick *= Math.pow(.35, dt);
    const [ox] = this.imgToScreen(0, 0), [ex] = this.imgToScreen(1, 0), k = (ex - ox) / IMG_W;
    for (const mode of ['day', 'night']) {
      const a = mode === 'day' ? 1 - m : m, img = this.atlas[mode];
      if (a < .02 || !img) continue;
      for (const p of PEND[mode]) {
        const amp = (.022 + this.swingKick * .09) * (reduceMotion ? .2 : 1);
        const th = amp * Math.sin(t * p.w + p.ph) + amp * .35 * Math.sin(t * p.w * 2.3 + p.ph * 1.7);
        const [px, py] = this.imgToScreen(p.px / IMG_W, p.py / IMG_H);
        fx.save(); fx.globalAlpha = a; fx.translate(px, py); fx.rotate(th);
        fx.drawImage(img, p.ax, 0, p.aw, p.ah, (p.sx - p.px) * k, (p.sy - p.py) * k, p.aw * k, p.ah * k);
        fx.restore();
      }
    }
  }

  drawFx(t, dt, m, blur) {
    const fx = this.fx, W = this.W, H = this.H;
    fx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0); fx.clearRect(0, 0, W, H);
    fx.globalCompositeOperation = 'lighter';
    const dim = 1 - blur * .6;     // 桌面上（虚化时）粒子淡一些
    if (this.kind === 'castle') {
      for (const s of this.stars) {
        const tw = Math.pow(Math.max(0, Math.sin(t * s.sp + s.ph)), 3);
        const [x, y] = this.imgToScreen(s.u, s.v);
        if (blur < .5 && y < H * .27 && Math.abs(x - W / 2) < W * .36) continue;
        const col = s.warm || m < .5 ? (m < .5 ? '255,236,196' : '255,226,180') : '235,240,255';
        sparkle(fx, x, y, s.s * (.6 + .4 * tw), (.12 + .75 * tw) * (m < .5 ? .75 : 1) * dim, `rgb(${col})`);
      }
      if (blur < .9) this.drawPendulums(t, dt, m);
      for (const p of this.motes) {
        if (m < .5) {
          p.v += p.sp * dt * .45; p.u += p.sp * dt * .35; p.rot += p.vr * dt;
          if (p.v > 1.04 || p.u > 1.04) { p.v = rand(.3, .7); p.u = rand(-.1, .5); }
          const [x, y] = this.imgToScreen(p.u + Math.sin(t * p.sw + p.ph) * .012, p.v);
          fx.save(); fx.translate(x, y); fx.rotate(p.rot); fx.scale(1, .45 + .35 * Math.sin(t * 2 + p.ph));
          fx.globalAlpha = (1 - m * 2) * .7 * dim; fx.fillStyle = 'rgb(250,248,255)';
          fx.beginPath(); fx.ellipse(0, 0, p.r * 2.2, p.r * 1.2, 0, 0, 6.283); fx.fill(); fx.restore();
        } else {
          p.v -= p.sp * dt * .18; if (p.v < .5) { p.v = rand(.9, 1.02); p.u = rand(0, 1); }
          const [x, y] = this.imgToScreen(p.u + Math.sin(t * p.sw * .6 + p.ph) * .02, p.v + Math.cos(t * p.sw + p.ph) * .006);
          const pulse = .4 + .6 * Math.pow(Math.max(0, Math.sin(t * p.sw * 1.7 + p.ph)), 2);
          fx.globalAlpha = (m * 2 - 1) * pulse * .8 * Math.min(1, (p.v - .5) * 4) * dim;
          const g = fx.createRadialGradient(x, y, 0, x, y, p.r * 4);
          g.addColorStop(0, 'rgba(255,236,190,1)'); g.addColorStop(.35, 'rgba(255,220,160,.35)'); g.addColorStop(1, 'rgba(255,220,160,0)');
          fx.fillStyle = g; fx.beginPath(); fx.arc(x, y, p.r * 4, 0, 6.283); fx.fill();
        }
      }
      if (!reduceMotion && blur < .5) {
        if (t > this.nextMeteor) { this.meteors.push({ x: rand(.45, 1.05) * W, y: rand(-.02, .22) * H, t0: t, life: rand(.7, 1.1), len: rand(90, 160), v: rand(520, 760) }); this.nextMeteor = t + rand(3.5, 8); }
        this.meteors = this.meteors.filter(me => t - me.t0 < me.life);
        for (const me of this.meteors) {
          const k = (t - me.t0) / me.life, dx = -.87, dy = .5;
          const hx = me.x + dx * me.v * (t - me.t0), hy = me.y + dy * me.v * (t - me.t0);
          const a = Math.sin(k * Math.PI) * (.55 + .45 * m);
          const g = fx.createLinearGradient(hx, hy, hx - dx * me.len, hy - dy * me.len);
          g.addColorStop(0, `rgba(255,250,235,${a})`); g.addColorStop(1, 'rgba(255,250,235,0)');
          fx.globalAlpha = 1; fx.strokeStyle = g; fx.lineWidth = 1.4; fx.lineCap = 'round';
          fx.beginPath(); fx.moveTo(hx, hy); fx.lineTo(hx - dx * me.len, hy - dy * me.len); fx.stroke();
          sparkle(fx, hx, hy, 1.6, a, 'rgb(255,250,235)');
        }
      }
    } else {
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
