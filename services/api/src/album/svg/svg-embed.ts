/**
 * 把一张自包含 <svg …> 作为嵌套视口注入到父 SVG。
 * 依赖嵌套 <svg> 自带 viewBox 建立独立坐标系（SVG1.1 合法）。
 * 稳妥起见重建根标签：保留 viewBox，丢弃原固定 width/height，注入 x/y/新宽高。纯字符串操作。
 */
export function embedSvg(svg: string, x: number, y: number, w: number, h: number): string {
  const m = /^<svg\b([^>]*)>/.exec(svg);
  if (!m) return svg;
  const attrs = m[1] ?? '';
  const viewBox = /viewBox="([^"]*)"/.exec(attrs)?.[1] ?? `0 0 ${w} ${h}`;
  const xmlns = /xmlns="[^"]*"/.test(attrs) ? '' : ' xmlns="http://www.w3.org/2000/svg"';
  const open =
    `<svg${xmlns} viewBox="${viewBox}" x="${x}" y="${y}" width="${w}" height="${h}" ` +
    `preserveAspectRatio="xMidYMid meet">`;
  return open + svg.slice(m[0].length);
}
