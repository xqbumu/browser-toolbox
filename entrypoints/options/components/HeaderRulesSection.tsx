/**
 * 请求头规则管理（工具箱 · options 视图）：
 * - 全量规则列表：启停开关、编辑、删除；
 * - 编辑器：名称 / URL 匹配模式 / 方法与资源类型 / 动作行（target × op × name/value）；
 * - 导入导出：文件导入（merge/replace）+ 复制导出 JSON。
 * 写操作统一走 background 消息，保证引擎即时同步。
 */
import { useEffect, useState } from "react";
import { Button, MessagePlugin, Switch } from "tdesign-react";
import {
  describeActions,
  describeCondition,
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
import { ConfirmDialog } from "@/ui/kit";
import { newHeaderGroup, type HeaderGroup } from "@/types/headers";

async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function HeaderRulesSection() {
  const [rules, setRules] = useState<HeaderRule[]>([]);
  const [groups, setGroups] = useState<HeaderGroup[]>([]);
  const [editing, setEditing] = useState<HeaderRule | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    void reload();
    void reloadGroups();
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
    const prev = rules;
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, enabled } : r)));
    try {
      await request({ type: "HEADERS_TOGGLE", payload: { id, enabled } });
    } catch {
      setRules(prev);
    }
  }

  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function performRemove(id: string): Promise<void> {
    await request({ type: "HEADERS_DELETE", payload: { id } }).catch(() => {});
    await reload();
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
          onChange={setEditing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      <ul className="rule-list">
        {[...rules]
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((rule) => (
            <li
              key={rule.id}
              className={`rule-row${rule.enabled ? "" : " disabled"}`}
            >
              <Switch
                size="small"
                value={rule.enabled}
                onChange={(v) => void toggle(rule.id, Boolean(v))}
              />
              <div className="rule-meta">
                <span className="rule-name">{rule.name || "未命名规则"}</span>
                <span
                  className="rule-sub"
                  title={describeCondition(rule.condition)}
                >
                  {describeCondition(rule.condition)} · {describeActions(rule)}
                </span>
              </div>
              <div className="rule-ops">
                <button
                  title="上移"
                  onClick={() => void moveRule(rule.id, "up")}
                >
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
    </div>
  );
}
