/**
 * 文件名生成：`域名_标题_时间戳.png`。
 * 域名去 `www.` 前缀与端口；标题清洗非法字符（\/:*?"<>| → _）并截断到 50 字符。
 */
import type { OutputFormat } from '@/types/capture';

const ILLEGAL_RE = /[\\/:*?"<>|]/g;

/** 生成截图文件名（唯一命名入口，禁止各处手写） */
export function buildFileName(
  url: string,
  title?: string,
  format: OutputFormat = 'png',
  now: Date = new Date(),
): string {
  const domain = extractDomain(url);
  const safeTitle = sanitizeTitle(title);
  const ext = format === 'jpeg' ? 'jpg' : format;
  const timestamp = formatTimestamp(now);
  return `${domain}_${safeTitle}_${timestamp}.${ext}`;
}

/** 提取域名：去 www. 与端口 */
function extractDomain(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '');
    return host || 'localhost';
  } catch {
    return 'page';
  }
}

/** 清洗标题：替换非法字符、压缩空白、截断 50 字符 */
function sanitizeTitle(title: string | undefined): string {
  if (!title) return 'page';
  const cleaned = title.replace(ILLEGAL_RE, '_').replace(/\s+/g, ' ').trim().slice(0, 50);
  return cleaned || 'page';
}

/**
 * 清洗保存子文件夹名：非法字符 → _，禁止 '.'/'..'/路径越界，空串→存根目录。
 * 复用 ILLEGAL_RE 与文件名清洗同一字符集。
 */
export function sanitizeSubfolder(input: string): string {
  let s = (input ?? '').trim();
  s = s.replace(ILLEGAL_RE, '_'); // \ / : * ? " < > | → _
  s = s.replace(/\s+/g, ' ').trim();
  // 路径分隔符已在上面转 _，此处仅剩字面 '.' / '..'，直接拦截
  if (s === '.' || s === '..') return '';
  // 去首尾 '.'，避免隐藏目录名混淆（保持确定性）
  s = s.replace(/^\.+|\.+$/g, '');
  return s.slice(0, 100); // 长度保护
}

/** 时间戳：YYYYMMDD_HHmmss */
function formatTimestamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(
    d.getMinutes(),
  )}${p(d.getSeconds())}`;
}
