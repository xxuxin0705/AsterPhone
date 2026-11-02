// 内置提示词：只能看、能复制，不能改。每一块属于一个或几个「分类」（cats），
// 分类里打开的块按顺序拼起来发出去（见 core/promptstore.js 的 compose）。
// 可用变量：{{char}} 角色名  {{user}} 你的名字  {{time}} 剧情时间
//           {{persona}} 角色人设  {{user_persona}} 你的人设  {{story}} 正文里最近发生的事
//           {{history}} 手机里最近的聊天  {{min}} {{max}} 回复条数  {{world}} 世界书（没有就是空的）

/** 分类：按应用分，应用里再细分。vars = 这一类能用的变量 */
export const PROMPT_CATS = [
  { app: '聊天', items: [
    { id: 'dm', name: '私聊', vars: ['char', 'user', 'persona', 'user_persona', 'world', 'story', 'time', 'history', 'min', 'max'] },
    { id: 'group', name: '群聊', vars: ['group', 'user', 'members', 'intro', 'world', 'story', 'time', 'history', 'max'] },
    { id: 'moment', name: '发动态', vars: ['char', 'user', 'persona', 'world', 'story', 'time'] },
    { id: 'comment', name: '动态评论', vars: ['post', 'people', 'time', 'user'] },
    { id: 'proactive', name: '主动消息', vars: ['char', 'user'] },
    { id: 'catchup', name: '离开期间补发', vars: ['char', 'user', 'gap'] },
    { id: 'verify', name: '好友验证', vars: ['char', 'user', 'persona', 'story', 'text'] },
    { id: 'aiLoad', name: 'AI 加载联系人', vars: ['user', 'cards', 'user_persona', 'story', 'existing', 'require', 'withGroups'] },
    { id: 'lore', name: '世界书拆人', vars: ['user', 'entries', 'existing'] },
  ] },
  { app: '音乐', items: [
    { id: 'review', name: '乐评', vars: ['user', 'song', 'lyrics', 'note', 'reviews', 'people', 'must', 'count', 'strangers'] },
    { id: 'charSongs', name: '角色歌单', vars: ['char', 'persona', 'story', 'existing', 'count'] },
  ] },
  { app: '正文', items: [{ id: 'tag', name: '暗号', vars: ['user', 'tag'] }] },
];

