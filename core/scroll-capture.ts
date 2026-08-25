/**
 * 整页滚动截图流程编排（核心链路）：
 * 1. 采集页面度量；单屏直接走可见截图；
 * 2. 回顶 → 扫描 fixed/sticky → 隐藏 → 触发懒加载 → 等待稳定；
 * 3. 逐片精确滚动截图（位移对齐，scrollY 取实测值；内部容器滚动时逐片裁剪到容器可见区）；
 * 4. 恢复 fixed → 回顶截 chromeFrame；
 * 5. 内部容器走「视口铬」合成（Header/左导航等容器外固定带 + 容器内容分片）；
 *    window 级走原 Canvas 位移拼接；最后贴回 fixed/sticky 一次（视口坐标 = 长图坐标）。
 *
 * P0：run() 接受 ScrollRunOptions，按 preparing→waiting→scrolling(current/total)→stitching
 * 依次发射 stage 进度；逐片开头检查 shouldCancel（抛 CaptureCancelledError）；读超时生成 warning。
 */
import type { BrowserAdapter } from "@/adapters/browser-adapter";
import type { CaptureConfig } from "@/types/config";
import type {
  PageMetrics,
  Slice,
  FixedElementInfo,
  OutputFormat,
} from "@/types/capture";
import type { ProgressEvent } from "@/types/messages";
import { Stitcher, loadBitmap, canvasToDataUrl } from "./stitch";
import { CaptureCancelledError } from "./cancel";
import { sleep } from "@/utils/helpers";
import { createLogger } from "@/utils/logger";

const log = createLogger("scroll-capture");

/** 滚动步长（CSS px，整数）：max(1, floor(vh * (1 - overlapRatio))) */
export function scrollStep(
  viewportHeight: number,
  overlapRatio: number,
): number {
  return Math.max(1, Math.floor(viewportHeight * (1 - overlapRatio)));
}

/** 生成滚动位置序列：从 0 到 total-vh，末片对齐到底部，去重相邻相等 */
export function buildPositions(
  viewportHeight: number,
  totalHeight: number,
  step: number,
): number[] {
  if (totalHeight <= viewportHeight) return [0];
  const positions: number[] = [];
  const maxY = totalHeight - viewportHeight;
  let y = 0;
  while (y < maxY) {
    positions.push(y);
    y += step;
  }
  positions.push(maxY);
  // 去重相邻相等（末片可能与前一步重合）
  const deduped: number[] = [];
  for (const p of positions) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== p) {
      deduped.push(p);
    }
  }
  return deduped;
}

/**
 * 判断是否需要将整窗截图裁剪到滚动容器可见区（双轴）。
 * window 级滚动（offset 全 0 且 client=viewport）返回 false，走原逻辑零回归。
 */
export function shouldCropSlice(metrics: PageMetrics): boolean {
  const scrollVw = metrics.scrollViewportWidth ?? metrics.viewportWidth;
  const scrollVh = metrics.scrollViewportHeight ?? metrics.viewportHeight;
  return (
    (metrics.scrollOffsetX ?? 0) !== 0 ||
    (metrics.scrollOffsetY ?? 0) !== 0 ||
    scrollVw !== metrics.viewportWidth ||
    scrollVh !== metrics.viewportHeight
  );
}

/**
 * 将整窗截图双轴裁剪到滚动容器可见区（内部容器滚动时）。
 * captureTab 截到的是整个 window（innerWidth × innerHeight），而内部滚动容器只占其中一块
 * 矩形区 [scrollOffsetX, scrollOffsetX + scrollViewportWidth] ×
 *       [scrollOffsetY, scrollOffsetY + scrollViewportHeight]，需裁剪后再参与拼接。
 * window 级滚动（offset 全 0 且 client=viewport）不调用本函数。
 */
