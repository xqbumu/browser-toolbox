/**
 * 缩略图生成：原图 Blob → 降采样缩略图（最大边 320px，JPEG q0.7）。
 * 兼容 MV3 Service Worker（无 DOM）：优先 OffscreenCanvas + createImageBitmap；
 * 无 OffscreenCanvas 时降级 DOM canvas（Firefox MV2 background page）；
 * 两者皆无时抛出异常，由调用方兜底使用原图。
 */
import { createLogger } from '@/utils/logger';

const log = createLogger('thumbnail');

const THUMB_MAX_EDGE = 320;
const THUMB_QUALITY = 0.7;

/** 纯函数：等比降采样尺寸（不放大），便于单测 */
export function computeThumbSize(
  w: number,
  h: number,
  maxEdge = THUMB_MAX_EDGE,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** 原图 Blob → 缩略图 Blob（JPEG q0.7，最大边 320px） */
export async function createThumbnail(
  source: Blob,
  maxEdge = THUMB_MAX_EDGE,
  quality = THUMB_QUALITY,
): Promise<Blob> {
  const bmp = await createImageBitmap(source);
  const { width, height } = computeThumbSize(bmp.width, bmp.height, maxEdge);

  // Chrome MV3 Service Worker / 现代浏览器：OffscreenCanvas + convertToBlob
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(bmp, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      bmp.close();
      return blob;
    }
  }

  // 降级：DOM canvas（Firefox MV2 background page / popup / 无 OffscreenCanvas 环境）
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bmp.close();
      throw new Error('无法创建 2D 绘图上下文');
    }
    ctx.drawImage(bmp, 0, 0, width, height);
    bmp.close();
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        quality,
      ),
    );
  }

  bmp.close();
  throw new Error('当前环境不支持 OffscreenCanvas 与 DOM canvas，无法生成缩略图');
}
