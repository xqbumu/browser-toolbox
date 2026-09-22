/**
 * 请求头规则管理（工具箱 · options 视图）：
 * - 全量规则列表：启停开关、编辑、删除；
 * - 编辑器：名称 / URL 匹配模式 / 方法与资源类型 / 动作行（target × op × name/value）；
 * - 导入导出：文件导入（merge/replace）+ 复制导出 JSON。
 * 写操作统一走 background 消息，保证引擎即时同步。
 */
import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, MessagePlugin, Switch } from "tdesign-react";
import {
  describeActions,
  describeCondition,
  isGroupOff,
  makeRuleCopy,
  newHeaderRule,
  validateHeaderRule,
  type HeaderRule,
} from "@/types/headers";
import type { PopupRequest, PopupResponse } from "@/types/messages";
import { genId } from "@/utils/helpers";
import { HeaderRuleEditor } from "@/ui/HeaderRuleEditor";
import { HeaderImportExport } from "@/ui/HeaderImportExport";
import { HeaderGroupsPanel } from "@/ui/HeaderGroupsPanel";
import { ThemeToggle } from "@/ui/theme-toggle";
import { detectHeaderEngine } from "@/core/headers/engine";
import { ConfirmDialog } from "@/ui/kit";
import { newHeaderGroup, type HeaderGroup } from "@/types/headers";
import { collectLearnedHeaderNames } from "@/utils/header-hints";

