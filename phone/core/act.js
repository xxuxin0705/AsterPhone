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

/** 带标签的台词 → 这个语音接口要的 { text, act }（act 里是额外的参数，api.js 的 synthesize 认）。t：张力 1~5（0 = 没设） */
export function adapt(conn, script, t = 0) {
  const type = conn.type === 'custom-tts' && conn.fmt ? conn.fmt : conn.type, model = String(conn.model || ''), tags = tagsOf(script);
  if (type === 'fish') return { text: /drama|^s1|speech-1/i.test(model) ? toText(script) : script, act: t ? { temperature: +(.7 + TEMP[t]).toFixed(2) } : {} };   // 张力 → 温度（照正文朗读）
  if (!tags.length && !t && !/\[(long )?pause\]/i.test(script)) return { text: script, act: {} };
  if (type === 'elevenlabs') return /v3/.test(model) ? { text: script, act: {} } : { text: toText(script), act: {} };
  if (type.startsWith('minimax')) {
    const lead = (String(script).match(/^\s*((?:\[[^\]]+\]\s*)+)/) || [, ''])[1], key = (tagsOf(lead).length ? tagsOf(lead) : tags).join(' ');
    const text = /2\.8/.test(model) ? String(script).replace(/\[long pause\]\s*/gi, '<#1.0#>').replace(/\[pause\]\s*/gi, '<#0.4#>').replace(TAG, (all, w) => MM_SOUND[w.trim().toLowerCase()] || all) : script;
    return { text: toText(text), act: { emotion: (MM_EMO.find(([re]) => re.test(key)) || [])[1] } };
  }
  if (type === 'mimo') { const lead = tagsOf((String(script).match(/^\s*((?:\[[^\]]+\]\s*)+)/) || [, ''])[1]); return { text: (lead.length ? `(${lead.join(', ')})` : '') + toText(script.replace(/^\s*(?:\[[^\]]+\]\s*)+/, '')), act: {} }; }
  const zh = [tags.length && `用${tags.map(x => ZH[x] || x).join('、')}的语气说`, t && ZH_T[t]].filter(Boolean).join('，') + '。';
  if (type === 'doubao-tts') return { text: toText(script), act: { context: zh } };
  if (type === 'indextts') return { text: toText(script), act: { emoText: zh } };
  const en = [tags.length && `Voice: ${tags.join(', ')}.`, t && `Intensity ${t}/5 (${EN_T[t]}).`].filter(Boolean).join(' ');
  return { text: toText(script), act: /gpt-4o|mini-tts/i.test(model) && en ? { instructions: en } : {} };
}

