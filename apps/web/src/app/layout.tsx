import type { Metadata, Viewport } from 'next';
import { ExperienceHydrator } from '@/components/ExperienceHydrator';
import { RedLightOverlay } from '@/components/ui/RedLightOverlay';
import './globals.css';

export const metadata: Metadata = {
  title: '星辰纪念 · 宇宙星图',
  description:
    '沉浸式宇宙星图搜索器。搜索真实星体，飞向属于你的那颗星，为重要的人登记一颗私人纪念星。',
  // iOS 添加主屏用 apple-touch-icon（不吃 manifest，需单独声明）
  icons: { apple: '/icons/icon-192.png' },
};

export const viewport: Viewport = {
  themeColor: '#03040a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <main>{children}</main>
        {/* 体验层（Phase 6B）：偏好水合 + 环境音手势恢复 + SW 注册；红光覆盖层
            挂 body 级让所有路由（/almanac、/couple…）同享，multiply 混合天然
            覆盖 WebGL canvas 与一切弹窗。两者均为 null/纯展示客户端叶子组件，
            layout 本身保持 Server Component。 */}
        <ExperienceHydrator />
        <RedLightOverlay />
      </body>
    </html>
  );
}
