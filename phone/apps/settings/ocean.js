// 连接页背景：一片字符拼成的海。
// 鱼的形状直接用主页「水中月」壁纸里那群鱼（core/wallpaper.js 的 drawFishBody），不另外画。
// 做法：把鱼画到一张很小的画布上（一格字符 = 一个像素），再按每格的深浅换成 . : o t x % S 8 # @。
// 白天：米白底、深蓝字符；夜晚：深海蓝底、发光的蓝字符。一秒只更新十来次，省电。
import { drawFishBody } from '../../core/wallpaper.js';

const CW = 7, CH = 10;                         // 一格字符的宽高
const RAMP = ['.', ':', "'", 'o', 't', 'x', ';', '%', 'S', 'X', '8', '#', '@'];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a, b) => a + Math.random() * (b - a);
const hash = (a, b) => { let n = (a * 374761393 + b * 668265263) | 0; n = (n ^ (n >>> 13)) * 1274126177; return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };

export class AsciiOcean {
  constructor(host, isNight) {
    this.host = host; this.isNight = isNight;
    this.cvs = document.createElement('canvas'); this.cvs.className = 'as-pb__ocean'; this.cvs.setAttribute('aria-hidden', 'true');
    host.prepend(this.cvs);
    this.ctx = this.cvs.getContext('2d');
    this.small = document.createElement('canvas'); this.sctx = this.small.getContext('2d', { willReadFrequently: true });
    this.fish = []; this.dash = []; this.startle = 0; this.alive = true; this.last = 0;
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }
  resize() {
    const r = this.host.getBoundingClientRect(); this.W = r.width; this.H = r.height;
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.cvs.width = Math.round(this.W * this.dpr); this.cvs.height = Math.round(this.H * this.dpr);
    this.cols = Math.ceil(this.W / CW); this.rows = Math.ceil(this.H / CH);
    this.small.width = this.cols; this.small.height = this.rows;
    if (!this.fish.length) this.seed();
  }
  seed() {
    // 小鱼：一大群小的，偶尔一条稍大一点
    const n = 9;
    this.fish = Array.from({ length: n }, (_, i) => ({
      x: rand(0, this.cols), y: rand(this.rows * .1, this.rows * .95),
      a: rand(0, Math.PI * 2), turn: rand(-.25, .25), sp: rand(1.2, 2.4), len: i === 0 ? rand(17, 20) : rand(9, 13), ph: rand(0, 6.28), shade: rand(.75, 1),
    }));
    this.dash = Array.from({ length: 46 }, () => ({ x: rand(0, this.cols), y: rand(0, this.rows), n: 1 + (Math.random() * 3 | 0), sp: rand(.05, .25), tw: rand(0, 6.28) }));
  }
  /** 线插中、拔出时惊动一下鱼 */
  kick(v = 1) { this.startle = Math.max(this.startle, v); }
  stop() { this.alive = false; }
  frame(now) {
    if (!this.alive) return;
    requestAnimationFrame(this.frame);
    if (!this.host.isConnected || this.paused) return;
    const step = reduce ? 200 : 80;               // 一秒十来次就够有「字符」味道了
    if (now - this.last < step) return;
    const dt = Math.min(.25, (now - (this.last || now)) / 1000); this.last = now;
    if (!this.W || Math.abs(this.host.getBoundingClientRect().width - this.W) > 1 || Math.abs(this.host.getBoundingClientRect().height - this.H) > 1) this.resize();
    this.startle *= Math.pow(.3, dt);
    const { cols, rows, sctx } = this;
    // 1. 鱼游动：慢慢拐弯，游出画面就从另一边回来
    sctx.clearRect(0, 0, cols, rows); sctx.fillStyle = '#000';
    for (const f of this.fish) {
      f.turn += rand(-.4, .4) * dt; f.turn = Math.max(-.35, Math.min(.35, f.turn));
      f.a += f.turn * dt;
      const sp = f.sp * (1 + this.startle * 2.5) * (reduce ? .4 : 1);
      f.x += Math.cos(f.a) * sp * dt * 3; f.y += Math.sin(f.a) * sp * dt * 2;
      f.ph += dt * (4 + this.startle * 8);
      const m = f.len;
      if (f.x < -m) f.x = cols + m; if (f.x > cols + m) f.x = -m;
      if (f.y < -m) f.y = rows + m; if (f.y > rows + m) f.y = -m;
      sctx.globalAlpha = f.shade;
      // 字符格子是竖长的（9×12），鱼要压扁一点才不会被拉长；鱼头朝着真正游的方向（drawFishBody 里鱼头在 +x）
      sctx.save(); sctx.scale(1, CW / CH); drawFishBody(sctx, f.x, f.y * CH / CW, Math.atan2(Math.sin(f.a) * 2 * CH / CW, Math.cos(f.a) * 3), m, f.ph); sctx.restore();
    }
    sctx.globalAlpha = 1;
    const px = sctx.getImageData(0, 0, cols, rows).data;
    // 2. 画字符
    const night = this.isNight(), ctx = this.ctx, tick = Math.floor(now / 240);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.W, this.H);
    ctx.font = `600 ${CH - 2}px ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const ink = night ? [150, 190, 255] : [22, 52, 120], box = night ? [90, 140, 230] : [70, 110, 190];   // 白天：深蓝小鱼
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const a = px[(y * cols + x) * 4 + 3] / 255; if (a < .06) continue;
      const cx = x * CW + CW / 2, cy = y * CH + CH / 2;
      const jit = hash(x * 31 + y, tick) < .12 ? (hash(x, y + tick) < .5 ? -1 : 1) : 0;
      const ch = RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(a * (RAMP.length - 1)) + jit))];
      if (a > .45) { ctx.fillStyle = `rgba(${box},${(night ? .16 : .14) + a * (night ? .22 : .2)})`; ctx.fillRect(cx - CW / 2 + 1, cy - CH / 2 + 1, CW - 2, CH - 2); }
      ctx.fillStyle = `rgba(${ink},${(night ? .3 : .38) + a * (night ? .65 : .6)})`; ctx.fillText(ch, cx, cy + .5);
    }
    // 3. 远处零零星星的小横线（像水里的光点），慢慢往左漂
    for (const d of this.dash) {
      d.x -= d.sp * dt * 6; d.tw += dt;
      if (d.x < -3) { d.x = cols + 2; d.y = rand(0, rows); }
      const al = (.18 + .22 * Math.sin(d.tw * 1.3)) * (night ? 1.2 : 1);
      ctx.fillStyle = `rgba(${ink},${Math.max(.05, al)})`;
      for (let i = 0; i < d.n; i++) ctx.fillText('-', (Math.floor(d.x) + i * 1.2) * CW, Math.floor(d.y) * CH + CH / 2);
    }
  }
}
