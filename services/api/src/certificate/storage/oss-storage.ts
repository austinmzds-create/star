/**
 * 阿里云 OSS 存储：ali-oss 懒加载（本期不安装，代码完备默认不激活）。
 * 懒加载用 eval('require') 规避 webpack 静态分析与 TS 模块解析。
 */
import type { StorageObject, StorageService } from './storage.types';

/** 运行时可选 require：装了则返回模块，否则 null。规避 webpack 静态分析。 */
export function optionalRequire(name: string): unknown {
  try {
    // eslint-disable-next-line no-eval
    return (eval('require') as NodeRequire)(name);
  } catch {
    return null;
  }
}

interface OssClientLike {
  put(key: string, body: Buffer, opts: { headers: Record<string, string> }): Promise<unknown>;
  signatureUrl(key: string, opts: { expires: number }): string;
}

export class OssStorage implements StorageService {
  readonly kind = 'oss' as const;
  private readonly client: OssClientLike;

  constructor() {
    const OSS = optionalRequire('ali-oss') as
      | (new (opts: Record<string, unknown>) => OssClientLike)
      | null;
    if (!OSS) {
      throw new Error('ali-oss 未安装');
    }
    this.client = new OSS({
      region: process.env.OSS_REGION,
      bucket: process.env.OSS_BUCKET,
      accessKeyId: process.env.OSS_ACCESS_KEY_ID,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
      ...(process.env.OSS_ENDPOINT ? { endpoint: process.env.OSS_ENDPOINT } : {}),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StorageObject> {
    await this.client.put(key, body, { headers: { 'Content-Type': contentType } });
    return { key, url: await this.url(key) };
  }

  async url(key: string): Promise<string> {
    const expires = Number(process.env.ASSET_URL_TTL ?? 900);
    return this.client.signatureUrl(key, { expires });
  }
}
