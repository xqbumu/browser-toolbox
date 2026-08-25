/**
 * 可见区域截图：直接调用适配层原生截图 API，输出当前视口 PNG。
 * 尺寸与可视区一致（DPR 由原生 API 天然决定）。
 */
import type { BrowserAdapter } from '@/adapters/browser-adapter';

export class VisibleCapture {
  constructor(private readonly adapter: BrowserAdapter) {}

  /** 截取指定 tab 的可见区域，返回 PNG dataURL */
  async capture(tabId: number, windowId?: number): Promise<string> {
    return this.adapter.captureTab(tabId, windowId);
  }
}
