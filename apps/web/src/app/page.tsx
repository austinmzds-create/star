import { Suspense } from 'react';
import { DeepLinkBoot } from '@/components/DeepLinkBoot';
import { UniverseApp } from '@/components/UniverseApp';

export default function HomePage() {
  return (
    <>
      {/* 深链读取用 useSearchParams，Next 15 要求包 Suspense（静态预渲染约束） */}
      <Suspense fallback={null}>
        <DeepLinkBoot />
      </Suspense>
      <UniverseApp />
    </>
  );
}
