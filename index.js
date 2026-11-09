// AsterPhone · 酒馆插件入口
// 1. 酒馆一打开就在后台悄悄装好手机（看不见），这样手机关着也能读正文暗号、往正文里注入。
// 2. 打开手机的三个入口：悬浮按钮（可拖动、可换图标）、魔法棒菜单、连点三下（默认关）。
// 3. 扩展面板里有「显示悬浮按钮」开关和几个兜底按钮。

const BASE = new URL('.', import.meta.url).href;
const PHONE = BASE + 'phone/';
const POS_KEY = 'aster-fab-pos';
const CFG_KEY = 'asterphone-cfg';
const EXT = 'asterphone';

let overlay, iframe, fab, fabImg, fabDot, opened = false, ready = false;
let cfg = { fab: 'iphone', fabSize: 52, tripleTap: false, winScale: 0 };
try { Object.assign(cfg, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) { /* 用默认 */ }

/* ---------- 扩展设置（显示悬浮按钮） ---------- */
function stCtx() { try { return window.SillyTavern && SillyTavern.getContext ? SillyTavern.getContext() : null; } catch (e) { return null; } }
function extSettings() {
    const c = stCtx();
    const all = c && c.extensionSettings;
    if (all) { all[EXT] = Object.assign({ showFab: true }, all[EXT] || {}); return all[EXT]; }
    try { return Object.assign({ showFab: true }, JSON.parse(localStorage.getItem('asterphone-ext') || '{}')); } catch (e) { return { showFab: true }; }
}
function saveExt(s) {
    const c = stCtx();
    if (c && c.extensionSettings) { c.extensionSettings[EXT] = s; (c.saveSettingsDebounced || (() => {}))(); }
    else try { localStorage.setItem('asterphone-ext', JSON.stringify(s)); } catch (e) { /* 忽略 */ }
}

/* ---------- 搭建 ---------- */
function build() {
    fab = document.createElement('button');
    fab.id = 'aster-fab';
    fab.type = 'button';
    fab.title = 'AsterPhone';
    fab.setAttribute('aria-label', '打开 AsterPhone 小手机');
    fabImg = document.createElement('img');
    fabImg.alt = '';
    fabImg.draggable = false;
    fabDot = document.createElement('span');
    fabDot.className = 'aster-fab__dot';
    fab.append(fabImg, fabDot);
    document.body.appendChild(fab);
    applyFab();

    overlay = document.createElement('div');
    overlay.id = 'aster-overlay';
    const frame = document.createElement('div');
    frame.className = 'aster-frame';
    iframe = document.createElement('iframe');
    iframe.title = 'AsterPhone 小手机';
    iframe.setAttribute('allow', 'autoplay; clipboard-write');
    frame.appendChild(iframe);
    overlay.appendChild(frame);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && opened) close(); });
    window.addEventListener('message', onMessage);

    iframe.addEventListener('load', () => iframe.contentDocument.addEventListener('focusin', lift));
    window.addEventListener('resize', holdSize);
    overlay.addEventListener('scroll', () => { overlay.scrollTop = 0; });   // 浏览器自己也会把输入框往上滚一次，再加上 lift() 就推过头了；只让 lift() 来推
    restorePos();
    makeDraggable();
    bindTripleTap();
    load();
    whenReady('#extensionsMenu', addWand);
    whenReady('#extensions_settings2, #extensions_settings', addSettings);
    checkUpdate(false);
    // 手机上切回酒馆时页面不一定会重新加载，所以切回来也看一眼（十分钟最多一次）
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastCheck > 600000) checkUpdate(false); });
}

