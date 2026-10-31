// Aster 小手机 · 酒馆插件入口（预览版：目前只有锁屏）
// 酒馆页面上放一个可拖动的悬浮按钮，点一下打开手机，再点一下或按关闭键收起。

const BASE = new URL('.', import.meta.url).href;
const PAGE = BASE + 'prototype/lockscreen/';
const POS_KEY = 'aster-fab-pos';

let overlay, frame, iframe, fab, loaded = false;

function build() {
    fab = document.createElement('button');
    fab.id = 'aster-fab';
    fab.type = 'button';
    fab.title = 'Aster 小手机';
    fab.setAttribute('aria-label', '打开 Aster 小手机');
    fab.textContent = '✦';
    document.body.appendChild(fab);

    overlay = document.createElement('div');
    overlay.id = 'aster-overlay';
    frame = document.createElement('div');
    frame.className = 'aster-frame';
    iframe = document.createElement('iframe');
    iframe.title = 'Aster 小手机';
    iframe.setAttribute('allow', 'autoplay');
    frame.appendChild(iframe);
    overlay.appendChild(frame);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) close(); });
    window.addEventListener('message', e => {
        if (e.source === iframe.contentWindow && e.data && e.data.aster === 'close') close();
    });

    restorePos();
    makeDraggable();
}

async function load() {
    if (loaded) return;
    loaded = true;
    try {
        const res = await fetch(PAGE + 'index.html', { cache: 'no-cache' });
        const html = await res.text();
        iframe.srcdoc = '<!doctype html><html><head><meta charset="utf-8">'
            + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            + `<base href="${PAGE}"></head><body>${html}</body></html>`;
    } catch (err) {
        loaded = false;
        console.error('[Aster] 加载锁屏失败', err);
        if (window.toastr) window.toastr.error('Aster 加载失败，请检查插件文件是否完整');
    }
}

function open() {
    load();
    overlay.classList.add('open');
    fab.classList.add('is-hidden');
    try { iframe.contentWindow && iframe.contentWindow.postMessage({ aster: 'visible', v: true }, '*'); } catch (e) { /* 还没加载好 */ }
}

function close() {
    overlay.classList.remove('open');
    fab.classList.remove('is-hidden');
    try { iframe.contentWindow && iframe.contentWindow.postMessage({ aster: 'visible', v: false }, '*'); } catch (e) { /* 忽略 */ }
}

/* ---------- 悬浮按钮：拖动 + 记住位置 ---------- */
function restorePos() {
    try {
        const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
        if (p) { fab.style.left = p.x + 'px'; fab.style.top = p.y + 'px'; fab.style.right = 'auto'; fab.style.bottom = 'auto'; }
    } catch (e) { /* 用默认位置 */ }
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
        const x = Math.min(window.innerWidth - fab.offsetWidth - 4, Math.max(4, start.l + dx));
        const y = Math.min(window.innerHeight - fab.offsetHeight - 4, Math.max(4, start.t + dy));
        fab.style.left = x + 'px'; fab.style.top = y + 'px'; fab.style.right = 'auto'; fab.style.bottom = 'auto';
    });
    fab.addEventListener('pointerup', () => {
        if (!start) return;
        if (moved) {
            const r = fab.getBoundingClientRect();
            try { localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: r.top })); } catch (e) { /* 忽略 */ }
        } else {
            open();
        }
        start = null;
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
else build();
