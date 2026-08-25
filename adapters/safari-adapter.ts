/**
 * Safari 适配实现（P1 降级）：仅支持可见区域截图。
 * canScrollCapture / canAreaSelection / canBatchUrls 均为 false，
 * 整页/选区/按 URL 批量入口由 Popup 依据 capabilities 置灰并提示。
 */
import type { BrowserAdapter, Capabilities, TabInfo } from './browser-adapter';
import type { ContentRequest, ContentResponse } from '@/types/messages';
import { fetchTabInfo, toErrorMessage } from '@/utils/helpers';

const capabilities: Capabilities = {
  name: 'safari',
  canCaptureVisible: true,
  canScrollCapture: false,
  canAreaSelection: false,
  canBatchTabs: true, // 降级为逐个可见截图
  canBatchUrls: false,
  captureNeedsActiveTab: true,
};

export class SafariAdapter implements BrowserAdapter {
  readonly name = 'safari' as const;
  readonly capabilities = capabilities;

  async captureTab(tabId: number, windowId?: number): Promise<string> {
    let winId = windowId;
    if (winId == null) {
      const tab = await fetchTabInfo(tabId);
      winId = tab.windowId;
    }
    // Safari 支持 captureVisibleTab；若真机不可用，调用方（CaptureService）会捕获异常并降级提示
    const dataUrl = await browser.tabs.captureVisibleTab(winId, { format: 'png' });
    return dataUrl;
  }

  async activateTab(tabId: number): Promise<void> {
    await browser.tabs.update(tabId, { active: true });
  }

  async createTab(url: string): Promise<number> {
    const tab = await browser.tabs.create({ url, active: true });
    return tab.id ?? -1;
  }

  async closeTab(tabId: number): Promise<void> {
    await browser.tabs.remove(tabId);
  }

  async queryTabs(windowId?: number): Promise<TabInfo[]> {
    const tabs = await browser.tabs.query(windowId != null ? { windowId } : {});
    return tabs.map((t) => ({
      id: t.id ?? -1,
      windowId: t.windowId ?? -1,
      url: t.url,
      title: t.title,
      active: t.active ?? false,
    }));
  }

  async getTab(tabId: number): Promise<TabInfo> {
    return fetchTabInfo(tabId);
  }

  async sendToContent<T>(tabId: number, msg: ContentRequest): Promise<ContentResponse<T>> {
    try {
      const res = (await browser.tabs.sendMessage(tabId, msg)) as ContentResponse<T>;
      return res;
    } catch (e) {
      return { ok: false, error: toErrorMessage(e) };
    }
  }
}