/* ---------- 更新：打开酒馆就看一眼有没有新版本；有就弹一张小卡片（现在更新 / 知道了） ---------- */
const REMOTE = 'https://raw.githubusercontent.com/xxuxin0705/AsterPhone/main/manifest.json';
const SKIP_KEY = 'asterphone-skip-version';
const vcmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
const extName = () => decodeURIComponent((/\/extensions\/third-party\/([^/]+)\//.exec(new URL(BASE).pathname) || [])[1] || 'AsterPhone');
const stHeaders = () => { const c = stCtx(); return (c && c.getRequestHeaders) ? c.getRequestHeaders() : { 'Content-Type': 'application/json' }; };
/** 装在「所有用户」还是「当前用户」：问酒馆自己记的（和「管理扩展」用的同一份）。问错地方 Tauri 会弹「后端错误」，所以只问对的那个 */
async function installedGlobal() {
    try {
        const { extensionTypes } = await import(new URL('../../../extensions.js', import.meta.url).href);
        const t = extensionTypes && extensionTypes['third-party/' + extName()];
        if (t) return [t === 'global'];
    } catch (e) { /* 读不到就两种都试 */ }
    return [false, true];
}
/** 问酒馆自己（和「管理扩展」里的更新提示是同一个检查） */
async function tavernStatus() {
    for (const global of await installedGlobal()) {
        try {
            const res = await fetch('/api/extensions/version', { method: 'POST', headers: stHeaders(), body: JSON.stringify({ extensionName: extName(), global }) });
            if (res.ok) { const d = await res.json(); if (typeof d.isUpToDate === 'boolean') return d; }
        } catch (e) { /* 试下一种 */ }
    }
    return null;
}
let lastCheck = 0, gitCheck = null;
/** 返回 { local, remote, newer }；force = 手机里点「检查更新」，这时就算点过「知道了」也照样提示。
 *  GitHub 读得到就先按它马上弹；酒馆自己的检查要先 git fetch，慢几秒，但 GitHub 读不到（国内网络、Tauri 酒馆）时靠它 */
async function checkUpdate(force) {
    lastCheck = Date.now();
    const show = (v, skip) => { if (force || localStorage.getItem(SKIP_KEY) !== skip) showUpdateCard(v, skip); };
    const git = gitCheck = tavernStatus();
    const [l, r] = await Promise.all([
        fetch(BASE + 'manifest.json', { cache: 'no-cache' }).then(x => x.json()).catch(() => ({})),
        fetch(REMOTE, { cache: 'no-cache' }).then(x => x.json()).catch(() => null),
    ]);
    const ghNewer = !!r && vcmp(r.version, l.version) > 0;
    if (ghNewer) show(r.version, r.version);
    const g = await git;
    if (!g && !r) return { error: true };
    const newer = g ? !g.isUpToDate : ghNewer;
    if (newer && !ghNewer) show(r && r.version, r ? r.version : 'git:' + g.currentCommitHash);
    return { local: l.version, remote: r && r.version, newer };
}
function showUpdateCard(v, skip) {
    document.getElementById('aster-update')?.remove();
    const card = document.createElement('div');
    card.id = 'aster-update';
    card.innerHTML = `<b>AsterPhone 有新版本${v ? ' v' + v : ''}</b><div><button type="button" data-k="later">知道了</button><button type="button" data-k="now" class="is-primary">现在更新</button></div>`;
    card.addEventListener('click', e => {
        const k = e.target.dataset && e.target.dataset.k; if (!k) return;
        if (k === 'later') { try { localStorage.setItem(SKIP_KEY, skip); } catch (err) { /* 忽略 */ } card.remove(); }
        if (k === 'now') { e.target.disabled = true; e.target.textContent = '正在更新…'; updateNow().then(ok => { if (!ok) { e.target.disabled = false; e.target.textContent = '现在更新'; } }); }
    });
    document.body.appendChild(card);
}
/** 让酒馆替我们 git pull 一下，好了就刷新页面。插件装在「所有用户」还是「当前用户」不知道，两种都试 */
async function updateNow() {
    // 卡片是 GitHub 一说有新版就弹，酒馆自己的检查（git fetch）还要慢几秒；这时去更新，同一个文件夹里两个 git 撞在一起，第一次会失败。先等它跑完
    await gitCheck;
    for (const global of await installedGlobal()) {
        try {
            const res = await fetch('/api/extensions/update', { method: 'POST', headers: stHeaders(), body: JSON.stringify({ extensionName: extName(), global }) });
            if (res.ok) { if (window.toastr) window.toastr.success('AsterPhone 更新好了，马上刷新'); setTimeout(() => location.reload(), 1200); return true; }
        } catch (e) { /* 试下一种 */ }
    }
    if (window.toastr) window.toastr.error('自动更新没成功：到「扩展」→「管理扩展」里点 AsterPhone 的更新按钮');
    return false;
}

async function load() {
    try {
        const res = await fetch(PHONE + 'index.html', { cache: 'no-cache' });
        const html = await res.text();
        iframe.srcdoc = '<!doctype html><html class="as-embedded"><head><meta charset="utf-8">'
            + `<base href="${PHONE}"></head><body>${html}</body></html>`;
    } catch (err) {
        console.error('[AsterPhone] 加载手机失败', err);
        if (window.toastr) window.toastr.error('AsterPhone 加载失败，请检查插件文件是否完整');
    }
}
const post = msg => { try { iframe.contentWindow && iframe.contentWindow.postMessage(msg, '*'); } catch (e) { /* 还没加载好 */ } };

function onMessage(e) {
    if (!iframe || e.source !== iframe.contentWindow || !e.data || typeof e.data !== 'object') return;
    const d = e.data;
    if (d.aster === 'close') close();
    if (d.aster === 'ready') { ready = true; post({ aster: 'visible', v: opened }); }
    if (d.aster === 'cfg') {
        cfg = { fab: d.fab || 'iphone', fabSize: d.fabSize || 52, tripleTap: !!d.tripleTap, winScale: d.winScale || 0 };
        try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (err) { /* 忽略 */ }
        applyFab();
    }
    if (d.aster === 'unread') fabDot.classList.toggle('is-on', d.n > 0);
    if (d.aster === 'update-check') checkUpdate(true).then(r => post({ aster: 'update-result', ...r }));
    if (d.aster === 'update-now') updateNow();
}

/** 手机放大 / 缩小的中心对准悬浮按钮（按钮藏起来时就从屏幕中间） */
function aimAtFab() {
    const r = fab.getBoundingClientRect(), f = overlay.firstChild;
    f.style.transformOrigin = r.width ? `${r.left + r.width / 2 - f.offsetLeft}px ${r.top + r.height / 2 - f.offsetTop}px` : '';
}
function open() {
    if (opened) return;
    opened = true;
    aimAtFab();
    overlay.classList.add('open');
    fab.classList.add('is-hidden');
    if (!size) holdSize();
    post({ aster: 'visible', v: true });
}
function close() {
    if (!opened) return;
    opened = false;
    aimAtFab();
    overlay.classList.remove('open');
    applyFab();
    post({ aster: 'visible', v: false });
}
const toggle = () => (opened ? close() : open());

/* ---------- 键盘 ----------
 * 酒馆把网页设成「弹键盘时整页变矮」。小手机要是跟着变矮，里面所有东西都得重排、毛玻璃和壁纸都得重画，
 * 中间几帧是空的——这就是「一点输入框就闪」。所以键盘弹出时小手机的大小一点不动，键盘只是盖住下面一截，
 * 输入框被盖住时把整台手机往上推到露出来（安卓自带的「推上去」也是这样） */
let size = null;
// 同一个输入框只往上推、不往回落：打中文时输入法的候选栏一会儿出来一会儿收回，键盘高度跟着变，
// 每变一次就重新推一次，整个手机就一上一下地闪
let liftEl = null, liftY = 0;
const typing = () => { const a = opened && iframe.contentDocument && iframe.contentDocument.activeElement; return !!a && (/^(INPUT|TEXTAREA)$/.test(a.tagName) || a.isContentEditable); };
function holdSize() {
    const f = overlay.firstChild;
    if (size && innerWidth === size.vw && innerHeight < size.vh && typing()) {
        if (!overlay.classList.contains('is-kb')) {
            overlay.classList.add('is-kb');
            Object.assign(f.style, { width: size.w + 'px', height: size.h + 'px', marginTop: size.top + 'px' });
        }
        lift();
        return;
    }
    overlay.classList.remove('is-kb'); liftEl = null; liftY = 0;
    const root = iframe.contentDocument && iframe.contentDocument.documentElement;
    if (root) { root.classList.remove('is-kb'); root.style.removeProperty('--as-kb'); }
    Object.assign(f.style, { width: '', height: '', marginTop: '', transform: '' });
    size = { vw: innerWidth, vh: innerHeight, w: f.offsetWidth, h: f.offsetHeight, top: f.offsetTop };
}
function lift() {
    if (!overlay.classList.contains('is-kb')) return;
    const a = iframe.contentDocument.activeElement, f = overlay.firstChild;
    const under = size.top + a.getBoundingClientRect().bottom + 16 - innerHeight;
    let y = Math.max(0, Math.min(under, size.top + size.h - innerHeight));
    if (a === liftEl) y = Math.max(y, liftY);
    liftEl = a; liftY = y;
    f.style.transform = `translateY(${-y}px)`;
    // 手机被键盘盖住的那一截：里面的页面和抽屉底下多留这么高，能往下拖到键盘后面的输入框（不然拖了又弹回来，一闪一闪）
    const root = iframe.contentDocument.documentElement;
    root.classList.add('is-kb'); root.style.setProperty('--as-kb', Math.max(0, size.top + size.h - y - innerHeight) + 'px');
}

/* ---------- 悬浮按钮 ---------- */
function applyFab() {
    if (!fab) return;
    fabImg.src = `${PHONE}assets/fab/${cfg.fab || 'iphone'}.webp`;
    fab.style.setProperty('--aster-fab-size', (cfg.fabSize || 52) + 'px');
    if (overlay) overlay.style.setProperty('--aster-scale', cfg.winScale || 1);
    const show = extSettings().showFab !== false;
    fab.classList.toggle('is-off', !show);
    fab.classList.toggle('is-hidden', opened);
    keepInView();
}
function restorePos() {
    try {
        const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
        if (p) { fab.style.left = p.x + 'px'; fab.style.top = p.y + 'px'; fab.style.right = 'auto'; fab.style.bottom = 'auto'; }
    } catch (e) { /* 用默认位置 */ }
    keepInView();
    window.addEventListener('resize', keepInView);
}
function keepInView() {
    if (!fab || !fab.style.left) return;
    const r = fab.getBoundingClientRect();
    const x = Math.min(window.innerWidth - r.width - 4, Math.max(4, r.left)), y = Math.min(window.innerHeight - r.height - 4, Math.max(4, r.top));
    fab.style.left = x + 'px'; fab.style.top = y + 'px';
}
function makeDraggable() {
    let start = null, moved = false;
    fab.addEventListener('pointerdown', e => {
        const r = fab.getBoundingClientRect();
        start = { x: e.clientX, y: e.clientY, l: r.left, t: r.top };
        moved = false;
        fab.setPointerCapture(e.pointerId);
    });
    fab.addEventListener('pointermove', e => {
        if (!start) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 6) return;
        moved = true;
        fab.classList.add('is-dragging');
        const x = Math.min(window.innerWidth - fab.offsetWidth - 4, Math.max(4, start.l + dx));
        const y = Math.min(window.innerHeight - fab.offsetHeight - 4, Math.max(4, start.t + dy));
        fab.style.left = x + 'px'; fab.style.top = y + 'px'; fab.style.right = 'auto'; fab.style.bottom = 'auto';
    });
    const end = () => {
        if (!start) return;
        fab.classList.remove('is-dragging');
        if (moved) {
            const r = fab.getBoundingClientRect();
            try { localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: r.top })); } catch (e) { /* 忽略 */ }
        } else open();
        start = null;
    };
    fab.addEventListener('pointerup', end);
    fab.addEventListener('pointercancel', () => { start = null; fab.classList.remove('is-dragging'); });
}

