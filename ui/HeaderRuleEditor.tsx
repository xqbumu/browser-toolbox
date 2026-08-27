/**
 * 请求头规则编辑器（popup / options 共享）：
 * - TDesign 表单控件：Input / Select / RadioGroup / Textarea / Alert / Button；
 * - 窄面板友好的动作行布局：目标+操作一行，头名/头值独立成行；
 * - 校验内聚：保存前本地 validateHeaderRule，错误就地展示。
 */
import { useState } from "react";
import {
  Alert,
  Button,
  Input,
  Radio,
  RadioGroup,
  Select,
  Textarea,
} from "tdesign-react";
import { CloseIcon, PlusIcon } from "tdesign-icons-react";
import {
  validateHeaderRule,
  IMPLICIT_GROUP_LABEL,
  type HeaderAction,
  type HeaderGroup,
  type UrlMatchItem,
  type UrlMatchType,
  type HeaderOp,
  type HeaderResourceType,
  type HeaderRule,
  type HeaderTarget,
  type RuleKind,
} from "@/types/headers";

const RESOURCE_TYPES: HeaderResourceType[] = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "xmlhttprequest",
  "websocket",
  "media",
  "font",
  "other",
];

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

export function HeaderRuleEditor(props: {
  draft: HeaderRule;
  groups: HeaderGroup[];
  onChange: (rule: HeaderRule) => void;
  onSave: () => Promise<void> | void;
  onCancel: () => void;
}): React.ReactNode {
  const { draft, onChange } = props;
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const ruleKind: RuleKind = draft.kind ?? "headers";

  function patch(p: Partial<HeaderRule>): void {
    onChange({ ...draft, ...p });
  }

  function patchCondition(p: Partial<HeaderRule["condition"]>): void {
    onChange({ ...draft, condition: { ...draft.condition, ...p } });
  }

  function patchMatch(idx: number, p: Partial<UrlMatchItem>): void {
    onChange({
      ...draft,
      condition: {
        ...draft.condition,
        matches: (draft.condition.matches ?? []).map((m, i) =>
          i === idx ? { ...m, ...p } : m,
        ),
      },
    });
  }

  function patchAction(idx: number, p: Partial<HeaderAction>): void {
    onChange({
      ...draft,
      actions: draft.actions.map((a, i) => (i === idx ? { ...a, ...p } : a)),
    });
  }

  async function save(): Promise<void> {
    const errs = validateHeaderRule(draft);
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      await props.onSave();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rule-editor">
      <h3>{draft.name ? `编辑：${draft.name}` : "新建规则"}</h3>

      <div className="field">
        <span className="field-label">规则名称</span>
        <Input
          value={draft.name}
          placeholder="如：改写 API 签名头"
          onChange={(v) => patch({ name: String(v ?? "") })}
        />
      </div>

      <div className="field">
        <span className="field-label">所属分组</span>
        <Select
          value={draft.groupId ?? ""}
          onChange={(v) => patch({ groupId: v === "" ? undefined : String(v) })}
          options={[
            { label: IMPLICIT_GROUP_LABEL, value: "" },
            ...props.groups.map((g) => ({
              label: g.name + (g.enabled ? "" : "（已停用）"),
              value: g.id,
            })),
          ]}
          size="small"
        />
      </div>

      <div className="field">
        <span className="field-label">动作类型</span>
        <RadioGroup
          variant="default-filled"
          size="small"
          value={ruleKind}
          onChange={(v) => patch({ kind: v as RuleKind })}
        >
          <Radio value="headers">改写头部</Radio>
          <Radio value="cancel">阻止请求</Radio>
          <Radio value="redirect">重定向</Radio>
        </RadioGroup>
      </div>

      {ruleKind !== "headers" && (
        <Alert
          theme="info"
          message={
            ruleKind === "cancel"
              ? "命中即取消该请求，不产生网络响应"
              : "命中后将请求重定向到下方目标地址"
          }
        />
      )}

      <div className="field">
        <span className="field-label">
          URL 匹配条件（任一命中即生效，成组编辑）
        </span>
        {(draft.condition.matches ?? []).map((m, i) => {
          const t: UrlMatchType = m.matchType ?? "pattern";
          return (
            <div key={i} className="action-row">
              <div className="action-line">
                <Select
                  size="small"
                  className="sel-mtype"
                  value={t}
                  options={[
                    { value: "pattern", label: "模式匹配" },
                    { value: "contains", label: "包含" },
                    { value: "regex", label: "正则" },
                  ]}
                  onChange={(v) =>
                    patchMatch(i, {
                      matchType:
                        v === "contains" || v === "regex"
                          ? v
                          : ("pattern" as UrlMatchType),
                    })
                  }
                />
                <Button
                  size="small"
                  variant="text"
                  theme="danger"
                  title="移除该条件"
                  onClick={() =>
                    patchCondition({
                      matches: draft.condition.matches.filter(
                        (_, idx) => idx !== i,
                      ),
                    })
                  }
                >
                  <CloseIcon />
                </Button>
              </div>
              <Input
                size="small"
                placeholder={
                  t === "pattern"
                    ? "*://api.example.com/*"
                    : t === "contains"
                      ? "如 /api/v2/"
                      : "如 ^https://api\\.example\\.com/v[0-9]+/"
                }
                value={m.value}
                onChange={(v) => patchMatch(i, { value: String(v ?? "") })}
              />
              {t === "pattern" && (
                <span className="hint">
                  支持全匹配：单独一个星号、&lt;all_urls&gt; 或全通配三段式
                </span>
              )}
            </div>
          );
        })}
        <Button
          size="small"
          block
          variant="dashed"
          icon={<PlusIcon />}
          onClick={() =>
            patchCondition({
              matches: [
                ...(draft.condition.matches ?? []),
                { matchType: "pattern", value: "" } as UrlMatchItem,
              ],
            })
          }
        >
          添加匹配条件
        </Button>
      </div>

      <details className="advanced exclude">
        <summary>排除域名（可选）</summary>
        <textarea
          className="exclude-area"
          rows={3}
          placeholder={"每行一个域名，支持 *.example.com 通配\nads.example.com"}
          value={(draft.condition.excludeDomains ?? []).join("\n")}
          onChange={(e) =>
            patchCondition({
              excludeDomains: String(e.target.value ?? "")
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
        <span className="hint">命中以下任意域名的请求将跳过本规则</span>
      </details>

      <div className="field">
        <span className="field-label">HTTP 方法（不选 = 不限）</span>
        <Select
          className="one-line-select"
          multiple
          clearable
          minCollapsedNum={3}
          size="small"
          placeholder="不限方法"
          value={draft.condition.methods ?? []}
          options={METHODS.map((m) => ({ value: m, label: m }))}
          onChange={(v) =>
            patchCondition({ methods: ((v as string[]) ?? []).map(String) })
          }
        />
      </div>

      <div className="field">
        <span className="field-label">资源类型（不选 = 不限）</span>
        <Select
          className="one-line-select"
          multiple
          clearable
          minCollapsedNum={1}
          size="small"
          placeholder="全部资源类型"
          value={draft.condition.resourceTypes ?? []}
          options={RESOURCE_TYPES.map((t) => ({ value: t, label: t }))}
          onChange={(v) =>
            patchCondition({
              resourceTypes: ((v as HeaderResourceType[]) ?? []).filter(
                Boolean,
              ),
            })
          }
        />
      </div>

      {ruleKind === "headers" && (
        <div className="field">
          <span className="field-label">头部动作</span>
          {draft.actions.map((action, i) => (
            <div key={i} className="action-row">
              <div className="action-line">
                <Select
                  size="small"
                  className="sel-target"
                  popupProps={{
                    placement: "top-left",
                    overlayInnerStyle: { width: "100%" },
                  }}
                  value={action.target}
                  options={[
                    { value: "request", label: "请求头" },
                    { value: "response", label: "响应头" },
                  ]}
                  onChange={(v) =>
                    patchAction(i, { target: v as HeaderTarget })
                  }
                />
                <Select
                  size="small"
                  className="sel-op"
                  popupProps={{
                    placement: "top-left",
                    overlayInnerStyle: { width: "100%" },
                  }}
                  value={action.op}
                  options={[
                    { value: "set", label: "覆盖" },
                    { value: "append", label: "追加" },
                    { value: "remove", label: "删除" },
                  ]}
                  onChange={(v) => patchAction(i, { op: v as HeaderOp })}
                />
                <Button
                  size="small"
                  variant="text"
                  theme="danger"
                  title="移除该动作"
                  onClick={() =>
                    patch({
                      actions: draft.actions.filter((_, idx) => idx !== i),
                    })
                  }
                >
                  <CloseIcon />
                </Button>
              </div>
              <Input
                size="small"
                placeholder="头部名（如 X-Token）"
                value={action.name}
                onChange={(v) => patchAction(i, { name: String(v ?? "") })}
              />
              {action.op !== "remove" && (
                <Input
                  size="small"
                  placeholder="头部值"
                  value={action.value ?? ""}
                  onChange={(v) => patchAction(i, { value: String(v ?? "") })}
                />
              )}
            </div>
          ))}
          <Button
            size="small"
            block
            variant="dashed"
            icon={<PlusIcon />}
            onClick={() =>
              patch({
                actions: [
                  ...draft.actions,
                  { target: "request", op: "set", name: "", value: "" },
                ],
              })
            }
          >
            添加动作
          </Button>
        </div>
      )}

      {ruleKind === "redirect" && (
        <div className="field">
          <span className="field-label">重定向目标</span>
          <Input
            value={draft.redirectTo ?? ""}
            placeholder={
              (draft.condition.matchType ?? "pattern") === "regex"
                ? "https://new.example.com$1（$1 引用捕获组）"
                : "https://mirror.example.com/request-path"
            }
            onChange={(v) => patch({ redirectTo: String(v ?? "") })}
          />
          <span className="hint">
            {(draft.condition.matchType ?? "pattern") === "regex"
              ? "正则模式下可用 $1~$9 引用匹配捕获组"
              : "需为 http(s) 绝对地址"}
          </span>
        </div>
      )}

      <details className="advanced">
        <summary>备注（可选）</summary>
        <Input
          value={draft.comment ?? ""}
          placeholder="用途说明，方便日后维护"
          onChange={(v) => patch({ comment: String(v ?? "") })}
        />
      </details>

      {errors.length > 0 && (
        <Alert
          theme="error"
          message={
            <ul className="error-list">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          }
        />
      )}

      <div className="actions">
        <Button theme="primary" loading={saving} onClick={() => void save()}>
          保存
        </Button>
        <Button onClick={props.onCancel}>取消</Button>
      </div>
    </section>
  );
}
