/**
 * core/stitch.ts stitchInternal「视口铬」合成的独立验证单测（QA 补齐测试缺口）：
 * 通过假 OffscreenCanvas / createImageBitmap / fetch 记录 drawImage 调用参数，
 * 脱离真实浏览器环境验证 chrome 各带（Header / footer / 左导航）与内容分片的
 * 目标坐标是否各自对齐、无缝隙（末片底 = offsetY + fullHeight = footer 起点）。
 *
 * 仅验证纯坐标换算（dpr=1），不涉及真实像素合成。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Stitcher } from '@/core/stitch';
import type { PageMetrics, Slice } from '@/types/capture';

/** 单次 drawImage 调用记录（rest = drawImage 除图像外的其余参数） */
interface DrawCall {
  imgId: string;
  rest: number[];
}

/** 安装假 OffscreenCanvas，捕获画布尺寸 / fillRect / drawImage 调用 */
function setupRecordingCanvas() {
  const drawCalls: DrawCall[] = [];
  const fillRects: number[][] = [];
  const canvasSizes: Array<[number, number]> = [];
  let bitmapSeq = 0;

  class FakeContext {
    fillStyle = '';
    constructor(public canvas: FakeCanvas) {}
    fillRect(x: number, y: number, w: number, h: number): void {
      fillRects.push([x, y, w, h]);
    }
    drawImage(img: { id: string }, ...rest: number[]): void {
      drawCalls.push({ imgId: img?.id ?? 'unknown', rest });
    }
    getImageData(_x: number, _y: number, w: number, h: number): { data: Uint8ClampedArray } {
      return { data: new Uint8ClampedArray(w * h * 4) };
    }
  }

  class FakeCanvas {
    ctx: FakeContext;
    constructor(
      public width: number,
      public height: number,
    ) {
      this.ctx = new FakeContext(this);
      canvasSizes.push([width, height]);
    }
    getContext(): FakeContext {
      return this.ctx;
    }
    convertToBlob(): Promise<{ type: string; arrayBuffer: () => Promise<ArrayBuffer> }> {
      return Promise.resolve({ type: 'image/png', arrayBuffer: async () => new ArrayBuffer(0) });
    }
  }

  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  vi.stubGlobal('fetch', async () => ({ ok: true, blob: async () => ({}) }));
  vi.stubGlobal('createImageBitmap', async () => ({
    id: `bitmap-${bitmapSeq++}`,
    width: 1,
    height: 1,
    close: () => {},
  }));

  return { drawCalls, fillRects, canvasSizes };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function internalMetrics(partial: Partial<PageMetrics> = {}): PageMetrics {
  return {
    viewportWidth: 1280,
    viewportHeight: 800,
    fullWidth: 1080,
    fullHeight: 2000,
    devicePixelRatio: 1,
    scrollY: 0,
    scrollViewportWidth: 1080,
    scrollViewportHeight: 740,
    scrollOffsetX: 200,
    scrollOffsetY: 60,
    ...partial,
  };
}

function makeSlices(ys: number[]): Slice[] {
  return ys.map((scrollY, index) => ({
    index,
    scrollY,
    dataUrl: 'data:image/png;base64,',
    width: 1080,
    height: 740,
  }));
}

describe('stitchInternal 视口铬合成（坐标对齐，dpr=1）', () => {
  it('Header 带贴满视口宽 y∈[0,offsetY]，左导航带贴 [0,offsetX]×[offsetY,offsetY+containerH]', async () => {
    const rec = setupRecordingCanvas();
    await new Stitcher().stitchInternal(makeSlices([0]), 'data:image/png;base64,chrome', internalMetrics(), 'png', 1);

    // 长图尺寸：宽=max(1280, 200+1080)=1280，高=offsetY+fullHeight+footerBand=60+2000+0
    expect(rec.canvasSizes[0]).toEqual([1280, 2060]);
    // 白底铺满
    expect(rec.fillRects[0]).toEqual([0, 0, 1280, 2060]);

    // draw 顺序：Header(bitmap-0) → 左导航(bitmap-0) → 分片(bitmap-1)；无 footer(footerBand=0)
    const header = rec.drawCalls.find((c) => c.imgId === 'bitmap-0' && c.rest.length === 8);
    expect(header?.rest).toEqual([0, 0, 1280, 60, 0, 0, 1280, 60]);

    const nav = rec.drawCalls.find((c) => c.imgId === 'bitmap-0' && c.rest[1] === 60);
    // src=[0,60,200,740] dst=[0,60,200,740]
    expect(nav?.rest).toEqual([0, 60, 200, 740, 0, 60, 200, 740]);

    // 首片贴到 (offsetX, offsetY + scrollY) = (200, 60)
    const slice0 = rec.drawCalls.find((c) => c.imgId === 'bitmap-1');
    expect(slice0?.rest).toEqual([200, 60]);
  });

  it('footer 带贴到 y∈[offsetY+fullHeight, …]，src 取自视口底部 [offsetY+containerH, vh]', async () => {
    const rec = setupRecordingCanvas();
    // 顶部无 Header、无左导航，容器高 600（视口 800）→ footerBand=200
    const m = internalMetrics({
      scrollOffsetX: 0,
      scrollOffsetY: 0,
      scrollViewportWidth: 1280,
      scrollViewportHeight: 600,
      fullWidth: 1280,
    });
    await new Stitcher().stitchInternal(makeSlices([0]), 'data:image/png;base64,chrome', m, 'png', 1);

    // 高 = 0 + 2000 + 200 = 2200
    expect(rec.canvasSizes[0]).toEqual([1280, 2200]);
    // footer: src=[0,600,1280,200] dst=[0,2000,1280,200]
    const footer = rec.drawCalls.find((c) => c.imgId === 'bitmap-0' && c.rest.length === 8);
    expect(footer?.rest).toEqual([0, 600, 1280, 200, 0, 2000, 1280, 200]);
  });

  it('末片底 = offsetY + fullHeight，与 footer 起点无缝衔接', async () => {
    const rec = setupRecordingCanvas();
    // Header 60 + 左导航 200 + 容器高 500 → footerBand=240；fullHeight=2000
    const m = internalMetrics({ scrollViewportHeight: 500 });
    // 末片 scrollY = fullHeight - containerH = 1500
    await new Stitcher().stitchInternal(makeSlices([0, 1500]), 'data:image/png;base64,chrome', m, 'png', 1);

    expect(rec.canvasSizes[0]).toEqual([1280, 60 + 2000 + 240]); // 2300
    const footer = rec.drawCalls.find((c) => c.imgId === 'bitmap-0' && c.rest[5] === 2060);
    // footer dst 起点 = offsetY + fullHeight = 60 + 2000 = 2060
    expect(footer?.rest).toEqual([0, 560, 1280, 240, 0, 2060, 1280, 240]);

    // 末片贴到 (offsetX, offsetY + 1500) = (200, 1560)，其底 1560 + 500 = 2060 = footer 起点
    const lastSlice = rec.drawCalls.filter((c) => c.imgId === 'bitmap-2')[0];
    expect(lastSlice?.rest).toEqual([200, 1560]);
  });

  it('window 级度量下 stitchInternal 仍等价：长图=vw×fullHeight，仅贴分片', async () => {
    const rec = setupRecordingCanvas();
    const m: PageMetrics = {
      viewportWidth: 1280,
      viewportHeight: 800,
      fullWidth: 1280,
      fullHeight: 2000,
      devicePixelRatio: 1,
      scrollY: 0,
    };
    await new Stitcher().stitchInternal(makeSlices([0, 800]), 'data:image/png;base64,chrome', m, 'png', 1);

    // footerBand=0, offset 全 0 → 画布 1280×2000
    expect(rec.canvasSizes[0]).toEqual([1280, 2000]);
    // 无 Header/footer/左导航（offset/footerBand 全 0），仅白底 + 分片
    expect(rec.drawCalls.filter((c) => c.rest.length === 8)).toHaveLength(0);
    const slices = rec.drawCalls.filter((c) => c.imgId !== 'bitmap-0');
    expect(slices.map((c) => c.rest)).toEqual([
      [0, 0],
      [0, 800],
    ]);
  });
});
