/**
 * 规则 → declarativeNetRequest 动态规则转换（纯逻辑）：
 * - 一条 HeaderRule 按作用目标拆成至多 N 条 DNR 规则（modifyHeaders 单动作只支持一个方向）；
 * - URL 条件按匹配方式构造：
 *   · pattern：多模式展开为多条规则；全匹配吞并其余模式，urlFilter 省略 = 匹配全部；
 *   · prefix/suffix：转义并加 ^ / $ 锚点的 RE2 正则（字面匹配）；
 *   · contains：子串转义为等价 RE2 正则；
 *   · regex：RE2 语法，自动前缀 (?i) 与 MV2 路径大小写不敏感对齐（自带 (?…) 旗标时原样透传）。
 * - DNR 的 requestMethods 为小写；resourceTypes 命名与本仓库一致可直接透传。
 * 输出使用结构化最小类型而非 chrome 命名空间，保证 node 测试环境零依赖。
 */
import type { HeaderRule } from "@/types/headers";
import { createLogger } from "@/utils/logger";

const log = createLogger("header-dnr");

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
    excludedRequestDomains?: string[];
    excludedRequestMethods?: string[];
    excludedResourceTypes?: string[];
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
        redirect: {
          url?: string;
          regexSubstitution?: string;
          transform?: {
            queryTransform?: {
              addOrReplaceParams?: { key: string; value: string }[];
              removeParams?: string[];
            };
          };
        };
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
      // contains：子串转义为正则；prefix/suffix：转义并加 ^ / $ 锚点；regex：RE2 表达式。
      // 说明：urlFilter 模式语法无法安全表达字面量（无转义机制），故沿用现有 contains 的正则化路线。
      // 大小写一致性：MV2 路径 regex 一律 new RegExp(v, "i")（不敏感），RE2 regexFilter 默认敏感，
      // 故此处对用户 regex 前缀 (?i) 对齐两端；用户自带 (?…) 旗标开头时按原样（自行控制）。
      const isRegex = m.matchType === "regex";
      const escaped = escapeRe2(v);
      const value =
        m.matchType === "prefix"
          ? `^${escaped}`
          : m.matchType === "suffix"
            ? `${escaped}$`
            : isRegex
              ? /^\(\?/.test(v)
                ? v
                : `(?i)${v}`
              : escaped;
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
    ...(rule.condition.excludeDomains?.length
      ? {
          excludedRequestDomains: rule.condition.excludeDomains
            .map((d) => (d.startsWith("*.", 0) ? d.slice(2) : d.trim()))
            .filter(Boolean),
        }
      : {}),
    ...(rule.condition.excludeMethods?.length
      ? {
          excludedRequestMethods: rule.condition.excludeMethods.map((m) =>
            m.toLowerCase(),
          ),
        }
      : {}),
    ...(rule.condition.excludeResourceTypes?.length
      ? { excludedResourceTypes: [...rule.condition.excludeResourceTypes] }
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
    // DNR 无法表达 URL 负向过滤：含排除正则的规则在 Chrome/Safari 不具备等价能力，
    // 若强行下发会「漏掉排除」而错误改写，故此处整体跳过（Firefox MV2 仍全量生效）。
    if ((rule.condition.excludeRegex ?? []).some((p) => p.trim())) {
      log.warn(
        `规则「${rule.name || rule.id}」含 URL 正则排除，DNR 不支持，已在 Chrome/Safari 跳过`,
      );
      continue;
    }

    const urlConds = buildUrlConditions(rule.condition);
    const kind =
      rule.kind === "cancel" ||
      rule.kind === "redirect" ||
      rule.kind === "query" ||
      rule.kind === "body"
        ? rule.kind
        : "headers";

    // 响应体改写依赖 filterResponseData，仅 Firefox MV2 可用，DNR 直接跳过
    if (kind === "body") {
      log.warn(
        `规则「${rule.name || rule.id}」为响应体改写，DNR 不支持，已在 Chrome/Safari 跳过`,
      );
      continue;
    }

    // 排序权重 → DNR 优先级（同头冲突时后写者生效，与 MV2 行为一致）
    const priority = 1 + (rule.order ?? 0);

    // headers 按方向拆分；cancel/redirect 与方向无关，仅一条/条件
    const headerGroups: {
      key: "req" | "resp";
      actions: typeof rule.actions;
    }[] =
      kind === "headers"
        ? [
            {
              key: "req",
              actions: rule.actions.filter((a) => a.target === "request"),
            },
            {
              key: "resp",
              actions: rule.actions.filter((a) => a.target === "response"),
            },
          ]
        : [];

    if (kind !== "headers") {
      for (const urlCond of urlConds) {
        const condition = buildCondition(rule, urlCond);
        if (kind === "cancel") {
          out.push({
            id: nextId++,
            priority,
            condition,
            action: { type: "block" },
          });
        } else if (kind === "query") {
          // 查询参数改写：DNR 用 redirect.transform.queryTransform
          const addOrReplaceParams = (rule.queryActions ?? [])
            .filter((q) => q.op !== "remove" && (q.value ?? "").trim())
            .map((q) => ({
              key: q.name.trim(),
              value: (q.value ?? "").trim(),
            }));
          const removeParams = (rule.queryActions ?? [])
            .filter((q) => q.op === "remove")
            .map((q) => q.name.trim());
          const transform: {
            queryTransform: {
              addOrReplaceParams?: { key: string; value: string }[];
              removeParams?: string[];
            };
          } = { queryTransform: {} };
          if (addOrReplaceParams.length)
            transform.queryTransform.addOrReplaceParams = addOrReplaceParams;
          if (removeParams.length)
            transform.queryTransform.removeParams = removeParams;
          out.push({
            id: nextId++,
            priority,
            condition,
            action: { type: "redirect", redirect: { transform } },
          });
        } else {
          // regex 模式用 regexSubstitution 引用捕获组；其余为固定目标
          out.push({
            id: nextId++,
            priority,
            condition,
            action: {
              type: "redirect",
              redirect: urlCond.isRegex
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
          priority,
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
