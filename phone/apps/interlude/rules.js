// 幕间 · 跑团规则（《克苏鲁的呼唤》第七版的常用部分）：属性、技能、检定、理智。骰子都由手机掷，AI 只收结果。
export const d = n => 1 + Math.floor(Math.random() * n);
export const roll = (times, sides) => Array.from({ length: times }, () => d(sides)).reduce((a, b) => a + b, 0);
export const d100 = () => { const t = Math.floor(Math.random() * 10), u = Math.floor(Math.random() * 10); return { t, u, v: t === 0 && u === 0 ? 100 : t * 10 + u }; };

export const ATTRS = [['STR', '力量'], ['CON', '体质'], ['DEX', '敏捷'], ['APP', '外貌'], ['POW', '意志'], ['SIZ', '体型'], ['INT', '智力'], ['EDU', '教育'], ['LUCK', '幸运']];
/** 掷一套属性：力量 / 体质 / 敏捷 / 外貌 / 意志 / 幸运 3D6×5，体型 / 智力 / 教育 (2D6+6)×5 */
export const rollAttrs = () => Object.fromEntries(ATTRS.map(([k]) => [k, (['SIZ', 'INT', 'EDU'].includes(k) ? roll(2, 6) + 6 : roll(3, 6)) * 5]));
/** 由属性算出来的：血、理智、魔法、移动力 */
export const derived = a => ({ hp: Math.floor((a.CON + a.SIZ) / 10), san: a.POW, mp: Math.floor(a.POW / 5), mov: a.DEX < a.SIZ && a.STR < a.SIZ ? 7 : a.DEX > a.SIZ && a.STR > a.SIZ ? 9 : 8 });
// 车卡分点（规则书的「点数购买」）：8 项属性的总点数 = 团公告的购点（默认 460）+ 这个人那一档多给的（作者定的三档）；
// 每项 15～90（人类上限，再高就不是人了），体型、智力、教育至少 40；幸运照旧掷
export const TIERS = [['普通人', 0], ['能力者', 80], ['最强者', 160]];
const OLD_TIER = { 有本事的人: '能力者', 顶尖人物: '最强者' };   // 旧卡上的名字
export const tierOf = t => (TIERS.find(x => x[0] === (OLD_TIER[t] || t)) || [])[0];
export const budgetOf = (tier, base = 460) => base + (TIERS.find(t => t[0] === tier) || TIERS[0])[1];
export const minOf = k => ['SIZ', 'INT', 'EDU'].includes(k) ? 40 : 15;
export const attrSum = a => ATTRS.reduce((s, [k]) => s + (k === 'LUCK' ? 0 : a[k]), 0);
/** AI 分的属性：每项夹在范围里（有团公告就照公告的上下限）、取 5 的倍数，总数超了就从最高的往下扣 */
export function fixAttrs(given = {}, budget, r) {
  const a = {}, lo = k => Math.max(minOf(k), r ? r.attrMin : 0), hi = r ? r.attrMax : 90;
  for (const [k] of ATTRS) if (k !== 'LUCK') a[k] = Math.max(lo(k), Math.min(hi, Math.round((+given[k] || 50) / 5) * 5));
  for (let over = attrSum({ ...a, LUCK: 0 }) - budget; over > 0; over -= 5) {
    const k = Object.keys(a).filter(x => a[x] - 5 >= lo(x)).sort((x, y) => a[y] - a[x])[0]; if (!k) break; a[k] -= 5;
  }
  a.LUCK = roll(3, 6) * 5;
  return a;
}
// 特殊能力的几种（手机在战斗里能算的）：打人 / 护身 / 治疗 / 鼓舞；「剧情」只在剧情里用，KP 照描述判
export const POWERS = { atk: '攻击', guard: '护身', heal: '治疗', buff: '鼓舞', other: '剧情' };
/** 天命五选一：一次掷五套 */
export const fiveSets = () => Array.from({ length: 5 }, rollAttrs);

