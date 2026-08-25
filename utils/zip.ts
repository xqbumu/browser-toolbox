/**
 * JSZip 打包截图集：只打包成功项，Zip 内平铺（PRD Q6）。
 * 文件名冲突时自动追加序号，避免同秒同名覆盖。
 */
import JSZip from 'jszip';
import type { CaptureResult } from '@/types/capture';

/** 将批量截图成功项打包为 Zip Blob */
export async function zipScreenshots(items: CaptureResult[]): Promise<Blob> {
  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (const item of items) {
    if (!item.ok || !item.dataUrl) continue;

    const base64 = splitBase64(item.dataUrl);
    const name = uniqueName(item.fileName || `screenshot_${Date.now()}.png`, usedNames);
    zip.file(name, base64, { base64: true });
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/** 提取 dataURL 的 base64 部分 */
function splitBase64(dataUrl: string): string {
  const idx = dataUrl.indexOf(',');
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

/** 确保 zip 内文件名唯一：冲突时追加 (1)、(2)… */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 1;
  let candidate = `${stem}(${i})${ext}`;
  while (used.has(candidate)) {
    i += 1;
    candidate = `${stem}(${i})${ext}`;
  }
  used.add(candidate);
  return candidate;
}
