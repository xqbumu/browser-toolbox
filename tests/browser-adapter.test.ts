/**
 * adapters/browser-adapter.ts 单测：
 * 1. createAdapter() 工厂：通过 vi.stubEnv 模拟 WXT 注入的 import.meta.env.BROWSER，验证三种返回；
 * 2. 接口契约：三 adapter 类均实现 BrowserAdapter 全部方法签名；
 * 3. capabilities：三浏览器能力探测正确（含 Safari 降级）。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createAdapter } from '@/adapters/browser-adapter';
import { ChromeAdapter } from '@/adapters/chrome-adapter';
import { FirefoxAdapter } from '@/adapters/firefox-adapter';
import { SafariAdapter } from '@/adapters/safari-adapter';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createAdapter 工厂', () => {
  it('BROWSER=chrome（默认分支）返回 ChromeAdapter', () => {
    vi.stubEnv('BROWSER', 'chrome');
    const adapter = createAdapter();
    expect(adapter).toBeInstanceOf(ChromeAdapter);
    expect(adapter.name).toBe('chrome');
  });

  it('BROWSER=firefox 返回 FirefoxAdapter', () => {
    vi.stubEnv('BROWSER', 'firefox');
    const adapter = createAdapter();
    expect(adapter).toBeInstanceOf(FirefoxAdapter);
    expect(adapter.name).toBe('firefox');
  });

  it('BROWSER=safari 返回 SafariAdapter', () => {
    vi.stubEnv('BROWSER', 'safari');
    const adapter = createAdapter();
    expect(adapter).toBeInstanceOf(SafariAdapter);
    expect(adapter.name).toBe('safari');
  });

  it('BROWSER 未定义（非 WXT 环境）回退 ChromeAdapter', () => {
    vi.stubEnv('BROWSER', undefined);
    const adapter = createAdapter();
    expect(adapter).toBeInstanceOf(ChromeAdapter);
  });
});

describe('接口契约（三 adapter 实现 BrowserAdapter）', () => {
  const methodNames = [
    'captureTab',
    'activateTab',
    'createTab',
    'closeTab',
    'queryTabs',
    'getTab',
    'sendToContent',
  ] as const;

  it.each([
    ['ChromeAdapter', () => new ChromeAdapter()],
    ['FirefoxAdapter', () => new FirefoxAdapter()],
    ['SafariAdapter', () => new SafariAdapter()],
  ])('%s 实现全部方法签名', (_label, factory) => {
    const adapter = factory();
    for (const m of methodNames) {
      expect(typeof adapter[m], `${m} 应为函数`).toBe('function');
    }
    expect(adapter.name).toBeTruthy();
    expect(adapter.capabilities).toBeTruthy();
  });
});

describe('capabilities 能力探测', () => {
  it('Chrome 全能力，且必须激活 tab 才能截取', () => {
    const c = new ChromeAdapter().capabilities;
    expect(c).toEqual({
      name: 'chrome',
      canCaptureVisible: true,
      canScrollCapture: true,
      canAreaSelection: true,
      canBatchTabs: true,
      canBatchUrls: true,
      captureNeedsActiveTab: true,
    });
  });

  it('Firefox 全能力，且可截后台 tab', () => {
    const c = new FirefoxAdapter().capabilities;
    expect(c.name).toBe('firefox');
    expect(c.canScrollCapture).toBe(true);
    expect(c.captureNeedsActiveTab).toBe(false);
  });

  it('Safari 降级：仅可见区域 + 按选项卡批量', () => {
    const c = new SafariAdapter().capabilities;
    expect(c).toEqual({
      name: 'safari',
      canCaptureVisible: true,
      canScrollCapture: false,
      canAreaSelection: false,
      canBatchTabs: true,
      canBatchUrls: false,
      captureNeedsActiveTab: true,
    });
  });
});
