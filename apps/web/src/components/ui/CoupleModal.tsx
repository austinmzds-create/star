'use client';

import { getCelestialByUid } from '@star/astro-data';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { createCoupleRegistration } from '@/lib/api';
import { formatDec, formatRA } from '@/lib/format';
import { exits, springs } from '@/lib/motionTokens';
import { useUniverse } from '@/lib/store';

// 情侣双星命名表单：两槽皆满后由 CoupleTray 打开。
// 双纪念名 + 关系标签 + 合并祝福 + 纪念日期 → POST /api/memorial/couple（api.ts 封装，演示回退）。
// 成功态展示一对星与分享链接（/couple/[slug]）。

const RELATIONS = ['恋人', '夫妻', '挚友', '家人', '其他'];

/** 成功态：live=服务端真实登记（带情侣页 slug）；demo=本地演示回退。 */
interface DoneState {
  mode: 'live' | 'demo';
  coupleSlug: string | null;
  regNoA: string;
  regNoB: string;
}

export function CoupleModal() {
  const open = useUniverse((s) => s.coupleFormOpen);
  const closeForm = useUniverse((s) => s.closeCoupleForm);
  const exitCoupleMode = useUniverse((s) => s.exitCoupleMode);
  const uidA = useUniverse((s) => s.coupleSlotA);
  const uidB = useUniverse((s) => s.coupleSlotB);

  const starA = uidA ? getCelestialByUid(uidA) : undefined;
  const starB = uidB ? getCelestialByUid(uidB) : undefined;

  const [nameA, setNameA] = useState('');
  const [nameB, setNameB] = useState('');
  const [relation, setRelation] = useState<string | null>(RELATIONS[0] ?? null);
  const [blessing, setBlessing] = useState('');
  const [date, setDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<DoneState | null>(null);

  const displayA = nameA.trim() || (starA ? `${starA.nameZh}的纪念星` : '第一颗星');
  const displayB = nameB.trim() || (starB ? `${starB.nameZh}的纪念星` : '第二颗星');

  const close = () => {
    if (submitting) return;
    closeForm();
  };

  const finish = () => {
    // 完成：关闭表单并退出双星模式（清空槽位）
    setDone(null);
    setNameA('');
    setNameB('');
    setBlessing('');
    setDate('');
    exitCoupleMode();
  };

  // createCoupleRegistration 永不 reject：失败一律 mode='demo' 回退，UI 恒定走向成功态
  const submit = async () => {
    if (!starA || !starB || submitting) return;
    setSubmitting(true);
    const outcome = await createCoupleRegistration({
      starA: {
        objectUid: starA.objectUid,
        memorialName: nameA.trim() || `${starA.nameZh}的纪念星`,
      },
      starB: {
        objectUid: starB.objectUid,
        memorialName: nameB.trim() || `${starB.nameZh}的纪念星`,
      },
      occasion: '情侣纪念',
      ...(relation ? { relationLabel: relation } : {}),
      ...(blessing.trim() ? { coupleBlessing: blessing.trim() } : {}),
      ...(date ? { memorialDate: date } : {}),
    });
    setSubmitting(false);
    setDone(
      outcome.mode === 'live'
        ? {
            mode: 'live',
            coupleSlug: outcome.data.coupleSlug,
            regNoA: outcome.data.registrations[0]?.registrationNo ?? '—',
            regNoB: outcome.data.registrations[1]?.registrationNo ?? '—',
          }
        : {
            mode: 'demo',
            coupleSlug: null,
            regNoA: outcome.data.registrationNoA,
            regNoB: outcome.data.registrationNoB,
          },
    );
  };

  return (
    <AnimatePresence>
      {open && starA && starB && (
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
            className="glass-strong relative z-10 w-[min(94vw,560px)] overflow-hidden rounded-3xl"
          >
            {!done ? (
              <div className="max-h-[86vh] overflow-y-auto p-7">
                <div className="text-[12px] uppercase tracking-[0.24em] text-nebula-200/50">
                  情侣双星
                </div>
                <h3 className="mt-1 text-2xl font-semibold text-white">为你们登记一对纪念星</h3>
                <p className="mt-2 text-[13px] text-nebula-200/60">
                  两颗真实星体，各自命名，共享一个情侣纪念页。
                </p>

                {/* 双星命名 */}
                <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <StarNameField
                    role="第一颗星"
                    starZh={starA.nameZh}
                    starEn={starA.nameEn}
                    coord={`${formatRA(starA.raDeg)} / ${formatDec(starA.decDeg)}`}
                    value={nameA}
                    onChange={setNameA}
                  />
                  <StarNameField
                    role="第二颗星"
                    starZh={starB.nameZh}
                    starEn={starB.nameEn}
                    coord={`${formatRA(starB.raDeg)} / ${formatDec(starB.decDeg)}`}
                    value={nameB}
                    onChange={setNameB}
                  />
                </div>

                <div className="mt-5 space-y-5">
                  <Field label="关系">
                    <div className="flex flex-wrap gap-2">
                      {RELATIONS.map((r) => (
                        <motion.button
                          key={r}
                          whileTap={{ scale: 0.96 }}
                          transition={springs.chip}
                          onClick={() => setRelation(r)}
                          className={`tap-96 rounded-full px-3 py-1.5 text-[13px] transition ${
                            relation === r
                              ? 'bg-nebula-500/40 text-white shadow-[inset_0_0_0_1px_rgba(140,155,255,0.5)]'
                              : 'border border-white/10 text-nebula-100/70 hover:bg-white/5'
                          }`}
                        >
                          {r}
                        </motion.button>
                      ))}
                    </div>
                  </Field>

                  <Field label="纪念日期">
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-void/50 px-4 py-3 text-[15px] text-white focus:border-nebula-400/40 focus:outline-none"
                    />
                  </Field>

                  <Field label="想对彼此说的话（可选）">
                    <textarea
                      value={blessing}
                      onChange={(e) => setBlessing(e.target.value)}
                      rows={3}
                      maxLength={140}
                      placeholder="写下你们想一同安放进星空的一句话……"
                      className="w-full resize-none rounded-xl border border-white/10 bg-void/50 px-4 py-3 text-[15px] leading-relaxed text-white placeholder:text-nebula-200/35 focus:border-nebula-400/40 focus:outline-none"
                    />
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
                    返回选星
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    transition={springs.chip}
                    onClick={submit}
                    disabled={submitting}
                    className="tap-96 flex-[1.6] rounded-2xl bg-gradient-to-r from-nebula-500 to-nebula-700 py-3 text-[15px] font-medium text-white shadow-[0_8px_30px_rgba(107,115,255,0.35)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                  >
                    {submitting ? '正在登记双星…' : '生成情侣纪念'}
                  </motion.button>
                </div>
                <p className="mt-4 text-center text-[11px] leading-relaxed text-nebula-200/40">
                  提交后将生成一个情侣纪念页，可分享给彼此。
                  <br />
                  本服务为私人纪念命名登记，不代表 IAU 或任何官方命名。
                </p>
              </div>
            ) : (
              <div className="relative p-7">
                <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-nebula-500/25 blur-3xl" />
                <div className="relative rounded-2xl border border-nebula-400/20 bg-gradient-to-b from-white/[0.06] to-transparent p-6 text-center">
                  <div className="text-[11px] uppercase tracking-[0.3em] text-gold/80">
                    Stellar Memorial · 情侣双星纪念
                  </div>

                  <div className="mt-4 flex items-center justify-center gap-3 text-[20px] font-semibold text-white">
                    <span className="max-w-[42%] truncate">{displayA}</span>
                    <span className="text-gold">✦</span>
                    <span className="max-w-[42%] truncate">{displayB}</span>
                  </div>
                  {relation && (
                    <div className="mt-1 text-[13px] text-nebula-200/70">{relation}</div>
                  )}

                  <div className="mx-auto my-5 h-px w-24 bg-gradient-to-r from-transparent via-nebula-300/50 to-transparent" />

                  <div className="grid grid-cols-2 gap-3 text-left text-[12.5px]">
                    <KV k="第一颗星" v={`${starA.nameZh} ${starA.nameEn}`} />
                    <KV k="第二颗星" v={`${starB.nameZh} ${starB.nameEn}`} />
                    <KV k="编号 A" v={done.regNoA} />
                    <KV k="编号 B" v={done.regNoB} />
                  </div>

                  {blessing.trim() && (
                    <p className="mt-5 text-[14px] italic leading-relaxed text-nebula-100/90">
                      “{blessing.trim()}”
                    </p>
                  )}

                  {done.mode === 'live' && done.coupleSlug ? (
                    <div className="mt-5">
                      <a
                        href={`/couple/${done.coupleSlug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12px] text-nebula-200/80 underline underline-offset-4 transition hover:text-white"
                      >
                        查看在线情侣纪念页 →
                      </a>
                    </div>
                  ) : (
                    <div className="mt-5">
                      <span className="text-[11px] text-nebula-200/40">
                        演示模式 · 未连接服务，编号仅供预览
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-6 flex gap-3">
                  <button
                    onClick={() => setDone(null)}
                    className="flex-1 rounded-2xl border border-white/10 py-3 text-[15px] text-nebula-100/70 transition hover:bg-white/5"
                  >
                    返回修改
                  </button>
                  <button
                    onClick={finish}
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

/** 单颗星命名字段（星体信息 + 纪念名输入）。 */
function StarNameField({
  role,
  starZh,
  starEn,
  coord,
  value,
  onChange,
}: {
  role: string;
  starZh: string;
  starEn: string;
  coord: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="text-[10.5px] uppercase tracking-[0.2em] text-gold/70">{role}</div>
      <div className="mt-1 text-[15px] font-medium text-white">{starZh}</div>
      <div className="truncate text-[12px] text-nebula-200/55">
        {starEn} · {coord}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`例如：${starZh}的纪念星`}
        maxLength={40}
        className="mt-3 w-full rounded-xl border border-white/10 bg-void/50 px-3.5 py-2.5 text-[14px] text-white placeholder:text-nebula-200/35 focus:border-nebula-400/40 focus:outline-none"
      />
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
      <div className="mt-0.5 truncate text-white">{v}</div>
    </div>
  );
}