// 技能和基础值：照作者给的现代调查员卡（第七版）。点数分两份：本职点 EDU×4 只加本职技能，兴趣点 INT×2 + 50 只加其他技能；每项最高 90，成长也到 90 为止（作者定的）
// 初始值：规则书里低于 10 的都当 10，不花点（作者定的）；克苏鲁神话、信用评级照旧
export const SKILLS = { 侦查: 25, 聆听: 20, 图书馆使用: 20, 话术: 10, 说服: 10, 恐吓: 15, 魅惑: 15, 心理学: 10, 精神分析: 10, 潜行: 20, 急救: 30, 医学: 10, 神秘学: 10, 克苏鲁神话: 0,
  机械维修: 10, 电气维修: 10, 电子学: 10, 计算机使用: 10, 操作重机: 10, 锁匠: 10, 妙手: 10, 攀爬: 20, 跳跃: 20, 游泳: 20, 投掷: 20, 汽车驾驶: 20, 驾驶: 10, 领航: 10, 生存: 10, 追踪: 10,
  斗殴: 25, 手枪: 20, 步枪: 25, 历史: 10, 考古学: 10, 人类学: 10, 估价: 10, 会计: 10, 法律: 10, 科学: 10, 博物学: 10, 技艺: 10, 语言: 10, 乔装: 10, 信用评级: 0 };
export const MAX_SKILL = 90;
// 武器伤害只有这几档（作者定的）：名字随便写，伤害照档位挑，最重到步枪；AI 写了别的就换成最接近的一档
export const DMG = [['1D3', '很轻', '拳脚'], ['1D4', '轻', '小刀'], ['1D6', '中', '棍棒'], ['1D8', '重', '砍刀、长剑'], ['1D10', '很重', '手枪'], ['2D6', '最重', '步枪']];
const avg = d => { const [n, m] = d.toUpperCase().split('D').map(x => parseInt(x) || 1); return n * (m + 1) / 2; };
export const fitDmg = d => DMG.map(x => x[0]).reduce((a, b) => Math.abs(avg(b) - avg(d)) < Math.abs(avg(a) - avg(d)) ? b : a);
export const dmgRange = d => { const [n, m] = d.split('D').map(Number); return `${n}～${n * m}`; };
// 改过名的技能（旧卡里还是旧名字）：旧的「驾驶」是开车，现在的「驾驶」是开飞机、开船
const RENAMED = [['开锁', '锁匠'], ['导航', '领航'], ['驾驶', '汽车驾驶'], ['艺术', '技艺'], ['外语', '语言']];
export const renamed = sk => { const o = { ...sk }; for (const [a, b] of RENAMED) if (a in o && !(b in o)) { o[b] = o[a]; delete o[a]; } return o; };
export const baseSkills = a => ({ ...SKILLS, 闪避: Math.floor(a.DEX / 2), 母语: a.EDU });
/** 两份点各用了多少：本职点只加本职技能，兴趣点只加其他技能（作者定的，规则书里兴趣点也能加本职）；jobs 本职技能。兴趣点比规则书多给 50（作者定的） */
export function usage(a, sk, jobs = []) {
  const b = baseSkills(a), job = a.EDU * 4, hobby = a.INT * 2 + 50; let j = 0, o = 0;
  for (const [k, v] of Object.entries(sk)) { const n = Math.max(0, v - (b[k] ?? 0)); if (jobs.includes(k)) j += n; else o += n; }
  return { job: j, hobby: o, jobAll: job, hobbyAll: hobby };
}
/** AI 分好的技能：只认表里有的，最高 90（团公告定了技能上限就照公告：本职技能 max、其他 hobbyMax；母语一开始就等于教育，不管上限），没给的用基础值 */
export function fixSkills(a, given = {}, max = MAX_SKILL, hobbyMax = max, jobs = null) {
  const out = baseSkills(a), cap = k => k === '母语' ? MAX_SKILL : !jobs || jobs.includes(k) ? max : hobbyMax;
  for (const [k, v] of Object.entries(given)) if (k in out && Number.isFinite(+v)) out[k] = Math.max(k === '母语' ? 10 : out[k], Math.min(cap(k), Math.round(+v)));   // 母语能往下减到 10（不退点）
  return out;
}
/** 常见职业：本职技能（换职业时按这个重新分职业点）、信用评级的范围（照规则书；学生、艺术家、神秘学家、司机四个没查到出处，是记得的数） */
export const JOBS = [['私家侦探', '侦查 聆听 心理学 乔装 锁匠 话术 手枪 法律', [9, 30]], ['记者', '侦查 聆听 话术 心理学 图书馆使用 历史 母语 潜行', [9, 30]], ['医生', '医学 急救 心理学 科学 语言 说服 聆听 信用评级', [30, 80]],
  ['警探', '侦查 聆听 心理学 恐吓 手枪 斗殴 法律 汽车驾驶', [20, 50]], ['教授', '图书馆使用 历史 语言 说服 心理学 考古学 科学 信用评级', [20, 70]], ['学生', '图书馆使用 语言 侦查 聆听 心理学 科学 历史 说服', [5, 10]],
  ['作家', '图书馆使用 历史 心理学 神秘学 技艺 母语 侦查 话术', [9, 30]], ['律师', '法律 说服 心理学 图书馆使用 话术 信用评级 侦查 聆听', [30, 80]], ['古董商', '估价 历史 考古学 侦查 话术 说服 图书馆使用 语言', [30, 70]],
  ['护士', '急救 医学 心理学 聆听 侦查 说服 科学 潜行', [9, 30]], ['艺术家', '技艺 心理学 侦查 魅惑 历史 话术 聆听 语言', [9, 50]], ['退伍军人', '步枪 手枪 斗殴 急救 生存 攀爬 潜行 恐吓', [9, 30]],
  ['神秘学家', '神秘学 历史 图书馆使用 语言 心理学 侦查 考古学 说服', [9, 65]], ['司机', '汽车驾驶 机械维修 领航 侦查 聆听 话术 斗殴 心理学', [9, 20]]];
