'use client';

import { getCelestialByUid } from '@star/astro-data';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import {
  createMemorialRegistration,
  generateCosmicLetter,
  isApiConfigured,
  triggerAlbum,
} from '@/lib/api';
import { formatDec, formatRA } from '@/lib/format';
import { exits, springs } from '@/lib/motionTokens';
import { useUniverse } from '@/lib/store';

const OCCASIONS = ['情侣纪念', '生日', '婚礼', '毕业', '宝宝出生', '宠物纪念', '逝者纪念', '其他'];

/** 成功态：live = 服务端真实登记（带公开纪念页 slug）；demo = 本地演示回退。 */
interface DoneState {
  regNo: string;
  slug: string | null;
  mode: 'live' | 'demo';
}

export function MemorialModal() {
  const memorialOpen = useUniverse((s) => s.memorialOpen);
  const closeMemorial = useUniverse((s) => s.closeMemorial);
  const selectedUid = useUniverse((s) => s.selectedUid);
  const star = selectedUid ? getCelestialByUid(selectedUid) : undefined;

  const [occasion, setOccasion] = useState(OCCASIONS[0]!);
  const [memorialName, setMemorialName] = useState('');
  const [date, setDate] = useState('');
  const [blessing, setBlessing] = useState('');
  const [done, setDone] = useState<DoneState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 宇宙来信：letter 生成后可自由编辑；letterMode 用于「由 AI/模板生成」的透明提示
  const [letter, setLetter] = useState('');
  const [letterMode, setLetterMode] = useState<'llm' | 'template' | 'demo' | null>(null);
  const [letterLoading, setLetterLoading] = useState(false);

  const close = () => {
    if (submitting) return;
    closeMemorial();
    window.setTimeout(() => {
      setDone(null);
      setLetter('');
      setLetterMode(null);
    }, 300);
  };

  // generateCosmicLetter 永不 reject：失败一律回退本地模板，按钮恒定给得出结果
  const genLetter = async () => {
    if (!star || letterLoading) return;
    setLetterLoading(true);
    const res = await generateCosmicLetter({
      starNameZh: star.nameZh,
      constellationZh: star.constellationZh,
      occasion,
      memorialName: memorialName.trim() || `${star.nameZh}的纪念星`,
    });
    setLetter(res.letter);
    setLetterMode(res.mode);
    setLetterLoading(false);
  };

  // createMemorialRegistration 永不 reject：失败一律以 mode='demo' 回退，UI 恒定走向成功态
  const submit = async () => {
    if (!star || submitting) return;
    setSubmitting(true);
    const outcome = await createMemorialRegistration({
      objectUid: star.objectUid,
      occasion,
      // 后端 DTO 要求纪念名 1-40 字非空：空串在此用展示层同款兜底名补齐
      memorialName: memorialName.trim() || `${star.nameZh}的纪念星`,
      memorialDate: date || undefined,
      blessing: blessing.trim() || undefined,
    });
    setSubmitting(false);
    setDone(
      outcome.mode === 'live'
        ? { regNo: outcome.data.registrationNo, slug: outcome.data.publicSlug, mode: 'live' }
        : { regNo: outcome.data.registrationNo, slug: null, mode: 'demo' },
    );
  };

  const displayName = memorialName.trim() || (star ? `${star.nameZh}的纪念星` : '我的纪念星');

  return (
    <AnimatePresence>
      {memorialOpen && star && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: exits.base }}
          transition={springs.modal}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div className="absolute inset-0 bg-void/70 backdrop-blur-sm" onClick={close} />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12, transition: exits.base }}
            transition={springs.modal}
            className="glass-strong relative z-10 w-[min(94vw,540px)] overflow-hidden rounded-3xl"
          >
            {!done ? (
              <div className="max-h-[86vh] overflow-y-auto p-7">
                <div className="text-[12px] uppercase tracking-[0.24em] text-nebula-200/50">
                  纪念命名
                </div>
                <h3 className="mt-1 text-2xl font-semibold text-white">
                  为 {star.nameZh} 登记一颗纪念星
                </h3>
                <p className="mt-2 text-[13px] text-nebula-200/60">
                  基于真实星体坐标 {formatRA(star.raDeg)} / {formatDec(star.decDeg)} ·{' '}
                  {star.constellationZh}
                </p>

                <div className="mt-6 space-y-5">
                  <Field label="纪念场景">
                    <div className="flex flex-wrap gap-2">
                      {OCCASIONS.map((o) => (
                        <motion.button
                          key={o}
                          whileTap={{ scale: 0.96 }}
                          transition={springs.chip}
                          onClick={() => setOccasion(o)}
                          className={`tap-96 rounded-full px-3 py-1.5 text-[13px] transition ${
                            occasion === o
                              ? 'bg-nebula-500/40 text-white shadow-[inset_0_0_0_1px_rgba(140,155,255,0.5)]'
                              : 'border border-white/10 text-nebula-100/70 hover:bg-white/5'
                          }`}
                        >
                          {o}
                        </motion.button>
                      ))}
                    </div>
                  </Field>

                  <Field label="星星纪念名">
                    <input
                      value={memorialName}
                      onChange={(e) => setMemorialName(e.target.value)}
                      placeholder={`例如：${star.nameZh}的纪念星 / To Alice`}
                      maxLength={40}
                      className="w-full rounded-xl border border-white/10 bg-void/50 px-4 py-3 text-[15px] text-white placeholder:text-nebula-200/35 focus:border-nebula-400/40 focus:outline-none"
                    />
                  </Field>

                  <Field label="纪念日期">
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-void/50 px-4 py-3 text-[15px] text-white focus:border-nebula-400/40 focus:outline-none"
                    />
                  </Field>

                  <Field label="想说的话（可选）">
                    <textarea
                      value={blessing}
                      onChange={(e) => setBlessing(e.target.value)}
                      rows={3}
                      maxLength={140}
                      placeholder="写下你想安放进星空的一句话……"
                      className="w-full resize-none rounded-xl border border-white/10 bg-void/50 px-4 py-3 text-[15px] leading-relaxed text-white placeholder:text-nebula-200/35 focus:border-nebula-400/40 focus:outline-none"
                    />
                  </Field>

                  <Field label="宇宙来信（可选）">
                    <button
                      type="button"
                      onClick={genLetter}
                      disabled={letterLoading}
                      className="w-full rounded-xl border border-nebula-400/30 bg-nebula-500/10 py-2.5 text-[14px] text-nebula-100/90 transition hover:bg-nebula-500/20 disabled:cursor-wait disabled:opacity-60"
                    >
                      {letterLoading
                        ? '星光正在书写……'
                        : letter
                          ? '✦ 重新生成一封'
                          : '✦ 生成一封宇宙来信'}
                    </button>
                    {letter && (
                      <>
                        <textarea
                          value={letter}
                          onChange={(e) => setLetter(e.target.value)}
                          rows={6}
                          className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-void/50 px-4 py-3 text-[14px] leading-relaxed text-white focus:border-nebula-400/40 focus:outline-none"
                        />
                        <p className="mt-2 text-[11px] leading-relaxed text-nebula-200/40">
                          {letterMode === 'llm'
                            ? '由 AI 依据你填写的信息生成，可自由编辑。'
                            : '由本地模板生成，可自由编辑。'}
                          这只是一封写给星空的私人纪念文字，不代表任何官方命名。
                        </p>
                      </>
                    )}
                  </Field>
                </div>

                <div className="mt-7 flex gap-3">
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    transition={springs.chip}
                    onClick={close}
                    disabled={submitting}
                    className="tap-96 flex-1 rounded-2xl border border-white/10 py-3 text-[15px] text-nebula-100/70 transition hover:bg-white/5 disabled:cursor-wait disabled:opacity-60"
                  >
                    取消
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    transition={springs.chip}
                    onClick={submit}
                    disabled={submitting}
                    className="tap-96 flex-[1.6] rounded-2xl bg-gradient-to-r from-nebula-500 to-nebula-700 py-3 text-[15px] font-medium text-white shadow-[0_8px_30px_rgba(107,115,255,0.35)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                  >
                    {submitting ? '正在登记…' : '生成纪念预览'}
                  </motion.button>
                </div>
                <p className="mt-4 text-center text-[11px] leading-relaxed text-nebula-200/40">
                  {isApiConfigured()
                    ? '提交后将生成在线纪念页，可分享给重要的人。'
                    : '当前为演示预览。正式版将生成纪念证书、星图与可扫码纪念页。'}
                  <br />
                  本服务为私人纪念命名登记，不代表 IAU 或任何官方命名。
                </p>
              </div>
            ) : (
              <div className="relative p-7">
                <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-nebula-500/25 blur-3xl" />
                <div className="relative rounded-2xl border border-nebula-400/20 bg-gradient-to-b from-white/[0.06] to-transparent p-6 text-center">
                  <div className="text-[11px] uppercase tracking-[0.3em] text-gold/80">
                    Stellar Memorial · 私人纪念星登记
                  </div>
                  <div className="mt-4 text-[26px] font-semibold text-white">{displayName}</div>
                  <div className="mt-1 text-[13px] text-nebula-200/70">
                    {occasion}
                    {date ? ` · ${date}` : ''}
                  </div>

                  <div className="mx-auto my-5 h-px w-24 bg-gradient-to-r from-transparent via-nebula-300/50 to-transparent" />

                  <div className="grid grid-cols-2 gap-3 text-left text-[13px]">
                    <KV k="本体星" v={`${star.nameZh} ${star.nameEn}`} />
                    <KV k="星座" v={star.constellationZh} />
                    <KV k="赤经 RA" v={formatRA(star.raDeg)} />
                    <KV k="赤纬 Dec" v={formatDec(star.decDeg)} />
                  </div>

                  {blessing.trim() && (
                    <p className="mt-5 text-[14px] italic leading-relaxed text-nebula-100/90">
                      “{blessing.trim()}”
                    </p>
                  )}

                  {letter.trim() && (
                    <div className="mt-5 rounded-xl border border-nebula-400/15 bg-white/[0.03] p-4 text-left">
                      <div className="mb-2 text-[10.5px] uppercase tracking-[0.24em] text-gold/70">
                        宇宙来信
                      </div>
                      <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-nebula-100/90">
                        {letter.trim()}
                      </p>
                    </div>
                  )}

                  <div className="mt-5 text-[12px] tracking-wider text-nebula-200/60">
                    纪念编号 {done.regNo}
                  </div>

                  {done.mode === 'live' && done.slug ? (
                    <div className="mt-2">
                      <a
                        href={`/m/${done.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12px] text-nebula-200/80 underline underline-offset-4 transition hover:text-white"
                      >
                        查看在线纪念页 →
                      </a>
                    </div>
                  ) : (
                    <div className="mt-2">
                      <span className="text-[11px] text-nebula-200/40">
                        演示模式 · 未连接服务，编号仅供预览
                      </span>
                    </div>
                  )}
                </div>

                <AlbumEntry done={done} />

                <div className="mt-6 flex gap-3">
                  <button
                    onClick={() => setDone(null)}
                    className="flex-1 rounded-2xl border border-white/10 py-3 text-[15px] text-nebula-100/70 transition hover:bg-white/5"
                  >
                    返回修改
                  </button>
                  <button
                    onClick={close}
                    className="flex-1 rounded-2xl bg-gradient-to-r from-nebula-500 to-nebula-700 py-3 text-[15px] font-medium text-white transition hover:brightness-110"
                  >
                    完成
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * 成功态内的「珍藏纪念册 / 实体礼盒」入口（紧凑版）。
 * live 模式：一键触发后端生成（幂等），随后引导至纪念页逐页预览与下载；
 * demo 模式：清晰告知需连接服务，不发起请求。实体礼盒为本期 UI 占位。
 */
function AlbumEntry({ done }: { done: DoneState }) {
  const [albumState, setAlbumState] = useState<'idle' | 'starting' | 'started' | 'unavailable'>(
    'idle',
  );

  const startAlbum = async () => {
    if (albumState === 'starting') return;
    setAlbumState('starting');
    const outcome = await triggerAlbum(done.regNo);
    setAlbumState(outcome.mode === 'live' ? 'started' : 'unavailable');
  };

  return (
    <div className="mt-5 rounded-2xl border border-nebula-400/15 bg-white/[0.03] p-4 text-center">
      <div className="text-[11px] uppercase tracking-[0.24em] text-gold/70">珍藏纪念册</div>
      <p className="mt-2 text-[12px] leading-relaxed text-nebula-200/60">
        六页暗夜高级风纪念册：封面、专属星图、纪念寄语、宇宙来信、星象档案与献词。
      </p>

      {done.mode === 'live' ? (
        albumState === 'started' ? (
          <div className="mt-3">
            <p className="text-[12px] text-nebula-100/80">已开始生成，可在纪念页逐页预览与下载。</p>
            {done.slug && (
              <a
                href={`/m/${done.slug}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-[12px] text-nebula-200/80 underline underline-offset-4 transition hover:text-white"
              >
                前往纪念页查看 →
              </a>
            )}
          </div>
        ) : albumState === 'unavailable' ? (
          <p className="mt-3 text-[12px] text-nebula-200/55">
            纪念册服务暂不可用，请稍后在纪念页重试。
          </p>
        ) : (
          <button
            onClick={startAlbum}
            disabled={albumState === 'starting'}
            className="mt-3 rounded-2xl border border-nebula-400/30 bg-nebula-500/10 px-5 py-2.5 text-[13px] text-nebula-100/90 transition hover:bg-nebula-500/20 disabled:cursor-wait disabled:opacity-60"
          >
            {albumState === 'starting' ? '正在装订…' : '✦ 生成珍藏纪念册'}
          </button>
        )
      ) : (
        <p className="mt-3 text-[12px] text-nebula-200/55">
          连接服务后，可一键生成纪念册并升级为实体证书 / 礼盒。
        </p>
      )}

      <p className="mt-3 text-[10.5px] leading-relaxed text-nebula-200/35">
        实体礼盒为私人纪念礼品，不涉及星体产权或官方命名。
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[13px] text-nebula-200/70">{label}</div>
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-3 py-2">
      <div className="text-[11px] text-nebula-200/50">{k}</div>
      <div className="mt-0.5 text-white">{v}</div>
    </div>
  );
}
