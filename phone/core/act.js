// 语气（演法）：照作者自己的「正文朗读」插件（xxuxin0705/reading 的 tts-adapt.js、deep-editor.js）。
// 统一写成 Fish S2 的样子：台词里插 [英文标签]；合成时按语音接口换成它认的写法——
//   Fish S2 / ElevenLabs v3 → 原样；MiniMax → 整句一个情绪参数（2.8 还认几个声音标签）；
//   OpenAI gpt-4o-mini-tts → 英文语气说明；豆包 2.0 → 中文语气指令；IndexTTS → 中文情绪描述；MiMo → 句首 (风格)；
//   别的 → 去掉标签，笑、哭、叹气这类换成拟声字。
const TAG = /\[([^\]\n]{1,40})\]\s*/g;
/** 给人看的字：标签都去掉 */
export const plain = s => String(s || '').replace(TAG, '').trim();

const ZH = {
  happy: '开心', excited: '兴奋', proud: '得意', tender: '宠溺', gentle: '温柔', coquettish: '撒娇', embarrassed: '害羞', teasing: '调侃', curious: '好奇',
  moved: '感动', relieved: '释然', hopeful: '期待', sad: '悲伤', upset: '委屈', heartbroken: '心疼', disappointed: '失落', lonely: '孤独', guilty: '愧疚',
  desperate: '绝望', exhausted: '疲惫', resigned: '无奈', nervous: '紧张', anxious: '焦急', scared: '害怕', panicked: '惊慌', surprised: '惊讶',
  confused: '困惑', doubtful: '怀疑', angry: '生气', furious: '暴怒', frustrated: '烦躁', jealous: '嫉妒', disdainful: '不屑', sarcastic: '嘲讽',
  indifferent: '冷淡', cold: '冷漠', serious: '严肃', determined: '坚定', lazy: '慵懒', sleepy: '困倦', smug: '得意洋洋', mysterious: '神秘',
  whisper: '压低声音耳语', breathy: '带气声', 'soft tone': '小声', loud: '大声', shouting: '喊出来', 'voice trembling': '声音发抖', 'voice breaking': '声音破音',
  'holding back tears': '强忍着眼泪', 'choked up': '哽咽', sobbing: '带着哭腔', sniffling: '吸着鼻子', sigh: '叹气', gasp: '倒抽一口气', panting: '急促喘息',
  groan: '低哼', chuckling: '轻笑', laughing: '笑着说', 'laughing loudly': '大笑', 'bitter laugh': '苦笑', snicker: '冷笑', yawning: '打着哈欠',
  'clear throat': '清了清嗓子', 'in a hurry tone': '急促地', 'drawn out': '拖长音',
};
const MM_EMO = [[/happy|excited|proud|tender|gentle|coquettish|teasing|curious|moved|relieved|hopeful|smug|laugh|chuckl/, 'happy'],
  [/sad|upset|heartbroken|disappointed|lonely|guilty|desperate|sob|tears|choked|sniffl|breaking/, 'sad'], [/angry|furious|frustrated|shouting/, 'angry'],
  [/scared|panicked|nervous|anxious|trembling/, 'fearful'], [/disdainful|sarcastic|jealous|snicker/, 'disgusted'], [/surprised|gasp/, 'surprised'],
  [/calm|indifferent|cold|serious|resigned|exhausted|lazy|sleepy|determined|mysterious/, 'calm']];
const MM_SOUND = { laughing: '(laughs)', 'laughing loudly': '(laughs)', chuckling: '(chuckle)', snicker: '(chuckle)', 'bitter laugh': '(chuckle)', sigh: '(sighs)',
  gasp: '(gasps)', panting: '(pant)', breathy: '(breath)', groan: '(groans)', sniffling: '(sniffs)', 'clear throat': '(clear-throat)', yawning: '(exhale)' };
// 不认标签的接口：声音类换成拟声字（中文 / 日文），情绪类直接去掉
const SOUND = { laughing: ['哈哈，', 'あはは、'], 'laughing loudly': ['哈哈哈哈，', 'あはははっ、'], chuckling: ['呵呵，', 'ふふっ、'], snicker: ['哼，', 'ふっ、'],
  'bitter laugh': ['呵……', 'はは……'], sigh: ['唉……', 'はぁ……'], gasp: ['啊，', 'はっ、'], panting: ['哈……哈……', 'はぁ、はぁ……'], sobbing: ['呜……', 'うぅ……'],
  'choked up': ['呜……', 'うっ……'], 'clear throat': ['咳，', 'こほん、'], yawning: ['哈啊……', 'ふぁ……'], groan: ['唔……', 'うぅ……'] };