async function cropSlice(
  dataUrl: string,
  metrics: PageMetrics,
  format: OutputFormat,
  quality: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const dpr = metrics.devicePixelRatio || 1;
  const scrollVw = metrics.scrollViewportWidth ?? metrics.viewportWidth;
  const scrollVh = metrics.scrollViewportHeight ?? metrics.viewportHeight;
  const srcX = Math.max(0, Math.round((metrics.scrollOffsetX ?? 0) * dpr));
  const srcY = Math.max(0, Math.round((metrics.scrollOffsetY ?? 0) * dpr));
  const w = Math.round(scrollVw * dpr);
  const h = Math.round(scrollVh * dpr);

  const bitmap = await loadBitmap(dataUrl);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("无法获取 2D 上下文");
  }
  ctx.drawImage(bitmap, srcX, srcY, w, h, 0, 0, w, h);
  bitmap.close();

  const out = await canvasToDataUrl(canvas, format, quality);
  return { dataUrl: out, width: w, height: h };
}

/** 整页滚动截图的最终产出（A1/A4：dataUrl + 可选超时 warning） */
export interface FullpageCaptureOutcome {
  dataUrl: string;
  warning?: string;
}

/** run() 运行选项：进度回调 + 取消检查（A1/A5） */
export interface ScrollRunOptions {
  onProgress?: (event: ProgressEvent) => void;
  shouldCancel?: () => boolean;
}

export class ScrollCaptureEngine {
  constructor(private readonly adapter: BrowserAdapter) {}

  /** 执行整页滚动截图，返回最终长图 dataURL（可携带超时 warning） */
  async run(
    tabId: number,
    config: CaptureConfig,
    opts: ScrollRunOptions = {},
  ): Promise<FullpageCaptureOutcome> {
    opts.onProgress?.({
      kind: "stage",
      phase: "preparing",
      label: "正在准备截图…",
    });

    const metrics = await this.getMetrics(tabId);
    log.debug("页面度量", metrics);

    // 单屏页面直接截可见区（内部容器滚动时按容器可见高判断，而非整窗高）
    const scrollVh = metrics.scrollViewportHeight ?? metrics.viewportHeight;
    if (metrics.fullHeight <= scrollVh) {
      return { dataUrl: await this.adapter.captureTab(tabId) };
    }

    // 回顶，确保 fixed/sticky 在 scrollY=0 记录初始 rect，且分片从顶部开始
    await this.scrollTo(tabId, 0);

    let fixedList: FixedElementInfo[] = [];
    if (config.handleFixed) {
      const res = await this.adapter.sendToContent<FixedElementInfo[]>(tabId, {
        type: "SCAN_FIXED",
        payload: {},
      });
      if (res.ok) {
        fixedList = res.data;
        log.debug(`扫描到 ${fixedList.length} 个 fixed/sticky 元素`);
      }
      await this.adapter.sendToContent(tabId, {
        type: "HIDE_FIXED",
        payload: {},
      });
    }

    if (config.triggerLazyLoad) {
      await this.adapter.sendToContent(tabId, {
        type: "TRIGGER_LAZY_LOAD",
        payload: {},
      });
    }

    opts.onProgress?.({
      kind: "stage",
      phase: "waiting",
      label: "等待页面渲染稳定…",
    });
    const stableRes = await this.adapter.sendToContent<{
      stable: boolean;
      timedOut: boolean;
      elapsedMs: number;
    }>(tabId, {
      type: "WAIT_STABLE",
      payload: {
        networkIdleMs: config.networkIdleMs,
        stableWaitMs: config.stableWaitMs,
        maxWaitMs: config.maxWaitMs,
      },
    });

    // A4：超时仅影响 warning 提示，不改变出图结果（超时仍按已加载内容出图）
    let warning: string | undefined;
    if (stableRes.ok && stableRes.data.timedOut) {
      warning = "页面等待超时，内容可能未加载完整";
    }

    // 逐片滚动截图（内部容器滚动时逐片裁剪到容器可见区）
    const slices = await this.captureSlices(tabId, metrics, config, opts);

    // 恢复 fixed（chromeFrame 需在 RESTORE_FIXED 之后截取，确保 Header/固定带可见）
    if (config.handleFixed) {
      await this.adapter.sendToContent(tabId, {
        type: "RESTORE_FIXED",
        payload: {},
      });
    }

    // 回顶，确保 chromeFrame 与首屏（scrollTop=0）一致
    await this.scrollTo(tabId, 0);

    opts.onProgress?.({
      kind: "stage",
      phase: "stitching",
      label: "正在拼接合成…",
    });
    const stitcher = new Stitcher();
    const isInternal = shouldCropSlice(metrics);
    let dataUrl: string;

    if (isInternal) {
      // 内部容器滚动：截回顶静止帧（含 Header/左导航等容器外 chrome），做「视口铬」合成
      await sleep(config.stableWaitMs);
      const chromeFrame = await this.adapter.captureTab(tabId);
      dataUrl = await stitcher.stitchInternal(
        slices,
        chromeFrame,
        metrics,
        config.format,
        config.quality,
      );
      log.debug("内部容器 chrome 合成完成，长图长度", slices.length);
      if (config.handleFixed && fixedList.length > 0) {
        dataUrl = await stitcher.pasteFixed(
          dataUrl,
          chromeFrame,
          fixedList,
          metrics,
          config.format,
          config.quality,
        );
      }
    } else {
      // window 级滚动：走原拼接逻辑（零回归）
      dataUrl = await stitcher.stitch(
        slices,
        metrics,
        config.format,
        config.quality,
      );
      log.debug("拼接完成，长图长度", slices.length);
      if (config.handleFixed && fixedList.length > 0) {
        await sleep(config.stableWaitMs);
        const topFrame = await this.adapter.captureTab(tabId);
        dataUrl = await stitcher.pasteFixed(
          dataUrl,
          topFrame,
          fixedList,
          metrics,
          config.format,
          config.quality,
        );
      }
    }

    return { dataUrl, warning };
  }

