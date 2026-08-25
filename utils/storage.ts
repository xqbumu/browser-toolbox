/**
 * 配置读写：存 browser.storage.sync（跨设备），读取缺省回退 DEFAULT_CONFIG，
 * 内存缓存避免频繁异步读取。
 */
import { DEFAULT_CONFIG, type CaptureConfig } from '@/types/config';
import { createLogger } from '@/utils/logger';

const log = createLogger('storage');
const STORAGE_KEY = 'captureConfig';

let cache: CaptureConfig | null = null;

/** 读取配置（优先内存缓存，其次 sync 存储，最终回退默认值） */
export async function getConfig(): Promise<CaptureConfig> {
  if (cache) return cache;

  let stored: Partial<CaptureConfig> = {};
  try {
    const result = await browser.storage.sync.get(STORAGE_KEY);
    const value = result[STORAGE_KEY];
    if (value && typeof value === 'object') {
      stored = value as Partial<CaptureConfig>;
    }
  } catch (e) {
    log.warn('读取 sync 配置失败，回退 local', e);
    try {
      const result = await browser.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY] && typeof result[STORAGE_KEY] === 'object') {
        stored = result[STORAGE_KEY] as Partial<CaptureConfig>;
      }
    } catch (e2) {
      log.warn('读取 local 配置失败，使用默认值', e2);
    }
  }

  cache = mergeConfig(DEFAULT_CONFIG, stored);
  return cache;
}

/** 合并写入配置（sync 失败回退 local），并刷新内存缓存 */
export async function setConfig(patch: Partial<CaptureConfig>): Promise<CaptureConfig> {
  const current = await getConfig();
  const next = mergeConfig(current, patch);
  cache = next;

  try {
    await browser.storage.sync.set({ [STORAGE_KEY]: next });
  } catch (e) {
    log.warn('写入 sync 配置失败，回退 local', e);
    try {
      await browser.storage.local.set({ [STORAGE_KEY]: next });
    } catch (e2) {
      log.warn('写入 local 配置失败', e2);
    }
  }
  return next;
}

/** 重置为默认配置 */
export async function resetConfig(): Promise<CaptureConfig> {
  cache = { ...DEFAULT_CONFIG };
  await Promise.allSettled([
    browser.storage.sync.remove(STORAGE_KEY),
    browser.storage.local.remove(STORAGE_KEY),
  ]);
  return cache;
}

/** 合并配置：默认值兜底，patch 覆盖 */
function mergeConfig(base: CaptureConfig, patch: Partial<CaptureConfig>): CaptureConfig {
  return { ...base, ...patch };
}
