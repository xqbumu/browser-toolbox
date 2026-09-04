/**
 * 改写成功日志仓库（请求头改写管理中心的运行数据）：
 * - 高频写路径（webRequest / 只读观测逐请求回调）先入内存缓冲，节流合并落盘；
 * - 自动清理双维度：保留条数上限 maxEntries + 保留天数 retentionDays，写盘与读取时惰性执行；
 * - 读接口（列表/统计）先 flush 再取数，保证 UI 看到的是已落盘的一致视图。
 * 说明：日志为 best-effort —— MV3 Service Worker 被回收瞬间的缓冲可能丢失（≤3s 窗口），可接受。
 */
import type {
  HeaderRewriteHit,
  HeaderRewriteLogEntry,
  HeaderLogSettings,
  HeaderRewriteStats,
} from "@/types/header-log";
import {
  DEFAULT_HEADER_LOG_SETTINGS,
  clampLogSettings,
  dateKey,
  lastDayKeys,
} from "@/types/header-log";
import { IMPLICIT_GROUP_LABEL } from "@/types/headers";
import { genId } from "@/utils/helpers";
import { createLogger } from "@/utils/logger";

const log = createLogger("header-log-store");

const LOGS_KEY = "headerRewriteLogs";
const SETTINGS_KEY = "headerLogSettings";
/** 落盘节流窗口：热路径逐请求合并写入，避免 storage 高频 IO */
const FLUSH_DEBOUNCE_MS = 3000;
/** 缓冲超过该量强制落盘，防止内存无界增长 */
const FLUSH_FORCE_THRESHOLD = 500;

let buffer: HeaderRewriteLogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
/** 设置内存缓存：规避每个事件都走 storage 读取 */
let settingsCache: HeaderLogSettings = { ...DEFAULT_HEADER_LOG_SETTINGS };

/** 启动时初始化（读设置 + 载入缓存）；重复调用幂等 */
export async function initHeaderLogStore(): Promise<void> {
  try {
    const res = await browser.storage.local.get(SETTINGS_KEY);
    settingsCache = clampLogSettings(
      res[SETTINGS_KEY] as HeaderLogSettings | undefined,
    );
  } catch {
    settingsCache = { ...DEFAULT_HEADER_LOG_SETTINGS };
  }
}

async function readStored(): Promise<HeaderRewriteLogEntry[]> {
  try {
    const res = await browser.storage.local.get(LOGS_KEY);
    const list = res[LOGS_KEY] as HeaderRewriteLogEntry[] | undefined;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeStored(list: HeaderRewriteLogEntry[]): Promise<void> {
  try {
    await browser.storage.local.set({ [LOGS_KEY]: list });
  } catch (e) {
    log.warn("改写日志写盘失败", e);
  }
}

/** 按 保留天数 → 保留条数 双维度裁剪（入参假定 ts 倒序） */
function prune(
  list: HeaderRewriteLogEntry[],
  settings: HeaderLogSettings,
  now = Date.now(),
): HeaderRewriteLogEntry[] {
  let out = list;
  if (settings.retentionDays > 0) {
    const cutoff = now - settings.retentionDays * 86_400_000;
    out = out.filter((e) => e.ts >= cutoff);
  }
  if (out.length > settings.maxEntries) out = out.slice(0, settings.maxEntries);
  return out;
}

/** 强制落盘：合并缓冲与存量（ts 倒序）后按当前设置裁剪写入 */
export async function flushHeaderLogs(): Promise<void> {
  if (flushing) return;
  if (buffer.length === 0) return;
  flushing = true;
  try {
    const batch = buffer;
    buffer = [];
    const merged = [...batch, ...(await readStored())].sort(
      (a, b) => b.ts - a.ts || (a.id < b.id ? -1 : 1),
    );
    const next = prune(merged, settingsCache);
    if (next.length < merged.length) {
      log.info(`改写日志清理：${merged.length} → ${next.length}`);
    }
    await writeStored(next);
  } catch (e) {
    log.warn("改写日志落盘失败", e);
  } finally {
    flushing = false;
  }
}

function scheduleFlush(): void {
  if (buffer.length >= FLUSH_FORCE_THRESHOLD) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flushHeaderLogs();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushHeaderLogs();
  }, FLUSH_DEBOUNCE_MS);
}

