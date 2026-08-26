/**
 * 规则 → declarativeNetRequest 动态规则转换（纯逻辑）：
 * - 一条 HeaderRule 按作用目标拆成至多两条 DNR 规则（modifyHeaders 单动作只支持一个方向）；
 * - 全匹配（单独星号、all_urls、全通配 scheme-host-path）时省略 urlFilter，让条件为空 = 匹配全部；
 * - DNR 的 requestMethods 为小写；resourceTypes 命名与本仓库一致可直接透传。
 * 输出使用结构化最小类型而非 chrome 命名空间，保证 node 测试环境零依赖。
 */
import type { HeaderAction, HeaderOp, HeaderRule } from "@/types/headers";

export interface DnrHeaderItem {
  header: string;
  operation: HeaderOp;
  value?: string;
}

export interface DnrLikeRule {
  id: number;
  priority: number;
  condition: {
    urlFilter?: string;
    resourceTypes?: string[];
    requestMethods?: string[];
  };
  action: {
    type: "modifyHeaders";
    requestHeaders?: DnrHeaderItem[];
    responseHeaders?: DnrHeaderItem[];
  };
}

/** 动态规则 id 起始（避开用户/扩展静态规则区间，DNR 上限内取高位段） */
export const DNR_START_ID = 1_000_000;

function toDnrHeaders(actions: HeaderAction[]): DnrHeaderItem[] {
  return actions.map((a) => ({
    header: a.name.trim(),
    operation: a.op,
    ...(a.op === "remove" ? {} : { value: a.value ?? "" }),
  }));
}

/**
 * 启用规则 → DNR 动态规则列表。
 * 同一条规则的 request/response 动作合并为对应方向的 headers 数组，
 * 因此最多产生两条 DNR 规则（id 连续分配）。
 */
export function toDnrRules(
  rules: HeaderRule[],
  startId = DNR_START_ID,
): DnrLikeRule[] {
  const out: DnrLikeRule[] = [];
  let nextId = startId;
  for (const rule of rules) {
    if (!rule.enabled) continue;

    // 多模式展开：DNR 单条件只支持一个 urlFilter。
    // 任一全匹配模式存在时其余模式被吞并，仅生成一条无条件规则。
    const filters = normalizePatterns(rule.condition.urlFilters);
    const perFilter: (string | undefined)[] = filters.includes(undefined)
      ? [undefined]
      : (filters as (string | undefined)[]);

    const requestActions = rule.actions.filter((a) => a.target === "request");
    const responseActions = rule.actions.filter((a) => a.target === "response");
    for (const actions of [requestActions, responseActions]) {
      if (actions.length === 0) continue;
      for (const urlFilter of perFilter) {
        out.push({
          id: nextId,
          priority: 1,
          condition: {
            ...(urlFilter ? { urlFilter } : {}),
            ...(rule.condition.resourceTypes?.length
              ? { resourceTypes: [...rule.condition.resourceTypes] }
              : {}),
            ...(rule.condition.methods?.length
              ? {
                  requestMethods: rule.condition.methods.map((m) =>
                    m.toLowerCase(),
                  ),
                }
              : {}),
          },
          action: {
            type: "modifyHeaders",
            ...(actions[0]!.target === "request"
              ? { requestHeaders: toDnrHeaders(actions) }
              : { responseHeaders: toDnrHeaders(actions) }),
          },
        });
        nextId += 1;
      }
    }
  }
  return out;
}

/** 去重/去空白；含全匹配时返回 [undefined]（= 无 urlFilter，匹配全部） */
function normalizePatterns(patterns: string[]): (string | undefined)[] {
  const seen = new Set<string>();
  let hasAll = false;
  for (const raw of patterns ?? []) {
    const f = raw.trim();
    if (!f) continue;
    if (f === "*" || f === "<all_urls>" || f === "*://*/*") {
      hasAll = true;
      continue;
    }
    seen.add(f);
  }
  if (hasAll) return [undefined];
  return [...seen];
}