/* ---------- 连点三下（酒馆页面空白处） ---------- */
function bindTripleTap() {
    let n = 0, t0 = 0, x0 = 0, y0 = 0;
    document.addEventListener('pointerup', e => {
        if (!cfg.tripleTap || opened) return;
        if (e.target.closest('input, textarea, select, button, a, [contenteditable], .mes_text, .menu_button, .drawer-content, #send_form, #aster-fab, .list-group-item')) { n = 0; return; }
        const now = performance.now();
        if (now - t0 > 450 || Math.hypot(e.clientX - x0, e.clientY - y0) > 40) n = 0;
        n++; t0 = now; x0 = e.clientX; y0 = e.clientY;
        if (n >= 3) { n = 0; open(); }
    }, true);
}

/* ---------- 魔法棒菜单 ---------- */
function addWand(menu) {
    if (document.getElementById('aster-wand')) return;
    const it = document.createElement('div');
    it.id = 'aster-wand';
    it.className = 'list-group-item flex-container flexGap5 interactable';
    it.tabIndex = 0;
    it.innerHTML = '<div class="fa-solid fa-mobile-screen-button extensionsMenuExtensionButton"></div><span>AsterPhone 小手机</span>';
    it.addEventListener('click', () => { toggle(); try { document.getElementById('extensionsMenu').style.display = 'none'; } catch (e) { /* 菜单自己会关 */ } });
    menu.appendChild(it);
}

