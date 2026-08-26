/**
 * 请求头工具设置视图（popup 内）：规则的导入 / 导出。
 * 自持规则列表加载，供壳层统一设置入口挂载；数据变更后本地刷新。
 */
import { useEffect, useState } from "react";
import { HeaderImportExport } from "@/ui/HeaderImportExport";
import { listHeaderRules } from "@/utils/header-rules-store";
import type { HeaderRule } from "@/types/headers";

export function HeadersSettings(): React.ReactNode {
  const [rules, setRules] = useState<HeaderRule[]>([]);

  async function reload(): Promise<void> {
    setRules(await listHeaderRules());
  }

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div className="settings-view">
      <HeaderImportExport rules={rules} onImported={reload} />
      <p className="hint" style={{ marginTop: -4 }}>
        规则的新建与编辑在「请求头」工具页完成；导入导出便于备份与迁移。
      </p>
    </div>
  );
}
