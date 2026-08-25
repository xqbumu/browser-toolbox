/**
 * Chrome 适配实现：基于 chrome.tabs.captureVisibleTab。
 * 只能截取窗口内激活 tab 的可见区，故 captureTab 需 windowId（未提供时从 tab 推导），
 * 批量场景下必须先 activateTab 再截取。
 */
import type { BrowserAdapter, Capabilities, TabInfo } from './browser-adapter';
import type { ContentRequest, ContentResponse } from '@/types/messages';
import { fetchTabInfo, toErrorMessage } from '@/utils/helpers';

const capabilities: Capabilities = {
  name: 'chrome',
  canCaptureVisible: true,
  canScrollCapture: true,
  canAreaSelection: true,
  canBatchTabs: true,
  canBatchUrls: true,
  captureNeedsActiveTab: true,
};

export class ChromeAdapter implements BrowserAdapter {
  readonly name = 'chrome' as const;
  readonly capabilities = capabilities;

  async captureTab(tabId: number, windowId?: number): Promise<string> {
    let winId = windowId;
    if (winId == null) {
      const tab = await fetchTabInfo(tabId);
      winId = tab.windowId;
    }
    // 仅能截激活 tab 的可见区
    const dataUrl = await browser.tabs.captureVisibleTab(winId, { format: 'png' });
    return dataUrl;
  }

  async activateTab(tabId: number): Promise<void> {
    await browser.tabs.update(tabId, { active: true });
  }

  async createTab(url: string): Promise<number> {
    // Chrome 无法截后台 tab，必须激活新 tab
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
