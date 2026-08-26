/**
 * 批量截图面板（紧凑版）：双行入口盒，纵向占用压到最小。
 * - 按选项卡：行内直接「开始」；
 * - 按 URL：点击行展开输入区（懒渲染），底部计数 Tag + 提交按钮；
 * - 忙碌时整盒降透明度并禁点；超限/跳过场景走受控 ConfirmDialog（B6 校验兜底不变）。
 */
import { useState } from "react";
import { Alert, Button, Tag, Textarea } from "tdesign-react";
import { ChevronDownIcon, LinkIcon, ViewListIcon } from "tdesign-icons-react";
import { ConfirmDialog } from "@/ui/kit";
import { validateBatchUrls, MAX_BATCH_URLS } from "@/utils/batch-validation";

interface Props {
  tabCount: number;
  canBatchTabs: boolean;
  canBatchUrls: boolean;
  busy: boolean;
  onBatchTabs: () => void;
  onBatchUrls: (urls: string[]) => void;
}

export function BatchPanel({
  tabCount,
  canBatchTabs,
  canBatchUrls,
  busy,
  onBatchTabs,
  onBatchUrls,
}: Props) {
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlsText, setUrlsText] = useState("");
  const [hint, setHint] = useState<{
    kind: "err" | "warn";
    text: string;
  } | null>(null);
  const [pendingUrls, setPendingUrls] = useState<string[] | null>(null);

  const validation = validateBatchUrls(urlsText);
  const hasInput = validation.lines.length > 0;

  function handleSubmit(): void {
    const v = validateBatchUrls(urlsText);
    if (v.lines.length === 0) {
      setHint({ kind: "err", text: "请输入至少一个 URL" });
      return;
    }
    if (v.invalidCount > 0 || v.overLimit) {
      // 有跳过/截断：先确认再执行
      setPendingUrls(v.validUrls.slice(0, MAX_BATCH_URLS));
      return;
    }
    onBatchUrls(v.validUrls.slice(0, MAX_BATCH_URLS));
  }

  function toggleUrlOpen(): void {
    setUrlOpen((v) => !v);
    setHint(null);
  }

  const urlSub = hasInput
    ? `已输入 ${validation.lines.length} 条${
        validation.invalidCount > 0 ? ` · 无效 ${validation.invalidCount}` : ""
      }`
    : `每行一个，最多 ${MAX_BATCH_URLS} 条`;

  return (
    <div className={`batch-box${busy ? " busy" : ""}`}>
      {/* 入口一：按选项卡 */}
      <div className="batch-entry">
        <span className="batch-icon">
          <ViewListIcon />
        </span>
        <div className="batch-text">
          <p className="batch-title">按选项卡批量</p>
          <p className="muted">{tabCount} 个选项卡 · 自动跳过受保护页</p>
        </div>
        <Button
          size="small"
          variant="outline"
          theme="primary"
          disabled={!canBatchTabs || busy || tabCount === 0}
          onClick={onBatchTabs}
        >
          开始
        </Button>
      </div>

      <div className="batch-divider" />

      {/* 入口二：按 URL（点击行展开/收起输入区） */}
      <button
        type="button"
        className="batch-entry as-button"
        onClick={toggleUrlOpen}
        aria-expanded={urlOpen}
      >
        <span className="batch-icon">
          <LinkIcon />
        </span>
        <div className="batch-text">
          <p className="batch-title">按 URL 列表批量</p>
          <p className="muted">{urlSub}</p>
        </div>
        <ChevronDownIcon className={`batch-chevron${urlOpen ? " up" : ""}`} />
      </button>

      {urlOpen && (
        <div className="batch-url-body">
          <Textarea
            placeholder={"https://example.com/a\nhttps://example.com/b"}
            value={urlsText}
            onChange={(v) => {
              setUrlsText(String(v ?? ""));
              setHint(null);
            }}
            autosize={{ minRows: 3, maxRows: 6 }}
            disabled={!canBatchUrls || busy}
            status={hint?.kind === "err" ? "error" : undefined}
          />

          {hint && (
            <Alert
              theme={hint.kind === "err" ? "error" : "warning"}
              message={hint.text}
            />
          )}

          <div className="batch-footer">
            <span className="batch-count">
              <Tag
                size="small"
                theme={
                  hasInput && validation.invalidCount === 0
                    ? "success"
                    : "default"
                }
                variant="light"
              >
                有效 {validation.validUrls.length}
              </Tag>
              {validation.invalidCount > 0 && (
                <Tag size="small" theme="danger" variant="light">
                  无效 {validation.invalidCount}
                </Tag>
              )}
              {validation.overLimit && (
                <Tag size="small" theme="warning" variant="light">
                  超出上限
                </Tag>
              )}
            </span>
            <Button
              size="small"
              theme="primary"
              disabled={!canBatchUrls || busy || !hasInput}
              onClick={handleSubmit}
            >
              开始截图
            </Button>
          </div>

          <ConfirmDialog
            open={pendingUrls != null}
            header="确认批量截图"
            body="部分 URL 将被跳过或截断，是否继续？"
            confirmText="继续"
            onConfirm={() => {
              if (pendingUrls) onBatchUrls(pendingUrls);
              setPendingUrls(null);
              setHint(null);
            }}
            onClose={() => setPendingUrls(null)}
          />
        </div>
      )}
    </div>
  );
}
