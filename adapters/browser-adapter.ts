/**
 * 浏览器截图 API 适配层接口 + 工厂函数（Adapter 模式）。
 * 一切跨浏览器差异收敛到 adapters/ 与 utils/capabilities.ts，
 * 业务代码（core/）只依赖 BrowserAdapter 接口与 Capabilities 字段。
 */
import type { ContentRequest, ContentResponse } from '@/types/messages';
import { ChromeAdapter } from './chrome-adapter';
import { FirefoxAdapter } from './firefox-adapter';
import { SafariAdapter } from './safari-adapter';

export interface TabInfo {
  id: number;
  windowId: number;
  url?: string;
  title?: string;
  active: boolean;
}

export interface Capabilities {
  name: 'chrome' | 'firefox' | 'safari';
  canCaptureVisible: boolean;
  /** 是否支持整页滚动拼接 */
  canScrollCapture: boolean;
  canAreaSelection: boolean;
  canBatchTabs: boolean;
  canBatchUrls: boolean;
  /** Chrome true（必须激活 tab 才能截）/ Firefox false */
  captureNeedsActiveTab: boolean;
}

export interface BrowserAdapter {
  readonly name: 'chrome' | 'firefox' | 'safari';
  readonly capabilities: Capabilities;
  /** 截取指定 tab 的可见区域，返回 PNG dataURL */
  captureTab(tabId: number, windowId?: number): Promise<string>;
  activateTab(tabId: number): Promise<void>;
  createTab(url: string): Promise<number>;
  closeTab(tabId: number): Promise<void>;
  queryTabs(windowId?: number): Promise<TabInfo[]>;
  /** 读取单个 tab 信息（通用读操作，纳入 adapter 保证 core 不直接触碰 tabs API） */
  getTab(tabId: number): Promise<TabInfo>;
  /** 向 tab 发送 content 消息并等待响应 */
  sendToContent<T>(tabId: number, msg: ContentRequest): Promise<ContentResponse<T>>;
}

/** 工厂：依据 WXT 注入的构建目标 BROWSER 返回对应实现 */
export function createAdapter(): BrowserAdapter {
  const name: string = import.meta.env.BROWSER;
  switch (name) {
    case 'firefox':
      return new FirefoxAdapter();
    case 'safari':
      return new SafariAdapter();
    default:
      return new ChromeAdapter();
  }
}
