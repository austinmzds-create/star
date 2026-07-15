import { Controller, Get, Param, Res } from '@nestjs/common';
import { createReadStream, existsSync } from 'node:fs';
import { AppError, ErrorCodes } from '../common/errors/app-error';
import { resolveLocalPath } from './storage/local-storage';

/** express Response 的最小使用面（避免依赖 @types/express）。 */
interface ResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): void;
}

/** 扩展名 → Content-Type。 */
function contentTypeByExt(key: string): string {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

/**
 * 本地存储静态资产流式服务：GET /api/assets/*path。
 * 仅本地存储生效；OSS 模式下 url 指向 OSS 签名直链，本控制器不参与。
 * 防路径穿越由 resolveLocalPath 校验（越界抛 ASSET_NOT_FOUND → 404）。
 */
@Controller('assets')
export class AssetController {
  @Get('*path')
  get(@Param('path') pathParam: string | string[], @Res() res: ResponseLike): void {
    const key = Array.isArray(pathParam) ? pathParam.join('/') : pathParam;
    const abs = resolveLocalPath(key); // 穿越校验，越界 → ASSET_NOT_FOUND
    if (!existsSync(abs)) {
      throw new AppError(ErrorCodes.ASSET_NOT_FOUND, '资产不存在');
    }
    res.setHeader('Content-Type', contentTypeByExt(key));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    createReadStream(abs).pipe(res as unknown as NodeJS.WritableStream);
  }
}
