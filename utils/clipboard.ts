/**
 * 复制图片到剪贴板（B4 / C1）：
 * 优先走现代 ClipboardItem API；Firefox 等不支持时返回 unsupported，由调用方降级提示，
 * 不抛未捕获异常。
 */

/** 复制结果：成功 / 不支持 / 失败（失败也不抛异常，交调用方 toast 提示） */
export type CopyImageResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'error' };

/**
 * 将图片 Blob 写入系统剪贴板。
 * 能力探测：ClipboardItem 构造器与 navigator.clipboard.write 均可用才尝试写入。
 * @param blob 图片 Blob
 */
export async function copyImageToClipboard(blob: Blob): Promise<CopyImageResult> {
  // 能力探测：现代 Chromium 支持 ClipboardItem + clipboard.write
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return { ok: false, reason: 'unsupported' };
  }
  try {
    // 兜底 mime：异常情况下按 image/png 处理
    const mime = blob.type || 'image/png';
    await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
    return { ok: true };
  } catch {
    // Firefox 旧版等虽存在 ClipboardItem 但实际写入失败，不抛未捕获异常
    return { ok: false, reason: 'error' };
  }
}
