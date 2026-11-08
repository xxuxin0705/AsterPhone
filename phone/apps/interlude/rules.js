// 幕间 · 跑团规则（《克苏鲁的呼唤》第七版的常用部分）：属性、技能、检定、理智。骰子都由手机掷，AI 只收结果。
export const d = n => 1 + Math.floor(Math.random() * n);
export const roll = (times, sides) => Array.from({ length: times }, () => d(sides)).reduce((a, b) => a + b, 0);
export const d100 = () => { const t = Math.floor(Math.random() * 10), u = Math.floor(Math.random() * 10); return { t, u, v: t === 0 && u === 0 ? 100 : t * 10 + u }; };

export const ATTRS = [['STR', '力量'], ['CON', '体质'], ['DEX', '敏捷'], ['APP', '外貌'], ['POW', '意志'], ['SIZ', '体型'], ['INT', '智力'], ['EDU', '教育'], ['LUCK', '幸运']];
/** 掷一套属性：力量 / 体质 / 敏捷 / 外貌 / 意志 / 幸运 3D6×5，体型 / 智力 / 教育 (2D6+6)×5 */
export const rollAttrs = () => Object.fromEntries(ATTRS.map(([k]) => [k, (['SIZ', 'INT', 'EDU'].includes(k) ? roll(2, 6) + 6 : roll(3, 6)) * 5]));
/** 由属性算出来的：血、理智、魔法、移动力 */
export const derived = a => ({ hp: Math.floor((a.CON + a.SIZ) / 10), san: a.POW, mp: Math.floor(a.POW / 5), mov: a.DEX < a.SIZ && a.STR < a.SIZ ? 7 : a.DEX > a.SIZ && a.STR > a.SIZ ? 9 : 8 });
/** 天命五选一：一次掷五套 */
export const fiveSets = () => Array.from({ length: 5 }, rollAttrs);

// 技能和基础值（第七版）。点数：职业 EDU×4 + 兴趣 INT×2，每项最高 80（新手卡的常见房规）
export const SKILLS = { 侦查: 25, 聆听: 20, 图书馆使用: 20, 话术: 5, 说服: 10, 恐吓: 15, 魅惑: 15, 心理学: 10, 潜行: 20, 急救: 30, 医学: 1, 神秘学: 5, 克苏鲁神话: 0,
  机械维修: 10, 开锁: 1, 妙手: 10, 攀爬: 20, 跳跃: 20, 游泳: 20, 驾驶: 20, 导航: 10, 生存: 10, 斗殴: 25, 手枪: 20, 步枪: 25, 历史: 5, 考古学: 1, 估价: 5, 法律: 5,
  科学: 1, 艺术: 5, 外语: 1, 追踪: 10, 乔装: 5, 信用评级: 0 };
export const MAX_SKILL = 80;
export const baseSkills = a => ({ ...SKILLS, 闪避: Math.floor(a.DEX / 2), 母语: a.EDU });
export const points = a => a.EDU * 4 + a.INT * 2;
export const spent = (a, sk) => { const b = baseSkills(a); return Object.entries(sk).reduce((n, [k, v]) => n + Math.max(0, v - (b[k] ?? 0)), 0); };
/** AI 分好的技能：只认表里有的，最高 80，没给的用基础值 */
export function fixSkills(a, given = {}) {
  const out = baseSkills(a);
  for (const [k, v] of Object.entries(given)) if (k in out && Number.isFinite(+v)) out[k] = Math.max(out[k], Math.min(MAX_SKILL, Math.round(+v)));
  return out;
}
/** 常见职业和它的本职技能（换职业时按这个重新分职业点） */
export const JOBS = [['私家侦探', '侦查 聆听 心理学 乔装 开锁 话术 手枪 法律'], ['记者', '侦查 聆听 话术 心理学 图书馆使用 历史 母语 潜行'], ['医生', '医学 急救 心理学 科学 外语 说服 聆听 信用评级'],
  ['警探', '侦查 聆听 心理学 恐吓 手枪 斗殴 法律 驾驶'], ['教授', '图书馆使用 历史 外语 说服 心理学 考古学 科学 信用评级'], ['学生', '图书馆使用 外语 侦查 聆听 心理学 科学 历史 说服'],
  ['作家', '图书馆使用 历史 心理学 神秘学 艺术 母语 侦查 话术'], ['律师', '法律 说服 心理学 图书馆使用 话术 信用评级 侦查 聆听'], ['古董商', '估价 历史 考古学 侦查 话术 说服 图书馆使用 外语'],
  ['护士', '急救 医学 心理学 聆听 侦查 说服 科学 潜行'], ['艺术家', '艺术 心理学 侦查 魅惑 历史 话术 聆听 外语'], ['退伍军人', '步枪 手枪 斗殴 急救 生存 攀爬 潜行 恐吓'],
  ['神秘学家', '神秘学 历史 图书馆使用 外语 心理学 侦查 考古学 说服'], ['司机', '驾驶 机械维修 导航 侦查 聆听 话术 斗殴 心理学']];
/** 按职业分职业点：越靠前的本职技能分得越多；兴趣点留着自己加 */
export function jobSkills(a, job) {
  const out = baseSkills(a), list = ((JOBS.find(j => j[0] === job) || [])[1] || '').split(' ').filter(k => k in out);
  const w = [.2, .18, .15, .13, .1, .09, .08, .07]; let left = a.EDU * 4;
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
