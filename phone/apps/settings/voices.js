// 音色库 / 读音表的抽屉：插线板、列表模式、联系人资料都从这里打开（改的是同一份数据）
import { h, uid } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { toast, actionSheet, sheet, icon, input, segmented, switchEl, avatar } from '../../core/ui.js';
import { VOICES, listVoices, tryVoice } from '../../core/api.js';
import { V, save, people, connFor, defaultConn, voiceOf } from '../../core/voice.js';

const ttsList = () => state.connections.tts || [];
const fmtOf = c => c.type === 'custom-tts' && c.fmt ? c.fmt : c.type;
const PULL = new Set(['minimax-cn', 'minimax-intl', 'fish', 'elevenlabs']);
const FROM = { male: '男声默认', female: '女声默认', base: '当前音色' };

/** 音色输入：手填，旁边快选（这家常用的）、拉取（网上拉）、试听。getConn 每次现取，换了渠道也对 */
export function voiceInput(getConn, value, onChange, placeholder = '音色 ID') {
  const inp = input({ value: value || '', placeholder, onInput: v => onChange(v.trim()) });
  const set = v => { inp.value = v; onChange(v); };
  const pick = async (title, list) => { const v = await actionSheet(title, list.map(([id, n]) => ({ value: id, label: n && n !== id ? `${n} · ${id}` : id, active: id === inp.value }))); if (v) set(v); };
  const t = fmtOf(getConn());
  return h('div.as-pbd__line', inp,
    VOICES[t] ? h('button.as-pbd__mini', { onclick: () => pick('快选音色', VOICES[fmtOf(getConn())] || []) }, '快选') : null,
    PULL.has(t) ? h('button.as-pbd__mini', { onclick: async () => {
      toast('正在拉取音色…');
      try {
        const list = await listVoices(getConn()) || [];
        if (!list.length) { toast('没有拉到音色，可以手动填'); return; }
        toast(`拉到 ${list.length} 个音色`); pick(`选择音色（${list.length}）`, list.map(x => [x.id, x.name]));
      } catch (e) { toast('拉取失败：' + e.message); }
    } }, '拉取') : null,
    h('button.as-pbd__ibtn', { 'aria-label': '试听', onclick: async () => { toast('正在合成…'); try { await tryVoice(getConn(), inp.value); } catch (e) { toast('试听失败：' + e.message); } } }, icon('play', 16, 2)));
}
const row = (label, ctrl) => h('div.as-pbd__row', h('span.as-pbd__label', label), h('div.as-pbd__ctrl', ctrl));

/** 一个人在某个接口上用的音色，写成一行字 */
function voiceLabel(id, conn) {
  const v = voiceOf(id, conn);
  return v.from === 'own' ? (v.name || v.voice) : v.voice ? FROM[v.from] : '没有音色';
}

/** 音色库：统一 / 各自、渠道的默认音色、每个人。conn = 先看哪个渠道（从格子点进来就是那个格子） */
export function openLibrary(conn, onChange = () => {}) {
  if (!ttsList().length) { toast('先添加一个语音接口'); return; }
  let cur = conn || defaultConn() || ttsList()[0];
  const chipBox = h('div.as-chips'), defBox = h('div'), list = h('div.as-vl__people');
  const paintChips = () => chipBox.replaceChildren(...ttsList().map(c => h('button.as-chip' + (c.id === cur.id ? '.is-active' : ''), { onclick: () => { cur = c; paintChips(); paintDefaults(); paintPeople(); } }, c.name)));
  // 渠道的三个默认音色：改了马上存（和接口详情里的是同一份）
  const paintDefaults = () => {
    const T = cur.tts || (cur.tts = { voice: '', speed: 1, volume: 1 }), c = cur;
    const set = k => v => { T[k] = v; commit('connections'); paintPeople(); onChange(); };
    defBox.replaceChildren(row('当前音色', voiceInput(() => c, T.voice, set('voice'))), row('男声默认', voiceInput(() => c, T.male, set('male'))), row('女声默认', voiceInput(() => c, T.female, set('female'))));
  };
  const paintPeople = () => list.replaceChildren(...people().map(p => {
    const c = connFor(p.id), own = V().mode === 'each' && c && c.id !== (defaultConn() || {}).id;
    return h('button.as-vl__person', { onclick: () => openPerson(p.id, () => { paintPeople(); onChange(); }) },
      avatar(p.avatar, p.name, 34), h('span.as-vl__name', p.name), h('span.as-vl__sub', c ? (own ? `${c.name} · ` : '') + voiceLabel(p.id, c) : '没有语音接口'), icon('chevron', 14, 2));
  }));
  const content = h('div.as-pbd__wrap',
    h('div.as-pbd__row', segmented([['one', '统一一个渠道'], ['each', '每个人用自己的渠道']], V().mode, v => { V().mode = v; save(); paintPeople(); onChange(); })),
    row('渠道', chipBox), defBox,
    h('div.as-pbd__row.is-inline', h('span.as-pbd__label', '没配音色的联系人用默认音色'), switchEl(V().useDefault, v => { V().useDefault = v; save(); paintPeople(); onChange(); }, '没配音色的联系人用默认音色')),
    list);
  paintChips(); paintDefaults(); paintPeople();
  sheet({ title: '音色库', cls: 'as-pbd', content });
}