/* ---------- 扩展面板 ---------- */
function addSettings(host) {
    if (document.getElementById('aster-settings')) return;
    const s = extSettings();
    const box = document.createElement('div');
    box.id = 'aster-settings';
    box.innerHTML = `
<div class="inline-drawer">
  <div class="inline-drawer-toggle inline-drawer-header">
    <b>AsterPhone 小手机</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div class="inline-drawer-content">
    <label class="checkbox_label" for="aster-show-fab">
      <input type="checkbox" id="aster-show-fab" ${s.showFab !== false ? 'checked' : ''}>
      <span>显示悬浮按钮</span>
    </label>
    <small>关掉后，可以从输入框左边的魔法棒菜单打开手机。悬浮按钮的图标和大小在手机里的「设置 → 手机本体」换。</small>
    <div class="flex-container" style="margin-top:8px">
      <div class="menu_button" id="aster-open">打开手机</div>
      <div class="menu_button" id="aster-reset-pos">悬浮按钮回到原位</div>
    </div>
    <div class="flex-container">
      <div class="menu_button" id="aster-reset-lock">重置锁屏（忘记密码时用）</div>
      <div class="menu_button" id="aster-reset-look">重置外观</div>
    </div>
  </div>
</div>`;
    host.appendChild(box);
    box.querySelector('#aster-show-fab').addEventListener('change', e => { const v = extSettings(); v.showFab = e.target.checked; saveExt(v); applyFab(); });
    box.querySelector('#aster-open').addEventListener('click', open);
    box.querySelector('#aster-reset-pos').addEventListener('click', () => {
        try { localStorage.removeItem(POS_KEY); } catch (e) { /* 忽略 */ }
        fab.style.left = ''; fab.style.top = ''; fab.style.right = ''; fab.style.bottom = '';
        if (window.toastr) window.toastr.success('悬浮按钮已回到右侧');
    });
    box.querySelector('#aster-reset-lock').addEventListener('click', () => { post({ aster: 'reset', what: 'lock' }); if (window.toastr) window.toastr.success('锁屏已关闭，密码和手势都清除了'); });
    box.querySelector('#aster-reset-look').addEventListener('click', () => { post({ aster: 'reset', what: 'look' }); if (window.toastr) window.toastr.success('外观已重置'); });
}

function whenReady(sel, fn, tries = 0) {
    const el = document.querySelector(sel);
    if (el) return fn(el);
    if (tries < 60) setTimeout(() => whenReady(sel, fn, tries + 1), 500);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
else build();
