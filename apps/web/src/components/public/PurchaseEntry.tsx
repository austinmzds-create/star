'use client';

import { useState } from 'react';

// 购买 / 升级入口（本期 UI 占位）。
// 订单与支付后端为「接口 + Mock provider」骨架，真实网关需商户凭证，暂不接入前端下单。
// 因此此处为演示态占位：清晰陈列升级选项与价位区间，点击后提示「即将开放」，
// 不发起任何真实订单请求。待 orders API 稳定后，可在此接入 createOrder 拉起支付。

interface UpgradeOption {
  key: string;
  title: string;
  desc: string;
  priceHint: string;
}

const OPTIONS: UpgradeOption[] = [
  {
    key: 'album',
    title: '珍藏纪念册（电子版）',
    desc: '六页暗夜高级风纪念册，含专属星图、宇宙来信与献词，可下载打印。',
    priceHint: '¥ 68 起',
  },
  {
    key: 'print',
    title: '实体证书 · 星图裱框',
    desc: '博物馆级艺术纸打印，含防伪纪念编号，礼盒包装顺丰直达。',
    priceHint: '¥ 199 起',
  },
  {
    key: 'giftbox',
    title: '双星礼盒（情侣款）',
    desc: '一对纪念证书 + 合影星图 + 手写卡，适合纪念日与求婚。',
    priceHint: '¥ 299 起',
  },
];

export function PurchaseEntry({ variant = 'single' }: { variant?: 'single' | 'couple' }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(false);

  const options = variant === 'couple' ? OPTIONS : OPTIONS.filter((o) => o.key !== 'giftbox');

  return (
    <section className="glass-strong animate-fade-in mt-8 rounded-3xl p-6 sm:p-8">
      <div className="text-center text-[11px] uppercase tracking-[0.3em] text-gold/80">
        升级为实体珍藏
      </div>
      <p className="mt-3 text-center text-[13px] leading-relaxed text-nebula-200/65">
        把这份纪念做成可触摸的礼物：实体证书、裱框星图与礼盒包装。
      </p>

      {!open ? (
        <div className="mt-6 text-center">
          <button
            onClick={() => setOpen(true)}
            className="rounded-2xl border border-nebula-400/30 bg-nebula-500/10 px-6 py-3 text-[14px] text-nebula-100/90 transition hover:bg-nebula-500/20"
          >
            查看升级选项
          </button>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {options.map((o) => (
            <div
              key={o.key}
              className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-white">{o.title}</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-nebula-200/60">{o.desc}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="text-[13px] text-gold">{o.priceHint}</span>
                <button
                  onClick={() => setNotice(true)}
                  className="rounded-full bg-gradient-to-r from-nebula-500 to-nebula-700 px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:brightness-110"
                >
                  选购
                </button>
              </div>
            </div>
          ))}

          {notice && (
            <p className="pt-1 text-center text-[12px] leading-relaxed text-nebula-200/55">
              购买通道即将开放，敬请期待。届时支持微信 / 支付宝安全支付。
            </p>
          )}
        </div>
      )}

      <p className="mt-5 text-center text-[10.5px] leading-relaxed text-nebula-200/35">
        以上为私人纪念礼品，不涉及星体产权或官方命名。
      </p>
    </section>
  );
}
