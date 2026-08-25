/**
 * Firefox 适配实现：基于 browser.tabs.captureTab。
 * Firefox 独有 API，可截后台 tab；返回 dataURL 可能不含 `data:` 前缀，需补齐。
 */
import type { BrowserAdapter, Capabilities, TabInfo } from './browser-adapter';
import type { ContentRequest, ContentResponse } from '@/types/messages';
import { fetchTabInfo, toErrorMessage } from '@/utils/helpers';

const capabilities: Capabilities = {
  name: 'firefox',
  canCaptureVisible: true,
  canScrollCapture: true,
  canAreaSelection: true,
  canBatchTabs: true,
  canBatchUrls: true,
  captureNeedsActiveTab: false,
};

/** Firefox 扩展 API：captureTab 不在 webextension-polyfill 的标准类型中 */
interface FirefoxTabsExt {
  captureTab(tabId: number, options?: { format?: string }): Promise<string>;
}

export class FirefoxAdapter implements BrowserAdapter {
  readonly name = 'firefox' as const;
  readonly capabilities = capabilities;

  async captureTab(tabId: number, _windowId?: number): Promise<string> {
    const tabs = browser.tabs as unknown as FirefoxTabsExt;
    const dataUrl = await tabs.captureTab(tabId, { format: 'png' });
    // Firefox 可能返回裸 base64，补齐前缀
    return dataUrl.startsWith('data:') ? dataUrl : `data:image/png;base64,${dataUrl}`;
  }

  async activateTab(tabId: number): Promise<void> {
    await browser.tabs.update(tabId, { active: true });
  }

  async createTab(url: string): Promise<number> {
    // Firefox 可截后台 tab，但仍激活以确保页面真实渲染（懒加载/脚本）
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
