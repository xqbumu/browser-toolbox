/**
 * 请求头规则编辑器（popup / options 共享）：
 * - TDesign 表单控件：Input / Select / CheckTag / Alert / Button；
 * - 窄面板友好的动作行布局：目标+操作一行，头名/头值独立成行；
 * - 校验内聚：保存前本地 validateHeaderRule，错误就地展示。
 */
import { useState } from "react";
import {
  Alert,
  Button,
  CheckTag,
  Input,
  Select,
  TagInput,
} from "tdesign-react";
import { CloseIcon, PlusIcon } from "tdesign-icons-react";
import {
  validateHeaderRule,
  type HeaderAction,
  type HeaderOp,
  type HeaderResourceType,
  type HeaderRule,
  type HeaderTarget,
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
  onChange: (rule: HeaderRule) => void;
  onSave: () => Promise<void> | void;
  onCancel: () => void;
}): React.ReactNode {
  const { draft, onChange } = props;
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function patch(p: Partial<HeaderRule>): void {
    onChange({ ...draft, ...p });
  }

  function patchCondition(p: Partial<HeaderRule["condition"]>): void {
    onChange({ ...draft, condition: { ...draft.condition, ...p } });
  }

  function patchAction(idx: number, p: Partial<HeaderAction>): void {
    onChange({
      ...draft,
      actions: draft.actions.map((a, i) => (i === idx ? { ...a, ...p } : a)),
    });
  }

  function toggleIn<T extends string>(list: T[] | undefined, value: T): T[] {
    const cur = list ?? [];
    return cur.includes(value)
      ? cur.filter((x) => x !== value)
      : [...cur, value];
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
        <span className="field-label">
          URL 匹配模式（可多个，任一命中即生效）
        </span>
        <TagInput
          value={draft.condition.urlFilters}
          placeholder="输入后回车，如 *://api.example.com/*"
          clearable
          onChange={(v: unknown) =>
            patchCondition({ urlFilters: ((v as string[]) ?? []).map(String) })
          }
        />
        <span className="hint">
          match pattern；全匹配可用 all_urls 或单独一个星号
        </span>
      </div>

      <div className="field">
        <span className="field-label">HTTP 方法（不选 = 不限）</span>
        <div className="chip-group">
          {METHODS.map((m) => (
            <CheckTag
              key={m}
              checked={draft.condition.methods?.includes(m) ?? false}
              onChange={() =>
                patchCondition({
                  methods: toggleIn(
                    draft.condition.methods as string[] | undefined,
                    m,
                  ),
                })
              }
            >
              {m}
            </CheckTag>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">资源类型（不选 = 不限）</span>
        <div className="chip-group">
          {RESOURCE_TYPES.map((t) => (
            <CheckTag
              key={t}
              checked={draft.condition.resourceTypes?.includes(t) ?? false}
              onChange={() =>
                patchCondition({
                  resourceTypes: toggleIn(
                    draft.condition.resourceTypes as
                      HeaderResourceType[] | undefined,
                    t,
                  ),
                })
              }
            >
              {t}
            </CheckTag>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">头部动作</span>
        {draft.actions.map((action, i) => (
          <div key={i} className="action-row">
            <div className="action-line">
              <Select
                size="small"
                value={action.target}
                options={[
                  { value: "request", label: "请求头" },
                  { value: "response", label: "响应头" },
                ]}
                onChange={(v) => patchAction(i, { target: v as HeaderTarget })}
              />
              <Select
                size="small"
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
