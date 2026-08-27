/**
 * 请求头改写工具（工具箱第二个工具）：popup 内闭环完成查看/启停/编辑/新建/删除。
 * - 列表视图：命中当前页的规则排前并带「当前页」徽标；行内开关即时生效；
 * - 编辑视图：整面板切换到共享 HeaderRuleEditor（校验内聚），保存即同步引擎；
 * - 导入/导出仍留在 options 管理页，popup 底部提供跳转。
 */
import { useEffect, useState } from "react";
import { Button, MessagePlugin, Switch, Tag } from "tdesign-react";
import type { HeaderGroup, HeaderRule } from "@/types/headers";
import {
  describeActions,
  describeCondition,
  newHeaderRule,
} from "@/types/headers";
import { FilterIcon } from "tdesign-icons-react";
import { ConfirmDialog, EmptyState } from "@/ui/kit";
import type { PopupRequest, PopupResponse } from "@/types/messages";
import { conditionMatches } from "@/core/headers/match";
import { detectHeaderEngine } from "@/core/headers/engine";
import {
  isHeaderMasterEnabled,
  setHeaderMasterEnabled,
} from "@/utils/header-rules-store";
import { genId } from "@/utils/helpers";
import { HeaderRuleEditor } from "@/ui/HeaderRuleEditor";

async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function HeadersTool(): React.ReactNode {
  const [rules, setRules] = useState<HeaderRule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [engineAvailable] = useState(() => detectHeaderEngine() != null);
  const [tabUrl, setTabUrl] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "edit">("list");
  const engineKind = detectHeaderEngine();
  const dnrLimited = engineKind === "dnr";
  const [masterOn, setMasterOn] = useState(true);
  const [editing, setEditing] = useState<HeaderRule | null>(null);
  const [groups, setGroups] = useState<HeaderGroup[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        setTabUrl(tabs[0]?.url ?? null);
        const [rulesList, groupsList] = await Promise.all([
          request<HeaderRule[]>({ type: "HEADERS_LIST", payload: {} }),
          request<HeaderGroup[]>({ type: "GROUPS_LIST", payload: {} }),
        ]);
        setRules(rulesList);
        setGroups(groupsList);
      } catch {
        // 拉取失败保持空态
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  async function toggleMaster(on: boolean): Promise<void> {
    const prev = masterOn;
    setMasterOn(on);
    try {
      await setHeaderMasterEnabled(on);
    } catch {
      setMasterOn(prev);
    }
  }

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

  const [deleting, setDeleting] = useState<HeaderRule | null>(null);

  async function performDelete(id: string): Promise<void> {
    await request({
      type: "HEADERS_DELETE",
      payload: { id },
    }).catch(() => {});
    await reload();
    flash("已删除");
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
          groups={groups}
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
      <div className="headers-topbar">
        <div className="ht-left">
          <Switch
            size="small"
            value={masterOn}
            onChange={(v) => void toggleMaster(Boolean(v))}
          />
          <span className={`ht-title${masterOn ? "" : " off"}`}>
            请求头改写
          </span>
        </div>
        <div className="ht-right">
          <span className="section-title">规则 · {rules.length}</span>
          <Button
            size="small"
            shape="circle"
            theme="primary"
            variant="outline"
            title="新建规则"
            disabled={!masterOn}
            onClick={startCreate}
          >
            ＋
          </Button>
        </div>
      </div>

      <div className={masterOn ? "rules-zone" : "rules-zone dim"}>
        {rules.length === 0 && (
          <EmptyState
            icon={<FilterIcon />}
            title="还没有请求头规则"
            hint="点击右上角 ＋ 创建第一条"
          />
        )}

        {matched.length > 0 && (
          <>
            <p className="section-label">当前页生效 · {matched.length}</p>
            {matched.map((rule) => (
              <RuleRow
                key={rule.id}
                dnrLimited={dnrLimited}
                rule={rule}
                groups={groups}
                badge
                onToggle={(enabled) => void toggle(rule.id, enabled)}
                onEdit={() => startEdit(rule)}
                onDelete={() => setDeleting(rule)}
              />
            ))}
          </>
        )}
      </div>

      {others.length > 0 && (
        <>
          <p className="section-label">其他规则 · {others.length}</p>
          {others.map((rule) => (
            <RuleRow
              key={rule.id}
                dnrLimited={dnrLimited}
              groups={groups}
              rule={rule}
              onToggle={(enabled) => void toggle(rule.id, enabled)}
              onEdit={() => startEdit(rule)}
              onDelete={() => setDeleting(rule)}
            />
          ))}
        </>
      )}

      <ConfirmDialog
        open={deleting != null}
        header="删除规则"
        body={`确定删除规则「${deleting?.name || "未命名"}」？`}
        confirmText="删除"
        danger
        onConfirm={() => {
          if (deleting) void performDelete(deleting.id);
          setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function RuleRow(props: {
  rule: HeaderRule;
  groups: HeaderGroup[];
  dnrLimited?: boolean;
  badge?: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}): React.ReactNode {
  const { rule } = props;
  const groupName = rule.groupId
    ? props.groups.find((g) => g.id === rule.groupId)?.name
    : undefined;
  const regexLimited =
    props.dnrLimited &&
    (rule.condition.excludeRegex ?? []).some((p) => p.trim());
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
          {groupName && <span className="badge group">{groupName}</span>}
          {regexLimited && <span className="badge warn">仅Firefox</span>}
          {rule.name || "未命名规则"}
        </span>
        <span className="rule-sub">
          {describeCondition(rule.condition)} · {describeActions(rule)}
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
