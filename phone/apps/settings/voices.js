// 音色库 / 读音表的抽屉：插线板、列表模式、联系人资料都从这里打开（改的是同一份数据）
import { h, uid } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { busy, toast, actionSheet, sheet, icon, input, segmented, avatar, page, group, item, toggleItem, dialog } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { VOICES, listVoices, tryVoice } from '../../core/api.js';
import { V, save, people, connFor, defaultConn, voiceOf, fallbackVoice } from '../../core/voice.js';

const ttsList = () => state.connections.tts || [];
const fmtOf = c => c.type === 'custom-tts' && c.fmt ? c.fmt : c.type;
const PULL = new Set(['minimax-cn', 'minimax-intl', 'fish', 'elevenlabs']);
const FROM = { male: '男声默认', female: '女声默认', base: '当前音色' };
/** 试听：按钮转圈直到出声，出声了说「正在播放」，失败说原因 */
const listen = (btn, conn, voice, text) => busy(btn, async () => {
  try { await tryVoice(conn, voice, text); toast('正在播放'); } catch (e) { toast('试听失败：' + e.message); }
});
const playBtn = (conn, voice, text) => h('button.as-pbd__ibtn', { 'aria-label': '试听', onclick: e => { e.stopPropagation(); listen(e.currentTarget, conn(), voice(), text); } }, icon('play', 16, 2));

/** 音色输入：手填，旁边快选（这家常用的）、拉取（网上拉）、试听。getConn 每次现取，换了渠道也对 */
export function voiceInput(getConn, value, onChange, placeholder = '音色 ID') {
  const inp = input({ value: value || '', placeholder, onInput: v => onChange(v.trim()) });
  const set = v => { inp.value = v; onChange(v); };
  const pick = async (title, list) => { const v = await actionSheet(title, list.map(([id, n]) => ({ value: id, label: n && n !== id ? `${n} · ${id}` : id, active: id === inp.value }))); if (v) set(v); };
  const t = fmtOf(getConn());
  return h('div.as-pbd__line', inp,
    VOICES[t] ? h('button.as-pbd__mini', { onclick: () => pick('快选音色', VOICES[fmtOf(getConn())] || []) }, '快选') : null,
    PULL.has(t) ? h('button.as-pbd__mini', { onclick: e => busy(e.currentTarget, async () => {
      toast('正在拉取音色…');
      try {
        const list = await listVoices(getConn()) || [];
        if (!list.length) { toast('没有拉到音色，可以手动填'); return; }
        toast(`拉到 ${list.length} 个音色`); pick(`选择音色（${list.length}）`, list.map(x => [x.id, x.name]));
      } catch (e) { toast('拉取失败：' + e.message); }
    }) }, '拉取') : null,
    playBtn(getConn, () => inp.value));
}
const row = (label, ctrl) => h('div.as-pbd__row', h('span.as-pbd__label', label), h('div.as-pbd__ctrl', ctrl));

/** 一个人在某个接口上用的音色，写成一行字 */
function voiceLabel(id, conn) {
  const v = voiceOf(id, conn);
  return v.from === 'own' ? (v.name || v.voice) : v.voice ? FROM[v.from] : '没有音色';
}

/** 音色库（一整页）：渠道（统一 / 各自、每个渠道的默认音色）· 角色库（每个人）· 读音表。三栏切换只是显示 / 藏起，不重画
 *  conn = 先看哪个渠道；tab = 先打开哪一栏；onChange = 改了东西告诉插线板（重挂头像） */
