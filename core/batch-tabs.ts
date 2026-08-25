/**
 * 按选项卡批量截图（BatchTabsRunner）：
 * 遍历窗口选项卡 → activate 切页 → 等待 → 截图 → 汇总；
 * 单个失败跳过并标记，全部结束后对失败项自动重试 1 次。
 *
 * P0：每项/每重试之间检查 ctx.shouldCancel，取消时剩余项填充占位（cancelled:true）、
 * result.cancelled=true，emit cancelled + done；start 携带 batchId；重试 item 带 retrying。
 */
import type { BrowserAdapter } from '@/adapters/browser-adapter';
import type { CaptureConfig } from '@/types/config';
import type { CaptureMode, CaptureResult, BatchResult } from '@/types/capture';
import type { ProgressEvent, CaptureJobContext } from '@/types/messages';
import { sleep } from '@/utils/helpers';
import { createLogger } from '@/utils/logger';

const log = createLogger('batch-tabs');

export type CaptureOne = (tabId: number, mode: CaptureMode, config: CaptureConfig) => Promise<CaptureResult>;

/** 仅允许截图 http(s) 页面（chrome:// 等受限页无法注入 content script 与截图） */
function isCapturable(url?: string): boolean {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://');
}

export class BatchTabsRunner {
  constructor(
    private readonly adapter: BrowserAdapter,
    private readonly capture: CaptureOne,
  ) {}

  async run(
    windowId: number,
    config: CaptureConfig,
    onProgress?: (event: ProgressEvent) => void,
    ctx?: CaptureJobContext,
  ): Promise<BatchResult> {
    const allTabs = await this.adapter.queryTabs(windowId);
    const tabs = allTabs.filter((t) => isCapturable(t.url));
    const total = tabs.length;
    // B6：记录被过滤掉的不可截取选项卡数量，供 popup 汇总提示
    const skipped = allTabs.length - tabs.length;
    log.info(`开始按选项卡批量截图，共 ${total} 个可截取选项卡（跳过 ${skipped} 个不可截取）`);

    // A5：start 携带 batchId，供 popup 取消定位
    onProgress?.({ kind: 'start', total, batchId: ctx?.batchId });

    const items: CaptureResult[] = [];
    let cancelled = false;

    for (let i = 0; i < tabs.length; i += 1) {
      // 每项开头检查取消
      if (ctx?.shouldCancel?.()) {
        cancelled = true;
        break;
      }
      const tab = tabs[i];
      const label = tab.title || tab.url || `tab ${i + 1}`;
      onProgress?.({ kind: 'item', index: i + 1, total, label, batchId: ctx?.batchId });
      items.push(await this.captureOneTab(tab.id, config));
    }

    // 失败项自动重试 1 次（重试前再查一次取消）
    if (!cancelled) {
      for (let i = 0; i < items.length; i += 1) {
        if (!items[i].ok && !items[i].retried) {
          if (ctx?.shouldCancel?.()) {
            cancelled = true;
            break;
          }
          const tab = tabs[i];
          const label = `重试: ${tab.title || tab.url || `tab ${i + 1}`}`;
          onProgress?.({ kind: 'item', index: i + 1, total, label, retrying: true, batchId: ctx?.batchId });
          const retry = await this.captureOneTab(tab.id, config);
          retry.retried = true;
          items[i] = retry;
        }
      }
    }

    // 取消时用占位项补齐未处理项，保证 total = success + failed 恒等（占位计入 failed）
    if (cancelled) {
      for (let i = items.length; i < tabs.length; i += 1) {
        const tab = tabs[i];
        items.push({
          ok: false,
          mode: config.mode,
          tabId: tab.id,
          url: tab.url,
          title: tab.title,
          error: '已取消',
          cancelled: true,
        });
      }
    }

    const result = summarize(items);
    result.cancelled = cancelled;
    result.skipped = skipped;
    if (cancelled) {
      onProgress?.({ kind: 'cancelled', scope: 'batch', message: '已取消批量截图' });
    }
    onProgress?.({ kind: 'done', result });
    return result;
  }

  private async captureOneTab(tabId: number, config: CaptureConfig): Promise<CaptureResult> {
    try {
      await this.adapter.activateTab(tabId);
      // 等待切页后渲染稳定
      await sleep(config.stableWaitMs);
      return await this.capture(tabId, config.mode, config);
    } catch (e) {
      return {
        ok: false,
        mode: config.mode,
        tabId,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}

/** 汇总批量结果 */
export function summarize(items: CaptureResult[]): BatchResult {
  const success = items.filter((i) => i.ok).length;
  return { total: items.length, success, failed: items.length - success, items };
}