/** 一张卡的本职技能：车卡时定的（AI 写的、自己标的），没有就照职业表 */
export const jobsOf = c => { const l = c.jobSkills || ((JOBS.find(j => j[0] === c.job) || [])[1] || '').split(' ').filter(Boolean); return l.includes('信用评级') ? l : [...l, '信用评级']; };   // 信用评级总算本职（规则书）
/** 信用评级能在多少到多少：照职业，表里没有的职业不限 */
export const crOf = job => (JOBS.find(j => j[0] === job) || [])[2] || [0, 99];
export const crFit = (v, job) => { const [lo, hi] = crOf(job); return Math.max(lo, Math.min(hi, +v || 0)); };
/** 信用评级 → [消费水平, 现金, 资产]：规则书现代那张表（美元） */
export const wealth = cr => cr <= 0 ? ['身无分文', 10, 0] : cr < 10 ? ['穷', cr * 20, cr * 200] : cr < 50 ? ['普通', cr * 40, cr * 1000]
  : cr < 90 ? ['有钱', cr * 100, cr * 1e4] : cr < 99 ? ['很有钱', cr * 400, cr * 4e4] : ['超级富豪', 1e6, 1e8];
/** 美元换成当地的钱（团公告里 KP 按故事的年代、地方给的汇率），写成「16 万日元」 */
export const moneyText = (usd, m) => { const n = usd * m.rate, f = x => String(+x.toPrecision(2)); return (n >= 1e8 ? f(n / 1e8) + ' 亿' : n >= 1e4 ? f(n / 1e4) + ' 万' : f(n) + ' ') + m.unit; };
/** 按职业分职业点：越靠前的本职技能分得越多；兴趣点留着自己加 */
export function jobSkills(a, job) {
  const out = baseSkills(a), list = ((JOBS.find(j => j[0] === job) || [])[1] || '').split(' ').filter(k => k in out);
  const w = [.2, .18, .15, .13, .1, .09, .08, .07], lo = crOf(job)[0]; let left = a.EDU * 4 - lo; out.信用评级 = lo;   // 信用评级先放到职业的最低档
  list.forEach((k, i) => { const add = Math.min(MAX_SKILL - out[k], Math.round(a.EDU * 4 * w[i] / 5) * 5, left); out[k] += add; left -= add; });
  return out;
}

