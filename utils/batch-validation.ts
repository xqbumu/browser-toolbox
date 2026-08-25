/**
 * 按 URL 批量输入的校验工具（B6）：解析、校验 http(s)、统计非法、判断超限。
 * 纯函数模块，供 BatchPanel 前端先提示；core/batch-urls.ts 仍保留自身过滤逻辑兜底，
 * 二者口径保持一致。
 */

/** 单批 URL 数量上限（与 core/batch-urls.ts 的 MAX_URLS 保持一致） */
export const MAX_BATCH_URLS = 50;

/** 是否合法 http(s) URL（口径与 core/batch-urls.ts 的 isHttpUrl 一致） */
export function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/** 批量 URL 校验结果 */
export interface BatchUrlValidation {
  /** 原始非空行（已 trim） */
  lines: string[];
  /** 合法 http(s) URL（未截断） */
  validUrls: string[];
  /** 非法（非 http(s)）URL 数量 */
  invalidCount: number;
  /** 合法 URL 是否超过上限（需前端提示截断） */
  overLimit: boolean;
}

/** 解析并校验批量 URL 输入（按换行分隔，去空行、去首尾空白） */
export function validateBatchUrls(text: string): BatchUrlValidation {
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const validUrls = lines.filter(isHttpUrl);
  const invalidCount = lines.length - validUrls.length;
  const overLimit = validUrls.length > MAX_BATCH_URLS;
  return { lines, validUrls, invalidCount, overLimit };
}
