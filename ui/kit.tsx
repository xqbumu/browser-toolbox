/**
 * 工具 UI 基础组件（kit）：
 * 新工具按「MasterRow → 主操作 → SectionHead + 列表/内容 → EmptyState」的
 * 统一结构组装页面；此处沉淀跨工具复用的结构原语，样式见 ui/tool-ui.css。
 */
import type { ReactNode } from "react";
import { CloudIcon } from "tdesign-icons-react";
import { Dialog, Switch } from "tdesign-react";

/** 区块头：标题 · 计数，右侧动作插槽（齿轮、＋ 等） */
export function SectionHead({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="section-head">
      <span className="section-title">
        {title}
        {count != null ? ` · ${count}` : ""}
      </span>
      {children != null && (
        <span className="section-head-actions">{children}</span>
      )}
    </div>
  );
}

/** 工具级全局开关行：主标题 + 状态副文案 + 右侧 Switch */
export function MasterRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): ReactNode {
  return (
    <div className={`master-row${checked ? "" : " off"}`}>
      <div className="master-text">
        <p className="batch-title">{title}</p>
        <p className="muted">{desc}</p>
      </div>
      <Switch value={checked} onChange={(v) => onChange(Boolean(v))} />
    </div>
  );
}

/** 统一空态：图标 + 主文案 + 可选辅文案 */
export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}): ReactNode {
  return (
    <div className="empty-state">
      {icon ?? <CloudIcon />}
      <p>{title}</p>
      {hint && <p className="muted">{hint}</p>}
    </div>
  );
}

/** 统一确认对话框（声明式受控，popup/options 通用；替代命令式 DialogPlugin） */
export function ConfirmDialog({
  open,
  header,
  body,
  confirmText = "确认",
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  header: string;
  body: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): ReactNode {
  return (
    <Dialog
      visible={open}
      header={header}
      body={body}
      width={320}
      confirmBtn={{
        content: confirmText,
        theme: danger ? "danger" : "primary",
      }}
      cancelBtn="取消"
      onConfirm={() => {
        onConfirm();
        onClose();
      }}
      onClose={onClose}
    />
  );
}