// ---------- 调这一段的语气（照正文朗读的 🎭 逐句调整：一键演法、按类分页的标签、张力、语速） ----------
const TEMP = { 1: -.1, 2: 0, 3: .05, 4: .1, 5: .15 };
const ZH_T = { 1: '情绪很平静克制', 2: '情绪轻微', 3: '情绪明显', 4: '情绪强烈', 5: '情绪极其强烈、到达顶点' };
const EN_T = { 1: 'calm and restrained', 2: 'mild emotion', 3: 'clear emotion', 4: 'strong emotion', 5: 'extremely intense, at the emotional peak' };
export const TENSIONS = [[1, '1 平静'], [2, '2 轻微'], [3, '3 明显'], [4, '4 强烈'], [5, '5 爆发']];
export const PACES = [['very_slow', '1 很慢'], ['slow', '2 慢'], ['normal', '3 正常'], ['fast', '4 快'], ['very_fast', '5 很快']];
export const PACE_SPEED = { very_slow: .72, slow: .86, normal: 1, fast: 1.18, very_fast: 1.38 };   // 语速：播放时变速（不变调）
export const PRESETS = [
  { label: '平静日常', tags: [], t: 1, p: 'normal' }, { label: '温柔安抚', tags: ['gentle', 'soft tone'], t: 2, p: 'slow' }, { label: '宠溺', tags: ['tender', 'chuckling'], t: 2, p: 'slow', tail: '~' },
  { label: '撒娇', tags: ['coquettish', 'whiny'], t: 3, p: 'normal', tail: '~' }, { label: '开心', tags: ['happy'], t: 2, p: 'normal' }, { label: '兴奋', tags: ['excited'], t: 3, p: 'fast', tail: '！' },
  { label: '调侃坏笑', tags: ['teasing', 'chuckling'], t: 2, p: 'normal' }, { label: '得意', tags: ['proud', 'smug'], t: 2, p: 'normal' },
  { label: '害羞结巴', tags: ['embarrassed', 'whisper'], t: 3, p: 'normal', stutter: true }, { label: '委屈', tags: ['upset', 'voice trembling'], t: 3, p: 'slow' },
  { label: '强忍哭', tags: ['whisper', 'holding back tears'], t: 4, p: 'slow', stutter: true }, { label: '哭着说', tags: ['sobbing'], t: 4, p: 'slow', stutter: true, pre: ['呜……', 'うぅ……'] },
  { label: '抽泣', tags: ['sobbing', 'sniffling'], t: 4, p: 'slow', pre: ['呜、呜呜……', 'ひっく……ぐすっ……'] }, { label: '崩溃大哭', tags: ['crying loudly', 'hysterical'], t: 5, p: 'slow', stutter: true, pre: ['呜哇……', 'うわぁ……'] },
  { label: '大笑', tags: ['laughing loudly'], t: 3, p: 'normal', pre: ['哈哈哈哈，', 'あはははっ、'] }, { label: '笑着说', tags: ['laughing'], t: 2, p: 'normal', pre: ['哈哈，', 'あはは、'] },
  { label: '偷笑', tags: ['chuckling'], t: 2, p: 'normal', pre: ['嘿嘿，', 'ふふっ、'] }, { label: '苦笑', tags: ['bitter laugh'], t: 2, p: 'slow', pre: ['呵……', 'はは……'] },
  { label: '嗤笑', tags: ['disdainful', 'snicker'], t: 2, p: 'normal', pre: ['哼，', 'はっ、'] }, { label: '长叹', tags: ['sigh'], t: 2, p: 'slow', pre: ['唉……', 'はぁ……'] },
  { label: '咳嗽', tags: ['clear throat'], t: 2, p: 'normal', pre: ['咳咳，', 'げほっ、'] }, { label: '心疼', tags: ['heartbroken', 'soft tone'], t: 3, p: 'slow' },
  { label: '疲惫叹气', tags: ['exhausted', 'sigh'], t: 2, p: 'slow' }, { label: '无奈', tags: ['resigned', 'sigh'], t: 2, p: 'slow' }, { label: '紧张小声', tags: ['nervous', 'whisper'], t: 3, p: 'fast' },
  { label: '害怕发抖', tags: ['scared', 'voice trembling'], t: 4, p: 'fast', stutter: true }, { label: '惊慌', tags: ['panicked', 'gasp'], t: 4, p: 'very_fast' },
  { label: '惊讶', tags: ['surprised', 'gasp'], t: 3, p: 'normal' }, { label: '生气质问', tags: ['angry'], t: 4, p: 'fast', tail: '！' }, { label: '暴怒吼', tags: ['furious', 'shouting'], t: 5, p: 'very_fast', tail: '！！' },
  { label: '咬牙切齿', tags: ['angry', 'through gritted teeth'], t: 4, p: 'slow' }, { label: '冷淡', tags: ['indifferent', 'cold'], t: 1, p: 'slow' }, { label: '嘲讽', tags: ['sarcastic', 'snicker'], t: 2, p: 'normal' },
  { label: '严肃', tags: ['serious'], t: 2, p: 'slow' }, { label: '绝望', tags: ['desperate', 'voice breaking'], t: 5, p: 'slow' }, { label: '释然', tags: ['relieved', 'sigh'], t: 2, p: 'slow' },
  { label: '慵懒', tags: ['lazy', 'sleepy'], t: 1, p: 'slow' }, { label: '喘着说', tags: ['panting'], t: 3, p: 'fast' }];