/** 引擎上报入口：事件先入缓冲（无 IO），由调度器合并落盘 */
export function pushHeaderLogHits(hits: HeaderRewriteHit[]): void {
  if (hits.length === 0 || !settingsCache.enabled) return;
  const now = Date.now();
  for (const h of hits) {
    buffer.push({ ...h, id: genId(), ts: now });
  }
  scheduleFlush();
}

/** flush 后返回倒序快照（已按设置惰性清理） */
async function snapshot(): Promise<HeaderRewriteLogEntry[]> {
  await flushHeaderLogs();
  const stored = await readStored();
  const next = prune(stored, settingsCache);
  if (next.length < stored.length) await writeStored(next);
  return next;
}

/** 日志列表（倒序，limit 截取）；total 为清理后的存量 */
export async function listHeaderLogs(
  limit = 500,
): Promise<{ entries: HeaderRewriteLogEntry[]; total: number }> {
  const all = await snapshot();
  return { entries: all.slice(0, Math.max(1, limit)), total: all.length };
}

/** 清空日志（缓冲 + 存量） */
export async function clearHeaderLogs(): Promise<number> {
  buffer = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await writeStored([]);
  return 0;
}

export async function getHeaderLogSettings(): Promise<HeaderLogSettings> {
  return { ...settingsCache };
}

/** 更新设置：持久化后立即按新上限/保留期收敛存量 */
export async function setHeaderLogSettings(
  patch: Partial<HeaderLogSettings>,
): Promise<HeaderLogSettings> {
  const next = clampLogSettings({ ...settingsCache, ...patch });
  settingsCache = next;
  try {
    await browser.storage.local.set({ [SETTINGS_KEY]: next });
  } catch (e) {
    log.warn("改写日志设置写盘失败", e);
  }
  // 上限下调或保留期缩短时，立即惰性收敛存量
  const stored = await readStored();
  const trimmed = prune(stored, next);
  if (trimmed.length < stored.length) await writeStored(trimmed);
  return next;
}

/** 由保留期日志聚合统计（纯函数，便于单测） */
export function aggregateStats(
  entries: HeaderRewriteLogEntry[],
  now = Date.now(),
): HeaderRewriteStats {
  const days = lastDayKeys(14, now);
  const todayKey = days[days.length - 1]!;
  const last7Keys = new Set(days.slice(-7));
  const byDay = new Map<string, number>(
    days.map((k): [string, number] => [k, 0]),
  );
  const byGroup = new Map<string, number>();
  let byTargetReq = 0;
  let byTargetResp = 0;
  for (const e of entries) {
    const k = dateKey(new Date(e.ts));
    // 超出近 14 天展示窗口的存量：不扩充逐日序列，但仍计入总量/分组/方向桶
    if (byDay.has(k)) byDay.set(k, (byDay.get(k) ?? 0) + 1);
    const label = e.groupName?.trim() || IMPLICIT_GROUP_LABEL;
    byGroup.set(label, (byGroup.get(label) ?? 0) + 1);
    if (e.target === "response") byTargetResp += 1;
    else byTargetReq += 1;
  }
  let last7d = 0;
  for (const [k, v] of byDay) {
    if (last7Keys.has(k)) last7d += v;
  }
  const groupList = [...byGroup.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  return {
    total: entries.length,
    today: byDay.get(todayKey) ?? 0,
    last7d,
    byDay: [...byDay.entries()].map(([date, count]) => ({ date, count })),
    byGroup: groupList,
    byTarget: [
      { target: "request", count: byTargetReq },
      { target: "response", count: byTargetResp },
    ],
  };
}

/** 统计接口：先落盘再聚合（保留期口径） */
export async function getHeaderRewriteStats(): Promise<HeaderRewriteStats> {
  return aggregateStats(await snapshot());
}
