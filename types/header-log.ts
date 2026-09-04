/**
 * 请求头改写日志与统计模型（Header Editor 管理中心的运行数据）：
 * - 改写成功日志：引擎在「实际应用了改写动作」时上报一条事件，本层缓冲落盘；
 * - 自动清理：按保留条数上限 + 保留天数双维度（可配），写盘时惰性执行；
 * - 统计：由保留期内的日志实时聚合（总量 / 今日 / 近 7 天 / 按分组 / 按日 / 按方向）。
 * 平台口径：Firefox(MV2 webRequest 阻塞)与 Chrome(MV3 DNR + webRequest 只读观测)可记录；
 * Safari 无运行期观测能力，不产生日志（UI 侧提示）。
 */
import type { HeaderTarget } from "./headers";

/** 一次「某规则对某请求方向改写成功」的运行时事件（引擎 → 日志层） */
export interface HeaderRewriteHit {
  ruleId: string;
  /** 命中时刻快照：规则名 / 分组，便于规则被改删后日志仍可读 */
  ruleName: string;
  groupId?: string;
  groupName?: string;
  target: HeaderTarget;
  /** 命中的完整 URL（用于列表展示域名与排查） */
  url: string;
  method?: string;
  /** 该方向实际应用的动作条数 */
  actionCount: number;
}

/** 落盘日志条目 = 事件 + 自增标识 + 时间戳 */
export interface HeaderRewriteLogEntry extends HeaderRewriteHit {
  id: string;
  /** 事件发生时间戳（ms） */
  ts: number;
}

/** 日志自动清理设置 */
export interface HeaderLogSettings {
  /** 是否记录改写日志 */
  enabled: boolean;
  /** 保留条数上限（100 ~ 20000） */
  maxEntries: number;
  /** 保留天数（>0 时按 ts 过期清理；0 = 不限时间，仅按条数） */
  retentionDays: number;
}

export const DEFAULT_HEADER_LOG_SETTINGS: HeaderLogSettings = {
  enabled: true,
  maxEntries: 3000,
  retentionDays: 7,
};

export function clampLogSettings(s: Partial<HeaderLogSettings> | undefined): HeaderLogSettings {
  const base = { ...DEFAULT_HEADER_LOG_SETTINGS, ...(s ?? {}) };
  return {
    enabled: base.enabled !== false,
    maxEntries: clampInt(base.maxEntries, 100, 20000, DEFAULT_HEADER_LOG_SETTINGS.maxEntries),
    retentionDays: clampInt(base.retentionDays, 0, 365, DEFAULT_HEADER_LOG_SETTINGS.retentionDays),
  };
}

/** 按分组统计的桶（含隐式「未分组」，label 取命中快照 groupName） */
export interface HeaderStatsBucket {
  label: string;
  count: number;
}

/** 改写成功统计（由保留期日志聚合） */
export interface HeaderRewriteStats {
  /** 保留期内日志总量（受清理配置约束） */
  total: number;
  /** 今日（本地自然日）命中数 */
  today: number;
  /** 近 7 个自然日命中数 */
  last7d: number;
  /** 近 14 个自然日逐日分布（含 0 值日，便于绘图） */
  byDay: { date: string; count: number }[];
  /** 按分组分布（含「未分组」桶） */
  byGroup: HeaderStatsBucket[];
  /** 按目标方向（请求头 / 响应头） */
  byTarget: { target: HeaderTarget; count: number }[];
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** 本地自然日 YYYY-MM-DD */
export function dateKey(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 构造近 n 天（含今天）的日期键序列，升序 */
export function lastDayKeys(n: number, now = Date.now()): string[] {
  const out: string[] = [];
  const cur = new Date(now);
  cur.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i -= 1) {
    out.push(dateKey(new Date(cur.getTime() - i * 86_400_000)));
  }
  return out;
}
