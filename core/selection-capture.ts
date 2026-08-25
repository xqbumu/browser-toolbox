/**
 * 选区截图：先截可见区域，再按 rect（CSS px）换算物理像素裁剪。
 * rect 坐标相对视口，来自 content 端 overlay 的拖拽结果。
 */
import type { BrowserAdapter } from '@/adapters/browser-adapter';
import type { CaptureConfig } from '@/types/config';
import type { Rect, PageMetrics } from '@/types/capture';
import { loadBitmap, canvasToDataUrl } from './stitch';

export class SelectionCapture {
  constructor(private readonly adapter: BrowserAdapter) {}

  /** 按 rect 裁剪可见区域截图，返回 dataURL */
  async capture(tabId: number, rect: Rect, config: CaptureConfig): Promise<string> {
    const metrics = await this.getMetrics(tabId);
    const dpr = metrics.devicePixelRatio || 1;

    const dataUrl = await this.adapter.captureTab(tabId);
    const bmp = await loadBitmap(dataUrl);

    // 源坐标（物理像素）：rect.* × dpr
    const sx = clamp(Math.round(rect.x * dpr), 0, bmp.width - 1);
    const sy = clamp(Math.round(rect.y * dpr), 0, bmp.height - 1);
    const sw = clamp(Math.round(rect.width * dpr), 1, bmp.width - sx);
    const sh = clamp(Math.round(rect.height * dpr), 1, bmp.height - sy);

    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bmp.close();
      throw new Error('无法获取 2D 上下文');
    }
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
    bmp.close();

    return canvasToDataUrl(canvas, config.format, config.quality);
  }

  private async getMetrics(tabId: number): Promise<PageMetrics> {
    const res = await this.adapter.sendToContent<PageMetrics>(tabId, {
      type: 'GET_PAGE_METRICS',
      payload: {},
    });
    if (!res.ok) throw new Error(`获取页面度量失败: ${res.error}`);
    return res.data;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
