import type { MetadataRoute } from 'next';

/**
 * PWA manifest（Next 15 原生 MetadataRoute，构建期静态生成 /manifest.webmanifest）。
 * 图标为自绘品牌资产（scripts/generate-icons.mjs 程序化生成，无第三方版权）。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '星辰纪念 · 宇宙星图',
    short_name: '星辰纪念',
    description: '沉浸式宇宙星图，为重要的人点亮一颗纪念星。',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#03040a',
    theme_color: '#03040a',
    lang: 'zh-CN',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