async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function HeaderRulesSection() {
  const [rules, setRules] = useState<HeaderRule[]>([]);
  const dnrLimited = detectHeaderEngine() === "dnr";
  const [groups, setGroups] = useState<HeaderGroup[]>([]);
  const groupOffOf = (rule: HeaderRule): boolean => isGroupOff(rule, groups);
  const warnGroupOff = (): void => {
    void MessagePlugin.warning({
      content: "分组已停用，组内规则暂不生效——请先开启分组",
      duration: 2500,
    });
  };
  // 会话级临时覆盖（仅当前会话，重启即清）
  const [sessionOv, setSessionOv] = useState<Record<string, boolean>>({});
  async function toggleSession(id: string): Promise<void> {
    const rule = rules.find((r) => r.id === id);
    const has = id in sessionOv;
    const nextOv = has ? null : !rule?.enabled;
    // 「强制启用」方向受组开关约束：组停用时先提示开启分组
    if (rule && nextOv === true && groupOffOf(rule)) {
      warnGroupOff();
      return;
    }
    const prev = sessionOv;
    setSessionOv((m) => {
      const copy = { ...m };
      if (nextOv === null) delete copy[id];
      else copy[id] = nextOv;
      return copy;
    });
    try {
      await request({
        type: "HEADERS_SESSION_OVERRIDE",
        payload: { id, enabled: nextOv },
      });
    } catch {
      // 后台写覆盖失败：回滚本地展示
      setSessionOv(prev);
    }
  }
  const [editing, setEditing] = useState<HeaderRule | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    void reload();
    void reloadGroups();
    // 同步后台会话级覆盖快照（MV3 SW 重启后恢复显示）
    void request<Record<string, boolean>>({ type: "HEADERS_SESSION_LIST" })
      .then(setSessionOv)
      .catch(() => {});
  }, []);

  async function reload(): Promise<void> {
    try {
      setRules(
        await request<HeaderRule[]>({ type: "HEADERS_LIST", payload: {} }),
      );
    } catch (e) {
      void MessagePlugin.error({
        content: e instanceof Error ? e.message : String(e),
        duration: 3000,
      });
    }
  }

  async function reloadGroups(): Promise<void> {
    try {
      setGroups(
        await request<HeaderGroup[]>({ type: "GROUPS_LIST", payload: {} }),
      );
    } catch (e) {
      void MessagePlugin.error({
        content: e instanceof Error ? e.message : String(e),
        duration: 3000,
      });
    }
  }

  function flash(text: string): void {
    void MessagePlugin.success({ content: text, duration: 2000 });
  }

  async function toggle(id: string, enabled: boolean): Promise<void> {
    // 组停用 = 整组暂停：仅拦截「启用」方向，避免「显示已启用但引擎不生效」
    const rule = rules.find((r) => r.id === id);
    if (rule && enabled && groupOffOf(rule)) {
      warnGroupOff();
      return;
    }
    const prev = rules;
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, enabled } : r)));
    try {
      await request({ type: "HEADERS_TOGGLE", payload: { id, enabled } });
    } catch {
      setRules(prev);
    }
  }

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [rules],
  );

  async function performRemove(id: string): Promise<void> {
    await request({ type: "HEADERS_DELETE", payload: { id } }).catch(() => {});
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await reload();
  }

  /** 批量删除已选规则 */
  async function removeSelected(): Promise<void> {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      await request({ type: "HEADERS_DELETE_MANY", payload: { ids } });
      flash(`已删除 ${ids.length} 条规则`);
    } catch {
      // 部分失败也刷新，以实际存储为准
    }
    setBulkDeleting(false);
    setSelected(new Set());
    await reload();
  }

  async function performCopy(rule: HeaderRule): Promise<void> {
    try {
      const copy = makeRuleCopy(rules, rule, genId());
      await request({ type: "HEADERS_SAVE", payload: { rule: copy } });
      await reload();
      flash(`已复制「${copy.name}」`);
    } catch (e) {
      void MessagePlugin.error({
        content: e instanceof Error ? e.message : String(e),
        duration: 3000,
      });
    }
  }

  function startCreate(): void {
    setErrors([]);
    setEditing({ ...newHeaderRule(), id: genId() });
  }

  async function moveRule(id: string, dir: "up" | "down"): Promise<void> {
    const sorted = [...rules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const i = sorted.findIndex((r) => r.id === id);
    const j = i + (dir === "up" ? -1 : 1);
    if (i < 0 || j < 0 || j >= sorted.length) return;
    const a = sorted[i]!;
    const b = sorted[j]!;
    const ao = a.order ?? 0;
    const bo = b.order ?? 0;
    try {
      await request({
        type: "HEADERS_SAVE",
        payload: { rule: { ...a, order: bo } },
      });
      await request({
        type: "HEADERS_SAVE",
        payload: { rule: { ...b, order: ao } },
      });
      await reload();
    } catch (e) {
      void MessagePlugin.error({
        content: e instanceof Error ? e.message : String(e),
        duration: 3000,
      });
    }
  }

  async function save(): Promise<void> {
    if (!editing) return;
    // 校验由共享 HeaderRuleEditor 内聚完成，这里只负责持久化
    try {
      await request({ type: "HEADERS_SAVE", payload: { rule: editing } });
      setEditing(null);
      await reload();
      flash("已保存并生效");
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    }
  }

  async function createGroup(name: string): Promise<void> {
    await request({
      type: "GROUPS_SAVE",
      payload: { group: { ...newHeaderGroup(), id: genId(), name } },
    });
    await reloadGroups();
  }

  async function saveGroupItem(group: HeaderGroup): Promise<void> {
    await request({ type: "GROUPS_SAVE", payload: { group } }).catch(() => {});
  }

  async function toggleGroupItem(id: string, enabled: boolean): Promise<void> {
    await request({ type: "GROUPS_TOGGLE", payload: { id, enabled } }).catch(
      () => {},
    );
    await reloadGroups();
  }

  async function deleteGroupItem(id: string): Promise<void> {
    await request({ type: "GROUPS_DELETE", payload: { id } }).catch(() => {});
    await reloadGroups();
  }

  return (
    <div className="headers-section">
      <HeaderGroupsPanel
        groups={groups}
        onCreate={createGroup}
        onSave={saveGroupItem}
        onToggle={toggleGroupItem}
        onDelete={deleteGroupItem}
      />
      <div className="actions headers-toolbar">
        <HeaderImportExport rules={rules} onImported={reload} />
        <ThemeToggle />
        <Button theme="primary" onClick={startCreate}>
          ＋ 新建规则
        </Button>
      </div>
      {errors.length > 0 && (
        <ul className="error">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {editing && (
        <HeaderRuleEditor
          draft={editing}
          groups={groups}
          learnedNames={collectLearnedHeaderNames(rules)}
          onChange={setEditing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      {rules.length > 0 && !editing && (
        <div className="hm-select-bar">
          <Checkbox
            checked={
              sortedRules.length > 0 &&
              sortedRules.every((r) => selected.has(r.id))
            }
            indeterminate={
              sortedRules.some((r) => selected.has(r.id)) &&
              !sortedRules.every((r) => selected.has(r.id))
            }
            onChange={(v) => {
              const on = Boolean(v);
              setSelected((prev) => {
                const next = new Set(prev);
                for (const r of sortedRules) {
                  if (on) next.add(r.id);
                  else next.delete(r.id);
                }
                return next;
              });
            }}
          >
            全选
          </Checkbox>
          {selected.size > 0 && (
            <>
              <span className="muted">已选 {selected.size} 条</span>
              <Button
                size="small"
                variant="outline"
                theme="danger"
                onClick={() => setBulkDeleting(true)}
              >
                批量删除
              </Button>
              <button
                type="button"
                className="hm-text-btn"
                onClick={() => setSelected(new Set())}
              >
                取消选择
              </button>
            </>
          )}
        </div>
      )}

      <ul className="rule-list">
        {sortedRules.map((rule) => (
          <li
            key={rule.id}
            className={`rule-row${rule.enabled ? "" : " disabled"}${groupOffOf(rule) ? " group-off" : ""}${selected.has(rule.id) ? " selected" : ""}`}
          >
            <span title="选择该规则（用于批量删除）">
              <Checkbox
                checked={selected.has(rule.id)}
                onChange={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(rule.id)) next.delete(rule.id);
                    else next.add(rule.id);
                    return next;
                  })
                }
              />
            </span>
            <Switch
              size="small"
              value={rule.enabled}
              onChange={(v) => void toggle(rule.id, Boolean(v))}
            />
            <div className="rule-meta">
              <span className="rule-name">
                {rule.name || "未命名规则"}
                {(() => {
                  const g = rule.groupId
                    ? groups.find((x) => x.id === rule.groupId)
                    : undefined;
                  if (!g) return null;
                  return g.enabled ? (
                    <span className="badge group">{g.name}</span>
                  ) : (
                    <span className="badge warn">{g.name} · 已停用</span>
                  );
                })()}
                {dnrLimited &&
                  ((rule.condition.excludeRegex ?? []).some((p) => p.trim()) ||
                    rule.kind === "body") && (
                    <span className="badge warn">仅Firefox</span>
                  )}
                {rule.id in sessionOv && (
                  <span className="badge session">临时</span>
                )}
              </span>
              <span
                className="rule-sub"
                title={describeCondition(rule.condition)}
              >
                {describeCondition(rule.condition)} · {describeActions(rule)}
              </span>
            </div>
            <div className="rule-ops">
              <button title="上移" onClick={() => void moveRule(rule.id, "up")}>
                ↑
              </button>
              <button
                title="下移"
                onClick={() => void moveRule(rule.id, "down")}
              >
                ↓
              </button>
              <button
                onClick={() => {
                  setErrors([]);
                  setEditing(structuredClone(rule));
                }}
              >
                编辑
              </button>
              <button
                title="复制为一条新规则"
                onClick={() => void performCopy(rule)}
              >
                复制
              </button>
              <button
                className="session-text"
                title={
                  rule.id in sessionOv
                    ? "清除会话临时覆盖"
                    : "本次会话临时翻转启用状态"
                }
                onClick={() => void toggleSession(rule.id)}
              >
                ⚡
              </button>
              <button
                className="danger-text"
                onClick={() => setDeleteId(rule.id)}
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>

      {rules.length === 0 && !editing && (
        <p className="hint">暂无规则。新建后即可对匹配请求改写请求/响应头。</p>
      )}

      <ConfirmDialog
        open={deleteId != null}
        header="删除规则"
        body="确定删除该规则？"
        confirmText="删除"
        danger
        onConfirm={() => {
          if (deleteId) void performRemove(deleteId);
          setDeleteId(null);
        }}
        onClose={() => setDeleteId(null)}
      />

      <ConfirmDialog
        open={bulkDeleting}
        header="批量删除规则"
        body={`确定删除已选的 ${selected.size} 条规则？删除后不可恢复。`}
        confirmText={`删除 ${selected.size} 条`}
        danger
        onConfirm={() => void removeSelected()}
        onClose={() => setBulkDeleting(false)}
      />
    </div>
  );
}