export const LEVELS = { 普通: 1, 困难: 2, 极难: 5 };
export const CRITS = [['book', '规则书：01 大成功，100 大失败（技能低于 50 时 96～100）'], ['3', '1～3 大成功，98～100 大失败'], ['5', '1～5 大成功，96～100 大失败']];
/** 一次检定：掷 1D100，对技能值。level = 普通 / 困难 / 极难，crit = 大成功大失败用哪一档。返回 { v, t, u, ok, grade } */
// 奖励骰 / 惩罚骰：多掷几个十位骰，奖励挑小的、惩罚挑大的（bonus 正数奖励、负数惩罚，最多各两个）
function tens(r, bonus) {
  if (!bonus) return r;
  const val = t => t === 0 && r.u === 0 ? 100 : t * 10 + r.u, all = [r.t, ...Array.from({ length: Math.min(2, Math.abs(bonus)) }, () => d(10) - 1)];
  const t = all.reduce((a, b) => (bonus > 0 ? val(b) < val(a) : val(b) > val(a)) ? b : a);
  return { t, u: r.u, v: val(t) };
}
export function check(skill, level = '普通', crit = 'book', bonus = 0) {
  const r = tens(d100(), bonus), v = r.v, need = Math.floor(skill / (LEVELS[level] || 1));
  const big = crit === 'book' ? v === 1 : v <= +crit, bad = crit === 'book' ? (skill < 50 ? v >= 96 : v === 100) : v >= 101 - +crit;
  const grade = big ? '大成功' : bad ? '大失败' : v > need ? '失败' : v <= Math.floor(skill / 5) ? '极难成功' : v <= Math.floor(skill / 2) ? '困难成功' : '普通成功';
  return { ...r, need, ok: big || (!bad && v <= need), grade };
}
/** 对抗：两边各掷一次，成功等级高的赢；平了比技能值 */
export const rank = r => r.grade === '大失败' ? -1 : r.grade === '失败' ? 0 : r.grade === '普通成功' ? 1 : r.grade === '困难成功' ? 2 : 3;
export function opposed(mine, theirs, crit) {
  const a = check(mine, '普通', crit), b = check(theirs, '普通', crit);
  return { a, b, win: rank(a) !== rank(b) ? rank(a) > rank(b) : mine >= theirs };
}
/** 掷伤害 / 掉理智这种「1D6」「2D4+1」「0」；top：不掷，直接取最大（极难成功打满） */
export function dice(expr, top) {
  const m = /^(\d*)[dD](\d+)([+-]\d+)?$/.exec(String(expr).trim());
  if (!m) return Math.max(0, parseInt(expr, 10) || 0);
  return Math.max(0, (top ? (+m[1] || 1) * +m[2] : roll(+m[1] || 1, +m[2])) + (+m[3] || 0));
}
/** 伤害加值（近战才加）：看力量 + 体型 */
export const db = a => { const s = a.STR + a.SIZ; return s < 65 ? -2 : s < 85 ? -1 : s < 125 ? 0 : s < 165 ? dice('1D4') : dice('1D6'); };
/** 体格（比大小用：擒抱、按倒这类战技，对方大一级多一个惩罚骰，大三级做不了） */
export const build = a => { const s = a.STR + a.SIZ; return s < 65 ? -2 : s < 85 ? -1 : s < 125 ? 0 : s < 165 ? 1 : 2; };
/** 理智检定：loss 写成「成功掉/失败掉」，比如 1/1D6 */
export function sanCheck(san, loss, crit) {
  const [ok, no] = String(loss || '0/1D4').split('/'), r = check(san, '普通', crit);
  return { ...r, lost: dice(r.ok ? ok : (no ?? ok)) };
}
// 一次掉 5 点以上就会临时发疯：掷一个症状（第七版那张 1D10 表），持续几轮
export const MADNESS = ['失忆', '假性残疾', '暴力倾向', '偏执', '依恋某个人', '昏厥', '逃跑', '歇斯底里', '恐惧症', '躁狂'];
export const madness = () => ({ name: MADNESS[d(10) - 1], left: d(10) });

export const MOODS = [['serious', '正经'], ['light', '轻松'], ['fun', '整活']];
export const MOOD_TEXT = { serious: '正经的克苏鲁：压抑、恐惧、慢慢逼近的不对劲；角色们认真对待一切。', light: '轻松：有惊无险，角色们可以打趣、耍宝，但主线仍然推进。', fun: '相声团：怎么离谱怎么来，角色们大胆玩梗、互相拆台，KP 也一起玩，但规则照掷。' };

