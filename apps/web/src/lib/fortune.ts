/**
 * 确定性「今日运势」生成器（占星层，仅供娱乐、非科学结论）。
 *
 * 约束：同一天 + 同一星座在任何设备上必须得到同一份运势——
 * 种子 = 本地日期 YYYYMMDD 与星座缩写的散列，mulberry32 展开，
 * 抽取顺序固定（整体文→整体星→爱情文→爱情星→事业→健康），
 * 中途不得插入新的 rng() 调用，否则历史运势整体漂移。
 *
 * 语料为本项目原创中文文案：健康条目均为生活方式建议（无医疗表述），
 * 全库无投资建议、无任何官方命名/产权措辞。
 */

/** 单项运势：文案 + 星级（1–5）。 */
export interface FortuneLine {
  text: string;
  stars: number;
}

/** 一份完整的当日运势。 */
export interface DailyFortune {
  overall: FortuneLine;
  love: FortuneLine;
  career: FortuneLine;
  health: FortuneLine;
}

/** mulberry32：32 位种子的轻量确定性 PRNG（足够均匀，无需引依赖）。 */
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 日期整数 + 星座缩写 → 32 位种子（31 进制滚动散列，缩写大小写敏感）。 */
function seedOf(ymd: number, abbr: string): number {
  let h = ymd >>> 0;
  for (const c of abbr) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * 运势语料库：4 类 × 10 条。仅追加、勿重排——条目顺序参与确定性抽取，
 * 重排会让同一天的运势换文案。
 */
export const FORTUNE_POOLS: Record<keyof DailyFortune, readonly string[]> = {
  overall: [
    '今天的你像晴夜的北极星，方向感极好，按自己的节奏走就对了。',
    '一些小事会像流星掠过，别追，安静看它发光就好。',
    '宇宙今天不催你，慢慢来，把一件事做完就已足够闪耀。',
    '你身边藏着一颗愿意照亮你的星，留意那句不经意的问候。',
    '适合整理与告别的一天，腾出的位置会被新的星光填上。',
    '直觉今天格外准，像老练的观星人，一眼认出属于自己的星。',
    '会有一个小惊喜，像云缝里忽然露出的银河，值得抬头。',
    '今天宜守不宜攻，星星也要等天全黑才登场。',
    '有些答案要再等等，光走了很多年才抵达，你也可以慢一点。',
    '今天的能量像满月，明亮但汹涌，记得给自己留一片暗处休息。',
  ],
  love: [
    '心里的话别再绕轨道了，今天适合让它直线飞向那个人。',
    '两个人像双星，绕得再远也共享同一个引力中心，别怕距离。',
    '单身的你今天亮度加一等，有人正偷偷把你标进 TA 的星图。',
    '一次安静的陪伴胜过十句情话，一起看会儿夜空吧。',
    '旧的星等记录该更新了，别用过去的亮度衡量现在的 TA。',
    '今晚的月色适合坦白，也适合原谅。',
    '感情里的小阴云只是路过，别把它当成整片天气。',
    '把「在吗」换成「我看到一颗很亮的星，想起你」，效果翻倍。',
    '各自安静发光，也是爱的一种轨道。',
    '有缘的人像彗星，错过这次也会回归，不必攥得太紧。',
  ],
  career: [
    '今天适合做长周期的事，像种下一束要走很多光年的光。',
    '沟通像行星连珠，难得顺畅，把重要的话说出口。',
    '别急着把所有星星连成线，先把手边这颗擦亮。',
    '有颗「导师星」在你附近，遇到卡点，开口请教就好。',
    '灵感今天是流星雨级别，随手记下，别让它烧尽在大气层。',
    '适合复盘：把这个月的轨道画出来，偏差在哪一目了然。',
    '低头赶路的日子，也记得抬头确认北极星还在原位。',
    '一件被搁置的事会有转机，像被云遮住的星重新露面。',
    '少开新坑，先把已点亮的那条连线走完。',
    '你的努力有延迟，像星光——出发很久了，快抵达了。',
  ],
  health: [
    '今晚早点让自己降落，好的睡眠是每颗星的燃料。',
    '去走走吧，哪怕十分钟，让眼睛从屏幕回到真实的天空。',
    '身体像一条安静的河，今天记得多喝水，让它缓缓流动。',
    '肩颈像被引力压住了，起来伸个懒腰，望天花板五秒。',
    '今天适合慢节奏：散步、拉伸，像星轨一样从容。',
    '情绪也是天气，阴一会儿没关系，云层上面永远有星。',
    '给自己做一顿好好吃的晚餐，仪式感是最温柔的照顾。',
    '少熬一点夜，错过的凌晨星空可以留到周末再看。',
    '深呼吸三次，想象把一整片安静的夜空吸进胸口。',
    '今天宜放空：找片草地或窗台，什么都不做，看十分钟天。',
  ],
};

/** noUncheckedIndexedAccess 纪律：越界/空数组一律回退首条或空串，绝不返回 undefined。 */
function pickFrom(rng: () => number, pool: readonly string[]): string {
  return pool[Math.floor(rng() * pool.length)] ?? pool[0] ?? '';
}

/** 固定「文案→星级」的一次抽取（星级 1–5 均匀）。 */
function drawLine(rng: () => number, pool: readonly string[]): FortuneLine {
  const text = pickFrom(rng, pool);
  const stars = 1 + Math.floor(rng() * 5);
  return { text, stars };
}

/**
 * 生成某星座某天的运势（默认本地今天）。
 * 纯函数、无 IO：同 (日期, 缩写) 恒等输出，跨设备一致，可直接单测。
 */
export function getDailyFortune(abbr: string, date: Date = new Date()): DailyFortune {
  const ymd = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  const rng = mulberry32(seedOf(ymd, abbr));
  // 抽取顺序冻结：整体→爱情→事业→健康（各自先文案后星级）。
  return {
    overall: drawLine(rng, FORTUNE_POOLS.overall),
    love: drawLine(rng, FORTUNE_POOLS.love),
    career: drawLine(rng, FORTUNE_POOLS.career),
    health: drawLine(rng, FORTUNE_POOLS.health),
  };
}
