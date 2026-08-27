/**
 * 请求头规则导入 / 导出（共享组件）：
 * - 导入：文件选择，逐条校验（先经 migrateHeaderRule 规范化），无效规则跳过并计数提示；
 * - 导出：当前规则 JSON 复制到剪贴板；
 * - 反馈统一走 MessagePlugin，不内嵌错误列表。
 * 被 popup「请求头」设置视图与 options 管理页共用。
 */
import { useState } from "react";
import { Button, MessagePlugin, Radio, RadioGroup } from "tdesign-react";
import {
  migrateHeaderRule,
  validateHeaderRule,
  type HeaderRule,
} from "@/types/headers";
import { isModHeaderExport, parseModHeader } from "@/core/headers/modheader";
import type { PopupRequest, PopupResponse } from "@/types/messages";

async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function HeaderImportExport({
  rules,
  onImported,
}: {
  rules: HeaderRule[];
  onImported?: () => Promise<void> | void;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"merge" | "replace">("merge");

  async function importJson(text: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      void MessagePlugin.error({
        content: "JSON 解析失败，请检查格式",
        duration: 3000,
      });
      return;
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    // ModHeader 导出：整体转换为本规则后再走统一校验
    if (isModHeaderExport(parsed)) {
      const converted = parseModHeader(parsed).map((r) => migrateHeaderRule(r));
      const valid: HeaderRule[] = [];
      let invalidCount = 0;
      for (const item of converted) {
        if (validateHeaderRule(item).length === 0) valid.push(item);
        else invalidCount += 1;
      }
      if (valid.length === 0) {
        void MessagePlugin.error({
          content: "没有可导入的有效规则",
          duration: 3000,
        });
        return;
      }
      await commitImport(valid, invalidCount);
      return;
    }
    // 本工具格式：先规范化（兼容旧 urlFilter 单值），再逐条校验，丢弃无效规则
    const valid: HeaderRule[] = [];
    let invalidCount = 0;
    for (const item of arr) {
      const normalized = migrateHeaderRule(item as HeaderRule);
      if (validateHeaderRule(normalized).length === 0) valid.push(normalized);
      else invalidCount += 1;
    }
    if (valid.length === 0) {
      void MessagePlugin.error({
        content: "没有可导入的有效规则",
        duration: 3000,
      });
      return;
    }
    await commitImport(valid, invalidCount);
  }

  async function commitImport(
    valid: HeaderRule[],
    invalidCount: number,
  ): Promise<void> {
    try {
      const all = await request<HeaderRule[]>({
        type: "HEADERS_IMPORT",
        payload: { rules: valid, mode },
      });
      await onImported?.();
      setOpen(false);
      void MessagePlugin.success({
        content:
          invalidCount > 0
            ? `已导入 ${valid.length} 条，跳过 ${invalidCount} 条无效规则`
            : `已导入 ${valid.length} 条`,
        duration: 2500,
      });
      void all;
    } catch (e) {
      void MessagePlugin.error({
        content: e instanceof Error ? e.message : String(e),
        duration: 3000,
      });
    }
  }

  async function exportJson(): Promise<void> {
    try {
      await navigator.clipboard.writeText(JSON.stringify(rules, null, 2));
      void MessagePlugin.success({ content: "已复制到剪贴板", duration: 2000 });
    } catch {
      void MessagePlugin.error({
        content: "复制失败，请手动导出",
        duration: 2500,
      });
    }
  }

  return (
    <div className="rule-editor io-panel">
      <div className="actions" style={{ marginTop: 0 }}>
        <Button
          size="small"
          variant="outline"
          onClick={() => setOpen((v) => !v)}
        >
          导入规则
        </Button>
        <Button
          size="small"
          variant="outline"
          disabled={rules.length === 0}
          onClick={() => void exportJson()}
        >
          导出 JSON
        </Button>
      </div>

      {open && (
        <div className="import-box">
          <RadioGroup
            value={mode}
            onChange={(v) => setMode(v as "merge" | "replace")}
          >
            <Radio value="merge">合并（同 id 覆盖）</Radio>
            <Radio value="replace">替换全部</Radio>
          </RadioGroup>
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void file.text().then(importJson);
              e.target.value = "";
            }}
          />
          <p className="hint">
            支持本工具导出 JSON 与 ModHeader 配置（自动识别；ModHeader 每个
            profile 转为一条规则）
          </p>
          <p className="hint">支持单条对象或对象数组；导入后立即生效。</p>
        </div>
      )}
    </div>
  );
}
