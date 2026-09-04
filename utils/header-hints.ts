/**
 * 头部名称候选（Header Editor 编辑器的自动完成数据源）：
 * - 内置常用头部名（请求 / 响应两组，RFC 常用 + 业务惯例 X-* 头）；
 * - 已录入名自动纳入：从存量规则的动作（含导入数据）收集去重，随规则集变化自动更新，
 *   无需独立持久化（规则本身就是「已录入」的权威来源）。
 */
import type { HeaderRule, HeaderTarget } from "@/types/headers";

/** 常用请求头（候选顺序即展示优先级） */
export const COMMON_REQUEST_HEADERS: readonly string[] = [
  "Accept",
  "Accept-Encoding",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Content-Length",
  "Content-Type",
  "Cookie",
  "Origin",
  "Pragma",
  "Range",
  "Referer",
  "User-Agent",
  "X-Requested-With",
  "X-CSRF-Token",
  "X-Token",
  "X-Access-Token",
  "X-Auth-Token",
  "X-Api-Key",
  "X-API-Key",
  "X-Forwarded-For",
  "X-Forwarded-Proto",
  "X-Real-IP",
  "X-Request-Id",
  "X-Trace-Id",
  "X-Client-Version",
  "X-Device-Id",
  "Sec-Fetch-Site",
  "Sec-Fetch-Mode",
  "Sec-Fetch-Dest",
  "Sec-CH-UA",
  "Upgrade-Insecure-Requests",
  "DNT",
  "TE",
];

/** 常用响应头 */
export const COMMON_RESPONSE_HEADERS: readonly string[] = [
  "Access-Control-Allow-Origin",
  "Access-Control-Allow-Credentials",
  "Access-Control-Allow-Headers",
  "Access-Control-Allow-Methods",
  "Access-Control-Expose-Headers",
  "Access-Control-Max-Age",
  "Cache-Control",
  "Content-Disposition",
  "Content-Encoding",
  "Content-Length",
  "Content-Security-Policy",
  "Content-Type",
  "Date",
  "ETag",
  "Expires",
  "Last-Modified",
  "Location",
  "Pragma",
  "Referrer-Policy",
  "Refresh",
  "Retry-After",
  "Server",
  "Set-Cookie",
  "Strict-Transport-Security",
  "Vary",
  "WWW-Authenticate",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "X-Powered-By",
  "X-Request-Id",
  "X-XSS-Protection",
];

/** 从规则集中收集「已录入」的头部名（大小写不敏感去重，保首现顺序） */
export function collectLearnedHeaderNames(rules: HeaderRule[]): string[] {
  const seen = new Map<string, string>();
  for (const rule of rules) {
    for (const action of rule.actions ?? []) {
      const name = action.name?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.values()];
}

/** 供编辑器按目标方向合并「内置 + 已录入」的候选（内置优先，大小写不敏感去重） */
export function headerNameOptions(
  rules: HeaderRule[],
  target: HeaderTarget,
): string[] {
  const learned = collectLearnedHeaderNames(rules);
  const builtin =
    target === "response" ? COMMON_RESPONSE_HEADERS : COMMON_REQUEST_HEADERS;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...builtin, ...learned]) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
