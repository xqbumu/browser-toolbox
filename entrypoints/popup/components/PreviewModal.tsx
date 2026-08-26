/**
 * 预览弹层：展示原图（等比缩放），支持放大/缩小/复位、在新标签页打开、Esc/遮罩关闭。
 *
 * C1：增加滚轮缩放、按住拖拽平移、双击复位，工具栏加「📋 复制图片」「💾 另存为」。
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from 'tdesign-react';
import {
  AddCircleIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  BrowseIcon,
  MinusCircleIcon,
  RefreshIcon,
} from 'tdesign-icons-react';
import type { ScreenshotRecord } from '@/types/history';
import type { ToastKind } from '@/types/messages';
import { copyImageToClipboard } from '@/utils/clipboard';

interface Props {
  record: ScreenshotRecord;
  onClose: () => void;
  /** 可选：操作结果 toast 回调（由 App 注入） */
  onToast?: (kind: ToastKind, text: string) => void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const STEP = 0.25;
/** 另存为 objectURL 延迟 revoke 的毫秒数 */
const OBJECT_URL_TTL_MS = 60_000;

/** 拖拽起点信息（用于按住平移） */
interface DragState {
  startX: number;
  startY: number;
  panX: number;
  panY: number;
}

export function PreviewModal({ record, onClose, onToast }: Props) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

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

  // 滚轮缩放：用原生非 passive 监听，避免 React 合成 wheel 无法 preventDefault 导致容器滚动
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setScale((s) => clampScale(s * factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function openInNewTab(): void {
    // 为「在新标签页打开」单独创建 objectURL，避免关闭弹层 revoke 原 URL 的竞态
    const tabUrl = URL.createObjectURL(record.imageBlob);
    void browser.tabs.create({ url: tabUrl });
  }

  /** 复制图片到剪贴板（能力探测 + 降级提示，C1） */
  async function copyImage(): Promise<void> {
    const res = await copyImageToClipboard(record.imageBlob);
    if (res.ok) onToast?.('ok', '已复制到剪贴板');
    else if (res.reason === 'unsupported') onToast?.('warn', '当前浏览器不支持复制图片，请改用「另存为」');
    else onToast?.('err', '复制失败，请重试');
  }

  /** 另存为：以 saveAs 弹窗让用户选择保存位置（C1） */
  async function saveAs(): Promise<void> {
    try {
      const objectUrl = URL.createObjectURL(record.imageBlob);
      try {
        await browser.downloads.download({
          url: objectUrl,
          filename: record.fileName,
          saveAs: true,
        });
        onToast?.('ok', '已另存为');
      } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_TTL_MS);
      }
    } catch (e) {
      onToast?.('err', '另存为失败，请重试');
    }
  }

  // —— 按住拖拽平移 ——
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return; // 仅左键
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.panX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.panY + (e.clientY - dragRef.current.startY),
    });
  }
  function endDrag(): void {
    dragRef.current = null;
    setDragging(false);
  }

  /** 双击复位：缩放与平移归位（C1） */
  function resetView(): void {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="preview-toolbar">
          <Button size="small" variant="text" icon={<AddCircleIcon />} onClick={() => setScale((v) => clampScale(v + STEP))} />
          <Button size="small" variant="text" icon={<MinusCircleIcon />} onClick={() => setScale((v) => clampScale(v - STEP))} />
          <Button size="small" variant="text" icon={<RefreshIcon />} title="复位" onClick={resetView} />
          <Button size="small" variant="text" icon={<CopyIcon />} title="复制图片" onClick={() => void copyImage()} />
          <Button size="small" variant="text" icon={<DownloadIcon />} title="另存为" onClick={() => void saveAs()} />
          <Button size="small" variant="text" icon={<BrowseIcon />} title="在新标签页打开" onClick={openInNewTab} />
          <Button size="small" variant="text" theme="danger" icon={<CloseIcon />} onClick={onClose} />
        </div>
        <div
          ref={bodyRef}
          className={`preview-body${dragging ? ' dragging' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={resetView}
        >
          {url && (
            <img
              src={url}
              alt={record.fileName}
              draggable={false}
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** 缩放收敛到 [MIN_SCALE, MAX_SCALE] 并保留两位小数，避免浮点累积误差 */
function clampScale(n: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, round(n)));
}

/** 保留两位小数 */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
