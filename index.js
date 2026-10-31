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
let cfg = { fab: 'iphone', fabSize: 52, tripleTap: false };
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

    restorePos();
    makeDraggable();
    bindTripleTap();
    load();
    whenReady('#extensionsMenu', addWand);
    whenReady('#extensions_settings2, #extensions_settings', addSettings);
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
        cfg = { fab: d.fab || 'iphone', fabSize: d.fabSize || 52, tripleTap: !!d.tripleTap };
        try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (err) { /* 忽略 */ }
        applyFab();
    }
    if (d.aster === 'unread') fabDot.classList.toggle('is-on', d.n > 0);
}

function open() {
    if (opened) return;
    opened = true;
    overlay.classList.add('open');
    fab.classList.add('is-hidden');
    post({ aster: 'visible', v: true });
}
function close() {
    if (!opened) return;
    opened = false;
    overlay.classList.remove('open');
    applyFab();
    post({ aster: 'visible', v: false });
}
const toggle = () => (opened ? close() : open());

/* ---------- 悬浮按钮 ---------- */
function applyFab() {
    if (!fab) return;
    fabImg.src = `${PHONE}assets/fab/${cfg.fab || 'iphone'}.png`;
    fab.style.setProperty('--aster-fab-size', (cfg.fabSize || 52) + 'px');
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
    box.querySelector('#aster-reset-lock').addEventListener('click', () => { post({ aster: 'reset', what: 'lock' }); if (window.toastr) window.toastr.success('锁屏已重置为指纹解锁，密码已清除'); });
    box.querySelector('#aster-reset-look').addEventListener('click', () => { post({ aster: 'reset', what: 'look' }); if (window.toastr) window.toastr.success('外观已重置'); });
}

function whenReady(sel, fn, tries = 0) {
    const el = document.querySelector(sel);
    if (el) return fn(el);
    if (tries < 60) setTimeout(() => whenReady(sel, fn, tries + 1), 500);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
else build();
