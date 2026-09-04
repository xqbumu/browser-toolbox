/**
 * 运行日志（请求头管理中心 · 日志页）：
 * - 展示改写成功日志（时间倒序），支持按规则名/域名/方法文本过滤；
 * - 自动清理设置：记录开关 / 保留条数上限 / 保留天数；
 * - 平台能力提示：Firefox(MV2) 与 Chrome(MV3 + 只读观测) 可记录；
 *   Safari(纯 DNR、无 webRequest) 无观测能力，不产生日志。
 * 全部读写经 background 消息（HEADER_LOG_*），读取前后台会先落盘保证一致。
 */
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, InputNumber, MessagePlugin, Switch } from "tdesign-react";
import { RefreshIcon } from "tdesign-icons-react";
import type {
  HeaderRewriteLogEntry,
  HeaderLogSettings,
} from "@/types/header-log";
import { DEFAULT_HEADER_LOG_SETTINGS } from "@/types/header-log";
import { IMPLICIT_GROUP_LABEL } from "@/types/headers";
import type { PopupRequest, PopupResponse } from "@/types/messages";
import { ConfirmDialog, EmptyState } from "@/ui/kit";

async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url || "";
  }
}

export function fmtLogTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function LogsPane({
  engineAvailable,
  logCapable,
}: {
  engineAvailable: boolean;
  logCapable: boolean;
}): React.ReactNode {
  const [entries, setEntries] = useState<HeaderRewriteLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<HeaderLogSettings>({
    ...DEFAULT_HEADER_LOG_SETTINGS,
  });
  const [query, setQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  async function loadEntries(): Promise<void> {
    try {
      const { entries: list, total: t } = await request<{
        entries: HeaderRewriteLogEntry[];
        total: number;
      }>({ type: "HEADER_LOG_LIST", payload: { limit: 500 } });
      setEntries(list);
      setTotal(t);
    } catch {
      // 保持旧数据
    } finally {
      setLoading(false);
    }
  }

  async function loadSettings(): Promise<void> {
    try {
      setSettings(
        await request<HeaderLogSettings>({
          type: "HEADER_LOG_SETTINGS_GET",
          payload: {},
        }),
      );
    } catch {
      // 保持旧值
    }
  }

  useEffect(() => {
    void loadEntries();
    void loadSettings();
    // 激活期间定时拉新（静默刷新列表，不覆盖用户正在编辑的设置）。
    // 组件由 App 在切到「运行日志」Tab 时条件挂载，切走即卸载，无后台残留。
    const timer = setInterval(() => {
      void loadEntries();
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  async function saveSettings(): Promise<void> {
    try {
      const next = await request<HeaderLogSettings>({
        type: "HEADER_LOG_SETTINGS_SET",
        payload: settings,
      });
      setSettings(next);
      void MessagePlugin.success({ content: "日志设置已保存", duration: 2000 });
      await loadEntries();
    } catch (e) {
      void MessagePlugin.error({
        content: e instanceof Error ? e.message : String(e),
        duration: 3000,
      });
    }
  }

  async function clearAll(): Promise<void> {
    await request({ type: "HEADER_LOG_CLEAR", payload: {} }).catch(() => {});
    void MessagePlugin.success({ content: "日志已清空", duration: 2000 });
    setConfirmClear(false);
    await loadEntries();
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.ruleName.toLowerCase().includes(q) ||
        (e.groupName ?? IMPLICIT_GROUP_LABEL).toLowerCase().includes(q) ||
        hostOf(e.url).toLowerCase().includes(q) ||
        (e.method ?? "").toLowerCase().includes(q),
    );
  }, [entries, query]);

  return (
    <div className="hm-tab-content logs">
      {!engineAvailable && (
        <Alert
          theme="warning"
          message="当前浏览器不支持请求头改写（需要 declarativeNetRequest 或阻塞式 webRequest），不会产生改写日志。"
        />
      )}
      {engineAvailable && !logCapable && (
        <Alert
          theme="info"
          message="当前为声明式 DNR 引擎且浏览器不提供 webRequest 只读观测（如 Safari），无法记录改写日志与统计；Firefox / Chrome 支持。"
        />
      )}
      {engineAvailable && logCapable && !settings.enabled && (
        <Alert
          theme="info"
          message="日志记录当前已停用。可在下方「自动清理」设置中重新开启。"
        />
      )}

      <div className="hm-toolbar">
        <Input
          placeholder="过滤：规则名 / 分组 / 域名 / 方法"
          clearable
          size="small"
          style={{ width: 260 }}
          value={query}
          onChange={(v) => setQuery(String(v ?? ""))}
        />
        <span className="muted">
          共 {total} 条（保留期内）
          {filtered.length !== entries.length ? ` · 过滤后 ${filtered.length}` : ""}
        </span>
        <div className="hm-toolbar-actions">
          <Button size="small" variant="text" icon={<RefreshIcon />} onClick={() => void loadEntries()}>
            刷新
          </Button>
          <Button
            size="small"
            variant="text"
            theme="default"
            onClick={() => setShowSettings((v) => !v)}
          >
            {showSettings ? "收起清理设置" : "自动清理设置"}
          </Button>
          <Button
            size="small"
            variant="text"
            theme="danger"
            disabled={total === 0}
            onClick={() => setConfirmClear(true)}
          >
            清空
          </Button>
        </div>
      </div>

      {showSettings && (
        <div className="hm-settings-card">
          <label className="hm-set-line">
            <span className="hm-set-label">记录改写日志</span>
            <Switch
              size="small"
              value={settings.enabled}
              onChange={(v) => setSettings((s) => ({ ...s, enabled: Boolean(v) }))}
            />
          </label>
          <label className="hm-set-line">
            <span className="hm-set-label">
              保留条数上限
              <span className="hint">超出后删除最旧日志</span>
            </span>
            <InputNumber
              size="small"
              theme="column"
              min={100}
              max={20000}
              step={100}
              value={settings.maxEntries}
              onChange={(v) =>
                setSettings((s) => ({
                  ...s,
                  // 清空输入时保留上次有效值（Number("")=0 会越界 min=100）
                  maxEntries:
                    v === "" || v == null
                      ? s.maxEntries
                      : Number(v),
                }))
              }
            />
          </label>
          <label className="hm-set-line">
            <span className="hm-set-label">
              保留天数
              <span className="hint">0 = 不限时间（仅按条数清理）</span>
            </span>
            <InputNumber
              size="small"
              theme="column"
              min={0}
              max={365}
              value={settings.retentionDays}
              onChange={(v) =>
                setSettings((s) => ({
                  ...s,
                  // 清空输入时保留上次有效值；0 = 不限时间由用户显式输入
                  retentionDays:
                    v === "" || v == null
                      ? s.retentionDays
                      : Number(v),
                }))
              }
            />
          </label>
          <Button size="small" theme="primary" onClick={() => void saveSettings()}>
            保存设置
          </Button>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <EmptyState
          title={query ? "没有匹配的日志" : "暂无改写日志"}
          hint={
            engineAvailable && logCapable
              ? "发起带命中规则的请求后，改写成功事件会记录在这里（按清理策略保留）"
              : undefined
          }
        />
      )}

      {filtered.length > 0 && (
        <table className="hm-log-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>规则（分组）</th>
              <th>方向</th>
              <th>域名</th>
              <th>方法</th>
              <th>动作数</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id}>
                <td className="nowrap" title={fmtLogTime(e.ts)}>
                  {fmtLogTime(e.ts)}
                </td>
                <td>
                  <span className="hm-log-rule" title={`规则ID：${e.ruleId}`}>
                    {e.ruleName || e.ruleId}
                  </span>
                  <span className="badge group">
                    {e.groupName?.trim() || IMPLICIT_GROUP_LABEL}
                  </span>
                </td>
                <td>
                  <span className={`badge dir ${e.target}`}>
                    {e.target === "request" ? "请求头" : "响应头"}
                  </span>
                </td>
                <td title={e.url} className="hm-log-host">
                  {hostOf(e.url)}
                </td>
                <td className="muted">{e.method ?? "-"}</td>
                <td>{e.actionCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        open={confirmClear}
        header="清空改写日志"
        body="确定清空全部改写日志？此操作不可恢复。"
        confirmText="清空"
        danger
        onConfirm={() => {
          void clearAll();
        }}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  );
}