  private async getMetrics(tabId: number): Promise<PageMetrics> {
    const res = await this.adapter.sendToContent<PageMetrics>(tabId, {
      type: "GET_PAGE_METRICS",
      payload: {},
    });
    if (!res.ok) throw new Error(`获取页面度量失败: ${res.error}`);
    return res.data;
  }

  private async scrollTo(tabId: number, y: number): Promise<number> {
    const res = await this.adapter.sendToContent<{ y: number }>(tabId, {
      type: "SCROLL_TO",
      payload: { y },
    });
    return res.ok ? res.data.y : y;
  }

  /** 逐片滚动截图 */
  private async captureSlices(
    tabId: number,
    metrics: PageMetrics,
    config: CaptureConfig,
    opts: ScrollRunOptions,
  ): Promise<Slice[]> {
    const scrollVh = metrics.scrollViewportHeight ?? metrics.viewportHeight;
    const step = scrollStep(scrollVh, config.overlapRatio);
    const positions = buildPositions(scrollVh, metrics.fullHeight, step);
    const dpr = metrics.devicePixelRatio || 1;
    const physW = Math.round(metrics.viewportWidth * dpr);
    const physH = Math.round(metrics.viewportHeight * dpr);
    // 内部容器滚动且容器可见区（偏移或尺寸）!= 整窗时，需将整窗截图双轴裁剪到容器可见区
    const needCrop = shouldCropSlice(metrics);

    const slices: Slice[] = [];
    for (let i = 0; i < positions.length; i += 1) {
      // A5：逐片开头检查取消，取消时抛出专用错误交由上层捕获
      if (opts.shouldCancel?.()) throw new CaptureCancelledError();

      const y = positions[i]!;
      const actualY = await this.scrollTo(tabId, y);
      // 每片滚动后等待渲染稳定（触发该区域懒加载）
      await sleep(config.stableWaitMs);

      let dataUrl = await this.adapter.captureTab(tabId);
      let width = physW;
      let height = physH;
      if (needCrop) {
        const cropped = await cropSlice(
          dataUrl,
          metrics,
          config.format,
          config.quality,
        );
        dataUrl = cropped.dataUrl;
        width = cropped.width;
        height = cropped.height;
      }
      slices.push({
        index: i,
        scrollY: actualY,
        dataUrl,
        width,
        height,
      });

      // A1：逐片发射滚动进度（current/total 百分比）
      opts.onProgress?.({
        kind: "stage",
        phase: "scrolling",
        label: "正在滚动截图",
        current: i + 1,
        total: positions.length,
      });
      log.debug(`分片 ${i}/${positions.length - 1} captured at y=${actualY}`);
    }
    return slices;
  }
}
