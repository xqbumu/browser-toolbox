/**
 * 请求头改写引擎：按运行时能力在两条路径间选择，并负责规则的同步应用。
 * - dnr：declarativeNetRequest.updateDynamicRules（Chrome/Safari MV3）；
 * - webrequest：阻塞式 webRequest 监听（Firefox MV2，webRequestBlocking）；
 * - 都不可用（如旧 Safari）：返回 null，UI 展示降级提示。
 * sync() 幂等：DNR 先清理本引擎 id 区间再写入；webRequest 直接替换内存缓存。
 */
import type { HeaderResourceType, HeaderRule } from "@/types/headers";
import { DNR_START_ID, toDnrRules } from "./dnr";
import { applyHeaderActions, pickActions } from "./webrequest";
import { conditionMatchesUrl, isDomainExcluded } from "./match";
import {
  isHeaderMasterEnabled,
  listHeaderRules,
  listGroups,
} from "@/utils/header-rules-store";
import { createLogger } from "@/utils/logger";

const log = createLogger("header-engine");

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
    .filter(
      (r) => r.enabled && (r.groupId == null || !disabledGroups.has(r.groupId)),
    )
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

export async function createHeaderEngine(): Promise<HeaderEngine | null> {
  const kind = detectHeaderEngine();
  if (kind == null) return null;

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
    return {
      kind,
      async sync(): Promise<void> {
        const masterOn = await isHeaderMasterEnabled();
        const rules = masterOn ? await listEffectiveRules() : [];
        const next = toDnrRules(rules);
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
      dispose(): void {},
    };
  }

  // webrequest：内存缓存 + 阻塞监听
  let enabled: HeaderRule[] = [];

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
    const actions = pickActions(
      enabled,
      details.url,
      "request",
      details.method,
      resourceType,
    );
    if (actions.length === 0 || !details.requestHeaders) return undefined;
    return {
      requestHeaders: applyHeaderActions(details.requestHeaders, actions),
    };
  };
  const onHeadersReceived = (details: {
    url: string;
    method?: string;
    type?: string;
    responseHeaders?: { name: string; value?: string }[];
  }): { responseHeaders?: { name: string; value?: string }[] } | undefined => {
    const resourceType =
      details.type && RESOURCE_TYPE_SET.has(details.type)
        ? (details.type as HeaderResourceType)
        : undefined;
    const actions = pickActions(
      enabled,
      details.url,
      "response",
      details.method,
      resourceType,
    );
    if (actions.length === 0 || !details.responseHeaders) return undefined;
    return {
      responseHeaders: applyHeaderActions(details.responseHeaders, actions),
    };
  };

  // cancel / redirect 规则在 onBeforeRequest 阶段处理
  let cancelRules: HeaderRule[] = [];
  let redirectRules: HeaderRule[] = [];
  function resolveBeforeRequest(
    url: string,
  ): { cancel?: boolean; redirectUrl?: string } | undefined {
    for (const rule of cancelRules) {
      if (
        conditionMatchesUrl(rule.condition, url) &&
        !isDomainExcluded(rule.condition, url)
      )
        return { cancel: true };
    }
    for (const rule of redirectRules) {
      const to = (rule.redirectTo ?? "").trim();
      if (!to) continue;
      if (!conditionMatchesUrl(rule.condition, url)) continue;
      if (isDomainExcluded(rule.condition, url)) continue;
      // 正则模式：从 matches 中取首个 regex 条件作为捕获源（与 DNR 一致）
      const regexItem = (rule.condition.matches ?? []).find(
        (m) => (m.matchType ?? "pattern") === "regex",
      );
      if (regexItem?.value) {
        try {
          const re = new RegExp(regexItem.value, "i");
          if (re.test(url)) return { redirectUrl: url.replace(re, to) };
        } catch {
          // 非法正则不处理
        }
      } else {
        // pattern/contains：固定目标（要求绝对地址，校验层已保证）
        return { redirectUrl: to };
      }
    }
    return undefined;
  }

  const onBeforeRequest = (details: {
    url: string;
  }): { cancel?: boolean; redirectUrl?: string } | undefined => {
    return resolveBeforeRequest(details.url);
  };

  const wr = browser.webRequest as unknown as {
    onBeforeRequest: {
      addListener: (
        cb: (details: {
          url: string;
        }) => { cancel?: boolean; redirectUrl?: string } | undefined,
        filter: { urls: string[] },
        extra: string[],
      ) => void;
      removeListener: (
        cb: (details: {
          url: string;
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
      const all = await listEffectiveRules();
      const headersOnly: HeaderRule[] = [];
      enabled = [];
      for (const r of all) {
        if ((r.kind ?? "headers") === "headers") {
          enabled.push(r);
          headersOnly.push(r);
        } else if (r.kind === "cancel") {
          cancelRules.push(r);
        } else if (r.kind === "redirect") {
          redirectRules.push(r);
        }
      }
      log.info(
        `webRequest 缓存：头部 ${enabled.length} · 取消 ${cancelRules.length} · 重定向 ${redirectRules.length}`,
      );
    },
    dispose(): void {
      wr.onBeforeRequest.removeListener(onBeforeRequest);
      wr.onBeforeSendHeaders.removeListener(onBeforeSendHeaders);
      wr.onHeadersReceived.removeListener(onHeadersReceived);
    },
  };
}
