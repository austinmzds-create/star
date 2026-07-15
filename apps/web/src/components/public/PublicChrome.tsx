// 公开纪念页共享装饰件（服务端安全，无客户端 hook）：
// 纯 CSS 静态星空、合规脚注、键值卡片。供 /m/[slug] 与 /couple/[slug] 复用，
// 避免两页各自复制同一套视觉（此前为「复制而非共享」，此处收敛为单一来源）。

/** 确定性伪随机（LCG）：星点位置固定，避免每次 ISR 重渲染时星空跳动。 */
function makeRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** 生成一层 box-shadow 批量星点，如 "12vw 34vh 0 0 rgba(...)" 串联。 */
function starShadows(count: number, seed: number, alpha: number): string {
  const rng = makeRng(seed);
  const shadows: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = (rng() * 100).toFixed(2);
    const y = (rng() * 100).toFixed(2);
    shadows.push(`${x}vw ${y}vh 0 0 rgba(238,241,255,${alpha})`);
  }
  return shadows.join(', ');
}

/** 纯 CSS 静态星空：三层不同亮度/大小的星点 + 两团呼吸星云光晕。 */
export function StaticStarfield() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      {/* 远景暗星 */}
      <div
        className="absolute h-px w-px rounded-full"
        style={{ boxShadow: starShadows(90, 7, 0.35) }}
      />
      {/* 中景星 */}
      <div
        className="absolute h-[1.5px] w-[1.5px] rounded-full"
        style={{ boxShadow: starShadows(45, 42, 0.6) }}
      />
      {/* 近景亮星 */}
      <div
        className="absolute h-[2px] w-[2px] rounded-full"
        style={{ boxShadow: starShadows(18, 2026, 0.9) }}
      />
      {/* 星云光晕：紫蓝 + 暖金，低透明度呼吸 */}
      <div
        className="animate-breathe absolute -left-32 top-[12%] h-[420px] w-[420px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(107,115,255,0.16) 0%, rgba(107,115,255,0) 70%)',
        }}
      />
      <div
        className="animate-breathe absolute -right-24 bottom-[8%] h-[360px] w-[360px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(242,213,155,0.10) 0%, rgba(242,213,155,0) 70%)',
          animationDelay: '1.6s',
        }}
      />
    </div>
  );
}

/** 合规脚注：私人纪念命名登记，不代表官方命名。 */
export function ComplianceFootnote() {
  return (
    <footer className="mt-10 pb-6 text-center">
      <p className="text-[10.5px] leading-relaxed text-nebula-200/35">
        本平台提供基于真实星体坐标的私人纪念命名登记，
        <br />
        不代表国际天文学联合会（IAU）或任何官方天文机构的命名。
      </p>
    </footer>
  );
}

/** 键值卡片：与 MemorialModal 成功卡片的 KV 视觉一致。 */
export function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-3 py-2">
      <div className="text-[11px] text-nebula-200/50">{k}</div>
      <div className="mt-0.5 text-white">{v}</div>
    </div>
  );
}
