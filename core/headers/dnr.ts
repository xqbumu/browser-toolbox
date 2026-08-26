/**
 * 规则 → declarativeNetRequest 动态规则转换（纯逻辑）：
 * - 一条 HeaderRule 按作用目标拆成至多 N 条 DNR 规则（modifyHeaders 单动作只支持一个方向）；
 * - URL 条件按匹配方式构造：
 *   · pattern：多模式展开为多条规则；全匹配吞并其余模式，urlFilter 省略 = 匹配全部；
 *   · contains：子串转义为等价 RE2 正则；
 *   · regex：表达式原样透传（RE2 语法）。
 * - DNR 的 requestMethods 为小写；resourceTypes 命名与本仓库一致可直接透传。
 * 输出使用结构化最小类型而非 chrome 命名空间，保证 node 测试环境零依赖。
 */
import type { HeaderRule } from "@/types/headers";

export interface DnrHeaderItem {
  header: string;
  operation: "set" | "remove" | "append";
  value?: string;
}

export interface DnrLikeRule {
  id: number;
  priority: number;
  condition: {
    urlFilter?: string;
    regexFilter?: string;
    resourceTypes?: string[];
    requestMethods?: string[];
  };
  action:
    | {
        type: "modifyHeaders";
        requestHeaders?: DnrHeaderItem[];
        responseHeaders?: DnrHeaderItem[];
      }
    | { type: "block" }
    | {
        type: "redirect";
        redirect: { url?: string; regexSubstitution?: string };
      };
}

/** 动态规则 id 起始（避开用户/扩展静态规则区间，DNR 上限内取高位段） */
export const DNR_START_ID = 1_000_000;

/** RE2 字面量转义：把正则元字符转为字面匹配 */
function escapeRe2(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 构造 URL 条件列表：
 * - pattern：去重去空白；含全匹配时吞并其余，返回 [undefined]；
 * - contains：子串 → 转义正则（单条）；
 * - regex：表达式原样（单条）。
 * 返回 [undefined] 表示无条件 = 匹配全部；返回 [] 表示条件为空（不产出规则）。
 */
interface UrlCondition {
  /** 条件值；undefined 表示无条件（匹配全部） */
  value?: string;
  /** true 时写入 regexFilter，否则写入 urlFilter */
  isRegex: boolean;
}

function buildUrlConditions(
  condition: HeaderRule["condition"],
): UrlCondition[] {
  const out: UrlCondition[] = [];
  const seen = new Set<string>();
  let hasAll = false;

  for (const m of condition.matches ?? []) {
    const v = m.value?.trim();
    if (!v) continue;
    if ((m.matchType ?? "pattern") === "pattern") {
      if (v === "*" || v === "<all_urls>" || v === "*://*/*") {
        hasAll = true; // 全匹配吞并其余条件
        continue;
      }
      const key = `p:${v}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ value: v, isRegex: false });
      }
    } else {
      const isRegex = m.matchType === "regex";
      const value = isRegex ? v : escapeRe2(v);
      const key = `${m.matchType}:${value}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ value, isRegex: true });
      }
    }
  }

  if (hasAll) return [{ value: undefined, isRegex: false }];
  return out;
}

/** 单个 URL 条件 + 方法/资源过滤 → DNR condition */
function buildCondition(
  rule: HeaderRule,
  urlCond: { value?: string; isRegex: boolean },
): DnrLikeRule["condition"] {
  return {
    ...(urlCond.value == null
      ? {}
      : urlCond.isRegex
        ? { regexFilter: urlCond.value }
        : { urlFilter: urlCond.value }),
    ...(rule.condition.resourceTypes?.length
      ? { resourceTypes: [...rule.condition.resourceTypes] }
      : {}),
    ...(rule.condition.methods?.length
      ? { requestMethods: rule.condition.methods.map((m) => m.toLowerCase()) }
      : {}),
  };
}

function toDnrHeaders(
  actions: { op: "set" | "remove" | "append"; name: string; value?: string }[],
): DnrHeaderItem[] {
  return actions.map((a) => ({
    header: a.name.trim(),
    operation: a.op,
    ...(a.op === "remove" ? {} : { value: a.value ?? "" }),
  }));
}

/**
 * 启用规则 → DNR 动态规则列表。
 * 同一条规则的 request/response 动作各合并为一个方向，
 * 再乘以 URL 条件条数（pattern 多模式 / contains / regex 各一条），id 连续分配。
 */
export function toDnrRules(
  rules: HeaderRule[],
  startId = DNR_START_ID,
): DnrLikeRule[] {
  const out: DnrLikeRule[] = [];
  let nextId = startId;
  for (const rule of rules) {
    if (!rule.enabled) continue;

    const urlConds = buildUrlConditions(rule.condition);
    const isRegex = (rule.condition.matchType ?? "pattern") === "regex";
    const kind =
      rule.kind === "cancel" || rule.kind === "redirect"
        ? rule.kind
        : "headers";

    // headers 按方向拆分；cancel/redirect 与方向无关，仅一条/条件
    const headerGroups: {
      key: "req" | "resp";
      actions: typeof rule.actions;
    }[] =
      kind === "headers"
        ? [
            { key: "req", actions: rule.actions.filter((a) => a.target === "request") },
            { key: "resp", actions: rule.actions.filter((a) => a.target === "response") },
          ]
        : [];

    if (kind !== "headers") {
      for (const urlCond of urlConds) {
        const condition = buildCondition(rule, urlCond);
        if (kind === "cancel") {
          out.push({
            id: nextId++,
            priority: 1,
            condition,
            action: { type: "block" },
          });
        } else {
          // regex 模式用 regexSubstitution 引用捕获组；其余为固定目标
          out.push({
            id: nextId++,
            priority: 1,
            condition,
            action: {
              type: "redirect",
              redirect: isRegex
                ? { regexSubstitution: rule.redirectTo ?? "" }
                : { url: rule.redirectTo ?? "" },
            },
          });
        }
      }
      continue;
    }

    for (const group of headerGroups) {
      if (group.actions.length === 0) continue;
      for (const urlCond of urlConds) {
        out.push({
          id: nextId++,
          priority: 1,
          condition: buildCondition(rule, urlCond),
          action: {
            type: "modifyHeaders",
            ...(group.key === "req"
              ? { requestHeaders: toDnrHeaders(group.actions) }
              : { responseHeaders: toDnrHeaders(group.actions) }),
          },
        });
      }
    }
  }
  return out;
}
