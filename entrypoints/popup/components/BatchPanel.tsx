/**
 * 批量截图面板：按选项卡 / 按 URL 列表两种批量模式入口。
 * 默认折叠（<details>），点击「批量截图」摘要展开，减少 popup 纵向占用。
 */
import { useState } from 'react';

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
  const [urlsText, setUrlsText] = useState('');

  const parsedUrls = urlsText
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

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
          onChange={(e) => setUrlsText(e.target.value)}
          disabled={!canBatchUrls || busy}
        />
        <div className="row" style={{ marginTop: 4 }}>
          <span className="muted">共 {parsedUrls.length} 个 URL</span>
          <button
            disabled={!canBatchUrls || busy || parsedUrls.length === 0}
            onClick={() => onBatchUrls(parsedUrls)}
          >
            按 URL 列表截图
          </button>
        </div>
      </div>
    </details>
  );
}
