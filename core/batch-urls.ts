/**
 * 按 URL 列表批量截图（BatchUrlsRunner）：
 * 逐个打开 → 等待加载 + 渲染稳定 → 截图 → 关闭；
 * 单个失败跳过并标记，全部结束后对失败项自动重试 1 次。
 *
 * P0：每项/每重试之间检查 ctx.shouldCancel，取消时剩余项填充占位（cancelled:true）、
 * result.cancelled=true，emit cancelled + done；start 携带 batchId；重试 item 带 retrying。
 */
import type { BrowserAdapter } from "@/adapters/browser-adapter";
import type { CaptureConfig } from "@/types/config";
import type { CaptureMode, CaptureResult, BatchResult } from "@/types/capture";
import type { ProgressEvent, CaptureJobContext } from "@/types/messages";
import { sleep } from "@/utils/helpers";
import { summarize } from "./batch-tabs";
import { createLogger } from "@/utils/logger";

const log = createLogger("batch-urls");

export type CaptureOne = (
  tabId: number,
  mode: CaptureMode,
  config: CaptureConfig,
) => Promise<CaptureResult>;

/** 单批 URL 数量上限（防滥用） */
const MAX_URLS = 50;

function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

export class BatchUrlsRunner {
  constructor(
    private readonly adapter: BrowserAdapter,
    private readonly capture: CaptureOne,
  ) {}

  async run(
    urls: string[],
    config: CaptureConfig,
    onProgress?: (event: ProgressEvent) => void,
    ctx?: CaptureJobContext,
  ): Promise<BatchResult> {
    const validUrls = urls
      .map((u) => u.trim())
      .filter(isHttpUrl)
      .slice(0, MAX_URLS);
    const total = validUrls.length;
    log.info(`开始按 URL 批量截图，共 ${total} 个 URL`);

    // A5：start 携带 batchId，供 popup 取消定位
    onProgress?.({ kind: "start", total, batchId: ctx?.batchId });

    const items: CaptureResult[] = [];
    let cancelled = false;

    for (let i = 0; i < validUrls.length; i += 1) {
      // 每项开头检查取消
      if (ctx?.shouldCancel?.()) {
        cancelled = true;
        break;
      }
      const url = validUrls[i];
      if (!url) continue;
      onProgress?.({
        kind: "item",
        index: i + 1,
        total,
        label: url,
        batchId: ctx?.batchId,
      });
      items.push(await this.captureOneUrl(url, config));
    }

    // 失败项自动重试 1 次（重试前再查一次取消）
    if (!cancelled) {
      for (let i = 0; i < items.length; i += 1) {
        const prev = items[i];
        if (!prev || prev.ok || prev.retried) continue;
        if (ctx?.shouldCancel?.()) {
          cancelled = true;
          break;
        }
        const url = validUrls[i];
        if (!url) continue;
        onProgress?.({
          kind: "item",
          index: i + 1,
          total,
          label: `重试: ${url}`,
          retrying: true,
          batchId: ctx?.batchId,
        });
        const retry = await this.captureOneUrl(url, config);
        retry.retried = true;
        items[i] = retry;
      }
    }

    // 取消时用占位项补齐未处理项，保证 total = success + failed 恒等（占位计入 failed）
    if (cancelled) {
      for (let i = items.length; i < validUrls.length; i += 1) {
        items.push({
          ok: false,
          mode: config.mode,
          url: validUrls[i],
          error: "已取消",
          cancelled: true,
        });
      }
    }

    const result = summarize(items);
    result.cancelled = cancelled;
    if (cancelled) {
      onProgress?.({
        kind: "cancelled",
        scope: "batch",
        message: "已取消批量截图",
      });
    }
    onProgress?.({ kind: "done", result });
    return result;
  }

  private async captureOneUrl(
    url: string,
    config: CaptureConfig,
  ): Promise<CaptureResult> {
    let tabId: number | null = null;
    try {
      tabId = await this.adapter.createTab(url);
      await this.waitForLoad(tabId, config);
      return await this.capture(tabId, config.mode, config);
    } catch (e) {
      return {
        ok: false,
        mode: config.mode,
        tabId: tabId ?? undefined,
        url,
        error: e instanceof Error ? e.message : String(e),
      };
    } finally {
      if (tabId != null) {
        try {
          await this.adapter.closeTab(tabId);
        } catch {
          // 关闭失败忽略
        }
      }
    }
  }

  /** 等待 tab 加载完成 + content 端渲染稳定 */
  private async waitForLoad(
    tabId: number,
    config: CaptureConfig,
  ): Promise<void> {
    const deadline = Date.now() + config.maxWaitMs;
    while (Date.now() < deadline) {
      const tab = await this.adapter.getTab(tabId);
      if (!tab.url || tab.url.startsWith("http")) break; // 已开始导航
      await sleep(200);
    }

    // content 端做网络空闲 + 固定延时判定（含页面内异步内容）
    await this.adapter.sendToContent(tabId, {
      type: "WAIT_STABLE",
      payload: {
        networkIdleMs: config.networkIdleMs,
        stableWaitMs: config.stableWaitMs,
        maxWaitMs: config.maxWaitMs,
      },
    });
  }
}
