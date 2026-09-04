/**
 * 请求头改写引擎：按运行时能力在两条路径间选择，并负责规则的同步应用。
 * - dnr：declarativeNetRequest.updateDynamicRules（Chrome/Safari MV3）；
 * - webrequest：阻塞式 webRequest 监听（Firefox MV2，webRequestBlocking）；
 * - 都不可用（如旧 Safari）：返回 null，UI 展示降级提示。
 * sync() 幂等：DNR 先清理本引擎 id 区间再写入；webRequest 直接替换内存缓存。
 */
import type { HeaderResourceType, HeaderRule } from "@/types/headers";
import type { HeaderRewriteHit } from "@/types/header-log";
import { DNR_START_ID, toDnrRules } from "./dnr";
import {
  applyHeaderActions,
  applyQueryTransform,
  collectRuleHits,
  type RuleTargetHit,
} from "./webrequest";
import { rewriteResponse } from "./body";
import {
  conditionMatchesUrl,
  isDomainExcluded,
  isMethodOrTypeExcluded,
  isUrlRegexExcluded,
} from "./match";
import {
  isHeaderMasterEnabled,
  listHeaderRules,
  listGroups,
} from "@/utils/header-rules-store";
import { createLogger } from "@/utils/logger";

const log = createLogger("header-engine");

/**
 * 会话级临时覆盖：强制某条规则在本浏览器会话内启用/停用，不写入持久化存储。
 *
 * 运行期以内存 Map 为唯一真相；同时镜像到 browser.storage.session（仅 MV3 可用），
 * 因此 MV3 下 Service Worker 被回收再唤醒时能通过 loadSessionOverrides 恢复，
 * 避免「覆盖静默丢失」。storage.session 在扩展重启时自动清空，契合「重启即清」语义；
 * Firefox MV2 无 storage.session，后台页常驻故内存 Map 本身即可持久，无需镜像。
 */
const sessionOverrides = new Map<string, boolean>();
const SESSION_STORE_KEY = "headerSessionOverrides";

async function persistSessionOverrides(): Promise<void> {
  const s = browser.storage?.session;
  if (!s) return;
  try {
    await s.set({ [SESSION_STORE_KEY]: Object.fromEntries(sessionOverrides) });
  } catch {
    // Firefox MV2 等无 storage.session 时忽略
  }
}

async function loadSessionOverrides(): Promise<void> {
  const s = browser.storage?.session;
  if (!s) return;
  try {
    const res = await s.get(SESSION_STORE_KEY);
    const data = (res?.[SESSION_STORE_KEY] as Record<string, boolean>) ?? {};
    for (const [k, v] of Object.entries(data)) sessionOverrides.set(k, v);
  } catch {
    // 忽略
  }
}

export function setSessionOverride(
  ruleId: string,
  enabled: boolean | null,
): void {
  if (enabled === null) sessionOverrides.delete(ruleId);
  else sessionOverrides.set(ruleId, enabled);
  log.info(`会话覆盖：${ruleId} -> ${enabled === null ? "清除" : enabled}`);
  void persistSessionOverrides();
}

export function getSessionOverrides(): Record<string, boolean> {
  return Object.fromEntries(sessionOverrides);
}

export function clearSessionOverrides(): void {
  sessionOverrides.clear();
  void persistSessionOverrides();
}

