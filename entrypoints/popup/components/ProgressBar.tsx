/**
 * 进度与结果展示组件：
 * 展示整页分阶段进度（stage：preparing/waiting/scrolling/stitching）、
 * 批量进度（第 N 页 / 总数 + 重试提示）与最终汇总（含取消/下载失败）。
 */
import type { ProgressEvent } from '@/types/messages';
import type { BatchResult } from '@/types/capture';

interface Props {
  progress: ProgressEvent | null;
  busy: boolean;
}

export function ProgressBar({ progress, busy }: Props) {
  const item = progress?.kind === 'item' ? progress : null;
  const start = progress?.kind === 'start' ? progress : null;
  const stage = progress?.kind === 'stage' ? progress : null;
  const cancelled = progress?.kind === 'cancelled' ? progress : null;
  const done = progress?.kind === 'done' ? progress.result : null;

  // 批量进度（item/start）与整页 stage(scrolling) 共用的百分比
  const total = item?.total ?? start?.total ?? stage?.total ?? 0;
  const current = item?.index ?? stage?.current ?? 0;
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  if (!busy && !done && !item && !stage && !cancelled) return null;

  return (
    <div className="card">
      <p className="card-title">进度</p>

      {/* 整页分阶段进度（A1） */}
      {stage && busy && (
        <div className="stage-line">
          {stage.phase === 'scrolling' && total > 0 ? (
            <>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <p className="muted" style={{ marginTop: 6 }}>
                {stage.label} · {current}/{total}
              </p>
            </>
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>
              <span className="spinner" aria-hidden="true" /> {stage.label}
            </p>
          )}
          {stage.warning && (
            <p className="status-warn" style={{ marginTop: 4 }}>
              ⚠️ {stage.warning}
            </p>
          )}
        </div>
      )}

      {/* 批量进度条（start/item） */}
      {busy && !stage && total > 0 && (
        <>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="muted" style={{ marginTop: 6 }}>
            {current}/{total} · {item?.label ?? '准备中…'}
            {item?.retrying ? '（重试）' : ''}
          </p>
        </>
      )}

      {/* 无具体进度时的兜底提示 */}
      {busy && !stage && total === 0 && (
        <p className="muted" style={{ marginTop: 0 }}>
          <span className="spinner" aria-hidden="true" /> 准备中…
        </p>
      )}

      {/* 取消提示（A5） */}
      {cancelled && !done && <p className="status-warn">已取消</p>}

      {done && <BatchSummary result={done} />}
    </div>
  );
}

function BatchSummary({ result }: { result: BatchResult }) {
  return (
    <div>
      {result.cancelled && <p className="status-warn">已取消批量截图</p>}
      <p>
        完成：<span className="status-ok">成功 {result.success}</span>
        {' · '}
        <span className={result.failed > 0 ? 'status-err' : 'muted'}>失败 {result.failed}</span>
      </p>
      {result.downloadFailed && (
        <p className="status-warn" style={{ marginTop: 4 }}>
          ⚠️ 打包下载失败：{result.downloadError ?? ''}
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
