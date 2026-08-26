/**
 * 进度与结果展示组件：
 * 展示整页分阶段进度（stage）、批量进度（B1：已完成项推进 + 重试提示 + 耗时/剩余估计）
 * 与最终汇总（含取消/下载失败/跳过提示）。进度条统一使用 TDesign Progress。
 */
import { useEffect, useRef, useState } from "react";
import { Loading, Progress } from "tdesign-react";
import type { ProgressEvent } from "@/types/messages";
import type { BatchResult } from "@/types/capture";
import { estimateRemainingMs, formatDuration } from "@/utils/helpers";

interface Props {
  progress: ProgressEvent | null;
  busy: boolean;
}

export function ProgressBar({ progress, busy }: Props) {
  const item = progress?.kind === "item" ? progress : null;
  const start = progress?.kind === "start" ? progress : null;
  const stage = progress?.kind === "stage" ? progress : null;
  const cancelled = progress?.kind === "cancelled" ? progress : null;
  const done = progress?.kind === "done" ? progress.result : null;

  // B1：start 事件到达时记录时间戳，供「已耗时/剩余」计算
  const startAtRef = useRef<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (start) startAtRef.current = Date.now();
    if (done && !busy) startAtRef.current = null; // 任务结束清理时间戳
  }, [start, done, busy]);

  // busy 期间每秒强制刷新一次，驱动「已耗时」读数推进
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const total = item?.total ?? start?.total ?? stage?.total ?? 0;

  // 批量进度：已完成项 = index - 1（首项到达仍为 0%，末项完成→done→100%）
  const completed = item ? Math.max(0, item.index - 1) : 0;
  const batchPercent =
    item && total > 0 ? Math.round((completed / total) * 100) : 0;

  // 整页 stage(scrolling) 进度：已完成分片 = current
  const stagePercent =
    stage && total > 0 ? Math.round(((stage.current ?? 0) / total) * 100) : 0;

  // 已耗时 / 剩余估计（仅批量 item 阶段展示）
  const elapsedMs =
    startAtRef.current != null ? Date.now() - startAtRef.current : null;
  const remainingMs =
    item && elapsedMs != null
      ? estimateRemainingMs(elapsedMs, completed, total)
      : null;

  if (!busy && !done && !item && !stage && !cancelled) return null;

  return (
    <div className="progress-block">
      {/* 整页分阶段进度（A1） */}
      {stage && busy && (
        <div className="stage-line">
          {stage.phase === "scrolling" && total > 0 ? (
            <>
              <Progress percentage={stagePercent} />
              <p className="muted progress-caption">
                {stage.label} · {stage.current}/{total}
              </p>
            </>
          ) : (
            <Loading loading size="small" text={stage.label}>
              <span className="muted">　</span>
            </Loading>
          )}
          {stage.warning && (
            <p className="status-warn progress-caption">⚠️ {stage.warning}</p>
          )}
        </div>
      )}

      {/* 批量进度条（start/item） */}
      {busy && !stage && total > 0 && (
        <>
          <Progress percentage={batchPercent} />
          <p className="muted progress-caption">
            {item?.retrying ? (
              <span className="retrying">↻ 重试：{item.label}</span>
            ) : (
              `${item ? item.index : 0}/${total} · ${item?.label ?? "准备中…"}`
            )}
          </p>
          {item && elapsedMs != null && (
            <p className="muted progress-caption">
              已耗时 {formatDuration(elapsedMs)}
              {remainingMs != null
                ? ` · 剩余约 ${formatDuration(remainingMs)}`
                : ""}
            </p>
          )}
        </>
      )}

      {/* 无具体进度时的兜底提示 */}
      {busy && !stage && total === 0 && (
        <Loading loading size="small" text="准备中…">
          <span className="muted">　</span>
        </Loading>
      )}

      {/* 取消提示（A5） */}
      {cancelled && !done && <p className="status-warn">已取消</p>}

      {done && <BatchSummary result={done} />}
    </div>
  );
}

function BatchSummary({ result }: { result: BatchResult }) {
  return (
    <div className="batch-summary">
      {result.cancelled && <p className="status-warn">已取消批量截图</p>}
      <p>
        完成：<span className="status-ok">成功 {result.success}</span>
        {" · "}
        <span className={result.failed > 0 ? "status-err" : "muted"}>
          失败 {result.failed}
        </span>
      </p>
      {result.skipped != null && result.skipped > 0 && (
        <p className="muted progress-caption">
          已跳过 {result.skipped} 个不可截取的选项卡（chrome:// 等受保护页面）
        </p>
      )}
      {result.downloadFailed && (
        <p className="status-warn progress-caption">
          ⚠️ 打包下载失败：{result.downloadError ?? ""}
        </p>
      )}
      {result.failed > 0 && (
        <ul className="fail-list">
          {result.items
            .filter((it) => !it.ok)
            .map((it, i) => (
              <li key={i} className="status-err" title={it.error}>
                {it.url || it.title || `#${i + 1}`}：{it.error}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