/** 一个人的声音：（各自模式下）用哪个渠道 + 在那个渠道上存的几个音色，挑一个用。改完点保存 */
export function openPerson(id, onDone = () => {}) {
  const P = JSON.parse(JSON.stringify(V().people[id] || { conn: '', voices: {} }));
  const p = people().find(x => x.id === id) || { name: '这个人' };
  const connOf = () => (V().mode === 'each' && P.conn && ttsList().find(c => c.id === P.conn)) || defaultConn();
  if (!connOf()) { toast('先添加一个语音接口'); return; }
  const box = h('div'), connBtn = h('button.as-pbd__select');
  const paintConn = () => { const c = connOf(); connBtn.replaceChildren(h('span', P.conn ? c.name : `跟随（${c.name}）`), icon('chevron', 14, 2)); };
  connBtn.onclick = async () => {
    const v = await actionSheet('声音渠道', [{ value: '-', label: '跟随「语音」线', active: !P.conn }, ...ttsList().map(c => ({ value: c.id, label: c.name, active: P.conn === c.id }))]);
    if (v == null) return; P.conn = v === '-' ? '' : v; paintConn(); paint();
  };
  const paint = () => {
    const c = connOf(), S = P.voices[c.id] || (P.voices[c.id] = { list: [], cur: '' });
    let name = '', voice = '';
    const nameIn = input({ placeholder: '起个名字，比如「温柔」', onInput: v => { name = v.trim(); } });
    box.replaceChildren(
      ...S.list.map(x => h('div.as-vl__voice' + (x.id === S.cur ? '.is-on' : ''), { onclick: () => { S.cur = x.id; paint(); } },
        h('span.as-vl__radio', icon('check', 12, 3)), h('span.as-vl__name', x.name || x.voice), h('span.as-vl__sub', x.voice),
        h('button.as-pbd__ibtn', { 'aria-label': '试听', onclick: async e => { e.stopPropagation(); toast('正在合成…'); try { await tryVoice(c, x.voice); } catch (err) { toast('试听失败：' + err.message); } } }, icon('play', 16, 2)),
        h('button.as-pbd__ibtn', { 'aria-label': '删掉这个音色', onclick: e => { e.stopPropagation(); S.list = S.list.filter(y => y !== x); if (S.cur === x.id) S.cur = S.list[0] ? S.list[0].id : ''; paint(); } }, icon('close', 14, 2)))),
      ...(S.list.length ? [] : [h('p.as-pbd__hint', `还没配，会用${(() => { const v = voiceOf(id, c); return v.voice ? FROM[v.from] : '接口默认的声音'; })()}`)]),
      row('新增音色', h('div', nameIn, voiceInput(() => c, '', v => { voice = v; }))),
      h('button.as-pbd__dash', { onclick: () => {
        if (!voice) { toast('先填或选一个音色'); return; }
        const nv = { id: uid('v'), name: name || voice, voice }; S.list.push(nv); S.cur = nv.id; paint();
      } }, icon('plus', 15, 2), '加进来'));
  };
  paintConn(); paint();
  const s = sheet({ title: `${p.name}的声音`, cls: 'as-pbd', content: h('div.as-pbd__wrap',
    V().mode === 'each' ? row('声音渠道', connBtn) : null, box,
    h('div.as-pbd__bar', h('button.as-pbd__cancel', { onclick: () => s.close() }, '取消'),
      h('button.as-pbd__save', { onclick: () => { V().people[id] = P; save(); toast('保存好了'); s.close(); onDone(); } }, '保存'))) });
}

/** 读音表：写法 → 读音（全局一张，发语音、通话念出来时都会换；显示的字不动） */
export function openReadings() {
  const rows = JSON.parse(JSON.stringify(V().readings));
  const box = h('div');
  const paint = () => box.replaceChildren(...rows.map((r, i) => h('div.as-pbd__line.as-vl__reading',
    input({ value: r.from, placeholder: '写法，如 銀時', onInput: v => { r.from = v; } }), h('span.as-vl__arrow', '→'),
    input({ value: r.to, placeholder: '读音，如 ぎんとき', onInput: v => { r.to = v; } }),
    h('button.as-pbd__ibtn', { 'aria-label': '试听', onclick: async () => {
      const c = defaultConn(); if (!c) { toast('先插一个语音接口'); return; }
      toast('正在合成…'); try { await tryVoice(c, voiceOf('me', c).voice, r.to || r.from); } catch (e) { toast('试听失败：' + e.message); }
    } }, icon('play', 16, 2)),
    h('button.as-pbd__ibtn', { 'aria-label': '删掉这一行', onclick: () => { rows.splice(i, 1); paint(); } }, icon('close', 14, 2)))),
    h('button.as-pbd__dash', { onclick: () => { rows.push({ from: '', to: '' }); paint(); } }, icon('plus', 15, 2), '加一行'));
  paint();
  const s = sheet({ title: '读音表', cls: 'as-pbd', content: h('div.as-pbd__wrap', box,
    h('div.as-pbd__bar', h('button.as-pbd__cancel', { onclick: () => s.close() }, '取消'),
      h('button.as-pbd__save', { onclick: () => { V().readings = rows.filter(r => r.from.trim()).map(r => ({ from: r.from.trim(), to: r.to.trim() })); save(); toast('保存好了'); s.close(); } }, '保存'))) });
}