const toText = s => { const ja = /[぀-ヿ]/.test(s);
  return s.replace(/\[long pause\]\s*/gi, '……').replace(/\[pause\]\s*/gi, '…').replace(TAG, (_, w) => (SOUND[w.trim().toLowerCase()] || [])[ja ? 1 : 0] || '').trim(); };
const tagsOf = s => [...new Set([...String(s).matchAll(/\[([^\]\n]{1,40})\]/g)].map(m => m[1].trim().toLowerCase()).filter(x => !/^(long )?pause$/.test(x)))];

/** 带标签的台词 → 这个语音接口要的 { text, act }（act 里是额外的参数，api.js 的 synthesize 认） */
export function adapt(conn, script) {
  const type = conn.type === 'custom-tts' && conn.fmt ? conn.fmt : conn.type, model = String(conn.model || ''), tags = tagsOf(script);
  if (!tags.length && !/\[(long )?pause\]/i.test(script)) return { text: script, act: {} };
  if (type === 'fish') return /drama|^s1|speech-1/i.test(model) ? { text: toText(script), act: {} } : { text: script, act: {} };
  if (type === 'elevenlabs') return /v3/.test(model) ? { text: script, act: {} } : { text: toText(script), act: {} };
  if (type.startsWith('minimax')) {
    const lead = (String(script).match(/^\s*((?:\[[^\]]+\]\s*)+)/) || [, ''])[1], key = (tagsOf(lead).length ? tagsOf(lead) : tags).join(' ');
    const text = /2\.8/.test(model) ? String(script).replace(/\[long pause\]\s*/gi, '<#1.0#>').replace(/\[pause\]\s*/gi, '<#0.4#>').replace(TAG, (all, w) => MM_SOUND[w.trim().toLowerCase()] || all) : script;
    return { text: toText(text), act: { emotion: (MM_EMO.find(([re]) => re.test(key)) || [])[1] } };
  }
  if (type === 'mimo') { const lead = tagsOf((String(script).match(/^\s*((?:\[[^\]]+\]\s*)+)/) || [, ''])[1]); return { text: (lead.length ? `(${lead.join(', ')})` : '') + toText(script.replace(/^\s*(?:\[[^\]]+\]\s*)+/, '')), act: {} }; }
  const zh = `用${tags.map(x => ZH[x] || x).join('、')}的语气说。`;
  if (type === 'doubao-tts') return { text: toText(script), act: { context: zh } };
  if (type === 'indextts') return { text: toText(script), act: { emoText: zh } };
  return { text: toText(script), act: /gpt-4o|mini-tts/i.test(model) ? { instructions: `Voice: ${tags.join(', ')}.` } : {} };
}

// 自己调语气时点的（跟正文朗读的「一键演法」和标签分类一样）
export const PRESETS = [['平静', []], ['温柔', ['gentle', 'soft tone']], ['宠溺', ['tender', 'chuckling']], ['开心', ['happy']], ['兴奋', ['excited']], ['调侃坏笑', ['teasing', 'chuckling']],
  ['得意', ['proud', 'smug']], ['害羞', ['embarrassed', 'whisper']], ['委屈', ['upset', 'voice trembling']], ['强忍哭', ['whisper', 'holding back tears']], ['哭着说', ['sobbing']],
  ['笑着说', ['laughing']], ['苦笑', ['bitter laugh']], ['长叹', ['sigh']], ['心疼', ['heartbroken', 'soft tone']], ['疲惫', ['exhausted', 'sigh']], ['无奈', ['resigned', 'sigh']],
  ['紧张小声', ['nervous', 'whisper']], ['害怕', ['scared', 'voice trembling']], ['惊讶', ['surprised', 'gasp']], ['生气', ['angry']], ['冷淡', ['indifferent', 'cold']],
  ['嘲讽', ['sarcastic', 'snicker']], ['严肃', ['serious']], ['神秘', ['mysterious', 'whisper']], ['慵懒', ['lazy', 'sleepy']]];
