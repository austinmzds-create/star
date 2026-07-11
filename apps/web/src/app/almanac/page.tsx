import { AlmanacApp } from '@/components/almanac/AlmanacApp';

/**
 * /almanac 天象日历（App Router 按路由分包，天然独立 chunk）。
 * 本路由不得 import three/R3F/UniverseScene 任何东西。
 */
export const metadata = {
  title: '天象日历 · 星辰纪念',
  description: '未来 12 个月的月相、日月食、行星合月、大距冲日与流星雨，附月相月历与观测提醒。',
};

export default function AlmanacPage() {
  return <AlmanacApp />;
}
