'use client';

import { getCelestialByUid } from '@star/astro-data';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { formatDec, formatRA } from '@/lib/format';
import { useUniverse } from '@/lib/store';

const OCCASIONS = [
  '情侣纪念',
  '生日',
  '婚礼',
  '毕业',
  '宝宝出生',
  '宠物纪念',
  '逝者纪念',
  '其他',
];

function makeRegistrationNo(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0');
  return `STAR-${y}${m}${d}-${rand}`;
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
  const [done, setDone] = useState<{ regNo: string } | null>(null);

  const close = () => {
    closeMemorial();
    window.setTimeout(() => setDone(null), 300);
  };

  const submit = () => {
    setDone({ regNo: makeRegistrationNo() });
  };

  const displayName = memorialName.trim() || (star ? `${star.nameZh}的纪念星` : '我的纪念星');

  return (
    <AnimatePresence>
      {memorialOpen && star && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-void/70 backdrop-blur-sm"
            onClick={close}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', stiffness: 240, damping: 26 }}
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
                  基于真实星体坐标 {formatRA(star.raDeg)} / {formatDec(star.decDeg)} · {star.constellationZh}
                </p>

                <div className="mt-6 space-y-5">
                  <Field label="纪念场景">
                    <div className="flex flex-wrap gap-2">
                      {OCCASIONS.map((o) => (
                        <button
                          key={o}
                          onClick={() => setOccasion(o)}
                          className={`rounded-full px-3 py-1.5 text-[13px] transition ${
                            occasion === o
                              ? 'bg-nebula-500/40 text-white shadow-[inset_0_0_0_1px_rgba(140,155,255,0.5)]'
                              : 'border border-white/10 text-nebula-100/70 hover:bg-white/5'
                          }`}
                        >
                          {o}
                        </button>
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
                </div>

                <div className="mt-7 flex gap-3">
                  <button
                    onClick={close}
                    className="flex-1 rounded-2xl border border-white/10 py-3 text-[15px] text-nebula-100/70 transition hover:bg-white/5"
                  >
                    取消
                  </button>
                  <button
                    onClick={submit}
                    className="flex-[1.6] rounded-2xl bg-gradient-to-r from-nebula-500 to-nebula-700 py-3 text-[15px] font-medium text-white shadow-[0_8px_30px_rgba(107,115,255,0.35)] transition hover:brightness-110"
                  >
                    生成纪念预览
                  </button>
                </div>
                <p className="mt-4 text-center text-[11px] leading-relaxed text-nebula-200/40">
                  当前为演示预览。正式版将生成纪念证书、星图与可扫码纪念页。
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

                  <div className="mt-5 text-[12px] tracking-wider text-nebula-200/60">
                    纪念编号 {done.regNo}
                  </div>
                </div>

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
