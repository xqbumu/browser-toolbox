/**
 * 下载封装：browser.downloads.download 的薄封装。
 * Blob 走 objectURL 通道（规避 Chrome 对超大 dataURL 的 `Access denied` 限制）；
 * dataURL 先转 Blob 再委托 objectURL 通道，同样不再受 dataURL 长度限制影响。
 */
import { blobToDataUrl, dataUrlToBlob } from '@/utils/helpers';
import { createLogger } from '@/utils/logger';
import { sanitizeSubfolder } from '@/utils/naming';

const log = createLogger('download');

/** objectURL 延迟 revoke 的毫秒数（下载是异步的，过早 revoke 会导致下载失败） */
const OBJECT_URL_TTL_MS = 60_000;

/** 拼最终相对路径：saveSubfolder + '/' + fileName；空目录则原样返回 */
export function resolveDownloadPath(saveSubfolder: string, fileName: string): string {
  const dir = sanitizeSubfolder(saveSubfolder);
  return dir ? `${dir}/${fileName}` : fileName;
}

/** 下载 dataURL 内容到文件（先转 Blob 再走 objectURL，规避超大 dataURL 限制） */
export async function downloadDataUrl(dataUrl: string, fileName: string): Promise<number> {
  const blob = await dataUrlToBlob(dataUrl);
  return downloadBlob(blob, fileName);
}

/** 下载 Blob 内容到文件（objectURL 通道，无 dataURL 长度限制） */
export async function downloadBlob(blob: Blob, fileName: string): Promise<number> {
  // 正常环境（Chrome MV3 SW / Firefox MV2 Background）均有 createObjectURL；
  // 极端环境缺省时回退 dataURL（仅小图兜底，大图仍可能受 Access denied 限制）。
  if (typeof URL.createObjectURL === 'function') {
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await downloadViaUrl(objectUrl, fileName);
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_TTL_MS);
    }
  }
  const dataUrl = await blobToDataUrl(blob);
  return downloadViaUrl(dataUrl, fileName);
}

/** 以指定 URL（dataURL 或 objectURL）发起下载 */
async function downloadViaUrl(url: string, fileName: string): Promise<number> {
  const id = await browser.downloads.download({
    url,
    filename: fileName,
    saveAs: false,
  });
  log.info('已发起下载', fileName, 'downloadId=', id);
  return id;
}
