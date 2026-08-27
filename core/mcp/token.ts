/**
 * MCP 鉴权 token：随机生成并持久于 storage.local（重启扩展仍保留，但 SW 重启不影响）。
 * 本地端点仅监听 127.0.0.1，配合 token 防止同机其他进程随意调用。
 */
const KEY = "mcpToken";

function randomToken(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `mcp-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export async function getMcpToken(): Promise<string> {
  const stored = await browser.storage.local.get(KEY);
  const existing = (stored as Record<string, unknown>)?.[KEY] as
    string | undefined;
  if (existing) return existing;
  const token = randomToken();
  await browser.storage.local.set({ [KEY]: token });
  return token;
}

export async function validateMcpToken(
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  const expected = await getMcpToken();
  return token === expected;
}
