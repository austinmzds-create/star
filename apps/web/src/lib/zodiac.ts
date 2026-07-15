/**
 * 黄道十二星座占星数据表（星座富面板占星分区的数据源）。
 *
 * 键为 IAU 3 字母缩写（Ari…Psc），与 CONSTELLATION_ABBR 对齐——
 * 非黄道座查不到即不渲染占星分区，无需另维护「是否黄道」布尔。
 * 守护星按现代占星通行说法（天蝎=冥王星、水瓶=天王星、双鱼=海王星）。
 *
 * 合规红线：本表与全部占星内容仅供娱乐、非科学结论，UI 侧必须显著标注；
 * 全部字段不含任何命名/产权/官方认证语义。
 */

export interface ZodiacInfo {
  /** 阳历生日段，如「3.21 – 4.19」。 */
  dates: string;
  /** 守护星（现代占星说法）。 */
  ruler: string;
  /** 四元素属性。 */
  element: '火' | '土' | '风' | '水';
  /** 幸运色名称。 */
  colorName: string;
  /** 幸运色色值（面板色块展示用）。 */
  colorHex: string;
  /** 幸运数字。 */
  luckyNumber: number;
  /** 性格关键词（徽章行展示，固定 3 个）。 */
  keywords: string[];
}

export const ZODIAC_INFO: Record<string, ZodiacInfo> = {
  Ari: {
    dates: '3.21 – 4.19',
    ruler: '火星',
    element: '火',
    colorName: '正红',
    colorHex: '#e23a3a',
    luckyNumber: 9,
    keywords: ['勇敢', '直率', '行动派'],
  },
  Tau: {
    dates: '4.20 – 5.20',
    ruler: '金星',
    element: '土',
    colorName: '森绿',
    colorHex: '#2e7d4f',
    luckyNumber: 6,
    keywords: ['沉稳', '念旧', '可靠'],
  },
  Gem: {
    dates: '5.21 – 6.21',
    ruler: '水星',
    element: '风',
    colorName: '明黄',
    colorHex: '#f5c518',
    luckyNumber: 5,
    keywords: ['好奇', '灵动', '健谈'],
  },
  Cnc: {
    dates: '6.22 – 7.22',
    ruler: '月亮',
    element: '水',
    colorName: '月白',
    colorHex: '#e8ecf5',
    luckyNumber: 2,
    keywords: ['温柔', '恋家', '共情'],
  },
  Leo: {
    dates: '7.23 – 8.22',
    ruler: '太阳',
    element: '火',
    colorName: '鎏金',
    colorHex: '#d4a94e',
    luckyNumber: 1,
    keywords: ['慷慨', '自信', '热烈'],
  },
  Vir: {
    dates: '8.23 – 9.22',
    ruler: '水星',
    element: '土',
    colorName: '麦褐',
    colorHex: '#b08850',
    luckyNumber: 7,
    keywords: ['细致', '克制', '求真'],
  },
  Lib: {
    dates: '9.23 – 10.23',
    ruler: '金星',
    element: '风',
    colorName: '雾蓝',
    colorHex: '#7fa6c9',
    luckyNumber: 3,
    keywords: ['优雅', '公允', '懂平衡'],
  },
  Sco: {
    dates: '10.24 – 11.22',
    ruler: '冥王星',
    element: '水',
    colorName: '酒红',
    colorHex: '#8e2438',
    luckyNumber: 4,
    keywords: ['深情', '敏锐', '专注'],
  },
  Sgr: {
    dates: '11.23 – 12.21',
    ruler: '木星',
    element: '火',
    colorName: '琥珀',
    colorHex: '#d98e32',
    luckyNumber: 8,
    keywords: ['自由', '乐观', '爱远行'],
  },
  Cap: {
    dates: '12.22 – 1.19',
    ruler: '土星',
    element: '土',
    colorName: '玄黑',
    colorHex: '#23252f',
    luckyNumber: 10,
    keywords: ['坚韧', '务实', '长期主义'],
  },
  Aqr: {
    dates: '1.20 – 2.18',
    ruler: '天王星',
    element: '风',
    colorName: '靛青',
    colorHex: '#3b4a9f',
    luckyNumber: 11,
    keywords: ['独立', '前卫', '理想'],
  },
  Psc: {
    dates: '2.19 – 3.20',
    ruler: '海王星',
    element: '水',
    colorName: '海雾紫',
    colorHex: '#8b7fc9',
    luckyNumber: 12,
    keywords: ['浪漫', '梦想', '柔软'],
  },
};