export function openVoicePage({ conn, tab = 'conn', onChange = () => {}, openConn } = {}) {
  if (!ttsList().length) { toast('先添加一个语音接口'); return; }
  let cur = conn || defaultConn() || ttsList()[0];
  const p = page({ app: 'settings', id: 'settings-voices', title: '音色库', back: true });
  const changed = () => { paintPeople(); onChange(); };
  /* 渠道 */
  const chipBox = h('div.as-chips'), defBox = h('div');
  const paintChips = () => chipBox.replaceChildren(...ttsList().map(c => h('button.as-chip' + (c.id === cur.id ? '.is-active' : ''), { onclick: () => { cur = c; paintChips(); paintDefaults(); } },
    c.name + (c.id === (defaultConn() || {}).id ? ' · 默认' : ''))));
  const paintDefaults = () => {
    const T = cur.tts || (cur.tts = { voice: '', speed: 1, volume: 1 }), c = cur;
    const set = k => v => { T[k] = v; commit('connections'); changed(); };
    // 男声 / 女声默认只在开了「用默认音色」时才有
    const male = h('div.as-field', { hidden: !V().useDefault }, h('span.as-field__label', '男声默认'), voiceInput(() => c, T.male, set('male')));
    const female = h('div.as-field', { hidden: !V().useDefault }, h('span.as-field__label', '女声默认'), voiceInput(() => c, T.female, set('female')));
    defBox.replaceChildren(group('', [
      toggleItem({ title: '没配音色的联系人用默认音色' }, V().useDefault, v => { V().useDefault = v; save(); male.hidden = female.hidden = !v; changed(); }),
      male, female,
      ...(openConn ? [item({ title: '接口设置（地址、密钥、模型…）', chevron: true, onClick: () => openConn(c) })] : [])]));
  };
  const connTab = h('div',
    group('每个人用哪个渠道', [h('div.as-field', segmented([['one', '统一一个渠道'], ['each', '每个人用自己的渠道']], V().mode, v => { V().mode = v; save(); changed(); }))]),
    group('渠道', [h('div.as-field', chipBox)]), defBox);
  /* 角色库 */
  const list = h('div.as-vl__people');
  const paintPeople = () => list.replaceChildren(...people().map(x => {
    const c = connFor(x.id), own = V().mode === 'each' && c && c.id !== (defaultConn() || {}).id;
    return h('button.as-vl__person', { onclick: () => openPerson(x.id, changed) },
      avatar(x.avatar, x.name, 34), h('span.as-vl__name', x.name), h('span.as-vl__sub', c ? (own ? `${c.name} · ` : '') + voiceLabel(x.id, c) : '没有语音接口'), icon('chevron', 14, 2));
  }));
  const peopleTab = group('', [list]);
  /* 读音表：改了马上存 */
  const rbox = h('div');
  const R = () => V().readings;
  const paintReadings = () => rbox.replaceChildren(...R().map((r, i) => h('div.as-pbd__line.as-vl__reading',
    input({ value: r.from, placeholder: '写法', onInput: v => { r.from = v.trim(); save(); } }), h('span.as-vl__arrow', '→'),
    input({ value: r.to, placeholder: '读音', onInput: v => { r.to = v.trim(); save(); } }),
    h('button.as-pbd__ibtn', { 'aria-label': '试听', onclick: e => {
      const c = defaultConn(); if (!c) { toast('先插一个语音接口'); return; }
      if (!(r.to || r.from)) { toast('先写上读音'); return; }
      listen(e.currentTarget, c, voiceOf('me', c).voice, r.to || r.from);
    } }, icon('play', 16, 2)),
    h('button.as-pbd__ibtn', { 'aria-label': '删掉这一行', onclick: () => { R().splice(i, 1); save(); paintReadings(); } }, icon('close', 14, 2)))),
    h('button.as-pbd__dash', { onclick: () => { R().push({ from: '', to: '' }); save(); paintReadings(); } }, icon('plus', 15, 2), '加一行'));
  const readTab = group(withInfo('读音表', '念出来的时候把「写法」换成「读音」，比如日语人名。发语音、通话都会用，聊天里显示的字不变。'), [h('div.as-field', rbox)]);
  /* 三栏 */
  const tabs = { conn: connTab, people: peopleTab, read: readTab };
  const show = k => Object.entries(tabs).forEach(([n, el]) => { el.hidden = n !== k; });
  p.body.append(h('div', { style: { marginBottom: '14px' } }, segmented([['conn', '渠道'], ['people', '角色库'], ['read', '读音表']], tab, show)), connTab, peopleTab, readTab);
  paintChips(); paintDefaults(); paintPeople(); paintReadings(); show(tab);
  p.el._onShow = () => { paintChips(); paintDefaults(); paintPeople(); };   // 从接口设置回来：名字、默认渠道可能变了
  nav.push(p.el);
}
export const withInfo = (title, text) => h('span.as-info-head', title, h('button.as-info-btn', { 'aria-label': title + '说明', onclick: e => { e.stopPropagation(); dialog({ title, text, confirm: '知道了', cancel: '' }); } }, icon('info', 15, 2)));

