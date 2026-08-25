/**
 * utils/thumbnail.ts 的 computeThumbSize 纯函数单测：
 * 等比降采样、不放大、边界（1px 下限、0 值防御）、默认 maxEdge=320。
 * （createThumbnail 依赖 createImageBitmap / OffscreenCanvas / DOM canvas，
 *   属真机浏览器能力，无法在 Node 下断言，仅静态核对三级降级逻辑。）
 */
import { describe, it, expect } from 'vitest';
import { computeThumbSize } from '@/utils/thumbnail';

describe('computeThumbSize', () => {
  it('等比降采样：横向长图，宽边缩到 maxEdge', () => {
    expect(computeThumbSize(640, 320, 320)).toEqual({ width: 320, height: 160 });
  });

  it('等比降采样：纵向长图，高边缩到 maxEdge', () => {
    expect(computeThumbSize(320, 640, 320)).toEqual({ width: 160, height: 320 });
  });

  it('不放大：小于 maxEdge 的图保持原尺寸', () => {
    expect(computeThumbSize(100, 100, 320)).toEqual({ width: 100, height: 100 });
    expect(computeThumbSize(200, 80, 320)).toEqual({ width: 200, height: 80 });
  });

  it('等于 maxEdge 时保持不变', () => {
    expect(computeThumbSize(320, 320, 320)).toEqual({ width: 320, height: 320 });
  });

  it('边界：0 尺寸防御为 1px（不下钻到 0）', () => {
    expect(computeThumbSize(0, 0, 320)).toEqual({ width: 1, height: 1 });
  });

  it('边界：极小图不小于 1px', () => {
    expect(computeThumbSize(1, 1, 320)).toEqual({ width: 1, height: 1 });
  });

  it('默认 maxEdge = 320（不传参）', () => {
    const { width, height } = computeThumbSize(1280, 720);
    expect(width).toBe(320);
    expect(height).toBe(180);
  });

  it('自定义 maxEdge 生效', () => {
    expect(computeThumbSize(1280, 720, 160)).toEqual({ width: 160, height: 90 });
  });

  it('极端长宽比：窄边被 1px 下限兜底', () => {
    const r = computeThumbSize(1000, 2, 320);
    expect(r.width).toBe(320);
    expect(r.height).toBe(1); // round(2*0.32)=1
  });
});
