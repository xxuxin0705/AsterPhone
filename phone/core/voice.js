// 谁用什么声音（音色库）：
// - 模式：统一一个渠道（都用「语音」线插着的接口）/ 每个人用自己的渠道（没单独选的跟着线走）
// - 每个人在每个语音接口上可以存好几个音色，挑一个用；音色 ID 只在那个接口上有效，所以按接口分开存
// - 没配音色的：开了「用默认音色」就按性别用这个接口的男声 / 女声默认，否则用接口的当前音色
// - 读音表：全局一张，念之前把「写法」换成「读音」（主要给日语人名用），显示的字不动
import { state, commit, contact } from './store.js';
import { resolveConn, speak } from './api.js';
import { myAvatar } from './promptstore.js';

export const V = () => state.voice || (state.voice = { mode: 'one', useDefault: true, people: {}, readings: [] });
export const save = () => commit('voice');
/** 音色库里列出来的人：「我」排第一，然后是联系人 */
/** 音色按真实姓名记（跟着角色卡；同一张卡的不同窗口里，同名的就是同一个人） */
export const pk = id => id === 'me' ? 'me' : (contact(id) || {}).name || id;
export function people() {
  return [{ id: 'me', name: '我', avatar: myAvatar(), gender: state.me.gender },
    ...state.contacts.map(c => ({ id: c.id, name: c.remark || c.nick || c.name || '联系人', avatar: c.avatar || '', gender: c.gender }))];
}
const genderOf = id => id === 'me' ? state.me.gender : (contact(id) || {}).gender;
const isMale = g => /^(男|male|m)$/i.test(String(g || '').trim());
const isFemale = g => /^(女|female|f)$/i.test(String(g || '').trim());

const ttsList = () => state.connections.tts || [];
export const defaultConn = () => resolveConn('tts', 'chat');
/** 这个人用哪个语音接口 */
export function connFor(id) {
  const p = V().people[pk(id)], own = V().mode === 'each' && p && p.conn && ttsList().find(c => c.id === p.conn);
  return own || defaultConn();
}
/** 这个人在这个接口上存的音色：{ list: [{ id, name, voice }], cur } */
export const savedOn = (id, connId) => ((V().people[pk(id)] || {}).voices || {})[connId] || { list: [], cur: '' };
/** 这个人在这个接口上实际用的音色，以及它是怎么来的（'own' / 'male' / 'female' / 'base'） */
export function voiceOf(id, conn) {
  const s = savedOn(id, conn.id), mine = s.list.find(x => x.id === s.cur);
  if (mine && mine.voice) return { voice: mine.voice, from: 'own', name: mine.name };
  return fallbackVoice(id, conn);
}
/** 没挑自己的音色时用哪个：按性别用接口的男声 / 女声默认，否则接口的当前音色 */
export function fallbackVoice(id, conn) {
  const T = conn.tts || {}, g = genderOf(id);
  if (V().useDefault && isMale(g) && T.male) return { voice: T.male, from: 'male' };
  if (V().useDefault && isFemale(g) && T.female) return { voice: T.female, from: 'female' };
  return { voice: T.voice || '', from: 'base' };
}
/** 读音表：把写法换成读音（长的先换，免得「銀時」被「銀」先换掉一半） */
export function readAloud(text) {
  return V().readings.filter(r => r.from).sort((a, b) => b.from.length - a.from.length)
    .reduce((s, r) => s.split(r.from).join(r.to), String(text || ''));
}
/** 用某个人的声音念一段话 */
export function speakAs(id, text, opts = {}) {
  const conn = connFor(id);
  return speak(readAloud(text), conn ? { ...opts, conn, voice: voiceOf(id, conn).voice } : opts);
}
