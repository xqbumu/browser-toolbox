/**
 * 统一日志：带模块前缀，debug 级别由 storage 开关控制，便于排查滚动/拼接问题。
 */

const DEBUG_KEY = 'wxt_screenshot_debug';

let debugEnabled = false;

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** 初始化日志开关（从 storage.local 读取） */
export async function initLogger(): Promise<void> {
  try {
    const stored = await browser.storage.local.get(DEBUG_KEY);
    debugEnabled = !!stored[DEBUG_KEY];
  } catch {
    debugEnabled = false;
  }
}

/** 设置 debug 开关并持久化 */
export async function setDebug(enabled: boolean): Promise<void> {
  debugEnabled = enabled;
  try {
    await browser.storage.local.set({ [DEBUG_KEY]: enabled });
  } catch {
    // 忽略写入失败，开关仅在当前会话生效
  }
}

export function isDebug(): boolean {
  return debugEnabled;
}

/** 创建带模块前缀的 logger */
export function createLogger(module: string): Logger {
  const prefix = `[wxt-shot:${module}]`;
  return {
    debug(...args: unknown[]): void {
      if (debugEnabled) console.debug(prefix, ...args);
    },
    info(...args: unknown[]): void {
      console.info(prefix, ...args);
    },
    warn(...args: unknown[]): void {
      console.warn(prefix, ...args);
    },
    error(...args: unknown[]): void {
      console.error(prefix, ...args);
    },
  };
}
