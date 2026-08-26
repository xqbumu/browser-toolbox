/**
 * URL 匹配器（纯逻辑，双端共用）：
 * - MV2 webRequest 路径：match pattern → RegExp，逐请求判断；
 * - popup 侧：对当前页 URL 预判规则命中（与引擎行为保持一致）。
 * 语义与 Chrome match pattern 对齐，另接受 `*` / `<all_urls>` 作为全匹配。
 */
import type { UrlMatchItem, HeaderResourceType,
  HeaderRule,
  HeaderRuleCondition, } from "@/types/headers";

/** 缓存已编译的 pattern → RegExp，避免每请求重复编译 */
const regexpCache = new Map<string, RegExp | null>();

/** match pattern → RegExp；非法 pattern 返回 null */
export function matchPatternToRegExp(pattern: string): RegExp | null {
  const cached = regexpCache.get(pattern);
  if (cached !== undefined) return cached;
  let result: RegExp | null = null;
  if (pattern === "*" || pattern === "<all_urls>") {
    result = /^[\w-]+:\/\/.*/;
  } else {
    const m =
      /^(\*|https?|wss?|ftp|data|file):\/\/(\*(?:\.[^/*]+)?|\*|[^/*]+)?(\/.*)$/.exec(
        pattern,
      );
    if (m) {
      // 正则命中时捕获组 1/3 必然存在，2 可缺省（file/data 无 host）
      const rawScheme = m[1]!;
      const rawHost = m[2] ?? "";
      const rawPath = m[3]!;
      const scheme = rawScheme === "*" ? "[^:]+" : escape(rawScheme);
      // `*.example.com` 匹配任意子域（含多级）；裸 `*` 匹配任意 host
      const host =
        rawHost === "*"
          ? "[^/]+"
          : rawHost.startsWith("*.")
            ? `(\\w[-\\w0-9]*\\.)*${escape(rawHost.slice(2))}`
            : escape(rawHost);
      // 路径中的 * 是通配符（匹配任意字符），其余字符转义
      const pathRe = rawPath
        .split("*")
        .map((seg) => escape(seg))
        .join(".*");
      result = new RegExp(`^${scheme}:\\/\\/${host}${pathRe}$`);
    }
  }
  regexpCache.set(pattern, result);
  return result;
}

function escape(s: string): string {
  return s.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

/** 单条 pattern 是否命中 URL（非法 pattern 恒不命中） */
export function urlMatchesPattern(url: string, pattern: string): boolean {
  const re = matchPatternToRegExp(pattern.trim());
  return re != null && re.test(url);
}

/** 条件整体是否命中（URL + 方法 + 资源类型） */
/** 单条匹配规则是否命中 */
function matchOne(item: UrlMatchItem, url: string): boolean {
  const v = item.value?.trim() ?? "";
  if (!v) return false;
  switch (item.matchType) {
    case "contains":
      return url.includes(v);
    case "regex":
      try {
        return new RegExp(v, "i").test(url);
      } catch {
        return false;
      }
    default:
      return urlMatchesPattern(url, v);
  }
}

/** 条件组任一命中即生效（OR） */
export function conditionMatchesUrl(
  condition: HeaderRuleCondition,
  url: string,
): boolean {
  return (condition.matches ?? []).some((m) => matchOne(m, url));
}

export function conditionMatches(
  condition: HeaderRuleCondition,
  url: string,
  method?: string,
  resourceType?: HeaderResourceType,
): boolean {
  if (!conditionMatchesUrl(condition, url)) return false;
  if (condition.methods?.length && (!method || !condition.methods.includes(method.toUpperCase()))) {
    return false;
  }
  if (
    condition.resourceTypes?.length &&
    resourceType &&
    !condition.resourceTypes.includes(resourceType)
  ) {
    return false;
  }
  return true;
}

/** 规则是否命中请求（enabled 由上层过滤） */
export function ruleMatches(
  rule: HeaderRule,
  url: string,
  method?: string,
  resourceType?: HeaderResourceType,
): boolean {
  return (
    rule.enabled && conditionMatches(rule.condition, url, method, resourceType)
  );
}

/** 过滤出命中 URL 的启用规则（popup「当前页生效」视图） */
export function matchedRules(rules: HeaderRule[], url: string): HeaderRule[] {
  if (!url) return [];
  return rules.filter((r) => ruleMatches(r, url));
}