/** 筛选实际生效的规则：rule.enabled 且所属分组未停用（无 groupId 视为始终启用） */
async function listEffectiveRules(): Promise<HeaderRule[]> {
  const [allRules, groups] = await Promise.all([
    listHeaderRules(),
    listGroups(),
  ]);
  const disabledGroups = new Set(
    groups.filter((g) => !g.enabled).map((g) => g.id),
  );
  return allRules
    .filter((r) => {
      const effective = sessionOverrides.has(r.id)
        ? sessionOverrides.get(r.id)
        : r.enabled;
      return effective && (r.groupId == null || !disabledGroups.has(r.groupId));
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export type HeaderEngineKind = "dnr" | "webrequest" | null;

/** 运行时能力探测（可在 background/popup 双端调用） */
export function detectHeaderEngine(): HeaderEngineKind {
  const dnr = (browser as unknown as Record<string, never>)[
    "declarativeNetRequest"
  ] as { updateDynamicRules?: unknown } | undefined;
  if (dnr && typeof dnr.updateDynamicRules === "function") return "dnr";
  const wr = browser.webRequest as
    { onBeforeSendHeaders?: { addListener?: unknown } } | undefined;
  if (
    wr?.onBeforeSendHeaders &&
    typeof wr.onBeforeSendHeaders.addListener === "function"
  ) {
    return "webrequest";
  }
  return null;
}

export interface HeaderEngine {
  kind: Exclude<HeaderEngineKind, null>;
  /** 用存储中的最新启用规则重建拦截（幂等） */
  sync(): Promise<void>;
  dispose(): void;
}

/**
 * 改写成功回调负载即 HeaderRewriteHit（无 id/ts，由日志层补齐）。
 * 上报语义按引擎路径区分（详见 createHeaderEngine 注释）。
 */
export interface HeaderEngineOptions {
  onRewrite?: (hit: HeaderRewriteHit) => void;
}

/** DNR 引擎能实际应用的规则子集（仅 headers 动作 + 无 URL 正则排除，与 toDnrRules 跳过逻辑一致） */
function dnrApplicableHeaders(rules: HeaderRule[]): HeaderRule[] {
  return rules.filter(
    (r) =>
      (r.kind ?? "headers") === "headers" &&
      !(r.condition.excludeRegex ?? []).some((p) => p.trim()),
  );
}

async function loadGroupNames(): Promise<Map<string, string>> {
  const groups = await listGroups().catch(() => []);
  return new Map(groups.map((g) => [g.id, g.name]));
}

/**
 * 正则重定向替换串语法桥：DNR(regexSubstitution) 用 RE2 语法（\1 引用捕获组、\$ 转义），
 * 而 MV2 走 String.replace 需 $1 语法。本函数把 RE2/DNR 风格翻译为 JS 风格，
 * 使同一 redirectTo 在两端行为一致（规范以 DNR/RE2 为准）。
 */
function toJsReplacement(replacement: string): string {
  return replacement.replace(/\\(0|[1-9]|\$|\\)/g, (m, p: string) => {
    if (p === "0") return "$&"; // \0 = 整段匹配（JS 用 $&）
    if (p === "$") return "$"; // \$ → 字面 $（JS 中 $ 非特殊组合即字面）
    if (p === "\\") return "\\"; // \\ → 字面反斜杠
    return `$${p}`; // \1..\9 → $1..$9
  });
}

export async function createHeaderEngine(
  options: HeaderEngineOptions = {},
): Promise<HeaderEngine | null> {
  const { onRewrite } = options;
  // 恢复 MV3 下跨 Service Worker 重启的会话覆盖（Firefox MV2 无 storage.session 时为空操作）
  await loadSessionOverrides();
  const kind = detectHeaderEngine();
  if (kind == null) return null;

  /** 逐命中规则上报一次「改写成功」事件（无回调时为 no-op） */
  function reportHits(
    hits: RuleTargetHit[],
    url: string,
    method: string | undefined,
    target: HeaderRewriteHit["target"],
    groupNames: Map<string, string>,
  ): void {
    if (!onRewrite || hits.length === 0) return;
    for (const { rule, actions } of hits) {
      try {
        onRewrite({
          ruleId: rule.id,
          ruleName: rule.name?.trim() || rule.id,
          groupId: rule.groupId,
          groupName:
            rule.groupId != null ? groupNames.get(rule.groupId) : undefined,
          target,
          url,
          method,
          actionCount: actions.length,
        });
      } catch (e) {
        // 上报回调（日志落盘）失败绝不影响阻塞式请求改写
        log.warn("改写上报回调异常（已忽略，不影响请求）", e);
      }
    }
  }

  if (kind === "dnr") {
    const dnr = (
      browser as unknown as {
        declarativeNetRequest: {
          updateDynamicRules: (options: {
            removeRuleIds?: number[];
            addRules?: unknown[];
          }) => Promise<void>;
          getDynamicRules: (cb: (rules: { id: number }[]) => void) => void;
        };
      }
    ).declarativeNetRequest;

    // MV3 声明式规则在浏览器内部评估，无运行期回调；改写成功日志依赖只读 webRequest 观测
    // 命中判定（命中即由 DNR 应用，口径与声明式行为一致）。Chrome 支持；Safari 无 webRequest
    // → 不附加监听、不产生日志（UI 侧按能力提示）。
    type ObsDetail = { url: string; method?: string; type?: string };
    type ObsEvent = {
      addListener: (
        cb: (d: ObsDetail) => void,
        filter: { urls: string[] },
        extra: string[],
      ) => void;
      removeListener: (cb: (d: ObsDetail) => void) => void;
    };
    const obsWebRequest =
      onRewrite !== undefined
        ? ((browser as unknown as { webRequest?: unknown }).webRequest as
            | { onBeforeSendHeaders?: ObsEvent; onHeadersReceived?: ObsEvent }
            | undefined)
        : undefined;
    const obsCleanups: Array<{
      event: ObsEvent;
      cb: (d: ObsDetail) => void;
    }> = [];
    // 观测用的生效规则快照（headers 动作、无 DNR 无法表达的排除项），随 sync 更新
    let effectiveForLog: HeaderRule[] = [];
    let groupNames = new Map<string, string>();

    function attachObserver(
      event: ObsEvent | undefined,
      target: HeaderRewriteHit["target"],
    ): void {
      if (!event?.addListener) return;
      const cb = (details: ObsDetail): void => {
        const resourceType = details.type as HeaderResourceType | undefined;
        const hits = collectRuleHits(
          effectiveForLog,
          details.url,
          target,
          details.method,
          resourceType,
        );
        if (hits.length > 0) {
          reportHits(hits, details.url, details.method, target, groupNames);
        }
      };
      event.addListener(cb, { urls: ["<all_urls>"] }, []);
      obsCleanups.push({ event, cb });
    }
    attachObserver(obsWebRequest?.onBeforeSendHeaders, "request");
    attachObserver(obsWebRequest?.onHeadersReceived, "response");

    return {
      kind,
      async sync(): Promise<void> {
        const masterOn = await isHeaderMasterEnabled();
        const rules = masterOn ? await listEffectiveRules() : [];
        const next = toDnrRules(rules);
        // 仅观测 DNR 实际下发的 headers 规则（含 groupName 快照，供日志归属展示）
        effectiveForLog = dnrApplicableHeaders(rules);
        groupNames = await loadGroupNames();
        // 仅清理本引擎 id 区间内的动态规则，避免误删其他来源
        const existing = await new Promise<{ id: number }[]>((resolve) =>
          dnr.getDynamicRules((all) =>
            resolve(all.filter((r) => r.id >= DNR_START_ID)),
          ),
        );
        await dnr.updateDynamicRules({
          removeRuleIds: existing.map((r) => r.id),
          addRules: next,
        });
        log.info(`DNR 引擎已同步 ${next.length} 条动态规则`);
      },
      dispose(): void {
        for (const { event, cb } of obsCleanups) {
          try {
            event.removeListener(cb);
          } catch {
            // 监听可能已被整体卸载，忽略
          }
        }
        obsCleanups.length = 0;
      },
    };
  }

  // webrequest：内存缓存 + 阻塞监听
  let enabled: HeaderRule[] = [];
  let bodyRules: HeaderRule[] = [];
  let groupNames = new Map<string, string>();

  // webRequest 的 type 字符串与本仓库 HeaderResourceType 命名一致，未知类型保守返回 undefined
  const RESOURCE_TYPE_SET: ReadonlySet<string> = new Set([
    "main_frame",
    "sub_frame",
    "stylesheet",
    "script",
    "image",
    "font",
    "object",
    "xmlhttprequest",
    "ping",
    "media",
    "websocket",
    "other",
  ]);

  const onBeforeSendHeaders = (details: {
    url: string;
    method?: string;
    type?: string;
    requestHeaders?: { name: string; value?: string }[];
  }): { requestHeaders?: { name: string; value?: string }[] } | undefined => {
    const resourceType =
      details.type && RESOURCE_TYPE_SET.has(details.type)
        ? (details.type as HeaderResourceType)
        : undefined;
    const hits = collectRuleHits(
      enabled,
      details.url,
      "request",
      details.method,
      resourceType,
    );
    if (hits.length === 0 || !details.requestHeaders) return undefined;
    reportHits(hits, details.url, details.method, "request", groupNames);
    return {
      requestHeaders: applyHeaderActions(
        details.requestHeaders,
        hits.flatMap((h) => h.actions),
      ),
    };
  };
  const onHeadersReceived = (details: {
    requestId: string;
    url: string;
    method?: string;
    type?: string;
    responseHeaders?: { name: string; value?: string }[];
  }): { responseHeaders?: { name: string; value?: string }[] } | undefined => {
    const resourceType =
      details.type && RESOURCE_TYPE_SET.has(details.type)
        ? (details.type as HeaderResourceType)
        : undefined;
    const hits = collectRuleHits(
      enabled,
      details.url,
      "response",
      details.method,
      resourceType,
    );
    maybeRewriteBody(details, resourceType);
    if (hits.length === 0 || !details.responseHeaders) return undefined;
    reportHits(hits, details.url, details.method, "response", groupNames);
    return {
      responseHeaders: applyHeaderActions(
        details.responseHeaders,
        hits.flatMap((h) => h.actions),
      ),
    };
  };

  // 响应体改写：仅 Firefox MV2 的 filterResponseData 可用。命中文本型响应时按规则重写。
  const maybeRewriteBody = (
    details: {
      requestId: string;
      url: string;
      method?: string;
      responseHeaders?: { name: string; value?: string }[];
    },
    resourceType: HeaderResourceType | undefined,
  ): void => {
    const matched = bodyRules.filter(
      (r) =>
        conditionMatchesUrl(r.condition, details.url) &&
        !isDomainExcluded(r.condition, details.url) &&
        !isMethodOrTypeExcluded(r.condition, details.method, resourceType) &&
        !isUrlRegexExcluded(r.condition, details.url),
    );
    const actions = matched.flatMap((r) => r.bodyActions ?? []);
    if (actions.length === 0) return;
    const frApi = (
      browser.webRequest as unknown as {
        filterResponseData?: (id: string) => import("./body").FilterSink;
      }
    ).filterResponseData;
    const fr = frApi?.(details.requestId);
    if (!fr) return;
    const contentType = (details.responseHeaders ?? []).find(
      (h) => h.name.toLowerCase() === "content-type",
    )?.value;
    rewriteResponse(fr, contentType, actions);
  };

  // cancel / redirect / query 规则在 onBeforeRequest 阶段处理
  let cancelRules: HeaderRule[] = [];
  let redirectRules: HeaderRule[] = [];
  let queryRules: HeaderRule[] = [];  function resolveBeforeRequest(
    url: string,
    method?: string,
    resourceType?: HeaderResourceType,
  ): { cancel?: boolean; redirectUrl?: string } | undefined {
    for (const rule of cancelRules) {
      if (isUrlRegexExcluded(rule.condition, url)) continue;
      if (
        conditionMatchesUrl(rule.condition, url) &&
        !isDomainExcluded(rule.condition, url) &&
        !isMethodOrTypeExcluded(rule.condition, method, resourceType)
      )
        return { cancel: true };
    }
    for (const rule of redirectRules) {
      if (isUrlRegexExcluded(rule.condition, url)) continue;
      const to = (rule.redirectTo ?? "").trim();
      if (!to) continue;
      if (!conditionMatchesUrl(rule.condition, url)) continue;
      if (isDomainExcluded(rule.condition, url)) continue;
      if (isMethodOrTypeExcluded(rule.condition, method, resourceType))
        continue;
      // 正则模式：从 matches 中取首个 regex 条件作为捕获源（与 DNR 一致）
      const regexItem = (rule.condition.matches ?? []).find(
        (m) => (m.matchType ?? "pattern") === "regex",
      );
      if (regexItem?.value) {
        try {
          const re = new RegExp(regexItem.value, "i");
          if (re.test(url)) {
            return { redirectUrl: url.replace(re, toJsReplacement(to)) };
          }
        } catch {
          // 非法正则不处理
        }
      } else {
        // pattern/contains：固定目标（要求绝对地址，校验层已保证）
        return { redirectUrl: to };
      }
    }
    for (const rule of queryRules) {
      if (isUrlRegexExcluded(rule.condition, url)) continue;
      if (!conditionMatchesUrl(rule.condition, url)) continue;
      if (isDomainExcluded(rule.condition, url)) continue;
      if (isMethodOrTypeExcluded(rule.condition, method, resourceType))
        continue;
      const actions = rule.queryActions ?? [];
      if (actions.length === 0) continue;
      const newUrl = applyQueryTransform(url, actions);
      if (newUrl !== url) return { redirectUrl: newUrl };
    }
    return undefined;
  }

  const onBeforeRequest = (details: {
    url: string;
    method?: string;
    type?: string;
  }): { cancel?: boolean; redirectUrl?: string } | undefined => {
    const rt = details.type as HeaderResourceType | undefined;
    return resolveBeforeRequest(details.url, details.method, rt);
  };

  const wr = browser.webRequest as unknown as {
    onBeforeRequest: {
      addListener: (
        cb: (details: {
          url: string;
          method?: string;
          type?: string;
        }) => { cancel?: boolean; redirectUrl?: string } | undefined,
        filter: { urls: string[] },
        extra: string[],
      ) => void;
      removeListener: (
        cb: (details: {
          url: string;
          method?: string;
          type?: string;
        }) => { cancel?: boolean; redirectUrl?: string } | undefined,
      ) => void;
    };
    onBeforeSendHeaders: {
      addListener: (
        cb: typeof onBeforeSendHeaders,
        filter: { urls: string[] },
        extra: string[],
      ) => void;
      removeListener: (cb: typeof onBeforeSendHeaders) => void;
    };
    onHeadersReceived: {
      addListener: (
        cb: typeof onHeadersReceived,
        filter: { urls: string[] },
        extra: string[],
      ) => void;
      removeListener: (cb: typeof onHeadersReceived) => void;
    };
  };
  wr.onBeforeRequest.addListener(onBeforeRequest, { urls: ["<all_urls>"] }, [
    "blocking",
  ]);
  wr.onBeforeSendHeaders.addListener(
    onBeforeSendHeaders,
    { urls: ["<all_urls>"] },
    ["blocking", "requestHeaders"],
  );
  wr.onHeadersReceived.addListener(
    onHeadersReceived,
    { urls: ["<all_urls>"] },
    ["blocking", "responseHeaders"],
  );

  return {
    kind,
    async sync(): Promise<void> {
      groupNames = await loadGroupNames();
      const all = await listEffectiveRules();
      // 全量重建内存缓存：四个动作分类数组都必须先清空，否则删除/修改规则后
      // 旧条目残留（cancel/redirect/query 曾被遗漏重置，导致删规则不生效）。
      enabled = [];
      bodyRules = [];
      cancelRules = [];
      redirectRules = [];
      queryRules = [];
      for (const r of all) {
        if ((r.kind ?? "headers") === "headers") {
          enabled.push(r);
        } else if (r.kind === "cancel") {
          cancelRules.push(r);
        } else if (r.kind === "redirect") {
          redirectRules.push(r);
        } else if (r.kind === "query") {
          queryRules.push(r);
        } else if (r.kind === "body") {
          bodyRules.push(r);
        }
      }
      log.info(
        `webRequest 缓存：头部 ${enabled.length} · 取消 ${cancelRules.length} · 重定向 ${redirectRules.length} · 查询 ${queryRules.length} · 响应体 ${bodyRules.length}`,
      );
    },
    dispose(): void {
      wr.onBeforeRequest.removeListener(onBeforeRequest);
      wr.onBeforeSendHeaders.removeListener(onBeforeSendHeaders);
      wr.onHeadersReceived.removeListener(onHeadersReceived);
    },
  };
}
