/**
 * 星辰纪念 PWA service worker（手写极简，Phase 6B 目标 11）。
 *
 * 策略：仅缓存同源静态壳，网络优先——成功回填缓存、失败回退缓存
 * （导航请求兜底回 '/'）。/api/ 永不缓存、跨域不碰、非 GET 不碰。
 * 网络优先下 /_next/static/* 内容哈希文件天然安全（新部署直接拿新 URL）。
 * 升级 CACHE 版本号即全量失效旧缓存。
 * 缓存膨胀：dso-photos + textures 全量 <10MB，暂不做 LRU（后续可加）。
 */
const CACHE = 'star-shell-v1';
const SHELL = ['/']; // 壳路由；/almanac 等首次访问后经 fetch 分支自然入缓存

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // 跨域不碰
  if (url.pathname.startsWith('/api/')) return; // API 永不缓存

  // 网络优先，成功回填缓存，失败回退缓存（导航请求兜底回 '/'）
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(e.request)
          .then((hit) => hit ?? (e.request.mode === 'navigate' ? caches.match('/') : undefined))
          .then((hit) => hit ?? Response.error()),
      ),
  );
});
