import { useState } from "react";
import { Button, Switch } from "tdesign-react";
import { DeleteIcon } from "tdesign-icons-react";
import type { HeaderGroup } from "@/types/headers";
import { ConfirmDialog } from "@/ui/kit";

interface Props {
  groups: HeaderGroup[];
  onCreate: (name: string) => Promise<void>;
  onSave: (group: HeaderGroup) => Promise<void> | void;
  onToggle: (id: string, enabled: boolean) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
}

export function HeaderGroupsPanel({
  groups,
  onCreate,
  onSave,
  onToggle,
  onDelete,
}: Props): React.ReactNode {
  const [name, setName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<HeaderGroup | null>(null);

  return (
    <section className="groups-panel">
      <div className="groups-head">
        <span className="section-label">分组管理</span>
        <span className="hint">组停用后整组规则不再生效</span>
      </div>
      <form
        className="group-create"
        onSubmit={(e) => {
          e.preventDefault();
          const v = name.trim();
          if (!v) return;
          onCreate(v).then(() => setName(""));
        }}
      >
        <input
          className="group-input"
          placeholder="新分组名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" size="small" disabled={!name.trim()}>
          添加分组
        </Button>
      </form>
      <ul className="group-list">
        {groups.length === 0 && (
          <li className="group-empty">暂无分组，规则默认归「未分组」</li>
        )}
        {groups.map((g) => (
          <li key={g.id} className="group-row">
            <Switch
              size="small"
              value={g.enabled}
              onChange={(v) => void onToggle(g.id, Boolean(v))}
            />
            <input
              className="group-name-input"
              value={g.name}
              onChange={(e) => void onSave({ ...g, name: e.target.value })}
            />
            <Button
              size="small"
              variant="text"
              theme="danger"
              icon={<DeleteIcon />}
              onClick={() => setPendingDelete(g)}
            />
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={pendingDelete != null}
        header="删除分组"
        body={`删除「${pendingDelete?.name ?? ""}」后，组内规则将归为「未分组」（不会被删除）。确认？`}
        onConfirm={() => {
          if (pendingDelete) void onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
        onClose={() => setPendingDelete(null)}
      />
    </section>
  );
}