/** 场景照片：AI 只能从这些地点里挑 */
export const PLACES = { hall: '老宅客厅（壁炉、蒙布的家具、落地钟）', corridor: '旅馆长走廊', cellar: '地下室（石墙、木箱）', 'street-night': '雨夜街道', woods: '雾中林间小路', pier: '海边木码头（灯塔）', room: '旅馆房间',
  chapel: '荒废小教堂', hospital: '老医院病房走廊', study: '书房 / 图书室', train: '夜行火车车厢', cabin: '雪夜山中小屋', 'street-day': '白天的繁华大街（电车）', bar: '小酒吧', ship: '游轮甲板', park: '游乐园（旋转木马）', apartment: '公寓客厅', cafe: '咖啡馆靠窗的桌子' };
export const placeOf = k => (k in PLACES ? k : 'hall');

/** 内置的本（都是自己写的）：骨架给定，人物卡和开场白仍由 AI 按这一局的人来写 */
export const SCENARIOS = [
  { id: 'ward7', title: '雪夜，第七病房', blurb: '山里的老疗养院，大雪封路，第七病房的病人一夜之间都不见了。',
    acts: [{ title: '封路', goal: '到达被雪困住的疗养院，弄清第七病房为什么空了', place: 'cabin', exit: '从值夜护士或病历里得知病人是「自己走出去的」' },
      { title: '病历', goal: '在病房和档案里找到病人们共同的异常：都画同一座塔', place: 'hospital', exit: '找到通往锅炉房 / 地下的线索' },
      { title: '地下', goal: '在地下室面对把病人引走的东西', place: 'cellar', exit: '阻止它，或者逃出去' }],
    secret: '疗养院的院长用一本旧书做「安眠疗法」，病人在梦里被同一个声音召唤，夜里结伴走进后山的雪里；院长自己已经半疯，地下室里是他挖出的「塔基」。', endings: { good: '烧掉那本书，病人在雪地里被找回，院长被带走。', bad: '调查员也听见了那个声音，雪夜里多了几行脚印。' } },
  { id: 'lastTrain', title: '末班车不停', blurb: '夜里十一点的末班车过了该停的站没停，车厢里的人一个个变得不对劲。',
    acts: [{ title: '过站', goal: '发现末班车没有停、车窗外一片黑，和同车的人交谈', place: 'train', exit: '意识到乘客里有人「不该在这」' },
      { title: '查票', goal: '在乘务员和乘客之间找到车是被谁留住的', place: 'train', exit: '找到那张写着终点站的旧票' },
      { title: '终点', goal: '在列车停下的那个站做出选择', place: 'street-night', exit: '下车或留下' }],
    secret: '车上的一个乘客二十年前在这趟车上出了事，每年同一夜列车会为他多开一站；今晚他想带一个人替他留下。', endings: { good: '把那张旧票还给他，列车在天亮前回到正常的轨道。', bad: '有人替他留在了那一站，第二天报纸上多了一个失踪的人。' } },
  { id: 'lighthouse', title: '灯塔的信', blurb: '码头酒吧收到一封寄给「还没来的人」的信，灯塔已经十年没亮，昨晚却亮了。',
    acts: [{ title: '信', goal: '在酒吧问出这封信的来历，灯塔守的下落', place: 'bar', exit: '得知灯塔守十年前失踪，信每年都寄到' },
      { title: '码头', goal: '夜里去码头，找船去灯塔', place: 'pier', exit: '找到愿意渡人的船家，或自己划过去' },
      { title: '灯塔', goal: '在灯塔里见到写信的人', place: 'ship', exit: '回答他的问题' }],
    secret: '灯塔守十年前为救沉船的人自己沉了海，他每年写信求一个人替他把灯点亮一次；点灯的人会看见海底的船和船上的人。', endings: { good: '点亮灯塔，沉船的人终于上岸，信不再寄来。', bad: '点灯的人看见了船上自己的位置。' } },
];
