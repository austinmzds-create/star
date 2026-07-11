import { OpenAiCompatibleProvider } from './openai.provider';

describe('OpenAiCompatibleProvider', () => {
  const OK_BODY = {
    choices: [{ message: { content: '  外婆，我把这颗星以您的名义登记、安放。  ' } }],
    model: 'gpt-5.5',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('未配置 baseUrl/apiKey → isAvailable false，complete 抛错', async () => {
    const p = new OpenAiCompatibleProvider({});
    expect(p.isAvailable()).toBe(false);
    await expect(
      p.complete({ system: 's', messages: [{ role: 'user', content: 'u' }] }),
    ).rejects.toThrow(/未配置/);
  });

  it('配齐后可用；complete 拼 /chat/completions、带 Bearer、system 作首条消息', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch' as never)
      .mockResolvedValue({
        ok: true,
        json: async () => OK_BODY,
      } as never);

    const p = new OpenAiCompatibleProvider({
      baseUrl: 'https://api-slb.krill-ai.com/codex/v1/', // 末尾斜杠应被去掉
      apiKey: 'nb_test',
      model: 'gpt-5.5',
    });
    expect(p.isAvailable()).toBe(true);

    const r = await p.complete({
      system: 'SYS',
      messages: [{ role: 'user', content: 'USER' }],
      maxTokens: 256,
      temperature: 0.7,
    });

    expect(r.text).toBe('外婆，我把这颗星以您的名义登记、安放。'); // 已 trim
    expect(r.modelName).toBe('gpt-5.5');

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://api-slb.krill-ai.com/codex/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer nb_test');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-5.5');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'USER' });
    expect(body.max_tokens).toBe(256);
  });

  it('HTTP 非 2xx → 抛错含状态码', async () => {
    jest.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    } as never);
    const p = new OpenAiCompatibleProvider({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' });
    await expect(
      p.complete({ system: 's', messages: [{ role: 'user', content: 'u' }] }),
    ).rejects.toThrow(/401/);
  });

  it('返回空内容 → 抛错（触发上层模板兜底）', async () => {
    jest.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '   ' } }] }),
    } as never);
    const p = new OpenAiCompatibleProvider({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' });
    await expect(
      p.complete({ system: 's', messages: [{ role: 'user', content: 'u' }] }),
    ).rejects.toThrow(/空内容/);
  });
});