/** 一个人的声音：（各自模式下）用哪个渠道 + 在那个渠道上存的几个音色，挑一个用。改完点保存 */
export function openPerson(id, onDone = () => {}) {
  const P = JSON.parse(JSON.stringify(V().people[id] || { conn: '', voices: {} }));
  const p = people().find(x => x.id === id) || { name: '这个人' };
  const connOf = () => (V().mode === 'each' && P.conn && ttsList().find(c => c.id === P.conn)) || defaultConn();
  if (!connOf()) { toast('先添加一个语音接口'); return; }
  const box = h('div.as-vl__box'), connBtn = h('button.as-pbd__select');
  const paintConn = () => { const c = connOf(); connBtn.replaceChildren(h('span', P.conn ? c.name : `跟随（${c.name}）`), icon('chevron', 14, 2)); };
  connBtn.onclick = async () => {
    const v = await actionSheet('声音渠道', [{ value: '-', label: '跟随「语音」线', active: !P.conn }, ...ttsList().map(c => ({ value: c.id, label: c.name, active: P.conn === c.id }))]);
    if (v == null) return; P.conn = v === '-' ? '' : v; paintConn(); paint();
  };
  // 平时只显示「当前音色」（下拉里换存过的、或选「新增音色」）；选了新增才展开填写的地方
  let adding = false;
  const paint = () => {
    const c = connOf(), S = P.voices[c.id] || (P.voices[c.id] = { list: [], cur: '' });
    const mine = S.list.find(x => x.id === S.cur), fb = fallbackVoice(id, c);
    const defLabel = `默认（${fb.voice ? FROM[fb.from] : '接口自带'}）`;
    const pick = h('button.as-pbd__select', { onclick: async () => {
      const v = await actionSheet('当前音色', [{ value: '', label: defLabel, active: !mine },
        ...S.list.map(x => ({ value: x.id, label: x.name !== x.voice ? `${x.name} · ${x.voice}` : x.name, active: x === mine })),
        { value: '+', label: '＋ 新增音色' }]);
      if (v == null) return;
      if (v === '+') adding = true; else S.cur = v;
      paint();
    } }, h('span', mine ? mine.name : defLabel), icon('chevron', 14, 2));
    const del = mine && h('button.as-pbd__ibtn', { 'aria-label': '删除这个音色', onclick: () => { S.list = S.list.filter(y => y !== mine); S.cur = ''; paint(); } }, icon('close', 14, 2));
    let name = '', voice = '';
    const form = adding && h('div.as-vl__box',
      input({ placeholder: '名字', onInput: v => { name = v.trim(); } }),
      voiceInput(() => c, '', v => { voice = v; }),
      h('div.as-pbd__line',
        h('button.as-pbd__mini', { onclick: () => { adding = false; paint(); } }, '取消'),
        h('button.as-pbd__dash', { onclick: () => {
          if (!voice) { toast('先填或选一个音色'); return; }
          const nv = { id: uid('v'), name: name || voice, voice }; S.list.push(nv); S.cur = nv.id; adding = false; paint();
        } }, icon('plus', 15, 2), '加进来')));
    box.replaceChildren(
      row('当前音色', h('div.as-pbd__line', pick, playBtn(() => c, () => (mine || fb).voice), del)),
      ...(form ? [row('新增音色', form)] : []));
  };
  paintConn(); paint();
  const s = sheet({ title: `${p.name}的声音`, cls: 'as-pbd', content: h('div.as-pbd__wrap',
    V().mode === 'each' ? row('声音渠道', connBtn) : null, box,
    h('div.as-pbd__bar', h('button.as-pbd__cancel', { onclick: () => s.close() }, '取消'),
      h('button.as-pbd__save', { onclick: () => { V().people[id] = P; save(); toast('保存好了'); s.close(); onDone(); } }, '保存'))) });
}
