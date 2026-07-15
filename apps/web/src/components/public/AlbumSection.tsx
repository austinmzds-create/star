'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAlbum, triggerAlbum, type AlbumView } from '@/lib/api';

// 纪念册入口（客户端）：触发后端生成（幂等）、轮询进度、就绪后展示分页与下载。
// 后端不可达一律优雅降级为「需连接服务」提示，绝不抛错。

/** 轮询间隔（毫秒）：生成过程通常数秒内完成，3s 足够。 */
const POLL_INTERVAL_MS = 3000;
/** 最多轮询次数（避免无限轮询），约 3 分钟。 */
const MAX_POLLS = 60;

type Phase =
  | { kind: 'loading' } // 首帧查询中
  | { kind: 'idle' } // 未生成，可触发
  | { kind: 'generating' } // 生成中（入队/同步降级进行中）
  | { kind: 'ready'; album: AlbumView } // 已就绪
  | { kind: 'failed' } // 生成失败
  | { kind: 'unavailable' }; // 后端不可达 / 演示模式

export function AlbumSection({
  registrationNo,
  memorialName,
}: {
  registrationNo: string;
  memorialName: string;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const pollCount = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 把一次 AlbumView 结果映射为 Phase。 */
  const applyAlbum = useCallback((album: AlbumView): Phase => {
    switch (album.status) {
      case 'READY':
        return { kind: 'ready', album };
      case 'GENERATING':
        return { kind: 'generating' };
      case 'FAILED':
        return { kind: 'failed' };
      default:
        return { kind: 'idle' };
    }
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  /** 轮询一次并按需继续。 */
  const poll = useCallback(async () => {
    const outcome = await getAlbum(registrationNo);
    if (outcome.mode === 'unavailable') {
      setPhase({ kind: 'unavailable' });
      return;
    }
    const next = applyAlbum(outcome.data);
    setPhase(next);
    if (next.kind === 'generating' && pollCount.current < MAX_POLLS) {
      pollCount.current += 1;
      timer.current = setTimeout(poll, POLL_INTERVAL_MS);
    }
  }, [registrationNo, applyAlbum]);

  // 首帧查询当前状态
  useEffect(() => {
    let alive = true;
    (async () => {
      const outcome = await getAlbum(registrationNo);
      if (!alive) return;
      if (outcome.mode === 'unavailable') {
        setPhase({ kind: 'unavailable' });
        return;
      }
      const next = applyAlbum(outcome.data);
      setPhase(next);
      if (next.kind === 'generating') {
        timer.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    })();
    return () => {
      alive = false;
      clearTimer();
    };
  }, [registrationNo, applyAlbum, poll, clearTimer]);

  /** 点击「生成纪念册」：触发后端并进入轮询。 */
  const onGenerate = useCallback(async () => {
    setPhase({ kind: 'generating' });
    pollCount.current = 0;
    const outcome = await triggerAlbum(registrationNo);
    if (outcome.mode === 'unavailable') {
      setPhase({ kind: 'unavailable' });
      return;
    }
    const next = applyAlbum(outcome.data);
    setPhase(next);
    if (next.kind === 'generating') {
      timer.current = setTimeout(poll, POLL_INTERVAL_MS);
    }
  }, [registrationNo, applyAlbum, poll]);

  return (
    <section className="glass-strong animate-fade-in mt-8 rounded-3xl p-6 sm:p-8">
      <div className="text-center text-[11px] uppercase tracking-[0.3em] text-gold/80">
        珍藏纪念册
      </div>
      <p className="mt-3 text-center text-[13px] leading-relaxed text-nebula-200/65">
        一本六页的暗夜高级风纪念册：封面、专属星图、纪念寄语、宇宙来信、星象档案与献词。
      </p>

      <div className="mt-6">
        {phase.kind === 'loading' && (
          <p className="text-center text-[13px] text-nebula-200/50">正在读取纪念册状态…</p>
        )}

        {phase.kind === 'idle' && (
          <div className="text-center">
            <button
              onClick={onGenerate}
              className="rounded-2xl bg-gradient-to-r from-nebula-500 to-nebula-700 px-6 py-3 text-[14px] font-medium text-white shadow-[0_8px_30px_rgba(107,115,255,0.35)] transition hover:brightness-110"
            >
              ✦ 生成珍藏纪念册
            </button>
            <p className="mt-3 text-[11px] text-nebula-200/45">生成约需数秒，完成后可逐页预览与下载。</p>
          </div>
        )}

        {phase.kind === 'generating' && (
          <div className="text-center">
            <div className="inline-flex items-center gap-3 text-[14px] text-nebula-100/85">
              <span className="relative h-4 w-4">
                <span className="absolute inset-0 animate-ping rounded-full bg-nebula-400/50" />
                <span className="absolute inset-[3px] rounded-full bg-white" />
              </span>
              星光正在装订这本纪念册…
            </div>
            <p className="mt-3 text-[11px] text-nebula-200/45">页面会自动刷新，无需等待可稍后再来查看。</p>
          </div>
        )}

        {phase.kind === 'failed' && (
          <div className="text-center">
            <p className="text-[13px] text-nebula-200/70">纪念册生成遇到一点波折。</p>
            <button
              onClick={onGenerate}
              className="mt-4 rounded-2xl border border-nebula-400/30 bg-nebula-500/10 px-5 py-2.5 text-[13px] text-nebula-100/90 transition hover:bg-nebula-500/20"
            >
              重试生成
            </button>
          </div>
        )}

        {phase.kind === 'unavailable' && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
            <p className="text-[13px] leading-relaxed text-nebula-200/60">
              当前为演示预览，纪念册生成通道尚未接入服务。
              <br />
              正式版将一键生成六页高清纪念册，可逐页预览、下载与打印。
            </p>
          </div>
        )}

        {phase.kind === 'ready' && (
          <div>
            {phase.album.albumUrl && (
              <div className="mb-6 text-center">
                <a
                  href={phase.album.albumUrl}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block rounded-2xl bg-gradient-to-r from-nebula-500 to-nebula-700 px-6 py-3 text-[14px] font-medium text-white shadow-[0_8px_30px_rgba(107,115,255,0.35)] transition hover:brightness-110"
                >
                  下载整册长图 ↓
                </a>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {phase.album.pages.map((p) => (
                <div key={p.name} className="flex flex-col">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group block overflow-hidden rounded-xl border border-white/10 bg-void/40 transition hover:border-nebula-400/40"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- 动态 OSS/本地资产，用原生 img */}
                    <img
                      src={p.url}
                      alt={`${memorialName} 纪念册 · ${p.label}`}
                      loading="lazy"
                      className="h-auto w-full object-contain transition group-hover:brightness-105"
                    />
                  </a>
                  <div className="mt-1.5 flex items-center justify-between px-0.5">
                    <span className="text-[11.5px] text-nebula-200/70">{p.label}</span>
                    <a
                      href={p.url}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11.5px] text-nebula-200/80 underline underline-offset-4 transition hover:text-white"
                    >
                      下载
                    </a>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-5 text-center text-[11px] leading-relaxed text-nebula-200/40">
              纪念册为私人留存，不代表任何官方命名。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
