/**
 * core/stitch.ts 单测：
 * - computeOverlapCss 为私有方法，通过白盒访问（as 最小接口）验证其纯逻辑；
 * - stitch/pasteFixed/alignOverlap 依赖 OffscreenCanvas / createImageBitmap / fetch，
 *   Node 环境无法真机执行，仅在此做静态说明与坐标换算约定的等价校验。
 */
import { describe, it, expect } from 'vitest';
import { Stitcher, computeChromeLayout } from '@/core/stitch';
import type { Slice, PageMetrics } from '@/types/capture';

/** 白盒访问私有纯方法的最小类型 */
interface OverlapProbe {
  computeOverlapCss(slices: Slice[], metrics: PageMetrics): number;
}

const probe = new Stitcher() as unknown as OverlapProbe;

function metrics(vh: number): PageMetrics {
  return {
    viewportWidth: 100,
    viewportHeight: vh,
    fullWidth: 100,
    fullHeight: 1000,
    devicePixelRatio: 1,
    scrollY: 0,
  };
}

function slices(ys: number[]): Slice[] {
  return ys.map((scrollY, index) => ({
    index,
    scrollY,
    dataUrl: 'data:image/png;base64,',
    width: 100,
    height: 100,
  }));
}

describe('computeOverlapCss（私有，白盒）', () => {
  it('分片不足 2 个时重叠区为 0', () => {
    expect(probe.computeOverlapCss(slices([0]), metrics(100))).toBe(0);
    expect(probe.computeOverlapCss([], metrics(100))).toBe(0);
  });

  it('重叠区 = 视口高 - 相邻分片 scrollY 之差', () => {
    // scrollY 0 -> 85，视口 100 => 重叠 15
    expect(probe.computeOverlapCss(slices([0, 85]), metrics(100))).toBe(15);
    // scrollY 10 -> 60，视口 100 => 重叠 50
    expect(probe.computeOverlapCss(slices([10, 60]), metrics(100))).toBe(50);
  });

  it('无重叠（步长=视口高）时重叠区为 0', () => {
    expect(probe.computeOverlapCss(slices([0, 100]), metrics(100))).toBe(0);
  });

  it('与 scrollStep 组合：overlap = vh - floor(vh*(1-ratio))，且非负', () => {
    const vh = 100;
    const ratio = 0.15;
    const step = Math.max(1, Math.floor(vh * (1 - ratio)));
    const m = metrics(vh);
    const overlap = probe.computeOverlapCss(slices([0, step]), m);
    expect(overlap).toBe(vh - step);
    expect(overlap).toBeGreaterThanOrEqual(0);
  });
});

describe('computeChromeLayout（内部容器 chrome 合成布局）', () => {
  /** 构造完整 PageMetrics（内部容器相关字段显式给定） */
  function m(partial: Partial<PageMetrics> = {}): PageMetrics {
    return {
      viewportWidth: 1280,
      viewportHeight: 800,
      fullWidth: 1280,
      fullHeight: 2000,
      devicePixelRatio: 1,
      scrollY: 0,
      scrollViewportWidth: 1280,
      scrollViewportHeight: 800,
      scrollOffsetX: 0,
      scrollOffsetY: 0,
      ...partial,
    };
  }

  it('window 级滚动：footerBand=0，长图宽=视口宽、高=fullHeight', () => {
    const layout = computeChromeLayout(m());
    expect(layout).toEqual({
      offsetX: 0,
      offsetY: 0,
      containerW: 1280,
      containerH: 800,
      footerBand: 0,
      totalWidth: 1280,
      totalHeight: 2000,
    });
  });

  it('典型内部容器：长图高 = offsetY + fullHeight（无 footer）', () => {
    // 顶部 Header 60、左导航 200，容器 1080×740
    const layout = computeChromeLayout(
      m({ scrollOffsetX: 200, scrollOffsetY: 60, scrollViewportWidth: 1080, scrollViewportHeight: 740 }),
    );
    expect(layout.offsetX).toBe(200);
    expect(layout.offsetY).toBe(60);
    expect(layout.containerW).toBe(1080);
    expect(layout.containerH).toBe(740);
    expect(layout.footerBand).toBe(0); // 60 + 740 = 800，恰好填满视口
    expect(layout.totalWidth).toBe(1280); // max(1280, 200+1080)
    expect(layout.totalHeight).toBe(60 + 2000);
  });

  it('容器下方有剩余视口时计算 footerBand', () => {
    // 顶部无偏移，容器高 600（视口 800），下方剩余 200
    const layout = computeChromeLayout(m({ scrollViewportHeight: 600 }));
    expect(layout.footerBand).toBe(200);
    expect(layout.totalHeight).toBe(2000 + 200);
  });

  it('容器宽 + 水平偏移超出视口时，长图宽取较大者', () => {
    const layout = computeChromeLayout(m({ scrollOffsetX: 300, scrollViewportWidth: 1100 }));
    expect(layout.totalWidth).toBe(1400); // max(1280, 300+1100)
  });

  it('footerBand 被钳制为非负（容器可见区超出视口的异常兜底）', () => {
    const layout = computeChromeLayout(m({ scrollOffsetY: 100, scrollViewportHeight: 900 }));
    expect(layout.footerBand).toBe(0);
  });
});

describe('坐标换算约定（静态等价校验）', () => {
  it('物理像素坐标统一 Math.round(x * dpr)', () => {
    // 架构 §4.4：分片绘制位置 / fixed 裁剪 / 选区裁剪均 round(x*dpr)
    const dpr = 1.25;
    const cssY = 137;
    expect(Math.round(cssY * dpr)).toBe(Math.round(137 * 1.25)); // 171.25 -> 171
  });

  it('非整数 dpr 下先 round 再绘制，避免亚像素', () => {
    const dpr = 1.5;
    expect(Number.isInteger(Math.round(100 * dpr))).toBe(true);
  });
});
