/**
 * 本地磁盘存储：写文件到 STORAGE_LOCAL_DIR，由 AssetController 流式服务。
 * 读时 url 由 key 拼接。写失败视为存储不可用 → 抛错，服务层落 FAILED（不混用 data URL 持久化）。
 */
import { Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { AppError, ErrorCodes } from '../../common/errors/app-error';
import type { StorageObject, StorageService } from './storage.types';

/** 解析本地存储根目录。 */
export function resolveRoot(): string {
  const dir = process.env.STORAGE_LOCAL_DIR ?? '.local-storage';
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

/** 对外访问基址（拼 GET /api/assets/*）。 */
function publicBase(): string {
  return (
    process.env.STORAGE_PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3001}`
  ).replace(/\/+$/, '');
}

/**
 * 把 storage key 解析为磁盘绝对路径，并校验仍在 root 内（防 '../' 穿越）。
 * 越界抛 ASSET_NOT_FOUND（对外表现为 404，不泄露内部结构）。AssetController 复用。
 */
export function resolveLocalPath(key: string, root = resolveRoot()): string {
  // 去掉可能的前导斜杠，规范化
  const clean = key.replace(/^\/+/, '');
  const abs = path.normalize(path.join(root, clean));
  const rootResolved = path.resolve(root);
  const absResolved = path.resolve(abs);
  if (absResolved !== rootResolved && !absResolved.startsWith(rootResolved + path.sep)) {
    throw new AppError(ErrorCodes.ASSET_NOT_FOUND, '资产不存在');
  }
  return absResolved;
}

export class LocalStorage implements StorageService {
  readonly kind = 'local' as const;
  private readonly logger = new Logger(LocalStorage.name);
  private readonly root: string;

  constructor(root = resolveRoot()) {
    this.root = root;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<StorageObject> {
    const abs = resolveLocalPath(key, this.root);
    try {
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, body);
    } catch (e) {
      this.logger.warn(`本地存储写入失败: ${(e as Error).message}`);
      // 写盘为主路径；写失败视为存储不可用 → 上抛，服务层置 FAILED
      throw new AppError(ErrorCodes.INTERNAL_ERROR, '资产写入失败');
    }
    return { key, url: await this.url(key) };
  }

  async url(key: string): Promise<string> {
    const clean = key.replace(/^\/+/, '');
    return `${publicBase()}/api/assets/${clean}`;
  }
}
