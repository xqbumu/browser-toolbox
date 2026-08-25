/**
 * core/scroll-capture.ts 纯逻辑单测：
 * scrollStep 步长（整数、下限 1、重叠区比例换算）、
 * buildPositions 滚动位置序列（末片对齐到底、去重、单屏不滚动、严格递增）、
 * shouldCropSlice 裁剪判定（window 级零回归 / 内部容器双轴偏移与尺寸变化触发裁剪）。
 */
import { describe, it, expect } from 'vitest';
import { scrollStep, buildPositions, shouldCropSlice } from '@/core/scroll-capture';
import type { PageMetrics } from '@/types/capture';

/** 构造最小 PageMetrics（缺省字段走 ?? 兜底） */
function metrics(partial?: Partial<PageMetrics>): PageMetrics {
  return {
    viewportWidth: 1280,
    viewportHeight: 800,
    fullWidth: 1280,
    fullHeight: 2000,
    devicePixelRatio: 1,
    scrollY: 0,
    ...partial,
  };
}

describe('scrollStep', () => {
  it('按重叠区比例计算步长：floor(vh * (1 - ratio))', () => {
    expect(scrollStep(1000, 0.15)).toBe(850);
    expect(scrollStep(100, 0)).toBe(100);
    expect(scrollStep(100, 0.5)).toBe(50);
    expect(scrollStep(200, 0.3)).toBe(140);
  });

  it('结果始终为整数', () => {
    for (const [vh, r] of [
      [100, 0.15],
      [101, 0.15],
      [1, 0.15],
      [1000, 0.3],
    ] as const) {
      expect(Number.isInteger(scrollStep(vh, r))).toBe(true);
    }
  });

  it('步长下限为 1，避免步长为 0 导致死循环', () => {
    expect(scrollStep(1, 0.15)).toBe(1);
    expect(scrollStep(5, 0.99)).toBe(1);
    expect(scrollStep(100, 0.999)).toBe(1);
  });
});

describe('buildPositions', () => {
  it('单屏（总高 <= 视口）不滚动，仅 [0]', () => {
    expect(buildPositions(100, 100, 85)).toEqual([0]);
    expect(buildPositions(100, 50, 85)).toEqual([0]);
    expect(buildPositions(100, 0, 85)).toEqual([0]);
  });

  it('末片对齐到底部：最后一个位置 === total - vh', () => {
    expect(buildPositions(100, 300, 85)).toEqual([0, 85, 170, 200]);
    expect(buildPositions(100, 300, 85).at(-1)).toBe(200);
  });

  it('首片从 0 开始，序列严格递增且均为整数', () => {
    const positions = buildPositions(100, 350, 80);
    expect(positions[0]).toBe(0);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      expect(Number.isInteger(positions[i])).toBe(true);
    }
  });

  it('无相邻重复（末片若与上一步重合则去重）', () => {
    const positions = buildPositions(100, 201, 100);
    expect(positions).toEqual([0, 100, 101]);
    const unique = new Set(positions);
    expect(unique.size).toBe(positions.length);
  });

  it('步长恰好整除时仍精确对齐到底', () => {
    // vh=100, total=300, step=100(ratio=0) => [0, 100, 200]
    expect(buildPositions(100, 300, 100)).toEqual([0, 100, 200]);
    // 末片与前一片存在重叠时不产生越界
    expect(buildPositions(100, 250, 85)).toEqual([0, 85, 150]);
  });

  it('所有位置不超过 total - vh', () => {
    const total = 400;
    const vh = 120;
    const maxY = total - vh;
    const positions = buildPositions(vh, total, 90);
    for (const p of positions) {
      expect(p).toBeLessThanOrEqual(maxY);
    }
  });

  it('与 scrollStep 组合：重叠区 = vh - step', () => {
    const vh = 1000;
    const ratio = 0.15;
    const step = scrollStep(vh, ratio);
    expect(step).toBe(850);
    // 重叠区（CSS px）= viewportHeight - step = ceil(vh * ratio) ≈ 150
    expect(vh - step).toBe(150);
  });
});

describe('shouldCropSlice（双轴裁剪判定）', () => {
  it('window 级滚动（offset 全 0、client=viewport）不裁剪，零回归', () => {
    expect(shouldCropSlice(metrics())).toBe(false);
    expect(
      shouldCropSlice(
        metrics({
          scrollViewportWidth: 1280,
          scrollViewportHeight: 800,
          scrollOffsetX: 0,
          scrollOffsetY: 0,
        }),
      ),
    ).toBe(false);
  });

  it('缺省字段（旧调用方未提供）按 viewport/0 兜底，不裁剪', () => {
    expect(shouldCropSlice(metrics({ scrollOffsetX: undefined, scrollOffsetY: undefined }))).toBe(
      false,
    );
  });

  it('水平偏移 scrollOffsetX != 0 触发裁剪', () => {
    expect(shouldCropSlice(metrics({ scrollOffsetX: 200 }))).toBe(true);
  });

  it('纵向偏移 scrollOffsetY != 0 触发裁剪', () => {
    expect(shouldCropSlice(metrics({ scrollOffsetY: 80 }))).toBe(true);
  });

  it('容器可见宽 != 视口宽触发裁剪', () => {
    expect(shouldCropSlice(metrics({ scrollViewportWidth: 1000 }))).toBe(true);
  });

  it('容器可见高 != 视口高触发裁剪', () => {
    expect(shouldCropSlice(metrics({ scrollViewportHeight: 600 }))).toBe(true);
  });
});