export const DEFAULT_PROMPTS = {
  // ---------- 私聊 / 群聊共用的说话方式 ----------
  style: { name: '文风', cats: ['dm', 'group'], on: true,
    text: '用自然、口语化的中文，像真人在手机上打字。少用书面语和排比句，不要旁白、不要动作描写，只写屏幕上会出现的文字。' },
  tone: { name: '消息语气', cats: ['dm', 'group'], on: true,
    text: '语气要符合角色性格和你们此刻的关系；可以有错别字、口头禅、省略号和表情符号，但不要每句都用。' },
  length: { name: '回复长度', cats: ['dm', 'group'], on: true,
    text: '每条消息尽量短，一般不超过 30 个字；想说的多就拆成几条发。' },

  // ---------- 暗号 ----------
  timeTag: { name: '时间标签', cats: ['tag'], on: true,
    text: '在每次回复的最后另起一行，用 <{{tag}}>YYYY年M月D日 · 地点 · HH:MM</{{tag}}> 写出故事此刻的日期、所在地点和时间（24 小时制），例如 <{{tag}}>2026年11月1日 · 东京 · 21:20</{{tag}}>。故事没写明年份或日期时，按剧情合理推定，并且前后保持一致。这一行不属于正文，不要解释它。' },
  msgTag: { name: '正文消息标签', cats: ['tag'], on: true,
    text: '如果正文里有角色在手机上和 {{user}} 互动，在回复最后另起一行留暗号，没有就不写。\n<asterphone from="角色名">内容</asterphone>：一个人一个标签，一行一条。普通消息直接写；其他写法：[语音] 说的话、[图片] 画面、[表情包] 名字、[位置] 地点、[名片] 被推的人的名字、[转账] 金额 | 备注、[红包] 金额 | 祝福语、[拍一拍]、[收下] 或 [退还]（收了 / 退了 {{user}} 的转账红包）、[撤回]（撤回刚发的一条）、[语音通话] 或 [视频通话]（打电话过来）。发在群里的加 group="群名"。\n另外几种加 type：发动态 type="动态"（内容是动态正文，配图写 [图片] 画面）；给 {{user}} 的动态点赞 type="点赞"、评论 type="评论"（内容是评论）；加 {{user}} 好友 type="加好友"（内容可写打招呼的话）；把 {{user}} 删了 type="删好友"、拉黑 type="拉黑"、解除拉黑 type="取消拉黑"（内容空着）；拉 {{user}} 进群 type="拉群" group="群名"（内容写群里还有谁，用、隔开）；叫 {{user}} 一起听歌 type="一起听"（内容写 歌名 - 歌手）。' },

  // ---------- 聊天 App ----------
  reply: { name: '私聊回复', cats: ['dm'], on: true, main: true,
    text: `你现在是 {{char}}，正在用手机和 {{user}} 私聊。

【{{char}} 的人设】
{{persona}}

【{{user}} 的资料】
{{user_persona}}
{{world}}
【正文里最近发生的事】
{{story}}

【现在】{{time}}

【最近的聊天记录】
{{history}}

请以 {{char}} 的身份回复 {{user}} 刚发来的消息：
- 回复 {{min}} 到 {{max}} 条消息，每条单独一行，不要编号、不要引号、不要写名字。
- 想表达心里话但不说出口的，可以在第一行用 <inner>……</inner> 写出来（不会发给对方）。
- 只输出消息本身。` },
  group: { name: '群聊回复', cats: ['group'], on: true, main: true,
    text: `这是一个手机群聊「{{group}}」。{{user}} 也在群里。群里的其他人：
{{members}}

【群介绍】{{intro}}
{{world}}
【正文里最近发生的事】
{{story}}

【现在】{{time}}

【最近的群聊记录】
{{history}}

请决定接下来谁在群里说话：最多 {{max}} 个人，不是每个人都要说；剧情里在忙、没看手机的人就不说。
被 @ 的人优先回复。每人可以连发几条。按下面格式输出，每行一条消息：
名字：消息内容
如果有人想私下单独找 {{user}}（比如不好意思在群里说、想吐槽群里的人），写成：
私聊|名字：消息内容
只输出这些行，不要别的。` },
  aiLoad: { name: 'AI 智能加载联系人', cats: ['aiLoad'], on: true, main: true,
    text: `你在帮 {{user}} 布置一部手机里的通讯录。请根据下面的角色卡和剧情，想出 {{user}} 手机里会有哪些联系人{{withGroups}}。

【角色卡】
{{cards}}

【{{user}} 的资料】
{{user_persona}}

【正文里最近发生的事】
{{story}}

【已经有的联系人（不要重复）】
{{existing}}

【要求】
{{require}}

只输出一个 JSON，不要别的文字，格式：
{"people":[{"name":"真实姓名","nick":"网名","remark":"{{user}} 给 TA 的备注","gender":"男/女/其他","sign":"个性签名","pokeSuffix":"拍一拍后缀，比如 的小脑袋","persona":"两三句人设：身份、性格、和 {{user}} 的关系"}],
 "groups":[{"name":"群名","intro":"这个群是干什么的","notice":"群公告，可以为空","owner":"群主名字（people 里的、已有联系人或 {{user}}）","members":["成员名字"],"titles":{"成员名字":"群头衔（有才写，也可以给 {{user}}）"}}]}` },
  // ---------- 音乐 ----------
  review: { name: '乐评', cats: ['review'], on: true, main: true,
    text: `{{user}} 在听《{{song}}》，把这几句歌词收进了笔记：
{{lyrics}}

【{{user}} 写的感悟】
{{note}}

【已经有的乐评】
{{reviews}}

【可以来写乐评的人】
{{people}}

请写 {{count}} 条乐评，像网易云评论区那样：有人聊歌、有人聊自己的事、有人回应 {{user}} 写的感悟，长短不一，别都一个腔调。{{must}}{{strangers}}
每条一行，格式：名字|内容。路人写成：路人|随便起个网名|内容。只输出这些行。` },
  charSongs: { name: '角色歌单', cats: ['charSongs'], on: true, main: true,
    text: `你是 {{char}}。按你的人设和最近的经历，挑 {{count}} 首你会放进自己歌单的歌（真实存在、网易云能搜到的，别和已有的重复）。

【人设】
{{persona}}

【最近的事】
{{story}}

【歌单里已经有的】
{{existing}}

每行一首，格式：歌名 - 歌手。只输出这些行。` },
  lore: { name: '世界书拆人', cats: ['lore'], on: true, main: true,
    text: `下面是几条世界书条目。请找出里面写到的人物（可以和 {{user}} 在手机上聊天的人），每个人整理成一张联系人卡片。

{{entries}}

【已经有的联系人（不要重复）】
{{existing}}

只输出一个 JSON，不要别的文字，格式：
{"people":[{"name":"真实姓名","nick":"网名","remark":"","gender":"","sign":"个性签名","pokeSuffix":"","persona":"根据条目写两三句人设","entry":"来自哪个条目（条目标题）"}]}` },
  moment: { name: '动态生成', cats: ['moment'], on: true, main: true,
    text: `你是 {{char}}。根据人设和最近的经历，发一条朋友圈动态。

【人设】
{{persona}}
{{world}}
【最近的事】
{{story}}

【现在】{{time}}

只输出动态正文（1~4 句，可带表情）。如果想配图，在最后另起一行写 [图片：画面描述]。
如果这条动态不想让 {{user}} 看到（比如在吐槽 TA、生 TA 的气），在最后另起一行写 [屏蔽]。` },
  comment: { name: '评论生成', cats: ['comment'], on: true, main: true,
    text: `这是一条朋友圈动态和它下面的评论：
{{post}}

下面这些人可能会来互动：
{{people}}

请决定谁点赞、谁评论、谁不理。按下面格式输出，每行一个动作：
赞|名字
评论|名字|内容
回复|名字|被回复的人|内容
不需要每个人都出现；只输出这些行。` },
  proactive: { name: '主动消息', cats: ['proactive'], on: true, main: true,
    text: '（{{user}} 已经有一段时间没说话了。请 {{char}} 主动找 {{user}} 聊点什么，符合人设和当下的时间。）' },
  verify: { name: '好友验证', cats: ['verify'], on: true, main: true,
    text: '{{char}} 之前把 {{user}} 的好友删了。现在 {{user}} 发来朋友验证：「{{text}}」\n\n【{{char}} 的人设】\n{{persona}}\n\n【正文里最近发生的事】\n{{story}}\n\n结合人设和剧情，{{char}} 会通过吗？只回答「通过」或「不通过」。' },
  catchup: { name: '离开期间补发', cats: ['catchup'], on: true, main: true,
    text: '（{{user}} 离开了 {{gap}}。请写出这段时间里 {{char}} 可能陆续发来的 1~3 条消息。）' },
};

/** 套变量 */
export function fill(text, vars) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] ?? m));
}
