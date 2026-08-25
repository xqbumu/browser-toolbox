/**
 * content script 入口（薄壳）：用 defineContentScript 声明匹配与运行时机，
 * 注册来自 background 的消息处理器，转发到 core/content/ 各模块。
 * 响应统一为 { ok: true, data } | { ok: false, error }。
 */
import type { ContentRequest, ContentResponse } from '@/types/messages';
import { getPageMetrics, scrollToY } from '@/core/content/scroll';
import { FixedElementHandler } from '@/core/content/fixed-elements';
import { triggerLazyLoad } from '@/core/content/lazy-load';
import { RenderStabilityWatcher } from '@/core/content/stable-wait';
import { SelectionOverlay } from '@/core/content/overlay';
import { showToast } from '@/core/content/toast';
import { toErrorMessage } from '@/utils/helpers';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  main() {
    const fixedHandler = new FixedElementHandler();
    const stabilityWatcher = new RenderStabilityWatcher();
    let overlay: SelectionOverlay | null = null;

    browser.runtime.onMessage.addListener(
      (message: unknown, _sender, sendResponse: (response?: unknown) => void) => {
        handleMessage(message as ContentRequest, {
          fixedHandler,
          stabilityWatcher,
          getOrCreateOverlay: () => {
            if (!overlay) overlay = new SelectionOverlay();
            return overlay;
          },
        })
          .then((res) => sendResponse(res))
          .catch((err) => sendResponse({ ok: false, error: toErrorMessage(err) }));
        return true; // 异步响应
      },
    );
  },
});

interface Handlers {
  fixedHandler: FixedElementHandler;
  stabilityWatcher: RenderStabilityWatcher;
  getOrCreateOverlay: () => SelectionOverlay;
}

/** 消息分发：转发到 core/content 各模块 */
async function handleMessage(msg: ContentRequest, h: Handlers): Promise<ContentResponse<unknown>> {
  switch (msg.type) {
    case 'SCROLL_TO': {
      const y = await scrollToY(msg.payload.y);
      return { ok: true, data: { y } };
    }
    case 'GET_PAGE_METRICS':
      return { ok: true, data: getPageMetrics() };
    case 'SCAN_FIXED':
      return { ok: true, data: h.fixedHandler.scan() };
    case 'HIDE_FIXED':
      h.fixedHandler.hide();
      return { ok: true, data: null };
    case 'RESTORE_FIXED':
      return { ok: true, data: { restored: h.fixedHandler.restore() } };
    case 'TRIGGER_LAZY_LOAD':
      await triggerLazyLoad();
      return { ok: true, data: null };
    case 'WAIT_STABLE': {
      const res = await h.stabilityWatcher.waitUntilStable(msg.payload);
      return { ok: true, data: res };
    }
    case 'START_SELECTION': {
      const overlay = h.getOrCreateOverlay();
      const rect = await overlay.select();
      return { ok: true, data: rect };
    }
    case 'CANCEL_SELECTION':
      h.getOrCreateOverlay().cancel();
      return { ok: true, data: null };
    case 'SHOW_TOAST':
      // A3：background 完成选区后向页面回显结果
      showToast(msg.payload.kind, msg.payload.text);
      return { ok: true, data: null };
    default:
      return { ok: false, error: `未知消息类型: ${(msg as { type?: string }).type}` };
  }
}
