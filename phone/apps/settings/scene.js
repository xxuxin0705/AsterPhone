// 连接页的背景：2D 剪影风的森林山谷 + 瀑布 + 一只发光的小白鹿。
// 全部用 SVG 画，没有图片；颜色走 CSS 变量，白天是雾蓝绿的晨光，晚上是深蓝的夜色（跟着手机日夜一起换）。
const NS = 'http://www.w3.org/2000/svg';

// 小白鹿（朝左站着），以 (0,0) 为蹄子落地点
const DEER = `
<g class="pbs-deer">
  <path d="M-14 -22 C-16 -30 -10 -34 -3 -33 L13 -33 C19 -33 22 -29 21 -24 C20 -20 17 -19 15 -19 L-11 -19 C-13 -19 -14 -20 -14 -22Z"/>
  <path d="M-12 -30 L-17 -44 L-14 -46 L-8 -33Z"/>
  <path d="M-21 -51 C-24 -50 -26 -47 -24 -45 L-18 -43 C-15 -43 -13 -46 -14 -49 C-15 -51 -18 -52 -21 -51Z"/>
  <path d="M-24 -47 L-29 -45 L-27 -43 L-23 -44Z"/>
  <path d="M-15 -50 L-12 -55 L-13 -50Z M-18 -51 L-17 -55 L-16 -51Z"/>
  <path class="pbs-antler" d="M-17 -52 C-19 -58 -18 -63 -14 -67 M-18 -58 L-23 -61 M-17 -62 L-21 -67 M-15 -53 C-12 -58 -11 -62 -7 -65 M-12 -59 L-8 -59 M-11 -62 L-9 -67" fill="none" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M-11 -20 L-12 -2 L-9.5 -2 L-8 -20Z M-5 -20 L-6 -1 L-3.5 -1 L-2 -20Z M11 -20 L13 -2 L15.5 -2 L15 -20Z M16 -20 L19 -1 L21.5 -1 L19.5 -20Z"/>
  <path d="M20 -30 L25 -32 L23 -27Z"/>
</g>`;

export function buildScene() {
  const wrap = document.createElement('div');
  wrap.className = 'as-pb__scene';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `
<svg viewBox="0 0 400 860" preserveAspectRatio="xMidYMid slice" xmlns="${NS}">
  <defs>
    <linearGradient id="pbsSky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="pbs-s1"/><stop offset=".45" class="pbs-s2"/><stop offset="1" class="pbs-s3"/>
    </linearGradient>
    <radialGradient id="pbsGlow" cx=".55" cy=".22" r=".55"><stop offset="0" class="pbs-g1"/><stop offset="1" class="pbs-g0"/></radialGradient>
    <linearGradient id="pbsFall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="pbs-f1"/><stop offset=".75" class="pbs-f2"/><stop offset="1" class="pbs-f0"/>
    </linearGradient>
    <pattern id="pbsStripes" width="14" height="40" patternUnits="userSpaceOnUse">
      <rect x="2" y="0" width="2" height="22" class="pbs-stripe"/><rect x="9" y="14" width="1.5" height="18" class="pbs-stripe"/>
      <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="0 40" dur="1.4s" repeatCount="indefinite"/>
    </pattern>
    <linearGradient id="pbsShaft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="pbs-sh1"/><stop offset="1" class="pbs-sh0"/></linearGradient>
    <filter id="pbsDeerGlow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="pbsSoft"><feGaussianBlur stdDeviation="1.6"/></filter>
  </defs>
  <rect width="400" height="860" fill="url(#pbsSky)"/>
  <rect width="400" height="860" fill="url(#pbsGlow)"/>
  <!-- 远处的山崖 -->
  <path class="pbs-far" d="M0 300 C30 240 60 250 80 200 C95 165 120 175 135 140 L150 120 L160 160 C168 190 160 240 170 300 L170 520 L0 560Z"/>
  <path class="pbs-far" d="M400 280 C370 230 350 240 335 190 C325 160 300 160 290 130 L275 105 L262 150 C255 190 250 250 238 300 L238 520 L400 560Z"/>
  <!-- 瀑布 -->
  <g class="pbs-fall">
    <path d="M168 168 C176 160 226 160 234 168 L246 470 L156 470Z" fill="url(#pbsFall)"/>
    <path d="M168 168 C176 160 226 160 234 168 L246 470 L156 470Z" fill="url(#pbsStripes)"/>
    <ellipse cx="201" cy="472" rx="96" ry="22" class="pbs-mist" filter="url(#pbsSoft)"/>
  </g>
  <!-- 中景山崖和右边的石台 -->
  <path class="pbs-mid" d="M0 380 C20 360 40 330 55 300 C70 270 95 280 110 250 C125 225 140 240 150 270 C160 300 150 360 165 420 L172 600 L0 640Z"/>
  <path class="pbs-mid" d="M400 330 L400 640 L232 600 L240 420 C246 380 262 350 280 330 C298 310 318 318 336 300 C352 284 376 290 400 270Z"/>
  <path class="pbs-ledge" d="M300 168 C318 158 352 154 384 160 C394 162 400 168 400 174 L400 184 C370 182 330 184 304 180 C294 178 292 172 300 168Z"/>
  <g transform="translate(352 166) scale(.95)" filter="url(#pbsDeerGlow)">${DEER}</g>
  <!-- 光束 -->
  <g class="pbs-shafts">
    <polygon points="250,0 300,0 150,640 70,640" fill="url(#pbsShaft)"/>
    <polygon points="318,0 346,0 238,560 188,560" fill="url(#pbsShaft)"/>
    <polygon points="200,0 216,0 104,520 74,520" fill="url(#pbsShaft)"/>
  </g>
  <!-- 水面 -->
  <path class="pbs-water" d="M0 640 C80 610 320 610 400 640 L400 860 L0 860Z"/>
  <path class="pbs-glint" d="M120 660 L180 660 M220 676 L290 676 M150 700 L210 700 M250 720 L300 720" stroke-width="1.4" stroke-linecap="round"/>
  <!-- 近处的叶子和藤蔓（剪影） -->
  <g class="pbs-near">
    <path d="M0 860 L0 690 C18 700 30 720 36 748 C44 712 64 700 84 704 C70 724 64 752 66 790 C80 760 104 752 124 758 C104 778 96 812 98 860Z"/>
    <path d="M400 860 L400 700 C380 706 366 724 362 752 C352 720 330 708 310 712 C326 732 330 760 326 796 C312 768 290 762 270 768 C292 786 300 820 298 860Z"/>
    <path d="M0 0 L0 120 C8 100 18 92 32 88 C24 74 28 54 40 40 C46 58 56 64 72 66 C62 48 66 24 84 10 L88 0Z"/>
    <path d="M400 0 L400 110 C394 92 384 84 370 80 C378 68 374 48 362 36 C356 52 344 60 330 62 C340 44 336 22 318 8 L314 0Z"/>
    <path class="pbs-vine" d="M62 0 C64 40 58 70 66 110 M84 0 C82 30 90 52 86 84 M330 0 C328 36 336 64 328 98" fill="none" stroke-width="2"/>
  </g>
</svg>`;
  return wrap;
}
