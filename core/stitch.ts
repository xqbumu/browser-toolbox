/**
 * Canvas 拼接器（核心）：
 * - stitch：按「位移对齐」将分片绘制到整页长图；
 * - alignOverlap：重叠区 SSD 局部微调（可选增强，P0 默认 delta=0 纯位移对齐）；
 * - pasteFixed：从补拍首帧裁剪 fixed/sticky 区域贴回长图一次。
 *
 * 背景运行于 MV3 Service Worker（无 DOM），统一使用 OffscreenCanvas + createImageBitmap，
 * 兼容 Chrome/Firefox/Safari（Safari 走降级，不触发拼接）。
 */
import type { Slice, PageMetrics, FixedElementInfo, OutputFormat } from '@/types/capture';
import { blobToDataUrl } from '@/utils/helpers';
import { createLogger } from '@/utils/logger';

const log = createLogger('stitch');

/** dataURL → ImageBitmap（Service Worker 无 Image 构造器，用 fetch + createImageBitmap） */
export async function loadBitmap(dataUrl: string): Promise<ImageBitmap> {
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error(`图片拉取失败: ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

/** OffscreenCanvas → dataURL（convertToBlob + base64） */
export async function canvasToDataUrl(
  canvas: OffscreenCanvas,
  format: OutputFormat,
  quality: number,
): Promise<string> {
  const opts =
    format === 'jpeg'
      ? { type: 'image/jpeg' as const, quality }
      : { type: 'image/png' as const };
  const blob = await canvas.convertToBlob(opts);
  return blobToDataUrl(blob);
}

/** 内部容器「视口铬」合成布局（CSS px） */
export interface ChromeLayout {
  offsetX: number; // 容器 rect.left（左侧导航带宽）
  offsetY: number; // 容器 rect.top（顶部 Header 带高）
  containerW: number; // 容器 clientWidth
  containerH: number; // 容器 clientHeight
  footerBand: number; // 容器下方视口剩余高（通常 0）
  totalWidth: number; // 长图宽
  totalHeight: number; // 长图高 = offsetY + fullHeight + footerBand
}

/**
 * 计算内部容器长图布局（纯函数，便于单测）。
 * 采用统一视口坐标系：长图 (0,0) = 视口 (0,0)，使 pasteFixed 的视口坐标可直接复用。
 */
export function computeChromeLayout(metrics: PageMetrics): ChromeLayout {
  const vw = metrics.viewportWidth;
  const vh = metrics.viewportHeight;
  const offsetX = metrics.scrollOffsetX ?? 0;
  const offsetY = metrics.scrollOffsetY ?? 0;
  const containerW = metrics.scrollViewportWidth ?? vw;
  const containerH = metrics.scrollViewportHeight ?? vh;
  const footerBand = Math.max(0, vh - offsetY - containerH);
  return {
    offsetX,
    offsetY,
    containerW,
    containerH,
    footerBand,
    totalWidth: Math.max(vw, offsetX + containerW),
    totalHeight: offsetY + metrics.fullHeight + footerBand,
  };
}

export class Stitcher {
  /**
   * 是否启用重叠区 SSD 微调。P0 采用纯位移对齐（delta=0），
   * 保留开关便于后续开启（架构 4.3 的鲁棒性增强项）。
   */
  private readonly useSsdRefine = false;

  /** 拼接分片为整页长图，返回 dataURL */
  async stitch(
    slices: Slice[],
    metrics: PageMetrics,
    format: OutputFormat = 'png',
    quality = 0.92,
  ): Promise<string> {
    if (slices.length === 0) throw new Error('无分片可拼接');

    const dpr = metrics.devicePixelRatio || 1;
    const fullW = Math.max(1, Math.round(metrics.fullWidth * dpr));
    const fullH = Math.max(1, Math.round(metrics.fullHeight * dpr));

    const canvas = new OffscreenCanvas(fullW, fullH);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 2D 上下文');

    // 白色底：避免透明 body 页面出现黑底
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, fullW, fullH);

    const overlapCss = this.computeOverlapCss(slices, metrics);
    const overlapPx = Math.round(overlapCss * dpr);

    let prev: ImageBitmap | null = null;

    for (const slice of slices) {
      const img = await loadBitmap(slice.dataUrl);
      const yBase = Math.round(slice.scrollY * dpr);

      let delta = 0;
      if (prev != null && this.useSsdRefine && overlapPx > 0) {
        // 重叠区局部微调：仅在重叠带内搜索最佳竖直偏移，校正亚像素/舍入误差
        delta = await this.alignOverlap(ctx, img, yBase, overlapPx);
      }

      ctx.drawImage(img, 0, yBase + delta);
      log.debug(`分片 ${slice.index}: scrollY=${slice.scrollY}, yBase=${yBase}, delta=${delta}`);

      prev?.close();
      prev = img;
    }
    prev?.close();

    return canvasToDataUrl(canvas, format, quality);
  }

  /**
   * 内部滚动容器「视口铬」合成：
   * 长图 = 容器外固定带（chrome：顶部 Header / 左侧导航 / 底部 footer，各出现一次）+ 容器内容分片。
   * 分片已在 captureSlices 阶段裁剪为容器可见区，此处按 scrollOffsetX/Y + scrollTop 贴回。
   * 统一视口坐标系：长图 (0,0) = 视口 (0,0)，使 pasteFixed 的视口坐标可直接复用。
   */
  async stitchInternal(
    slices: Slice[],
    chromeFrame: string,
    metrics: PageMetrics,
    format: OutputFormat = 'png',
    quality = 0.92,
  ): Promise<string> {
    if (slices.length === 0) throw new Error('无分片可拼接');

    const layout = computeChromeLayout(metrics);
    const dpr = metrics.devicePixelRatio || 1;
    const px = (n: number) => Math.max(0, Math.round(n * dpr));

    const canvas = new OffscreenCanvas(
      Math.max(1, px(layout.totalWidth)),
      Math.max(1, px(layout.totalHeight)),
    );
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 2D 上下文');

    // 白色底：避免透明区域出现黑底
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 1. 贴 chrome 带（来自回顶静止帧 chromeFrame，各出现一次）
    const chrome = await loadBitmap(chromeFrame);
    const vwPx = px(metrics.viewportWidth);
    // 顶部 Header 带
    if (layout.offsetY > 0) {
      ctx.drawImage(chrome, 0, 0, vwPx, px(layout.offsetY), 0, 0, vwPx, px(layout.offsetY));
    }
    // 底部 footer 带
    if (layout.footerBand > 0) {
      const srcY = px(layout.offsetY + layout.containerH);
      const dstY = px(layout.offsetY + metrics.fullHeight);
      ctx.drawImage(
        chrome,
        0,
        srcY,
        vwPx,
        px(layout.footerBand),
        0,
        dstY,
        vwPx,
        px(layout.footerBand),
      );
    }
    // 左侧导航带（静止、仅一屏，出现一次，不随内容延伸）
    if (layout.offsetX > 0) {
      ctx.drawImage(
        chrome,
        0,
        px(layout.offsetY),
        px(layout.offsetX),
        px(layout.containerH),
        0,
        px(layout.offsetY),
        px(layout.offsetX),
        px(layout.containerH),
      );
    }
    chrome.close();

    // 2. 贴容器内容分片（已裁剪到容器可见区，自然尺寸即 clientWidth×clientHeight）
    for (const slice of slices) {
      const img = await loadBitmap(slice.dataUrl);
      ctx.drawImage(img, px(layout.offsetX), px(layout.offsetY + slice.scrollY));
      img.close();
    }

    return canvasToDataUrl(canvas, format, quality);
  }

  /**
   * 重叠区 SSD 对齐（可选增强，P0 默认 delta=0 纯位移对齐）：
   * 在重叠带内竖直滑动 cur，找像素差平方和最小的偏移，返回最优 delta。
   * 为控制耗时采用「抽样列 + 抽样行」的降采样 SSD。
   *
   * 原理：prev 已绘制在长图 ctx 中，重叠带行区间为 [curYBase, curYBase+bandH)；
   * cur 绘制到临时画布（上下各预留 overlapPx 搜索空间），对每个候选偏移 d，
   * 比较 prev 重叠带像素与 cur 在「若绘制于 curYBase+d」时的对应像素，取 SSD 最小者。
   */
  private async alignOverlap(
    ctx: OffscreenCanvasRenderingContext2D,
    cur: ImageBitmap,
    curYBase: number,
    overlapPx: number,
  ): Promise<number> {
    const width = cur.width;
    const bandHeight = Math.max(1, Math.min(overlapPx, ctx.canvas.height - curYBase));
    if (bandHeight <= 0) return 0;

    // prev 已绘制在长图中，重叠带行区间 [curYBase, curYBase+bandHeight)
    const prevData = ctx.getImageData(0, curYBase, width, bandHeight).data;

    // 将 cur 绘制到临时画布，偏移 overlapPx 预留上下搜索空间
    const tmp = new OffscreenCanvas(width, cur.height + 2 * overlapPx);
    const tmpCtx = tmp.getContext('2d');
    if (!tmpCtx) return 0;
    tmpCtx.drawImage(cur, 0, overlapPx);

    // 抽样：列/行步长，降低计算量
    const colStep = Math.max(1, Math.floor(width / 32));
    const rowStep = Math.max(1, Math.floor(bandHeight / 64));

    let bestDelta = 0;
    let bestCost = Number.POSITIVE_INFINITY;

    for (let d = -overlapPx; d <= overlapPx; d += 1) {
      // cur 在 temp 中与长图重叠带对齐的行起点
      const srcY = overlapPx - d;
      const curData = tmpCtx.getImageData(0, srcY, width, bandHeight).data;
      let cost = 0;
      for (let y = 0; y < bandHeight; y += rowStep) {
        for (let x = 0; x < width; x += colStep) {
          const idx = (y * width + x) * 4;
          const dr = prevData[idx] - curData[idx];
          const dg = prevData[idx + 1] - curData[idx + 1];
          const db = prevData[idx + 2] - curData[idx + 2];
          cost += dr * dr + dg * dg + db * db;
        }
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestDelta = d;
      }
    }
    return bestDelta;
  }

  /** 计算相邻分片重叠区（CSS px） */
  private computeOverlapCss(slices: Slice[], metrics: PageMetrics): number {
    if (slices.length < 2) return 0;
    const d0 = Math.abs(slices[1].scrollY - slices[0].scrollY);
    return Math.max(0, metrics.viewportHeight - d0);
  }

  /** 将 fixed/sticky 区域从补拍首帧贴回长图（只出现一次） */
  async pasteFixed(
    longDataUrl: string,
    topFrameDataUrl: string,
    fixedList: FixedElementInfo[],
    metrics: PageMetrics,
    format: OutputFormat = 'png',
    quality = 0.92,
  ): Promise<string> {
    if (fixedList.length === 0) return longDataUrl;

    const dpr = metrics.devicePixelRatio || 1;
    const longImg = await loadBitmap(longDataUrl);
    const topImg = await loadBitmap(topFrameDataUrl);

    const canvas = new OffscreenCanvas(longImg.width, longImg.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      longImg.close();
      topImg.close();
      throw new Error('无法获取 2D 上下文');
    }
    ctx.drawImage(longImg, 0, 0);

    for (const f of fixedList) {
      const sx = Math.round(f.rect.x * dpr);
      const sy = Math.round(f.rect.y * dpr);
      const sw = Math.round(f.rect.width * dpr);
      const sh = Math.round(f.rect.height * dpr);
      if (sw <= 0 || sh <= 0) continue;
      // 越界保护：贴回位置限制在长图范围内
      const dx = Math.max(0, sx);
      const dy = Math.max(0, sy);
      if (dx >= longImg.width || dy >= longImg.height) continue;
      // 源坐标修正：当贴回位置被 clamp 到长图边界时，源裁剪窗口同步偏移，
      // 避免裁剪出与目标区域不对齐的内容
      const offsetX = dx - sx;
      const offsetY = dy - sy;
      const srcX = sx + offsetX;
      const srcY = sy + offsetY;
      const cw = Math.min(sw, longImg.width - dx);
      const ch = Math.min(sh, longImg.height - dy);
      if (cw <= 0 || ch <= 0) continue;
      ctx.drawImage(topImg, srcX, srcY, cw, ch, dx, dy, cw, ch);
    }

    longImg.close();
    topImg.close();
    return canvasToDataUrl(canvas, format, quality);
  }
}
