// 商业街（从旧小手机 X_XPhone 原样搬过来的）：横着滑的一条马卡龙色小街，线条干净圆润
// 街上的店：大头贴屋、一番赏、烘焙店、娃娃机（这四家现在只有样子），最右边新开了一间照相馆（做立绘）
import { h } from '../../core/util.js';
import { page, toast } from '../../core/ui.js';

/* ---------- 配色 ---------- */
const INK = '#6b4235', LIL = '#f4bdb6', LIL2 = '#d9483f', PNK = '#f8d6d0', PNK2 = '#f39aa0', MNT = '#9fd0c1', MNT2 = '#4f9483', BUT = '#fbe3a0', BUT2 = '#f4cf63', SKY = '#cfe6e4', SKY2 = '#5fa595', PCH = '#f2c9a5', CRM = '#fbf1e1', GLASS1 = '#eaf5f3', GLASS2 = '#bfdcd8'; // 奶油米白 + 草莓红 + 柔黄 + 薄荷绿（上一版的配色）
const W = 1600, H = 470, GY = 384; // GY = 人行道上沿

/* ---------- 画布元件 ---------- */
const defs = `<defs>
<linearGradient id="st-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbeee4"/><stop offset=".6" stop-color="#fcf3e8"/><stop offset="1" stop-color="#f7ead8"/></linearGradient>
<linearGradient id="st-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GLASS1}"/><stop offset="1" stop-color="${GLASS2}"/></linearGradient>
<linearGradient id="st-hood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#fdeee6"/></linearGradient>
<linearGradient id="st-scr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a3a36"/><stop offset="1" stop-color="#2e2422"/></linearGradient>
<linearGradient id="st-wall-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf1e1"/><stop offset="1" stop-color="#f2e2c8"/></linearGradient>
<linearGradient id="st-wall-m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf1e1"/><stop offset="1" stop-color="#f1e0c4"/></linearGradient>
<linearGradient id="st-wall-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9efe7"/><stop offset="1" stop-color="#bfe2d5"/></linearGradient>
<linearGradient id="st-wall-p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8cdc6"/><stop offset="1" stop-color="#f2b7ae"/></linearGradient>
<linearGradient id="st-crust" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2924a"/><stop offset=".5" stop-color="#eaa65e"/><stop offset="1" stop-color="#d98a45"/></linearGradient>
<linearGradient id="st-crumb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6e2"/><stop offset="1" stop-color="#fbe6c2"/></linearGradient>
<pattern id="st-pore" width="16" height="13" patternUnits="userSpaceOnUse"><ellipse cx="4" cy="4" rx="1.6" ry="1" fill="#efd3a2"/><ellipse cx="12" cy="10" rx="1.2" ry=".8" fill="#efd3a2"/></pattern>
<radialGradient id="st-glow"><stop offset="0" stop-color="#fff6d6" stop-opacity=".95"/><stop offset="1" stop-color="#fff6d6" stop-opacity="0"/></radialGradient>
<radialGradient id="st-glow2"><stop offset="0" stop-color="#ffffff" stop-opacity=".9"/><stop offset="1" stop-color="#fff3e0" stop-opacity="0"/></radialGradient>
<pattern id="st-stp-l" width="20" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#fff"/><rect x="10" width="10" height="10" fill="${LIL2}"/></pattern>
<pattern id="st-stp-m" width="20" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#fff"/><rect x="10" width="10" height="10" fill="${BUT2}"/></pattern>
<pattern id="st-stp-c" width="20" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#fff"/><rect x="10" width="10" height="10" fill="${MNT2}"/></pattern>
<pattern id="st-stp-p" width="20" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#fff"/><rect x="10" width="10" height="10" fill="${PNK2}"/></pattern>
<pattern id="st-dots" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="7" cy="7" r="1.6" fill="#fff" opacity=".75"/></pattern>
<pattern id="st-star" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M11 6l1.4 3.4 3.6.3-2.8 2.3.9 3.5L11 13.6 7.9 15.5l.9-3.5L6 9.7l3.6-.3z" fill="#fff" opacity=".7"/></pattern>
<pattern id="st-tile" width="36" height="18" patternUnits="userSpaceOnUse"><rect width="36" height="18" fill="#efe1c9"/><path d="M0 17.5h36M18 0v18" stroke="#dcc8a8" stroke-width="1.4"/></pattern>
<filter id="st-soft" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#a8795c" flood-opacity=".18"/></filter>
</defs>`;
const SW = 1.8;
const r = (x, y, w, h, f, rx = 0, s = INK, sw = SW) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}" ${s ? `stroke="${s}" stroke-width="${sw}"` : ''}/>`;
const ln = (d, c = INK, w = SW) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const spark = (x, y, s = 1, c = '#fff') => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -7C.8 -2 2 -.8 7 0 2 .8.8 2 0 7-.8 2-2 .8-7 0-2-.8-.8-2 0-7z" fill="${c}"/>`;
const heart = (x, y, s = 1, c = PNK2) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 4c-3-3-8-3-8 1.5S0 13 0 13s8-3 8-7.5S3 1 0 4z" fill="${c}"/>`;
// 奶油花边（屋檐下一圈像挤奶油一样的波浪）
const frost = (x, y, w, c = '#fff') => { const n = Math.max(3, Math.round(w / 18)), s = w / n; let d = `M${x} ${y}`; for (let i = 0; i < n; i++) d += ` q${s / 2} ${i % 2 ? 9 : 13} ${s} 0`; return `<path d="${d}V${y - 6}H${x}z" fill="${c}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>`; };
// 圆角条纹遮阳棚 + 下沿一排小圆弧
const awning = (x, y, w, pat, edge) => { const n = Math.round(w / 20), s = w / n; let d = `M${x} ${y + 20}`; for (let i = 0; i < n; i++) d += ` a${s / 2} ${s / 2.4} 0 0 0 ${s} 0`; return `<path d="M${x + 8} ${y}h${w - 16}q8 0 8 8v12H${x}V${y + 8}q0-8 8-8z" fill="url(#${pat})" stroke="${INK}" stroke-width="${SW}"/><path d="${d}z" fill="${edge}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>`; };
// 窗：圆顶 / 圆形 / 圆角方
const win = (x, y, w, h, kind, frame) => {
  const shine = `<path d="M${x + w * .22} ${y + h * .32}l${w * .2} -${h * .14}M${x + w * .22} ${y + h * .48}l${w * .12} -${h * .08}" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".9"/>`;
  const shape = kind == 'arch' ? `<path d="M${x} ${y + h}V${y + w / 2}a${w / 2} ${w / 2} 0 0 1 ${w} 0V${y + h}z" fill="url(#st-glass)" stroke="${frame}" stroke-width="4"/>` : kind == 'round' ? `<circle cx="${x + w / 2}" cy="${y + w / 2}" r="${w / 2}" fill="url(#st-glass)" stroke="${frame}" stroke-width="4"/>` : r(x, y, w, h, 'url(#st-glass)', 8, frame, 4);
  return shape + (kind == 'round' ? ln(`M${x + w / 2} ${y + 2}V${y + w - 2}M${x + 2} ${y + w / 2}H${x + w - 2}`, frame, 2) : ln(`M${x + w / 2} ${y + (kind == 'arch' ? 3 : 0)}V${y + h}`, frame, 2)) + shine;
};
const pots = (x, y, w, c) => { let f = r(x, y, w, 10, c, 5); for (let i = 0; i < w / 10; i++) { const cx = x + 6 + i * 10; f += `<circle cx="${cx}" cy="${y - 2}" r="4.6" fill="${MNT2}"/><circle cx="${cx + 1}" cy="${y - 5}" r="2.8" fill="${[PNK2, '#fff', BUT2, LIL2][i % 4]}"/>`; } return f; };
const tree = (x, s = 1, a = '#8fbf6c', b = '#b6da92') => `<g transform="translate(${x} ${GY}) scale(${s})"><path d="M-3 0V-62h6V0z" fill="#d9b9a3" stroke="${INK}" stroke-width="${SW}"/><circle cx="0" cy="-96" r="40" fill="${a}" stroke="${INK}" stroke-width="${SW}"/><circle cx="-12" cy="-108" r="16" fill="${b}"/><circle cx="16" cy="-84" r="5" fill="#fff" opacity=".8"/>${heart(-20, -92, .7, '#fff')}${spark(18, -116, .8)}</g>`;
const lamp = (x, c = LIL2) => `<g transform="translate(${x} ${GY})"><circle cx="0" cy="-150" r="36" fill="url(#st-glow)"/><path d="M-3 0V-136h6V0z" fill="${c}" stroke="${INK}" stroke-width="${SW}"/>${r(-10, -6, 20, 6, c, 3)}<circle cx="0" cy="-150" r="15" fill="#fff8de" stroke="${INK}" stroke-width="${SW}"/>${r(-10, -138, 20, 6, c, 3)}<path d="M-6 -165q6-8 12 0" fill="${c}" stroke="${INK}" stroke-width="${SW}"/><circle cx="-4" cy="-154" r="3" fill="#fff"/></g>`;
const bench = x => `<g transform="translate(${x} ${GY})">${r(-32, -28, 64, 8, PCH, 4)}${r(-32, -17, 64, 7, PCH, 3.5)}${ln('M-24 -10V0M24 -10V0', INK, 2.4)}</g>`;
const bunting = (x1, x2, y, sag = 24) => { let s = ln(`M${x1} ${y}Q${(x1 + x2) / 2} ${y + sag * 2} ${x2} ${y}`, INK, 1.2); const n = Math.round((x2 - x1) / 30); for (let i = 1; i < n; i++) { const t = i / n, px = x1 + (x2 - x1) * t, py = y + sag * 2 * 2 * t * (1 - t); s += `<path d="M${px - 7} ${py - 1}h14l-7 13z" fill="${[PNK, LIL, MNT, BUT, SKY][i % 5]}" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>`; } return s; };
const plate = (x, y, c = LIL2) => `<g class="st-plate" transform="translate(${x} ${y})">${ln('M-9 0l9-11 9 11', INK, 1.4)}<circle cx="0" cy="-11" r="2" fill="${c}"/>${r(-19, 0, 38, 16, '#fff', 8, INK, 1.5)}<text x="0" y="12" text-anchor="middle" class="st-hand" font-size="10.5" fill="${c}">准备中</text></g>`;
const cloud = (x, y, w, txt, fill, fg, fs) => `<g filter="url(#st-soft)"><path d="M${x + 20} ${y + 44}H${x + w - 20}A15 15 0 0 0 ${x + w - 8} ${y + 20}A17 17 0 0 0 ${x + w - 44} ${y + 6}A${w / 3} ${w / 4} 0 0 0 ${x + 44} ${y + 6}A17 17 0 0 0 ${x + 8} ${y + 20}A15 15 0 0 0 ${x + 20} ${y + 44}z" fill="${fill}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/><text x="${x + w / 2}" y="${y + 36}" text-anchor="middle" class="st-hand" font-size="${fs}" fill="${fg}">${txt}</text></g>`;

