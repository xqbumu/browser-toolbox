/**
 * 请求头改写工具（工具箱第二个工具）：popup 内闭环完成查看/启停/编辑/新建/删除。
 * - 列表视图：命中当前页的规则排前并带「当前页」徽标；行内开关即时生效；
 * - 编辑视图：整面板切换到共享 HeaderRuleEditor（校验内聚），保存即同步引擎；
 * - 导入/导出仍留在 options 管理页，popup 底部提供跳转。
 */
import { useEffect, useState } from "react";
import {
  Button,
  DialogPlugin,
  MessagePlugin,
  Switch,
  Tag,
} from "tdesign-react";
import type { HeaderRule } from "@/types/headers";
import { newHeaderRule } from "@/types/headers";
import { FilterIcon, SettingIcon } from "tdesign-icons-react";
import type { PopupRequest, PopupResponse } from "@/types/messages";
import { conditionMatches } from "@/core/headers/match";
import { detectHeaderEngine } from "@/core/headers/engine";
import { genId } from "@/utils/helpers";
import { HeaderRuleEditor } from "@/ui/HeaderRuleEditor";
import { HeaderImportExport } from "@/ui/HeaderImportExport";

async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/** 模式摘要：首个 pattern + 剩余计数 */
function patternsLabel(rule: HeaderRule): string {
  const ps = rule.condition.urlFilters ?? [];
  if (ps.length === 0) return "无匹配模式";
  const first = ps[0]!;
  return ps.length > 1 ? `${first} 等 ${ps.length} 条` : first;
}

/** 动作摘要：如「请求 ×2 / 响应 ×1」 */
function actionSummary(rule: HeaderRule): string {
  const req = rule.actions.filter((a) => a.target === "request").length;
  const resp = rule.actions.filter((a) => a.target === "response").length;
  return [req > 0 ? `请求 ×${req}` : "", resp > 0 ? `响应 ×${resp}` : ""]
    .filter(Boolean)
    .join(" / ");
}

export function HeadersTool(): React.ReactNode {
  const [rules, setRules] = useState<HeaderRule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [engineAvailable] = useState(() => detectHeaderEngine() != null);
  const [tabUrl, setTabUrl] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "edit">("list");
  const [showIO, setShowIO] = useState(false);
  const [editing, setEditing] = useState<HeaderRule | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        setTabUrl(tabs[0]?.url ?? null);
        setRules(
          await request<HeaderRule[]>({ type: "HEADERS_LIST", payload: {} }),
        );
      } catch {
        // 拉取失败保持空态
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  function flash(text: string): void {
    void MessagePlugin.success({ content: text, duration: 2000 });
  }

  async function toggle(id: string, enabled: boolean): Promise<void> {
    const prev = rules;
    // 乐观更新，失败回滚
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, enabled } : r)));
    try {
      await request({ type: "HEADERS_TOGGLE", payload: { id, enabled } });
    } catch {
      setRules(prev);
    }
  }

  function remove(rule: HeaderRule): void {
    const dialog = DialogPlugin.confirm({
      header: "删除规则",
      body: `确定删除规则「${rule.name || "未命名"}」？`,
      confirmBtn: { content: "删除", theme: "danger" },
      cancelBtn: "取消",
      onConfirm: () => {
        dialog.destroy();
        void (async () => {
          await request({
            type: "HEADERS_DELETE",
            payload: { id: rule.id },
          }).catch(() => {});
          await reload();
          flash("已删除");
        })();
      },
      onClose: () => dialog.destroy(),
    });
  }

  async function reload(): Promise<void> {
    try {
      setRules(
        await request<HeaderRule[]>({ type: "HEADERS_LIST", payload: {} }),
      );
    } catch {
      // 保持旧列表
    }
  }

  function startCreate(): void {
    setEditing({ ...newHeaderRule(), id: genId() });
    setView("edit");
  }

  function startEdit(rule: HeaderRule): void {
    setEditing(structuredClone(rule));
    setView("edit");
  }

  async function save(): Promise<void> {
    if (!editing) return;
    await request({ type: "HEADERS_SAVE", payload: { rule: editing } });
    await reload();
    setView("list");
    setEditing(null);
    flash("已保存并生效");
  }

  if (!engineAvailable) {
    return (
      <div className="degrade-banner">
        当前浏览器不支持请求头改写（需要 declarativeNetRequest 或阻塞式
        webRequest）。
      </div>
    );
  }
  if (!loaded) {
    return <p className="muted">加载中…</p>;
  }

  if (view === "edit" && editing) {
    return (
      <div className="headers-panel">
        <HeaderRuleEditor
          draft={editing}
          onChange={setEditing}
          onSave={save}
          onCancel={() => {
            setEditing(null);
            setView("list");
          }}
        />
      </div>
    );
  }

  // 条件命中即可见（与 enabled 解耦），关闭后仍可在此重新开启
  const matched = rules.filter((r) =>
    conditionMatches(r.condition, tabUrl ?? ""),
  );
  const matchedIds = new Set(matched.map((r) => r.id));
  const others = rules.filter((r) => !matchedIds.has(r.id));

  return (
    <div className="headers-panel">
      <div className="section-head">
        <span className="section-title">规则 · {rules.length}</span>
        <span className="section-head-actions">
          <Button
            size="small"
            shape="circle"
            variant="text"
            theme="default"
            title="导入 / 导出"
            onClick={() => setShowIO((v) => !v)}
          >
            <SettingIcon />
          </Button>
          <Button
            size="small"
            shape="circle"
            theme="primary"
            variant="outline"
            title="新建规则"
            onClick={startCreate}
          >
            ＋
          </Button>
        </span>
      </div>

      {showIO && (
        <HeaderImportExport rules={rules} onImported={reload} />
      )}

      {rules.length === 0 && (
        <div className="empty-state">
          <FilterIcon />
          <p>还没有请求头规则</p>
          <p className="muted">点击右上角 ＋ 创建第一条</p>
        </div>
      )}

      {matched.length > 0 && (
        <>
          <p className="section-label">当前页生效 · {matched.length}</p>
          {matched.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              badge
              onToggle={(enabled) => void toggle(rule.id, enabled)}
              onEdit={() => startEdit(rule)}
              onDelete={() => void remove(rule)}
            />
          ))}
        </>
      )}

      {others.length > 0 && (
        <>
          <p className="section-label">其他规则 · {others.length}</p>
          {others.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onToggle={(enabled) => void toggle(rule.id, enabled)}
              onEdit={() => startEdit(rule)}
              onDelete={() => void remove(rule)}
            />
          ))}
        </>
      )}

      <Button
        block
        variant="text"
        theme="primary"
        onClick={() => void browser.runtime.openOptionsPage()}
      >
        导入 / 导出与更多设置 ⧉
      </Button>
    </div>
  );
}

function RuleRow(props: {
  rule: HeaderRule;
  badge?: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}): React.ReactNode {
  const { rule } = props;
  return (
    <div className={`rule-row${rule.enabled ? "" : " disabled"}`}>
      <label className="switch">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => props.onToggle(e.target.checked)}
        />
        <span className="slider" />
      </label>
      <button
        type="button"
        className="rule-meta as-button"
        onClick={props.onEdit}
      >
        <span className="rule-name">
          {props.badge && <span className="badge">当前页</span>}
          {rule.name || "未命名规则"}
        </span>
        <span className="rule-sub">
          {patternsLabel(rule)} · {actionSummary(rule)}
        </span>
      </button>
      <button
        type="button"
        className="danger-text"
        title="删除规则"
        onClick={props.onDelete}
      >
        ✕
      </button>
    </div>
  );
}
