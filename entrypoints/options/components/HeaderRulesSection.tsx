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
import { ConfirmDialog } from "@/ui/kit";

async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function HeaderRulesSection() {
  const [rules, setRules] = useState<HeaderRule[]>([]);
  const [editing, setEditing] = useState<HeaderRule | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    void reload();
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

  return (
    <div className="headers-section">
      <div className="actions headers-toolbar">
        <HeaderImportExport rules={rules} onImported={reload} />
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
          onChange={setEditing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      <ul className="rule-list">
        {rules.map((rule) => (
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
                {describeCondition(rule.condition)} ·{" "}
                {describeActions(rule)}
              </span>
            </div>
            <div className="rule-ops">
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
