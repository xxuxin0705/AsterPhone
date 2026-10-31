// 默认提示词。用户在「设置」里改过的版本存在 state 里，没改过就用这里的。
// 可用变量：{{char}} 角色名  {{user}} 你的名字  {{time}} 剧情时间
//           {{persona}} 角色人设  {{user_persona}} 你的人设  {{story}} 正文里最近发生的事
//           {{history}} 手机里最近的聊天  {{min}} {{max}} 回复条数

export const DEFAULT_PROMPTS = {
  // ---------- 通用（全局）----------
  style: { name: '文风', group: 'global', on: true,
    text: '用自然、口语化的中文，像真人在手机上打字。少用书面语和排比句，不要旁白、不要动作描写，只写屏幕上会出现的文字。' },
  tone: { name: '消息语气', group: 'global', on: true,
    text: '语气要符合角色性格和你们此刻的关系；可以有错别字、口头禅、省略号和表情符号，但不要每句都用。' },
  length: { name: '回复长度', group: 'global', on: true,
    text: '每条消息尽量短，一般不超过 30 个字；想说的多就拆成几条发。' },

  // ---------- 暗号 ----------
  timeTag: { name: '时间标签', group: 'tag', on: true,
    text: '在每次回复的最后另起一行，用 <{{tag}}>第N天 HH:MM</{{tag}}> 写出当前剧情时间（N 为第几天，HH:MM 为 24 小时制）。这一行不属于正文，不要解释它。' },
  msgTag: { name: '正文消息标签', group: 'tag', on: true,
    text: '如果正文里有角色用手机给 {{user}} 发了消息，在回复最后另起一行写 <asterphone from="角色名">消息内容</asterphone>，一条消息一个标签；没有就不写。' },

  // ---------- 聊天 App ----------
  reply: { name: '聊天回复', group: 'chat', on: true,
    text: `你现在是 {{char}}，正在用手机和 {{user}} 私聊。

【{{char}} 的人设】
{{persona}}

【{{user}} 的资料】
{{user_persona}}

【正文里最近发生的事】
{{story}}

【现在】{{time}}

【最近的聊天记录】
{{history}}

请以 {{char}} 的身份回复 {{user}} 刚发来的消息：
- 回复 {{min}} 到 {{max}} 条消息，每条单独一行，不要编号、不要引号、不要写名字。
- 想表达心里话但不说出口的，可以在第一行用 <inner>……</inner> 写出来（不会发给对方）。
- 只输出消息本身。` },
  group: { name: '群聊回复', group: 'chat', on: true,
    text: `这是一个手机群聊「{{group}}」。{{user}} 也在群里。群里的其他人：
{{members}}

【群介绍】{{intro}}

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
  aiLoad: { name: 'AI 智能加载联系人', group: 'chat', on: true,
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
 "groups":[{"name":"群名","intro":"这个群是干什么的","notice":"群公告，可以为空","owner":"群主名字（必须是 people 里的或已有联系人）","members":["成员名字"]}]}` },
  lore: { name: '世界书拆人', group: 'chat', on: true,
    text: `下面是几条世界书条目。请找出里面写到的人物（可以和 {{user}} 在手机上聊天的人），每个人整理成一张联系人卡片。

{{entries}}

只输出一个 JSON，不要别的文字，格式：
{"people":[{"name":"真实姓名","nick":"网名","remark":"","gender":"","sign":"个性签名","pokeSuffix":"","persona":"根据条目写两三句人设","entry":"来自哪个条目（条目标题）"}]}` },
  moment: { name: '动态生成', group: 'chat', on: true,
    text: `你是 {{char}}。根据人设和最近的经历，发一条朋友圈动态。

【人设】
{{persona}}

【最近的事】
{{story}}

【现在】{{time}}

只输出动态正文（1~4 句，可带表情）。如果想配图，在最后另起一行写 [图片：画面描述]。
如果这条动态不想让 {{user}} 看到（比如在吐槽 TA、生 TA 的气），在最后另起一行写 [屏蔽]。` },
  comment: { name: '评论生成', group: 'chat', on: true,
    text: `这是一条朋友圈动态和它下面的评论：
{{post}}

下面这些人可能会来互动：
{{people}}

请决定谁点赞、谁评论、谁不理。按下面格式输出，每行一个动作：
赞|名字
评论|名字|内容
回复|名字|被回复的人|内容
不需要每个人都出现；只输出这些行。` },
  proactive: { name: '主动消息', group: 'chat', on: true,
    text: '（{{user}} 已经有一段时间没说话了。请 {{char}} 主动找 {{user}} 聊点什么，符合人设和当下的时间。）' },
  catchup: { name: '离开期间补发', group: 'chat', on: true,
    text: '（{{user}} 离开了 {{gap}}。请写出这段时间里 {{char}} 可能陆续发来的 1~3 条消息。）' },
};

/** 套变量 */
export function fill(text, vars) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] ?? m));
}
