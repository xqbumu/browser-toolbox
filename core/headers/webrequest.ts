/**
 * MV2 阻塞式 webRequest 改写（纯逻辑部分）：
 * 对请求/响应头数组执行 set/remove/append 三种操作，供 background 监听器调用。
 * 与 DNR 行为对齐：set = 替换同名全部头；append = 追加；remove = 删除同名全部头。
 */
import type {
  HeaderAction,
  HeaderResourceType,
  HeaderRule,
} from "@/types/headers";
import {
  conditionMatchesUrl,
  isDomainExcluded,
  isMethodOrTypeExcluded,
  isUrlRegexExcluded,
} from "./match";

export interface HttpHeader {
  name: string;
  value?: string;
}

/** 命中结果：命中的规则 + 该方向应应用的动作（供引擎逐规则上报改写事件） */
export interface RuleTargetHit {
  rule: HeaderRule;
  actions: HeaderAction[];
}

/** 命中谓词（不含 enabled 过滤，由调用方保证） */
function ruleMatchesTarget(
  rule: HeaderRule,
  url: string,
  target: HeaderAction["target"],
  method?: string,
  resourceType?: HeaderResourceType,
): HeaderAction[] {
  if (!conditionMatchesUrl(rule.condition, url)) return [];
  if (isDomainExcluded(rule.condition, url)) return [];
  if (isMethodOrTypeExcluded(rule.condition, method, resourceType)) return [];
  if (isUrlRegexExcluded(rule.condition, url)) return [];

  const methods = rule.condition.methods;
  if (methods?.length) {
    if (!method || !methods.includes(method.toUpperCase())) return [];
  }

  const types = rule.condition.resourceTypes;
  if (types?.length) {
    if (resourceType == null || !types.includes(resourceType)) return [];
  }

  return rule.actions.filter((a) => a.target === target);
}

/**
 * 收集命中请求的目标动作（带规则归属）。
 * 与 DNR 路径对齐采用严格语义：
 * - 方法受限但调用方未传 method → 不应用；
 * - 资源类型受限但类型未知/不匹配 → 不应用（宁可漏改不可错改）。
 */
export function collectRuleHits(
  rules: HeaderRule[],
  url: string,
  target: HeaderAction["target"],
  method?: string,
  resourceType?: HeaderResourceType,
): RuleTargetHit[] {
  const out: RuleTargetHit[] = [];
  for (const rule of rules) {
    // 注意：enabled 过滤已在 listEffectiveRules 完成（含会话覆盖），此处不再判断，
    // 否则会被二次过滤而丢弃「会话临时启用」的禁用规则。
    const actions = ruleMatchesTarget(rule, url, target, method, resourceType);
    if (actions.length > 0) out.push({ rule, actions });
  }
  return out;
}

/**
 * 收集命中请求的动作（扁平，行为与历史版本一致）。
 * 与 DNR 路径对齐采用严格语义：
 * - 方法受限但调用方未传 method → 不应用；
 * - 资源类型受限但类型未知/不匹配 → 不应用（宁可漏改不可错改）。
 */
export function pickActions(
  rules: HeaderRule[],
  url: string,
  target: HeaderAction["target"],
  method?: string,
  resourceType?: HeaderResourceType,
): HeaderAction[] {
  return collectRuleHits(rules, url, target, method, resourceType).flatMap(
    (h) => h.actions,
  );
}

/** 应用一组头部动作到头数组（原地语义的纯实现，返回新数组） */
export function applyHeaderActions(
  headers: HttpHeader[],
  actions: HeaderAction[],
): HttpHeader[] {
  let result = [...headers];
  for (const action of actions) {
    const name = action.name.trim();
    if (!name) continue;
    switch (action.op) {
      case "set": {
        // 移除同名头后追加（保留出现位置语义简单化：追加到尾部）
        result = result.filter(
          (h) => h.name.toLowerCase() !== name.toLowerCase(),
        );
        result.push({ name, value: action.value ?? "" });
        break;
      }
      case "append":
        result.push({ name, value: action.value ?? "" });
        break;
      case "remove":
        result = result.filter(
          (h) => h.name.toLowerCase() !== name.toLowerCase(),
        );
        break;
    }
  }
  return result;
}

/**
 * 按查询参数动作重写 URL 的查询串（MV2 路径）：
 * - add/replace → 设置或覆盖该参数（不存在则追加）；
 * - remove → 删除该参数。
 * 返回改写后的完整 URL；无任何改动时返回原 URL。
 */
export function applyQueryTransform(
  url: string,
  actions: { op: "add" | "replace" | "remove"; name: string; value?: string }[],
): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  let changed = false;
  for (const a of actions) {
    const key = a.name.trim();
    if (!key) continue;
    if (a.op === "remove") {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.delete(key);
        changed = true;
      }
    } else {
      const val = (a.value ?? "").trim();
      if (parsed.searchParams.get(key) !== val) {
        parsed.searchParams.set(key, val);
        changed = true;
      }
    }
  }
  return changed ? parsed.toString() : url;
}
