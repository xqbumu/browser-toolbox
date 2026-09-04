/**
 * 改写统计（请求头管理中心 · 统计页）：
 * 数据来自 background 按保留期日志聚合（HEADER_LOG_STATS），展示：
 * - KPI：保留期内总量 / 今日 / 近 7 天；
 * - 按分组分布（含「未分组」桶，条形占比）；
 * - 近 14 天逐日柱状；
 * - 按方向（请求头 / 响应头）。
 * 口径说明：总量受「保留条数上限 + 保留天数」约束，可在日志页调整。
 */
import { useEffect, useState } from "react";
import { Alert, Button, MessagePlugin } from "tdesign-react";
import { RefreshIcon } from "tdesign-icons-react";
import type {
  HeaderLogSettings,
  HeaderRewriteStats,
} from "@/types/header-log";
import { DEFAULT_HEADER_LOG_SETTINGS } from "@/types/header-log";
import type { PopupRequest, PopupResponse } from "@/types/messages";
import { EmptyState } from "@/ui/kit";

async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function StatsPane({
  engineAvailable,
  logCapable,
}: {
  engineAvailable: boolean;
  logCapable: boolean;
}): React.ReactNode {
  const [stats, setStats] = useState<HeaderRewriteStats | null>(null);
  const [settings, setSettings] = useState<HeaderLogSettings>({
    ...DEFAULT_HEADER_LOG_SETTINGS,
  });
  const [loading, setLoading] = useState(true);

  async function load(silent = false): Promise<void> {
    if (!silent) setLoading(true);
    try {
      const [s, cfg] = await Promise.all([
        request<HeaderRewriteStats>({ type: "HEADER_LOG_STATS", payload: {} }),
        request<HeaderLogSettings>({ type: "HEADER_LOG_SETTINGS_GET", payload: {} }),
      ]);
      setStats(s);
      setSettings(cfg);
    } catch (e) {
      void MessagePlugin.error({
        content: e instanceof Error ? e.message : String(e),
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // 激活期间定时拉新（静默刷新不打断阅读）。组件由 App 条件挂载，切走即卸载。
    const timer = setInterval(() => {
      void load(true);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  if (!engineAvailable || !logCapable || !settings.enabled) {
    const hint = !engineAvailable
      ? "当前浏览器不支持请求头改写，无统计可展示。"
      : !logCapable
        ? "当前平台（声明式 DNR 且无 webRequest 观测，如 Safari）无法记录改写日志，统计不可用。"
        : "日志记录已停用，请在「运行日志」页开启后产生统计。";
    return (
      <div className="hm-tab-content stats">
        <Alert theme="info" message={hint} />
      </div>
    );
  }

  if (loading || stats == null) {
    return <p className="muted hm-tab-content">加载中…</p>;
  }

  // 跨进程数据防御：后台若返回缺字段也不允许白屏（正常路径由 aggregateStats 保证完整）
  const byDay = stats.byDay ?? [];
  const byGroup = stats.byGroup ?? [];
  const byTarget = stats.byTarget ?? [];
  const total = stats.total ?? 0;
  const today = stats.today ?? 0;
  const last7d = stats.last7d ?? 0;

  const dayMax = Math.max(1, ...byDay.map((d) => d.count));
  const groupMax = Math.max(1, ...byGroup.map((g) => g.count));
  const req = byTarget.find((t) => t.target === "request")?.count ?? 0;
  const resp = byTarget.find((t) => t.target === "response")?.count ?? 0;

  return (
    <div className="hm-tab-content stats">
      <div className="hm-toolbar">
        <span className="muted">
          统计口径：保留期内改写成功日志（上限 {settings.maxEntries} 条 · 保留{" "}
          {settings.retentionDays === 0 ? "不限" : `${settings.retentionDays} 天`}）
        </span>
        <div className="hm-toolbar-actions">
          <Button size="small" variant="text" icon={<RefreshIcon />} onClick={() => void load()}>
            刷新
          </Button>
        </div>
      </div>

      <div className="hm-kpis">
        <div className="hm-kpi">
          <span className="hm-kpi-num">{total}</span>
          <span className="hm-kpi-label">改写成功（保留期内）</span>
        </div>
        <div className="hm-kpi">
          <span className="hm-kpi-num">{today}</span>
          <span className="hm-kpi-label">今日</span>
        </div>
        <div className="hm-kpi">
          <span className="hm-kpi-num">{last7d}</span>
          <span className="hm-kpi-label">近 7 天</span>
        </div>
        <div className="hm-kpi">
          <span className="hm-kpi-num">
            {req}
            <em className="hm-kpi-sub">请求</em> / {resp}
            <em className="hm-kpi-sub">响应</em>
          </span>
          <span className="hm-kpi-label">按方向</span>
        </div>
      </div>

      <div className="hm-stats-grid">
        <section className="hm-panel">
          <h3>按分组</h3>
          {byGroup.length === 0 && <EmptyState title="暂无数据" />}
          {byGroup.map((g) => (
            <div key={g.label} className="hm-bar-line">
              <span className="hm-bar-label" title={g.label}>
                {g.label}
              </span>
              <div className="hm-bar-track">
                <div
                  className="hm-bar"
                  style={{ width: `${Math.max(2, Math.round((g.count / groupMax) * 100))}%` }}
                />
              </div>
              <span className="hm-bar-count">{g.count}</span>
            </div>
          ))}
        </section>

        <section className="hm-panel">
          <h3>近 14 天分布</h3>
          {byDay.every((d) => d.count === 0) && <EmptyState title="暂无数据" />}
          <div className="hm-days">
            {byDay.map((d) => (
              <div key={d.date} className="hm-day" title={`${d.date}：${d.count} 次`}>
                <div className="hm-day-col">
                  <div
                    className="hm-day-bar"
                    style={{
                      height: d.count === 0 ? 2 : Math.max(4, Math.round((d.count / dayMax) * 120)),
                    }}
                  />
                </div>
                <span className="hm-day-label">{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
