/**
 * PWA 安装提示总线（Phase 6B 目标 11）。
 *
 * Chrome/Edge 触发 beforeinstallprompt 时把事件截留，DisplaySettings 订阅
 * 后显示「安装到桌面」按钮；iOS Safari 无此事件，按钮自然不出现（克制，
 * 不做引导浮层）。模块顶层副作用带 SSR 守卫。
 */
'use client';

/** beforeinstallprompt 事件的最小类型（lib.dom 未内置，本地声明）。 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();

function broadcast(available: boolean): void {
  for (const l of listeners) l(available);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // 截留，改由我们的按钮择机触发
    deferred = e as BeforeInstallPromptEvent;
    broadcast(true);
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    broadcast(false);
  });
}

/** 订阅可安装状态变化；订阅时立即回放当前状态。返回退订函数。 */
export function subscribeInstallable(cb: (available: boolean) => void): () => void {
  listeners.add(cb);
  cb(deferred != null);
  return () => {
    listeners.delete(cb);
  };
}

export function canInstall(): boolean {
  return deferred != null;
}

/** 弹出浏览器原生安装提示（需处于用户手势栈内）。用后置空并广播。 */
export async function promptInstall(): Promise<void> {
  const ev = deferred;
  if (!ev) return;
  deferred = null;
  broadcast(false);
  try {
    await ev.prompt();
    await ev.userChoice;
  } catch {
    /* 用户关闭 / 浏览器限制：静默 */
  }
}