/* ---------- 大头贴机（自己画的：发光灯罩、屏幕、两侧灯条、像素小爱心、出片口，旁边一道星星帘子） ---------- */
function booth(x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})">
<circle cx="56" cy="40" r="70" fill="url(#st-glow2)"/>
<path d="M118 22h22v150h-22z" fill="none"/>${ln('M112 16H176', INK, 2.4)}<path d="M114 18c6 0 8 4 10 10l6 144h40l4-150c0-4 2-4 4-4H114z" fill="${LIL}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/><path d="M114 18c6 0 8 4 10 10l6 144h40l4-150c0-4 2-4 4-4H114z" fill="url(#st-star)"/>${ln('M140 26c-2 40 2 90 0 140M158 24c2 40-2 100 0 144', '#fff', 1.4)}
${r(0, 30, 112, 142, '#fff', 14)}
<path d="M-6 30c0-18 12-28 30-28h64c18 0 30 10 30 28z" fill="url(#st-hood)" stroke="${INK}" stroke-width="${SW}"/><path d="M8 24h96" stroke="${LIL}" stroke-width="3" stroke-linecap="round" opacity=".7"/>
${r(10, 36, 8, 66, BUT, 4, INK, 1.4)}${r(94, 36, 8, 66, BUT, 4, INK, 1.4)}
<circle cx="56" cy="42" r="4.4" fill="#4b3f6b" stroke="${INK}" stroke-width="1.2"/><circle cx="57.2" cy="40.8" r="1.2" fill="#fff"/>
${r(24, 50, 64, 46, 'url(#st-scr)', 5, INK, 1.6)}${[0, 1, 2].map(c => [0, 1].map(rr => r(30 + c * 18, 55 + rr * 19, 15, 16, [PNK, MNT, LIL, BUT, SKY, PCH][c + rr * 3], 2, null)).join('')).join('')}
${r(20, 104, 72, 14, PCH, 7, INK, 1.4)}${[0, 1, 2, 3, 4].map(i => `<circle cx="${30 + i * 13}" cy="111" r="3.2" fill="#fff" stroke="${INK}" stroke-width="1"/>`).join('')}
${[0, 1, 2, 3, 4, 5].map(i => `<path transform="translate(${15 + i * 15} 128)" d="M0 2h2V0h2v2h2V0h2v2h2v4H8v2H6v2H4V8H2V6H0z" fill="${i % 2 ? PNK2 : LIL2}"/>`).join('')}
${r(34, 146, 44, 8, '#4b3f6b', 4, INK, 1.4)}<path d="M44 150h24v10H44z" fill="#fff" stroke="${INK}" stroke-width="1.2"/>${heart(56, 150, .45, PNK2)}
<path d="M88 136c4-6 12-6 12 0s-6 8-6 8-6-2-6-8z" fill="${PNK}" stroke="${INK}" stroke-width="1.2"/>${spark(-2, 58, .9, BUT2)}${spark(116, 70, .7, '#fff')}</g>`;
}

/* ---------- 五间铺子 ---------- */
function photoShop(x) { // 大头贴机：一整台立在街边——顶上带小灯泡的招牌，左边拍照间挂着帘子（帘子底下露出两只脚），右边涂鸦台：样片、触摸屏和笔、出片口
  const w = 266, t = 118, sb = t + 50, bot = GY - 10, cx0 = x + 12, cw = 146;
  const foot = fx => `<g transform="translate(${fx} ${bot - 2})"><path d="M-7 0v-8h6v5h6a3 3 0 0 1 0 6h-12z" fill="#fff" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>${r(-7, -11, 6, 4, PNK2, 1, null)}</g>`;
  const folds = [...Array(7)].map((_, i) => ln(`M${cx0 + 10 + i * 21} ${sb + 22}q4 ${(bot - sb - 40) / 2} 0 ${bot - sb - 42}`, '#fff', 1.4)).join('');
  let hem = `M${cx0} ${bot - 18}`; for (let i = 0; i < 9; i++) hem += ` q${cw / 18} 8 ${cw / 9} 0`;
  return `<g class="st-shop" data-a="stshop" data-x="photo" filter="url(#st-soft)">
<circle cx="${x + w / 2}" cy="${t + 20}" r="110" fill="url(#st-glow2)"/>
${r(x, sb, w, bot - sb, '#fff4fa', 10)}${r(x - 4, bot - 4, w + 8, 14, LIL2, 6)}<rect x="${x - 4}" y="${bot - 2}" width="${w + 8}" height="8" fill="url(#st-stp-l)" opacity=".9"/>
<path d="M${x - 8} ${sb}V${t + 20}q0-20 20-20h${w - 24}q20 0 20 20V${sb}z" fill="${PNK}" stroke="${INK}" stroke-width="${SW}"/>
${[...Array(12)].map((_, i) => `<circle cx="${x + 12 + i * (w - 24) / 11}" cy="${t + 8}" r="3.4" fill="${i % 2 ? '#fff' : BUT2}" stroke="${INK}" stroke-width="1"/>`).join('')}
${r(x + 54, t + 16, w - 108, 30, '#fff', 15, INK, 1.6)}<text x="${x + w / 2}" y="${t + 40}" text-anchor="middle" class="st-hand" font-size="24" fill="${LIL2}">大头贴</text>${heart(x + 30, t + 22, .9)}${spark(x + w - 30, t + 32, .9, BUT2)}
<g transform="translate(${x + w / 2} ${t - 12})">${r(-18, -12, 36, 24, '#fff', 6, INK, 1.6)}<circle r="7" fill="${SKY}" stroke="${INK}" stroke-width="1.4"/><circle cx="-2" cy="-2" r="2" fill="#fff"/>${r(-14, -16, 10, 5, '#fff', 2, INK, 1.2)}</g>
${r(cx0, sb + 10, cw, 6, '#e9e1dc', 3, INK, 1.2)}
<path d="M${cx0} ${sb + 14}H${cx0 + cw}V${bot - 18}${hem.slice(hem.indexOf(' q'))}" fill="none"/><path d="M${cx0} ${sb + 14}H${cx0 + cw}V${bot - 18}H${cx0}z" fill="${PNK}" stroke="${INK}" stroke-width="${SW}"/><rect x="${cx0}" y="${sb + 14}" width="${cw}" height="${bot - sb - 32}" fill="url(#st-star)"/>${folds}
<path d="${hem}V${bot - 24}H${cx0}z" fill="#fff" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
<g transform="translate(${cx0 + cw / 2} ${sb + 70})"><path d="M0 8c-20-16-34-12-34 4S0 44 0 44s34-16 34-32-14-20-34-4z" fill="#fff" stroke="${INK}" stroke-width="1.6"/><text y="30" text-anchor="middle" class="st-hand" font-size="15" fill="${PNK2}">SMILE</text></g>
${foot(cx0 + 56)}${foot(cx0 + 78)}
${r(x + 166, sb + 12, 88, 46, '#fff', 6, INK, 1.4)}${[0, 1, 2, 3].map(i => r(x + 172 + i * 20, sb + 18, 16, 20, [PNK, MNT, BUT, SKY][i], 2, INK, 1)).join('')}${[0, 1, 2, 3].map(i => heart(x + 180 + i * 20, sb + 41, .35, [PNK2, MNT2, BUT2, SKY2][i])).join('')}
${r(x + 166, sb + 66, 88, 66, '#4b3f6b', 8, INK, 1.6)}${r(x + 172, sb + 72, 76, 50, 'url(#st-scr)', 4, INK, 1.2)}${[0, 1, 2].map(c => [0, 1].map(rr => r(x + 177 + c * 24, sb + 77 + rr * 21, 20, 18, [PNK, MNT, LIL, BUT, SKY, PCH][c + rr * 3], 2, null)).join('')).join('')}
${ln(`M${x + 252} ${sb + 112}q10 14 -2 26`, INK, 1.2)}<path d="M${x + 247} ${sb + 138}l6 -2 3 14-4 2z" fill="${BUT2}" stroke="${INK}" stroke-width="1.1"/>
${r(x + 176, sb + 146, 68, 12, '#4b3f6b', 6, INK, 1.4)}<g transform="rotate(4 ${x + 210} ${sb + 160})">${r(x + 194, sb + 151, 32, 34, '#fff', 2, INK, 1.2)}${[0, 1].map(c => [0, 1].map(rr => r(x + 197 + c * 14, sb + 154 + rr * 15, 12, 13, [PNK, SKY, BUT, MNT][c + rr * 2], 1, null)).join('')).join('')}</g>
${plate(cx0 + cw - 24, sb + 30, LIL2)}</g>`;
}
function ichibanShop(x) { // 一番赏：薄荷 + 奶油黄，屋顶一只系蝴蝶结的大礼盒，橱窗里一格一格的奖品
  const w = 280, top = 98;
  return `<g class="st-shop" data-a="stshop" data-x="ichiban" filter="url(#st-soft)">
${r(x + 6, top, w - 12, GY - top, 'url(#st-wall-m)', 0)}<rect x="${x + 6}" y="${top}" width="${w - 12}" height="${GY - top}" fill="url(#st-dots)"/>
${r(x - 6, top - 14, w + 12, 18, MNT, 9)}${frost(x - 6, top + 4, w + 12, '#fff')}
<g transform="translate(${x + w / 2} ${top - 18})">${r(-40, -50, 80, 50, PNK, 6)}${r(-46, -62, 92, 16, PNK2, 6)}${r(-8, -62, 16, 62, LIL, 0)}<path d="M0 -62c-10-18-30-16-26-4 2 6 14 6 26 4zM0 -62c10-18 30-16 26-4-2 6-14 6-26 4z" fill="${LIL}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>${spark(-28, -30, .8)}${spark(30, -20, .6)}</g>
${win(x + 30, top + 22, 50, 62, 'box', MNT2)}${win(x + w / 2 - 25, top + 22, 50, 62, 'arch', MNT2)}${win(x + w - 80, top + 22, 50, 62, 'box', MNT2)}
${r(x + 40, top + 100, w - 80, 40, '#fff', 20, INK, SW)}<text x="${x + w / 2}" y="${top + 129}" text-anchor="middle" class="st-hand" font-size="27" fill="${MNT2}">一番赏</text>${spark(x + 58, top + 120, .9, BUT2)}${spark(x + w - 58, top + 120, .9, PNK2)}
${r(x, GY - 132, w, 132, '#e2625a', 0)}${r(x, GY - 22, w, 22, '#b8372f', 0)}
${r(x + 16, GY - 112, 160, 92, 'url(#st-glass)', 10, MNT2, 4)}${[0, 1].map(rw => [0, 1, 2, 3].map(c => { const bx = x + 26 + c * 37, by = GY - 104 + rw * 42, col = [PNK, LIL, MNT, SKY][(c + rw) % 4]; return r(bx, by + 6, 30, 30, col, 6, INK, 1.4) + `<text x="${bx + 15}" y="${by + 27}" text-anchor="middle" font-size="13" fill="#fff" class="st-hand">${'ABCDEFGH'[rw * 4 + c]}</text>`; }).join('')).join('')}${ln(`M${x + 18} ${GY - 64}h156`, MNT2, 2.4)}
${r(x + 192, GY - 116, 70, 116, MNT, 14, INK, SW)}${r(x + 202, GY - 104, 50, 44, 'url(#st-glass)', 10, MNT2, 2)}<circle cx="${x + 250}" cy="${GY - 52}" r="3.4" fill="${BUT2}" stroke="${INK}" stroke-width="1.2"/>
${awning(x - 6, GY - 150, w + 12, 'st-stp-m', '#fff')}${plate(x + 227, GY - 42, MNT2)}</g>`;
}
function sweetShop(x) { // 烘焙店：整栋房子是一片竖着的大吐司——金黄的面包边包着奶白的芯，顶上鼓成蘑菇头、搭着一小块化开的黄油；
  // 芯里挖出一个拱形店面：薄荷条纹棚、木架上摆满面包、玻璃柜台；门口一篮法棍、一张小圆桌
  const w = 236, top = 118, sh = top + 96, CR = '#eaa65e', CR2 = '#c97a33', WD = '#d9a777';
  const toast = d => `M${x} ${GY}V${sh}C${x - 16 + d} ${sh - 4} ${x - 24 + d} ${top + 50} ${x + 14} ${top + 22 + d}C${x + 54} ${top - 6 + d} ${x + w - 54} ${top - 6 + d} ${x + w - 14} ${top + 22 + d}C${x + w + 24 - d} ${top + 50} ${x + w + 16 - d} ${sh - 4} ${x + w} ${sh}V${GY}z`;
  const inset = (() => { const d = 12, X = x + d, Wd = w - 2 * d, T = top + d, S = sh + 2; return `M${X} ${GY}V${S}C${X - 12} ${S - 4} ${X - 18} ${T + 46} ${X + 12} ${T + 20}C${X + 48} ${T - 4} ${X + Wd - 48} ${T - 4} ${X + Wd - 12} ${T + 20}C${X + Wd + 18} ${T + 46} ${X + Wd + 12} ${S - 4} ${X + Wd} ${S}V${GY}z`; })();
  const bun = (cx, cy, s = 1) => `<g transform="translate(${cx} ${cy}) scale(${s})"><path d="M-11 3a11 10 0 0 1 22 0z" fill="${CR}" stroke="${INK}" stroke-width="1.3"/><path d="M-6 -3q6-4 12 0" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".6"/></g>`;
  const loaf = (cx, cy, s = 1) => `<g transform="translate(${cx} ${cy}) scale(${s})"><path d="M-15 6V-3q0-9 15-9t15 9v9z" fill="${CR}" stroke="${INK}" stroke-width="1.4"/>${ln('M-8 -6l3 4M-1 -8l3 4M6 -6l3 4', CR2, 1.4)}</g>`;
  const bag = (cx, cy, a) => `<g transform="translate(${cx} ${cy}) rotate(${a})"><rect x="-4.5" y="-30" width="9" height="40" rx="4.5" fill="${CR}" stroke="${INK}" stroke-width="1.3"/>${ln('M-2 -22l4 -3M-2 -12l4 -3M-2 -2l4 -3', CR2, 1.3)}</g>`;
  const ax = x + 30, aw = w - 60, at = GY - 150;
  return `<g class="st-shop" data-a="stshop" data-x="sweet" filter="url(#st-soft)">
<path d="${toast(0)}" fill="url(#st-crust)" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>
<path d="${inset}" fill="url(#st-crumb)" stroke="${CR2}" stroke-width="1.4" stroke-linejoin="round"/><path d="${inset}" fill="url(#st-pore)"/>
${ln(`M${x + 40} ${top + 12}q30 -10 60 -6`, '#fff', 3)}
<g transform="translate(${x + w - 74} ${top + 4}) rotate(7)"><path d="M-6 4v8q0 6 4 6t4-6v-8z" fill="#ffeb8a" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>${r(-18, -10, 36, 15, '#fff3b0', 4, INK, 1.5)}<path d="M-18 1h36" stroke="#f5dc7a" stroke-width="3"/>${ln('M-11 -5h12', '#fff', 2)}</g>
<g transform="translate(${x + w / 2} ${top + 60})">${r(-58, -17, 116, 34, '#fff', 17, SKY2, 2.4)}<text y="8" text-anchor="middle" class="st-hand" font-size="22" fill="${SKY2}">烘焙店</text>${spark(-68, -12, .8, BUT2)}${heart(64, -18, .6)}</g>
<path d="M${ax} ${GY}V${at + aw / 2}a${aw / 2} ${aw / 2} 0 0 1 ${aw} 0V${GY}z" fill="#f6dcc0" stroke="${INK}" stroke-width="${SW}"/>
${r(ax + 12, at + 58, aw - 24, 6, WD, 3, INK, 1.2)}${r(ax + 12, at + 88, aw - 24, 6, WD, 3, INK, 1.2)}
${loaf(ax + 30, at + 52, .8)}${bun(ax + 56, at + 54)}${bun(ax + 78, at + 54)}${loaf(ax + 104, at + 52, .8)}${bun(ax + 130, at + 54, .9)}
${bun(ax + 26, at + 84, .9)}${loaf(ax + 52, at + 82, .75)}${bun(ax + 80, at + 84)}${bun(ax + 102, at + 84, .9)}${loaf(ax + 128, at + 82, .75)}
${r(ax + 8, GY - 46, aw - 16, 46, WD, 4, INK, SW)}${r(ax + 14, GY - 62, aw - 28, 18, 'url(#st-glass)', 4, INK, 1.4)}${bun(ax + 40, GY - 50, .7)}${loaf(ax + aw / 2, GY - 50, .6)}${bun(ax + aw - 40, GY - 50, .7)}${ln(`M${ax + 20} ${GY - 22}h${aw - 40}`, '#c08955', 1.4)}
${awning(ax - 10, at + 8, aw + 20, 'st-stp-c', '#fff')}
<g transform="translate(${x + w - 6} ${GY})">${bag(-8, -12, -12)}${bag(0, -14, -2)}${bag(8, -12, 10)}<path d="M-16 -18h32l-4 18h-24z" fill="#e8c38f" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>${ln('M-14 -12h28M-13 -6h26', '#c99a62', 1.2)}</g>
<g transform="translate(${x + 6} ${GY + 2})">${r(-22, -30, 44, 6, '#fff', 3)}${ln('M0 -24V0M-11 0h22', INK, 2)}<path d="M-5 -42h10v10h-10z" fill="#fff" stroke="${INK}" stroke-width="1.2"/>${heart(0, -48, .45)}</g>${plate(ax + aw - 14, at + aw / 2 + 4, SKY2)}</g>`;
}
function clawShop(x) { // 娃娃机：一整台大娃娃机立在街边——顶上一圈小灯泡的招牌，大玻璃箱里吊着三爪钩、底下堆满玩偶，前面操作台有摇杆和按钮，下面出货口
  const w = 172, t = 86, gy = t + 52, gb = gy + 138, cp = gb + 24;
  // 玩偶（自己画的，圆头圆脑）：小熊、垂耳小狗、兔兔、小黄鸡、顶橘子的水豚、小青蛙
  const eye = (dx, dy = 0) => `<circle cx="${dx}" cy="${dy}" r="1.9" fill="${INK}"/><circle cx="${dx + .6}" cy="${dy - .7}" r=".6" fill="#fff"/>`;
  const face = (dy = 0) => `${eye(-5, dy)}${eye(5, dy)}<ellipse cx="-9" cy="${dy + 5}" rx="2.8" ry="1.8" fill="${PNK2}" opacity=".55"/><ellipse cx="9" cy="${dy + 5}" rx="2.8" ry="1.8" fill="${PNK2}" opacity=".55"/>`;
  const bod = (c, dy = 15) => `<ellipse cx="0" cy="${dy}" rx="11" ry="8" fill="${c}" stroke="${INK}" stroke-width="1.3"/><circle cx="-6" cy="${dy + 6}" r="3" fill="${c}" stroke="${INK}" stroke-width="1.1"/><circle cx="6" cy="${dy + 6}" r="3" fill="${c}" stroke="${INK}" stroke-width="1.1"/>`;
  const S2 = 'stroke="' + INK + '" stroke-width="1.4"';
  const P = {
    bear: `${bod('#e3b48a')}<circle cx="-10" cy="-10" r="5.5" fill="#e3b48a" ${S2}/><circle cx="10" cy="-10" r="5.5" fill="#e3b48a" ${S2}/><circle cx="-10" cy="-10" r="2.6" fill="#fbe9d4"/><circle cx="10" cy="-10" r="2.6" fill="#fbe9d4"/><circle r="14" fill="#e3b48a" ${S2}/><ellipse cy="5" rx="6.5" ry="4.8" fill="#fbe9d4"/><ellipse cy="3" rx="2" ry="1.4" fill="${INK}"/>${face(-1)}`,
    pup: `${bod('#fffaf2')}<circle r="14" fill="#fffaf2" ${S2}/><ellipse cx="-12.5" cy="1" rx="5" ry="9.5" transform="rotate(16 -12.5 1)" fill="#c99a72" ${S2}/><ellipse cx="12.5" cy="1" rx="5" ry="9.5" transform="rotate(-16 12.5 1)" fill="#c99a72" ${S2}/><ellipse cx="4" cy="-4" rx="4" ry="3.4" fill="#f1dcc6"/><ellipse cy="4" rx="2.4" ry="1.7" fill="${INK}"/>${face(-1)}`,
    bun: `${bod('#fbd5da')}<ellipse cx="-5.5" cy="-19" rx="4.6" ry="11" fill="#fbd5da" ${S2}/><ellipse cx="5.5" cy="-19" rx="4.6" ry="11" fill="#fbd5da" ${S2}/><ellipse cx="-5.5" cy="-18" rx="2" ry="7" fill="${PNK2}" opacity=".5"/><ellipse cx="5.5" cy="-18" rx="2" ry="7" fill="${PNK2}" opacity=".5"/><circle r="13.5" fill="#fbd5da" ${S2}/><path d="M-2.4 4q1.2 1.8 2.4 0q1.2 1.8 2.4 0" fill="none" stroke="${INK}" stroke-width="1"/>${face(-1)}`,
    chick: `<circle r="15" fill="#fde58a" ${S2}/><path d="M-2 -15q-2-7 2-6 2-5 4 1" fill="#fde58a" ${S2}/><ellipse cx="-14" cy="5" rx="4" ry="6" transform="rotate(25 -14 5)" fill="#f8d35e" ${S2}/><ellipse cx="14" cy="5" rx="4" ry="6" transform="rotate(-25 14 5)" fill="#f8d35e" ${S2}/><path d="M-3 3l3-2.6 3 2.6-3 2.6z" fill="#f4a74b" stroke="${INK}" stroke-width="1"/>${face(-3)}`,
    capy: `${bod('#c99a6b', 14)}<circle cx="-10" cy="-9" r="3.5" fill="#b5835a" ${S2}/><circle cx="10" cy="-9" r="3.5" fill="#b5835a" ${S2}/><ellipse rx="15" ry="12.5" fill="#c99a6b" ${S2}/><ellipse cy="5" rx="9.5" ry="6.5" fill="#b5835a"/><circle cx="-2.5" cy="3.5" r="1" fill="${INK}"/><circle cx="2.5" cy="3.5" r="1" fill="${INK}"/><circle cy="-15" r="5" fill="#f4a74b" ${S2}/><path d="M1 -20q4-3 6 0-3 2-6 0z" fill="#8fbf6c"/>${eye(-6, -3)}${eye(6, -3)}`,
    frog: `${bod('#a8d68a', 13)}<circle cx="-7" cy="-10" r="6" fill="#a8d68a" ${S2}/><circle cx="7" cy="-10" r="6" fill="#a8d68a" ${S2}/><ellipse rx="15" ry="11.5" fill="#a8d68a" ${S2}/><path d="M-4 3q4 3 8 0" fill="none" stroke="${INK}" stroke-width="1.1"/>${eye(-7, -10)}${eye(7, -10)}<ellipse cx="-9" cy="2" rx="2.8" ry="1.8" fill="${PNK2}" opacity=".55"/><ellipse cx="9" cy="2" rx="2.8" ry="1.8" fill="${PNK2}" opacity=".55"/>`,
  };
  const toy = (k, cx, cy, s = 1, rot = 0) => `<g transform="translate(${cx} ${cy}) rotate(${rot}) scale(${s})">${P[k]}</g>`;
  const bulbs = (n, y0, y1, xx) => [...Array(n)].map((_, i) => `<circle cx="${xx}" cy="${y0 + (y1 - y0) * i / (n - 1)}" r="3.4" fill="${i % 2 ? '#fff' : BUT2}" stroke="${INK}" stroke-width="1"/>`).join('');
  return `<g class="st-shop" data-a="stshop" data-x="claw" filter="url(#st-soft)">
<circle cx="${x + w / 2}" cy="${t + 20}" r="90" fill="url(#st-glow2)"/>
<path d="M${x} ${gy}V${t + 22}q0-22 22-22h${w - 44}q22 0 22 22V${gy}z" fill="${PNK2}" stroke="${INK}" stroke-width="${SW}"/>
${[...Array(9)].map((_, i) => `<circle cx="${x + 20 + i * (w - 40) / 8}" cy="${t + 9}" r="3.4" fill="${i % 2 ? '#fff' : BUT2}" stroke="${INK}" stroke-width="1"/>`).join('')}${bulbs(4, t + 20, gy - 8, x + 9)}${bulbs(4, t + 20, gy - 8, x + w - 9)}
${r(x + 22, t + 16, w - 44, 30, '#fff', 15, INK, 1.6)}<text x="${x + w / 2}" y="${t + 39}" text-anchor="middle" class="st-hand" font-size="22" fill="${PNK2}">娃娃机</text>${heart(x + 34, t + 24, .5, PNK2)}${spark(x + w - 34, t + 31, .6, BUT2)}
${r(x, gy, w, gb - gy, PNK, 0)}${r(x + 12, gy + 4, w - 24, gb - gy - 8, 'url(#st-glass)', 4, INK, 1.6)}
${r(x + 14, gy + 8, w - 28, 7, '#e9e1dc', 3, INK, 1.2)}${r(x + 64, gy + 5, 26, 13, LIL, 3, INK, 1.2)}${ln(`M${x + 77} ${gy + 18}V${gy + 62}`, INK, 1.4)}
<g transform="translate(${x + 77} ${gy + 62})"><path d="M-9 0h18l-3 9h-12z" fill="${BUT2}" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>${ln('M-6 8c-9 6-11 15-6 22M6 8c9 6 11 15 6 22M0 9v19', INK, 2.4)}${ln('M-12 30l4 1M12 30l-4 1', INK, 2.4)}</g>
${toy('frog', x + 92, gb - 46, .82, 8)}${toy('chick', x + 34, gb - 48, .85, -10)}${toy('capy', x + 64, gb - 50, .85, 4)}${toy('pup', x + 32, gb - 22, .95, -6)}${toy('bear', x + 62, gb - 20, .95)}${toy('bun', x + 92, gb - 20, .92, 8)}
${r(x + w - 52, gy + 74, 38, gb - gy - 78, '#ffffff', 2, INK, 1.4)}<rect x="${x + w - 52}" y="${gy + 74}" width="38" height="${gb - gy - 78}" fill="url(#st-glass)" opacity=".6"/>${ln(`M${x + w - 52} ${gy + 74}h38`, INK, 2.2)}
${ln(`M${x + 22} ${gy + 30}l18 -12M${x + 22} ${gy + 44}l10 -7`, '#fff', 3)}
<path d="M${x - 8} ${cp}l8 -${cp - gb}h${w}l8 ${cp - gb}z" fill="${BUT}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>
${ln(`M${x + 36} ${gb + 14}l-4 -16`, INK, 3)}<circle cx="${x + 31}" cy="${gb - 4}" r="7" fill="${LIL2}" stroke="${INK}" stroke-width="1.4"/><circle cx="${x + 29}" cy="${gb - 6}" r="2" fill="#fff"/><ellipse cx="${x + 37}" cy="${gb + 15}" rx="9" ry="3.5" fill="#4b3f6b" stroke="${INK}" stroke-width="1.2"/>
<ellipse cx="${x + 104}" cy="${gb + 12}" rx="13" ry="6" fill="${MNT2}" stroke="${INK}" stroke-width="1.4"/><ellipse cx="${x + 104}" cy="${gb + 9}" rx="13" ry="6" fill="${MNT}" stroke="${INK}" stroke-width="1.4"/><ellipse cx="${x + 136}" cy="${gb + 13}" rx="7" ry="3.4" fill="${PNK2}" stroke="${INK}" stroke-width="1.2"/>
${r(x + 4, cp, w - 8, GY - 8 - cp, PNK, 0)}<rect x="${x + 4}" y="${cp + 8}" width="${w - 8}" height="10" fill="url(#st-stp-p)"/>${ln(`M${x + 4} ${cp + 8}h${w - 8}M${x + 4} ${cp + 18}h${w - 8}`, INK, 1.2)}
${r(x + 18, cp + 30, 30, 40, '#fff', 6, INK, 1.4)}${r(x + 30, cp + 38, 6, 16, '#4b3f6b', 3, null)}<text x="${x + 33}" y="${cp + 65}" text-anchor="middle" font-size="9" fill="${PNK2}" class="st-hand">¥1</text>
${r(x + w - 72, cp + 28, 54, 42, '#4b3f6b', 8, INK, 1.6)}${r(x + w - 68, cp + 32, 46, 24, LIL, 6, INK, 1.2)}<text x="${x + w - 45}" y="${cp + 49}" text-anchor="middle" font-size="11" fill="#fff" class="st-hand">PUSH</text>
${r(x + 10, GY - 8, 20, 8, INK, 2, null)}${r(x + w - 30, GY - 8, 20, 8, INK, 2, null)}${plate(x + 74, cp + 36, PNK2)}</g>`;
}

function studioShop(x) { // 照相馆：婴儿蓝墙、奶油花边屋檐，屋顶立着一台大相机，圆顶橱窗里挂一张立绘相框，门口薄荷条纹遮阳棚
  const w = 240, top = 128;
  return `<g class="st-shop" data-a="stshop" data-x="studio" filter="url(#st-soft)">
${r(x + 6, top, w - 12, GY - top, 'url(#st-wall-b)', 0)}<rect x="${x + 6}" y="${top}" width="${w - 12}" height="${GY - top}" fill="url(#st-star)"/>
${r(x - 6, top - 14, w + 12, 18, SKY, 9)}${frost(x - 6, top + 4, w + 12, '#fff')}
<g transform="translate(${x + w / 2} ${top - 16})">${r(-46, -50, 92, 50, '#fff', 12)}${r(-30, -60, 26, 12, PNK, 4)}<circle cx="0" cy="-25" r="18" fill="${SKY}" stroke="${INK}" stroke-width="${SW}"/><circle cx="0" cy="-25" r="10" fill="url(#st-scr)" stroke="${INK}" stroke-width="1.4"/><circle cx="-3" cy="-28" r="3" fill="#fff" opacity=".85"/><circle cx="33" cy="-38" r="4" fill="${BUT2}" stroke="${INK}" stroke-width="1.2"/>${spark(-56, -44, .8, BUT2)}${spark(56, -10, .7, PNK2)}</g>
${r(x + 36, top + 20, w - 72, 36, '#fff', 18, INK, SW)}<text x="${x + w / 2}" y="${top + 46}" text-anchor="middle" class="st-hand" font-size="25" fill="${SKY2}">照相馆</text>${spark(x + 52, top + 38, .8, PNK2)}${spark(x + w - 52, top + 38, .8, BUT2)}
${win(x + 22, GY - 150, 92, 120, 'arch', SKY2)}<g transform="rotate(-4 ${x + 68} ${GY - 76})">${r(x + 46, GY - 108, 44, 56, '#fff', 3, INK, 1.4)}${r(x + 50, GY - 104, 36, 40, PNK, 2, null)}<circle cx="${x + 68}" cy="${GY - 88}" r="8" fill="#fff" stroke="${INK}" stroke-width="1.3"/><path d="M${x + 56} ${GY - 64}q12-14 24 0" fill="#fff" stroke="${INK}" stroke-width="1.3"/></g>
${r(x + 140, GY - 120, 76, 120, MNT, 14, INK, SW)}${r(x + 150, GY - 108, 56, 48, 'url(#st-glass)', 10, MNT2, 2)}<circle cx="${x + 200}" cy="${GY - 54}" r="3.4" fill="${BUT2}" stroke="${INK}" stroke-width="1.2"/>
${awning(x - 6, GY - 172, w + 12, 'st-stp-c', '#fff')}${heart(x + 178, GY - 140, .8, PNK2)}</g>`;
}
/* ---------- 整条街 ---------- */
const far = () => { let f = ''; [0, 110, 230, 350, 470, 600, 730, 860, 990, 1120, 1250, 1380, 1500].forEach((x, i) => { const h = 150 + (i * 53 % 90), w = 86 + (i * 37 % 50), top = GY - h - 60; f += `<path d="M${x} ${GY}V${top + 16}q0-16 16-16h${w - 32}q16 0 16 16V${GY}z" fill="${['#f1dfd3', '#eadfcf', '#ece2d8', '#f3e3dc'][i % 4]}"/>${[...Array(Math.floor(h / 42))].map((_, k) => `<rect x="${x + 14}" y="${top + 24 + k * 42}" width="14" height="18" rx="7" fill="#fff" opacity=".7"/><rect x="${x + w - 28}" y="${top + 24 + k * 42}" width="14" height="18" rx="7" fill="#fff" opacity=".7"/>`).join('')}`; }); return f; };
const clouds = () => [[160, 66, 1], [640, 42, .8], [1080, 78, 1.1], [1440, 40, .75]].map(([x, y, s]) => `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="46" ry="15" fill="#fff"/><ellipse cx="20" cy="-10" rx="25" ry="16" fill="#fff"/><ellipse cx="-18" cy="-6" rx="19" ry="12" fill="#fff"/></g>`).join('');
const sparks = () => [[80, 120], [300, 40], [520, 150], [760, 60], [980, 120], [1200, 30], [1350, 140], [1560, 90]].map(([x, y], i) => spark(x, y, .7 + (i % 3) * .2, i % 2 ? '#fff' : BUT)).join('');
export function scene() {
  return `<svg class="st-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${defs}
<rect width="${W}" height="${H}" fill="url(#st-sky)"/>${sparks()}${clouds()}<g opacity=".9">${far()}</g>
<rect x="0" y="${GY}" width="${W}" height="42" fill="url(#st-tile)"/><path d="M0 ${GY}H${W}" stroke="#d2bb98" stroke-width="2"/><rect x="0" y="${GY + 42}" width="${W}" height="10" fill="#e3cfae"/><rect x="0" y="${GY + 52}" width="${W}" height="${H - GY - 52}" fill="#d9c8b0"/>${[...Array(16)].map((_, i) => `<rect x="${30 + i * 100}" y="${GY + 64}" width="44" height="5" rx="2.5" fill="#fff" opacity=".85"/>`).join('')}
${tree(46, .85)}${photoShop(96)}${lamp(386)}${bunting(96, 390, 210)}${ichibanShop(420)}${tree(728, .95, '#a9d283', '#c9e4ad')}${bench(730)}${sweetShop(776)}${lamp(1028, SKY2)}${clawShop(1066)}${tree(1260, .8, '#9fca78', '#c3e0a5')}${bunting(1270, 1560, 252, 18)}${studioShop(1320)}
</svg>`;
}

/* ---------- 页面 ---------- */
const SHOPS = [['photo', '大头贴', '拍拍屋'], ['ichiban', '一番赏', '抽抽乐'], ['sweet', '烘焙店', '刚出炉'], ['claw', '娃娃机', '抓一只'], ['studio', '照相馆', '做立绘']];
const POS = { photo: 96 + 135, ichiban: 420 + 140, sweet: 776 + 115, claw: 1066 + 86, studio: 1320 + 120 };
const coin = `<svg viewBox="0 0 20 20" width="15" height="15"><circle cx="10" cy="10" r="8.5" fill="${BUT}" stroke="${INK}" stroke-width="1.4"/>${spark(10, 10, .75, '#fff')}</svg>`;
const body = () => `<div class="street">
<div class="st-top"><div class="st-title"><b class="st-hand">商业街</b><small>SHOPPING STREET · 慢慢逛</small></div><div class="st-chips"><span>${coin}1,250</span><span><i>♥</i>12</span></div></div>
<p class="st-slogan st-hand">美好的事，在这条街上悄悄发生</p>
<div class="st-stage" data-no-swipe><div class="st-scroll">${scene()}</div><i class="st-heart h1">♥</i><i class="st-heart h2">✦</i><i class="st-heart h3">♥</i><i class="st-heart h4">✦</i></div>
<section class="st-cards"><div class="st-new" data-a="stgo" data-x="photo"><div><small>今日上新</small><b class="st-hand">情侣头像 · 剧情合照</b><em>去拍一张 →</em></div><svg viewBox="0 0 120 80" width="112" height="76"><g transform="rotate(-8 40 40)">${r(14, 10, 44, 54, '#fff', 4)}${r(19, 15, 34, 34, PNK, 2, null)}<circle cx="36" cy="30" r="8" fill="#fff" stroke="${INK}" stroke-width="1.3"/></g><g transform="rotate(9 84 40)">${r(62, 12, 44, 54, '#fff', 4)}${r(67, 17, 34, 34, LIL, 2, null)}<circle cx="84" cy="32" r="8" fill="#fff" stroke="${INK}" stroke-width="1.3"/></g>${heart(60, 0, 1.2, PNK2)}${spark(108, 62, .9, BUT2)}</svg></div>
<div class="st-prize"><h6><span class="st-hand">一番赏 · 本期</span><small>A–D 赏</small></h6><div>${[['A', '大玩偶', PNK], ['B', '亚克力立牌', MNT], ['C', '吧唧', BUT], ['D', '明信片', LIL]].map(([k, n, c]) => `<b data-a="stgo" data-x="ichiban" style="--c:${c}"><i class="st-hand">${k}</i><span>${n}</span></b>`).join('')}</div></div></section>
<nav class="st-nav">${SHOPS.map(([k, n, s]) => `<b data-a="stgo" data-x="${k}"><span class="st-hand">${n}</span><small>${s}</small></b>`).join('')}</nav>
<footer class="st-foot"><span class="st-hand">逛一逛，今天也会有好事发生。</span></footer></div>`;

// 街名用的两款手写体（Google Fonts）：进来才加载
const fonts = () => document.querySelector('link[data-street]') || document.head.append(h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=ZCOOL+KuaiLe&display=swap', dataset: { street: '' } }));
export function open() {
  fonts();
  const p = page({ app: 'street', id: 'street-main', title: '', back: true, cls: 'as-street' });
  p.body.innerHTML = body();
  const el = p.body, sc = el.querySelector('.st-scroll');
  // 手机上原生横滑；电脑上用鼠标拖着滑
  let x0 = 0, s0 = 0, drag = 0;
  sc.addEventListener('pointerdown', e => { if (e.pointerType != 'mouse') return; x0 = e.clientX; s0 = sc.scrollLeft; drag = 1; sc.classList.add('drag'); });
  sc.addEventListener('pointermove', e => { if (drag) sc.scrollLeft = s0 - (e.clientX - x0); });
  sc.addEventListener('pointerup', e => { if (!drag) return; drag = 0; sc.classList.remove('drag'); if (Math.abs(e.clientX - x0) > 6) sc._moved = Date.now(); });
  requestAnimationFrame(() => { sc.scrollLeft = 40; });
  const go = k => { const svg = sc.querySelector('svg'), k2 = svg.clientWidth / W; sc.scrollTo({ left: POS[k] * k2 - sc.clientWidth / 2, behavior: 'smooth' }); };
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-a]'); if (!t) return;
    const k = t.dataset.x;
    if (t.dataset.a === 'stgo') { k === 'studio' ? import('./studio.js').then(m => m.openStudio()) : go(k); return; }
    if (sc._moved && Date.now() - sc._moved < 300) return;
    if (k === 'studio') { import('./studio.js').then(m => m.openStudio()); return; }
    const pl = t.querySelector('.st-plate'); pl?.classList.remove('sw'); void pl?.getBBox?.(); pl?.classList.add('sw');
    toast(`${SHOPS.find(s => s[0] == k)[1]} · 準備中`);
  });
  return p.el;
}
