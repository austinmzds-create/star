// @ts-nocheck
/**
 * 运行接入层（接真机前执行；本期不产出、不入库）。
 *
 * 背景：本工程用 tsconfig paths 把 @star/astro-core 解析到共享源码，
 * 满足本期 `tsc --noEmit`。但微信运行时按 miniprogramRoot 打包，
 * paths 别名指向仓库外的源码无法被真机加载。
 *
 * 本脚本把 astro-core 的 6 个纯 TS 源码（零依赖、无 wx/DOM/Node API，
 * 可被微信内建 TS 插件就地编译）复制到 miniprogram/lib/astro-core/，
 * 从而真机可运行，且仍是「脚本从单一源同步」。
 *
 * 执行后需把 tsconfig.json 的 paths 目标改指本地副本：
 *   "@star/astro-core": ["./miniprogram/lib/astro-core/index.ts"]
 * 并在业务导入不变的情况下让打包器解析到本地副本。
 *
 * 用法：node scripts/vendor-astro.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '..', '..', '..', 'packages', 'astro-core', 'src');
const OUT_DIR = join(__dirname, '..', 'miniprogram', 'lib', 'astro-core');

const FILES = [
  'constants.ts',
  'types.ts',
  'time.ts',
  'coordinates.ts',
  'direction.ts',
  'visibility.ts',
  'index.ts',
];

function main() {
  if (!existsSync(SRC_DIR)) {
    console.error(`[vendor-astro] 源目录不存在: ${SRC_DIR}`);
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of FILES) {
    copyFileSync(join(SRC_DIR, f), join(OUT_DIR, f));
    console.log(`[vendor-astro] 已同步 ${f}`);
  }
  console.log(
    '[vendor-astro] 完成。请将 tsconfig.json 的 paths 指向 ./miniprogram/lib/astro-core/index.ts 以供真机打包。',
  );
}

main();
