/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 直接从 monorepo 内的 TS 源码转译共享包，保证「一套核心多端复用」。
  transpilePackages: ['@star/astro-core', '@star/astro-data', '@star/astro-ephem'],
};

export default nextConfig;
