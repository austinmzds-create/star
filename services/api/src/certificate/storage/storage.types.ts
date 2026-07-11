/** 存储抽象：证书/星图资产的落地与访问。OSS 或本地磁盘由工厂按环境选择。 */

/** DI token：certificate.module 以 useFactory 绑定 LocalStorage / OssStorage。 */
export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

export interface StorageObject {
  key: string;
  url: string;
}

export interface StorageService {
  readonly kind: 'oss' | 'local';
  /** 上传/覆盖对象，返回 key 与可访问 url（local=稳定直链，oss=签名短链）。 */
  put(key: string, body: Buffer, contentType: string): Promise<StorageObject>;
  /** 由 key 解析可访问 url（读时调用；oss 每次现签名，local 直接拼）。 */
  url(key: string): Promise<string>;
}
