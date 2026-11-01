// 特殊消息：语音、图片、表情包、转账、红包、位置、通话、名片。
// 这里管三件事：① 在列表 / 通知里显示成什么 ② 写给 AI 看的样子 ③ 从 AI 的回复里认出来
import { state } from '../../core/store.js';

export const TYPE_LABEL = {
  text: '文字', voice: '语音', image: '图片', sticker: '表情包', transfer: '转账', packet: '红包',
  location: '位置', call: '通话', card: '名片', poke: '拍一拍',
};
export const money = n => '¥' + (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
export const voiceDur = text => Math.max(1, Math.min(60, Math.ceil(String(text || '').length / 3.5)));
export const fmtDur = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** 列表、通知、锁屏里显示的一行字 */
export function previewOf(m) {
  switch (m.type) {
    case 'voice': return `[语音] ${m.dur || voiceDur(m.text)}″`;
    case 'image': return '[图片]';
    case 'sticker': return `[表情包] ${m.name || ''}`.trim();
    case 'transfer': return `[转账] ${money(m.amount)}`;
    case 'packet': return `[红包] ${m.note || '恭喜发财，大吉大利'}`;
    case 'location': return `[位置] ${m.text}`;
    case 'call': return m.missed ? `[${m.from === 'them' ? '未接来电' : '对方未接'}]` : `[${m.mode === 'video' ? '视频' : '语音'}通话] ${fmtDur(m.dur || 0)}`;
    case 'card': return `[名片] ${m.name}`;
    default: return m.text || '';
  }
}

/** 写给 AI 看的样子（聊天记录、注入正文都用这个） */
export function forAI(m) {
  switch (m.type) {
    case 'voice': return `[语音] ${m.text}`;
    case 'image': return m.text ? `[图片：${m.text}]` : '[发了一张图片]';
    case 'sticker': return `[表情包：${m.name || '表情'}]`;
    case 'transfer': return `[转账 ${money(m.amount)}${m.note ? '，备注：' + m.note : ''}｜${statusText(m)}]`;
    case 'packet': return `[红包 ${money(m.amount)}${m.note ? '，' + m.note : ''}｜${statusText(m)}]`;
    case 'location': return `[位置：${m.text}]`;
    case 'call': return m.missed ? `[${m.mode === 'video' ? '视频' : '语音'}通话，没接通]` : `[${m.mode === 'video' ? '视频' : '语音'}通话 ${fmtDur(m.dur || 0)}${m.text ? '，聊了：' + m.text.slice(0, 200) : ''}]`;
    case 'card': return `[名片：${m.name}]`;
    default: return m.text || '';
  }
}
export const statusText = m => m.status === 'accepted' ? '已收下' : m.status === 'returned' ? '已退还' : '未领取';

/** 告诉 AI 可以发哪些特殊消息（拼在系统提示后面） */
export function specialsGuide() {
  const names = (state.stickers || []).map(s => s.name).filter(Boolean).slice(0, 60);
  return `【可以发的特殊消息】需要时单独占一行，用下面的格式；不需要就只发普通文字：
[语音]要说的话
[图片]画面描述
${names.length ? `[表情包]名字（只能从这些里选：${names.join('、')}）\n` : ''}[转账]金额|备注
[红包]金额|祝福语
[位置]地点名
[名片]人名
[拍一拍]
如果对方刚给你转账或发红包，可以单独一行写 [收下] 或 [退还]。`;
}

/** 从 AI 的一行回复里认出特殊消息；认不出就当普通文字 */
export function parseLine(line) {
  const m = /^[\[【]\s*(语音|图片|照片|表情包?|表情|转账|红包|位置|定位|名片|拍一拍|收下|收款|领取|退还|退回)\s*(?:[:：]\s*)?[\]】]?\s*[:：]?\s*(.*)$/.exec(line);
  if (!m) return { type: 'text', text: line };
  const kind = m[1], rest = m[2].replace(/^[\]】]\s*/, '').trim();
  const [a, b] = rest.split(/[|｜]/).map(x => (x || '').trim());
  const num = parseFloat(String(a).replace(/[^\d.]/g, '')) || 0;
  switch (kind) {
    case '语音': return { type: 'voice', text: rest || '……', dur: voiceDur(rest) };
    case '图片': case '照片': return { type: 'image', text: rest };
    case '表情': case '表情包': {
      const st = (state.stickers || []).find(s => s.name === rest) || (state.stickers || []).find(s => rest && s.name.includes(rest));
      return st ? { type: 'sticker', name: st.name, src: st.src, sid: st.id } : { type: 'text', text: rest ? `[${rest}]` : '' };
    }
    case '转账': return { type: 'transfer', amount: num || 52, note: b || (num ? '' : a), status: 'pending' };
    case '红包': return { type: 'packet', amount: num || 6.66, note: b || (num ? '' : a) || '恭喜发财，大吉大利', status: 'pending' };
    case '位置': case '定位': return { type: 'location', text: rest || '我在这' };
    case '名片': return { type: 'card', name: rest };
    case '拍一拍': return { type: 'poke-them' };
    case '收下': case '收款': case '领取': return { type: 'accept' };
    case '退还': case '退回': return { type: 'return' };
  }
  return { type: 'text', text: line };
}
