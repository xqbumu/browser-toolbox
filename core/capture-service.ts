/**
 * 截图统一入口（CaptureService）：
 * 按 CaptureMode 分发到 VisibleCapture / ScrollCaptureEngine / SelectionCapture，
 * 生成结果命名；批量任务委托 BatchTabsRunner / BatchUrlsRunner 并转发进度事件。
 * 所有异常统一转为 CaptureResult { ok:false, error }，不向 popup 抛未捕获异常。
 *
 * P0：captureFullpage/batchTabs/batchUrls/captureByMode 接受 CaptureJobContext，
 * 单张整页在 reportStage 下转发 stage、透传 warning、捕获取消并返回 { cancelled:true }。
 */
import type { BrowserAdapter } from '@/adapters/browser-adapter';
import { createAdapter } from '@/adapters/browser-adapter';
import type { CaptureConfig } from '@/types/config';
import type { CaptureMode, CaptureResult, BatchResult, Rect } from '@/types/capture';
import type { ProgressEvent, CaptureJobContext } from '@/types/messages';
import { VisibleCapture } from './visible-capture';
import { ScrollCaptureEngine } from './scroll-capture';
import { SelectionCapture } from './selection-capture';
import { BatchTabsRunner } from './batch-tabs';
import { BatchUrlsRunner } from './batch-urls';
import { isCaptureCancelled } from './cancel';
import { buildFileName } from '@/utils/naming';
import { toErrorMessage } from '@/utils/helpers';
import { createLogger } from '@/utils/logger';

const log = createLogger('capture-service');

export type ProgressListener = (event: ProgressEvent) => void;

export class CaptureService {
  private readonly adapter: BrowserAdapter;
  private readonly progressListeners = new Set<ProgressListener>();

  constructor(adapter?: BrowserAdapter) {
    this.adapter = adapter ?? createAdapter();
  }

  /** 注册进度监听（background 转发给 popup） */
  onProgress(listener: ProgressListener): void {
    this.progressListeners.add(listener);
  }

  private emit(event: ProgressEvent): void {
    for (const listener of this.progressListeners) listener(event);
  }

  /** 可见区域截图 */
  async captureVisible(tabId: number, config: CaptureConfig): Promise<CaptureResult> {
    try {
      const tab = await this.adapter.getTab(tabId);
      const dataUrl = await new VisibleCapture(this.adapter).capture(tabId, tab.windowId);
      const fileName = buildFileName(tab.url ?? 'page', tab.title, config.format);
      return {
        ok: true,
        mode: 'visible',
        fileName,
        dataUrl,
        format: config.format,
        tabId,
        url: tab.url,
        title: tab.title,
      };
    } catch (e) {
      log.error('可见区域截图失败', e);
      return { ok: false, mode: 'visible', tabId, error: toErrorMessage(e) };
    }
  }

  /** 整页滚动截图（P0：接 CaptureJobContext，reportStage 下转发 stage、透传 warning、捕获取消） */
  async captureFullpage(
    tabId: number,
    config: CaptureConfig,
    ctx?: CaptureJobContext,
  ): Promise<CaptureResult> {
    try {
      const tab = await this.adapter.getTab(tabId);
      const outcome = await new ScrollCaptureEngine(this.adapter).run(tabId, config, {
        onProgress: ctx?.reportStage ? (e) => this.emit(e) : undefined,
        shouldCancel: ctx?.shouldCancel,
      });
      const fileName = buildFileName(tab.url ?? 'page', tab.title, config.format);
      return {
        ok: true,
        mode: 'fullpage',
        fileName,
        dataUrl: outcome.dataUrl,
        format: config.format,
        tabId,
        url: tab.url,
        title: tab.title,
        warning: outcome.warning,
      };
    } catch (e) {
      if (isCaptureCancelled(e)) {
        log.info('整页截图已取消', tabId);
        return { ok: false, mode: 'fullpage', tabId, error: '已取消截图', cancelled: true };
      }
      log.error('整页截图失败', e);
      return { ok: false, mode: 'fullpage', tabId, error: toErrorMessage(e) };
    }
  }

  /** 选定区域截图 */
  async captureArea(tabId: number, rect: Rect, config: CaptureConfig): Promise<CaptureResult> {
    try {
      const tab = await this.adapter.getTab(tabId);
      const dataUrl = await new SelectionCapture(this.adapter).capture(tabId, rect, config);
      const fileName = buildFileName(tab.url ?? 'page', tab.title, config.format);
      return {
        ok: true,
        mode: 'area',
        fileName,
        dataUrl,
        format: config.format,
        tabId,
        url: tab.url,
        title: tab.title,
      };
    } catch (e) {
      log.error('选区截图失败', e);
      return { ok: false, mode: 'area', tabId, error: toErrorMessage(e) };
    }
  }

  /** 进入选区模式，等待用户拖拽框选，返回选区 rect（CSS px） */
  async selectArea(tabId: number): Promise<Rect> {
    const res = await this.adapter.sendToContent<Rect>(tabId, {
      type: 'START_SELECTION',
      payload: {},
    });
    if (!res.ok) throw new Error(res.error);
    return res.data;
  }

  /** 按选项卡批量截图（P0：透传 batchId/shouldCancel） */
  async batchTabs(windowId: number, config: CaptureConfig, ctx?: CaptureJobContext): Promise<BatchResult> {
    return new BatchTabsRunner(this.adapter, (tabId, mode, cfg) =>
      this.captureByMode(tabId, mode, cfg, ctx),
    ).run(windowId, config, (e) => this.emit(e), ctx);
  }

  /** 按 URL 列表批量截图（P0：透传 batchId/shouldCancel） */
  async batchUrls(urls: string[], config: CaptureConfig, ctx?: CaptureJobContext): Promise<BatchResult> {
    return new BatchUrlsRunner(this.adapter, (tabId, mode, cfg) =>
      this.captureByMode(tabId, mode, cfg, ctx),
    ).run(urls, config, (e) => this.emit(e), ctx);
  }

  /** 供批量 runner 复用单页截图逻辑（按模式分发；批量内不开启 reportStage，避免嵌套进度污染） */
  captureByMode(
    tabId: number,
    mode: CaptureMode,
    config: CaptureConfig,
    ctx?: CaptureJobContext,
  ): Promise<CaptureResult> {
    switch (mode) {
      case 'fullpage':
        // 批量场景强制关闭单张 stage 进度，仅透传取消检查与批量 id
        return this.captureFullpage(
          tabId,
          config,
          ctx ? { shouldCancel: ctx.shouldCancel, reportStage: false, batchId: ctx.batchId } : undefined,
        );
      case 'area':
        // 批量场景选区无交互意义，降级为可见区域
        return this.captureVisible(tabId, config);
      case 'visible':
      default:
        return this.captureVisible(tabId, config);
    }
  }
}