export const GROUPS = [['情绪', ['happy', 'excited', 'tender', 'gentle', 'teasing', 'curious', 'moved', 'relieved', 'sad', 'upset', 'heartbroken', 'lonely', 'exhausted', 'resigned',
  'nervous', 'scared', 'surprised', 'angry', 'disdainful', 'sarcastic', 'indifferent', 'serious', 'lazy', 'mysterious']],
  ['声音', ['whisper', 'soft tone', 'breathy', 'loud', 'shouting', 'voice trembling', 'holding back tears', 'choked up', 'sobbing', 'sigh', 'gasp', 'chuckling', 'laughing',
  'bitter laugh', 'snicker', 'yawning', 'clear throat', 'drawn out']], ['停顿', ['pause', 'long pause']]].map(([n, l]) => [n, l.map(t => [ZH[t] || (t === 'pause' ? '短停顿' : '长停顿'), t])]);
/** 这个接口能认到什么程度（照正文朗读的 channelProfile）：inline 句中随便插；mm28 / mm 整句一个情绪（mm28 句中还认几个声音）；
 *  sentence 句首最多两个，合成一句整句的语气说明；plain 不认标签 */
export function kindOf(conn) {
  if (!conn) return 'plain';
  const type = conn.type === 'custom-tts' && conn.fmt ? conn.fmt : conn.type, m = String(conn.model || '');
  if (type === 'fish') return /drama|^s1|speech-1/i.test(m) ? 'plain' : 'inline';
  if (type === 'elevenlabs') return /v3/.test(m) ? 'inline' : 'plain';
  if (type === 'mimo') return 'inline';
  if (type.startsWith('minimax')) return /2\.8/.test(m) ? 'mm28' : 'mm';
  if (type === 'doubao-tts') return conn.ver === 'v1' ? 'plain' : 'sentence';
  if (type === 'indextts') return 'sentence';
  return /gpt-4o|mini-tts/i.test(m) ? 'sentence' : 'plain';
}
const MM = [['开心', 'happy'], ['悲伤', 'sad'], ['生气', 'angry'], ['害怕', 'scared'], ['厌恶', 'disdainful'], ['惊讶', 'surprised'], ['平静', 'calm']];
const PAUSE = GROUPS[2];
/** 调语气时能点的：只放这个接口认的 */
export const groupsFor = k => k === 'inline' || k === 'sentence' ? GROUPS : k === 'plain' ? [PAUSE]
  : [['情绪', MM], ...(k === 'mm28' ? [['声音', GROUPS[1][1].filter(([, t]) => MM_SOUND[t])]] : []), PAUSE];
const SOUNDS = 'laughing, chuckling, sigh, gasp, panting, sniffling, clear throat, groan';
/** 给 AI 的一句：写故事时每段怎么标语气，按角色现在用的语音接口来 */
export const hintFor = k => ({
  inline: `每段开头用方括号写 1~2 个英文语气标签，写这段该怎么念（情绪、音量、笑 / 叹气 / 哭腔这类声音），比如 [gentle][soft tone]、[teasing][chuckling]、[sad][voice trembling]；情绪中途变了可以在句中再插一个。常用：${GROUPS.slice(0, 2).flatMap(g => g[1].map(x => x[1])).join(', ')}。>> 开头的翻译行不写标签。`,
  sentence: `每段开头用方括号写最多 2 个英文语气标签（一个情绪 + 一个声音），比如 [gentle][soft tone]、[sad][voice trembling]，整段都按它念；句中不写标签，情绪变化用叠字、……、拟声字表达。>> 开头的翻译行不写标签。`,
  mm28: `每段开头用方括号写 1 个英文情绪标签，只能从这些里挑：${MM.map(x => x[1]).join(', ')}，整段都按这个情绪念；句中只可以插这几个声音标签：${SOUNDS}，和 [pause]；别的声音用拟声字、叠字、……、！表达。>> 开头的翻译行不写标签。`,
  mm: `每段开头用方括号写 1 个英文情绪标签，只能从这些里挑：${MM.map(x => x[1]).join(', ')}，整段都按这个情绪念；句中不写标签，声音用拟声字、叠字、……、！表达。>> 开头的翻译行不写标签。`,
  plain: '不写任何方括号标签；语气用叠字、语气词、拟声字（哈哈、唉……、呜……）、……、！！表达出来。',
})[k];
