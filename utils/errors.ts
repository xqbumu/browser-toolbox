/**
 * 错误文案友好化（B2）：将底层原始 Error 串映射为可读的、可自助恢复的提示。
 * 纯函数模块，不依赖浏览器运行时，便于单测。
 */

/** 单条「错误特征 → 友好文案」规则 */
export interface FriendlyErrorRule {
  /** 用于匹配原始错误串的正则（不区分大小写） */
  pattern: RegExp;
  /** 命中后返回的友好文案 */
  message: string;
}

/**
 * 规则按顺序匹配，命中即返回；顺序体现优先级：
 * 1. Access denied —— 下载被浏览器拒绝（常见于超大 dataURL）
 * 2. Cannot access / 注入失败 —— 权限不足，无法访问或注入页面
 * 3. timed out / 超时 —— 操作超时，页面可能未加载完整
 * 4. 已取消 / cancel —— 用户主动取消
 * 5. chrome:// 等受保护页面 —— 无法截图
 */
const RULES: FriendlyErrorRule[] = [
  { pattern: /Access denied/i, message: '浏览器拒绝了下载请求（文件可能过大）' },
  {
    pattern: /Cannot access|Receiving end does not exist|注入失败|content script/i,
    message: '权限不足：无法访问或注入该页面',
  },
  { pattern: /timed?\s?out|超时/i, message: '操作超时，页面可能未加载完整' },
  { pattern: /已取消|用户取消|cancelled/i, message: '已取消截图' },
  { pattern: /chrome:\/\/|about:|edge:\/\//i, message: '受浏览器保护的页面无法截图' },
];

/** 默认兜底文案（空错误串时） */
const FALLBACK = '截图失败';

/**
 * 将原始错误串映射为友好文案；无命中时保留原文（兜底）。
 * @param raw 原始错误串（可能为 null/undefined/空串）
 */
export function friendlyError(raw: string | null | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) return FALLBACK;
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.message;
  }
  return text;
}
