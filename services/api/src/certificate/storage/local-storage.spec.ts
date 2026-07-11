import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { AppError, ErrorCodes } from '../../common/errors/app-error';
import { LocalStorage, resolveLocalPath } from './local-storage';

describe('LocalStorage', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'star-storage-'));
    process.env.STORAGE_PUBLIC_BASE_URL = 'http://localhost:3001';
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    delete process.env.STORAGE_PUBLIC_BASE_URL;
  });

  it('kind === local', () => {
    expect(new LocalStorage(root).kind).toBe('local');
  });

  it('put 写盘 + 内容一致 + 返回 url 含 /api/assets/', async () => {
    const storage = new LocalStorage(root);
    const buf = Buffer.from('<svg>hi</svg>', 'utf8');
    const res = await storage.put('a/b/c.svg', buf, 'image/svg+xml');
    expect(res.key).toBe('a/b/c.svg');
    expect(res.url).toContain('/api/assets/a/b/c.svg');
    const onDisk = path.join(root, 'a/b/c.svg');
    expect(existsSync(onDisk)).toBe(true);
    expect(readFileSync(onDisk, 'utf8')).toBe('<svg>hi</svg>');
  });

  it('url 拼接含 base', async () => {
    const storage = new LocalStorage(root);
    const url = await storage.url('certificates/2026/07/x-v1.svg');
    expect(url).toBe('http://localhost:3001/api/assets/certificates/2026/07/x-v1.svg');
  });

  it('resolveLocalPath 拒绝路径穿越', () => {
    expect(() => resolveLocalPath('../../../etc/passwd', root)).toThrow(AppError);
    try {
      resolveLocalPath('../../../etc/passwd', root);
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCodes.ASSET_NOT_FOUND);
    }
  });

  it('resolveLocalPath 正常 key 落在 root 内', () => {
    const abs = resolveLocalPath('certificates/x.svg', root);
    expect(abs.startsWith(path.resolve(root))).toBe(true);
  });
});
