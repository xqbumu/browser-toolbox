/**
 * 预览弹层：展示原图（等比缩放），支持放大/缩小/复位、在新标签页打开、Esc/遮罩关闭。
 */
import { useEffect, useState } from 'react';
import type { ScreenshotRecord } from '@/types/history';

interface Props {
  record: ScreenshotRecord;
  onClose: () => void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const STEP = 0.25;

export function PreviewModal({ record, onClose }: Props) {
  const [scale, setScale] = useState(1);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(record.imageBlob);
    setUrl(u);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      URL.revokeObjectURL(u);
      window.removeEventListener('keydown', onKey);
    };
  }, [record, onClose]);

  function openInNewTab(): void {
    // 为「在新标签页打开」单独创建 objectURL，避免关闭弹层 revoke 原 URL 的竞态
    const tabUrl = URL.createObjectURL(record.imageBlob);
    void browser.tabs.create({ url: tabUrl });
  }

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="preview-toolbar">
          <button onClick={() => setScale((s) => Math.min(MAX_SCALE, round(s + STEP)))}>放大</button>
          <button onClick={() => setScale((s) => Math.max(MIN_SCALE, round(s - STEP)))}>缩小</button>
          <button onClick={() => setScale(1)}>复位</button>
          <button onClick={openInNewTab}>在新标签页打开</button>
          <button className="danger" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="preview-body">
          {url && (
            <img src={url} alt={record.fileName} style={{ transform: `scale(${scale})` }} />
          )}
        </div>
      </div>
    </div>
  );
}

/** 缩放步进取整，避免浮点累积误差 */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
