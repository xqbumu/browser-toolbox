/**
 * 批量截图面板：按选项卡 / 按 URL 列表两种批量模式入口。
 * 默认折叠（<details>），点击「批量截图」摘要展开，减少 popup 纵向占用。
 *
 * B6：按 URL 提交前校验——空输入 / 非法 URL / 超 50 条给出明确提示（前端先提示，
 *     BatchUrlsRunner 仍保留过滤逻辑兜底）。
 */
import { useState } from 'react';
import { validateBatchUrls, MAX_BATCH_URLS } from '@/utils/batch-validation';

interface Props {
  tabCount: number;
  canBatchTabs: boolean;
  canBatchUrls: boolean;
  busy: boolean;
  onBatchTabs: () => void;
  onBatchUrls: (urls: string[]) => void;
}

/** 批量面板内联提示（非阻塞） */
type Hint = { kind: 'err' | 'warn'; text: string };

export function BatchPanel({
  tabCount,
  canBatchTabs,
  canBatchUrls,
  busy,
  onBatchTabs,
  onBatchUrls,
}: Props) {
  const [urlsText, setUrlsText] = useState('');
  const [hint, setHint] = useState<Hint | null>(null);

  const validation = validateBatchUrls(urlsText);

  function handleSubmit(): void {
    const v = validateBatchUrls(urlsText);
    // 空输入：明确提示，不提交
    if (v.lines.length === 0) {
      setHint({ kind: 'err', text: '请输入至少一个 URL' });
      return;
    }
    // 非法 URL / 超限：前端先提示，用户确认后仍按合法项截断提交
    if (v.invalidCount > 0 || v.overLimit) {
      const parts: string[] = [];
      if (v.invalidCount > 0) parts.push(`${v.invalidCount} 个非 http(s) URL 将被跳过`);
      if (v.overLimit) parts.push(`超过 ${MAX_BATCH_URLS} 条，仅截取前 ${MAX_BATCH_URLS} 条`);
      const ok = window.confirm(`${parts.join('；')}。是否继续？`);
      if (!ok) return;
    }
    setHint(null);
    onBatchUrls(v.validUrls.slice(0, MAX_BATCH_URLS));
  }

  return (
    <details className="card batch-panel">
      <summary className="batch-summary">批量截图</summary>

      <div className="batch-body">
        <div className="batch-row">
          <button className="block" disabled={!canBatchTabs || busy} onClick={onBatchTabs}>
            按选项卡批量截图
          </button>
          <span className="muted">检测到 {tabCount} 个选项卡</span>
        </div>

        <div className="batch-divider" />

        <textarea
          placeholder={'输入 URL（每行一个）：\nhttps://example.com/a\nhttps://example.com/b'}
          value={urlsText}
          onChange={(e) => {
            setUrlsText(e.target.value);
            setHint(null);
          }}
          disabled={!canBatchUrls || busy}
        />
        {hint && (
          <p className={hint.kind === 'err' ? 'status-err' : 'status-warn'} style={{ margin: 0 }}>
            {hint.text}
          </p>
        )}
        <div className="row" style={{ marginTop: 4 }}>
          <span className="muted">
            共 {validation.validUrls.length} 个 URL
            {validation.invalidCount > 0 ? `（${validation.invalidCount} 个无效）` : ''}
          </span>
          <button
            disabled={!canBatchUrls || busy || validation.lines.length === 0}
            onClick={handleSubmit}
          >
            按 URL 列表截图
          </button>
        </div>
      </div>
    </details>
  );
}
