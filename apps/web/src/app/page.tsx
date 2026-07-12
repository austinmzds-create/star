import { Suspense } from 'react';
import { DeepLinkBoot } from '@/components/DeepLinkBoot';
import { UniverseApp } from '@/components/UniverseApp';
import { ObjectViewerHost } from '@/components/viewer/ObjectViewerHost';

export default function HomePage() {
  return (
    <>
      {/* 深链读取用 useSearchParams，Next 15 要求包 Suspense（静态预渲染约束） */}
      <Suspense fallback={null}>
        <DeepLinkBoot />
      </Suspense>
      <UniverseApp />
      {/* 全天体查看器（恒星/DSO 大窗）：轻壳挂载，重模块随打开懒加载 */}
      <ObjectViewerHost />
    </>
  );
}