// 插在光标处的，按类分页
export const OPTION_GROUPS = [
  { key: 'emo', label: '情绪', items: [['开心', '[happy]'], ['兴奋', '[excited]'], ['得意', '[proud]'], ['宠溺', '[tender]'], ['温柔', '[gentle]'], ['撒娇', '[coquettish]'], ['害羞', '[embarrassed]'], ['调侃', '[teasing]'],
    ['好奇', '[curious]'], ['感动', '[moved]'], ['释然', '[relieved]'], ['期待', '[hopeful]'], ['悲伤', '[sad]'], ['委屈', '[upset]'], ['心疼', '[heartbroken]'], ['失落', '[disappointed]'], ['孤独', '[lonely]'],
    ['愧疚', '[guilty]'], ['绝望', '[desperate]'], ['疲惫', '[exhausted]'], ['无奈', '[resigned]'], ['紧张', '[nervous]'], ['焦急', '[anxious]'], ['害怕', '[scared]'], ['惊慌', '[panicked]'], ['惊讶', '[surprised]'],
    ['困惑', '[confused]'], ['怀疑', '[doubtful]'], ['生气', '[angry]'], ['暴怒', '[furious]'], ['烦躁', '[frustrated]'], ['嫉妒', '[jealous]'], ['不屑', '[disdainful]'], ['嘲讽', '[sarcastic]'], ['冷淡', '[indifferent]'],
    ['严肃', '[serious]'], ['坚定', '[determined]'], ['歇斯底里', '[hysterical]'], ['慵懒', '[lazy]'], ['醉醺醺', '[drunk]']] },
  { key: 'voice', label: '声音', items: [['哭腔', '[sobbing]'], ['大哭', '[crying loudly]'], ['强忍泪', '[holding back tears]'], ['声音发抖', '[voice trembling]'], ['破音', '[voice breaking]'], ['耳语', '[whisper]'],
    ['小声', '[soft tone]'], ['气声', '[breathy]'], ['大声', '[loud]'], ['喊', '[shouting]'], ['尖叫', '[screaming]'], ['咬牙', '[through gritted teeth]'], ['叹气', '[sigh]'], ['倒抽气', '[gasp]'], ['急喘', '[panting]'],
    ['吸鼻子', '[sniffling]'], ['哽咽', '[choked up]'], ['轻笑', '[chuckling]'], ['笑出声', '[laughing]'], ['大笑', '[laughing loudly]'], ['冷笑', '[snicker]'], ['苦笑', '[bitter laugh]'], ['打哈欠', '[yawning]'],
    ['清嗓', '[clear throat]'], ['低哼', '[groan]'], ['急促', '[in a hurry tone]'], ['拖长音', '[drawn out]']] },
  { key: 'ono', label: '拟声/音效', items: [['哈哈', '哈哈，'], ['哈哈哈', '哈哈哈哈，'], ['嘿嘿', '嘿嘿，'], ['嘻嘻', '嘻嘻，'], ['呵呵', '呵呵，'], ['噗', '噗——'], ['呜呜', '呜呜……'], ['呜哇', '呜哇……'],
    ['抽噎', '呜、呜……'], ['唉', '唉……'], ['咳咳', '咳咳，'], ['啧', '啧，'], ['哼', '哼，'], ['哇', '哇——'], ['哎呀', '哎呀，'], ['あはは', 'あはは、'], ['ふふっ', 'ふふっ、'], ['えへへ', 'えへへ、'],
    ['くすくす', 'くすくす……'], ['ひっく', 'ひっく……'], ['ぐすっ', 'ぐすっ……'], ['うわぁ', 'うわぁ……'], ['げほっ', 'げほっ、']] },
  { key: 'pause', label: '停顿/标点', items: [['短停顿', '[pause]'], ['长停顿', '[long pause]'], ['……', '……'], ['…', '…'], ['、', '、'], ['！', '！'], ['！！', '！！'], ['？', '？'], ['？！', '？！'], ['~', '~'], ['～？', '~？'], ['っ', 'っ'], ['——', '……']] },
  { key: 'rep', label: '叠字/结巴', items: [['首字结巴', '@stutter-first'], ['光标前一个字叠一下', '@stutter-cursor'], ['首字拖长', '@drag-first'], ['句尾拖长', '@drag-tail'], ['整句打碎', '@shatter']] },
  { key: 'zh', label: '语气词·中', items: [['嗯', '嗯'], ['嗯？', '嗯？'], ['唔', '唔'], ['呜', '呜'], ['呜呜', '呜呜'], ['啊', '啊'], ['啊？', '啊？'], ['哈', '哈'], ['哈啊', '哈啊'], ['呼', '呼……'], ['诶', '诶'], ['欸？', '欸？'],
    ['哼', '哼'], ['切', '切'], ['呀', '呀'], ['嘛', '嘛'], ['啦', '啦'], ['呢', '呢'], ['喂', '喂'], ['噗', '噗']] },
  { key: 'ja', label: '语气词·日', items: [['ん', 'ん'], ['ん？', 'ん？'], ['うん', 'うん'], ['う', 'う'], ['うぅ', 'うぅ'], ['あ', 'あ'], ['あっ', 'あっ'], ['え', 'え'], ['えっ', 'えっ'], ['は', 'は'], ['はぁ', 'はぁ……'], ['ふ', 'ふ'],
    ['ふふ', 'ふふ'], ['へへ', 'へへ'], ['ちっ', 'ちっ'], ['ねぇ', 'ねぇ'], ['よ', 'よ'], ['っ', 'っ'], ['ぐすっ', 'ぐすっ']] }];
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
const tagIn = v => (String(v).match(/^\[([^\]]+)\]$/) || [])[1] || '';
/** 按这个接口筛能点的：不认的不显示，免得点了没用；ja / zh 语气词只给对应语言的字 */
export function groupsFor(k, text) {
  const ja = /[\u3040-\u30ff]/.test(text);
  return OPTION_GROUPS.filter(g => !(g.key === 'ja' && !ja) && !(g.key === 'zh' && ja)).map(g => {
    if (k === 'inline') return g;
    if (g.key === 'emo') return k === 'plain' ? null : k === 'sentence' ? { ...g, label: '情绪（整段）' } : { ...g, label: '情绪（整段）', items: MM.map(([l, t]) => [l, `[${t}]`]) };
    if (g.key === 'voice') return k === 'plain' || k === 'mm' ? null : k === 'mm28' ? { ...g, items: g.items.filter(([, v]) => MM_SOUND[tagIn(v)]) } : { ...g, label: '声音（整段）' };
    return g;
  }).filter(Boolean);
}
/** 一组标签（一键演法）→ 这个接口真正用得上的 */
export function fitTags(tags, k) {
  if (k === 'plain') return [];
  if (k === 'mm' || k === 'mm28') {
    const emo = (MM_EMO.find(([re]) => re.test(tags.join(' '))) || [])[1];
    const canon = { happy: 'happy', sad: 'sad', angry: 'angry', fearful: 'scared', disgusted: 'disdainful', surprised: 'surprised', calm: 'calm' }[emo];
    return [...new Set([canon, ...(k === 'mm28' ? tags.filter(x => MM_SOUND[x]) : [])].filter(Boolean))].slice(0, 2);
  }
  return tags.slice(0, 2);
}
export const MM_EMOS = new Set(MM.map(x => x[1]));
const NAME = { fish: 'Fish Audio', 'minimax-cn': 'MiniMax 国内', 'minimax-intl': 'MiniMax 国际', 'openai-tts': 'OpenAI', 'custom-tts': '第三方', elevenlabs: 'ElevenLabs', indextts: 'IndexTTS', mimo: 'MiMo', 'doubao-tts': '豆包' };
/** 这个接口叫什么、认什么（调语气时上面那一行） */
export const profileOf = conn => {
  const k = kindOf(conn);
  return { k, name: conn ? `${conn.name || NAME[conn.type] || conn.type}${conn.model ? ' · ' + conn.model : ''}` : '还没设语音接口',
    note: { inline: '标签放在哪个字前面就从哪里生效，句中可以换情绪。', mm28: '情绪整段只有一个；句中只能插笑、叹气、倒抽气、喘、吸鼻子、清嗓、低哼和停顿。', mm: '只认整段一个情绪和停顿；声音用拟声字、叠字、标点。',
      sentence: '情绪、声音放在开头，整段生效（最多两个）。', plain: '不认标签：用拟声字、语气词、叠字、标点来演。' }[k] };
};
const SOUNDS = 'laughing, chuckling, sigh, gasp, panting, sniffling, clear throat, groan';
/** 给 AI 的一句：写故事时每段怎么标语气，按角色现在用的语音接口来 */
export const hintFor = k => ({
  inline: `每段开头用方括号写 1~2 个英文语气标签，写这段该怎么念（情绪、音量、笑 / 叹气 / 哭腔这类声音），比如 [gentle][soft tone]、[teasing][chuckling]、[sad][voice trembling]；情绪中途变了可以在句中再插一个。常用：${OPTION_GROUPS.slice(0, 2).flatMap(g => g.items.map(x => tagIn(x[1]))).join(', ')}。>> 开头的翻译行不写标签。`,
  sentence: `每段开头用方括号写最多 2 个英文语气标签（一个情绪 + 一个声音），比如 [gentle][soft tone]、[sad][voice trembling]，整段都按它念；句中不写标签，情绪变化用叠字、……、拟声字表达。>> 开头的翻译行不写标签。`,
  mm28: `每段开头用方括号写 1 个英文情绪标签，只能从这些里挑：${MM.map(x => x[1]).join(', ')}，整段都按这个情绪念；句中只可以插这几个声音标签：${SOUNDS}，和 [pause]；别的声音用拟声字、叠字、……、！表达。>> 开头的翻译行不写标签。`,
  mm: `每段开头用方括号写 1 个英文情绪标签，只能从这些里挑：${MM.map(x => x[1]).join(', ')}，整段都按这个情绪念；句中不写标签，声音用拟声字、叠字、……、！表达。>> 开头的翻译行不写标签。`,
  plain: '不写任何方括号标签；语气用叠字、语气词、拟声字（哈哈、唉……、呜……）、……、！！表达出来。',
})[k];
