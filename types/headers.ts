/**
 * 请求头改写（Header Editor）规则模型：工具箱第二个工具的领域类型。
 * 设计取向参考 HeaderEditor 但做了裁剪：
 * - 扁平规则列表（不做分组），条件收敛为「URL 匹配模式 + 资源类型 + 方法」；
 * - 动作统一为 target(request/response) × op(set/remove/append) × name/value，
 *   该模型可无损映射到 Chrome/Safari 的 declarativeNetRequest.modifyHeaders，
 *   也可映射到 Firefox MV2 的阻塞式 webRequest 改写。
 */

/** 头部作用目标 */
export type HeaderTarget = "request" | "response";

/** 头部操作：覆盖 / 删除 / 追加 */
export type HeaderOp = "set" | "remove" | "append";

/** 资源类型（对齐 DNR 命名，webRequest 侧做映射） */
export type HeaderResourceType =
  | "main_frame"
  | "sub_frame"
  | "stylesheet"
  | "script"
  | "image"
  | "font"
  | "object"
  | "xmlhttprequest"
  | "ping"
  | "media"
  | "websocket"
  | "other";

/** 单条头部动作 */
export interface HeaderAction {
  target: HeaderTarget;
  op: HeaderOp;
  /** 头部名称（RFC 7230 token） */
  name: string;
  /** 头部值；op=remove 时可省略 */
  value?: string;
}

/** URL 匹配方式 */
export type UrlMatchType = "pattern" | "contains" | "regex";

/** 单条 URL 匹配规则（组内成员） */
export interface UrlMatchItem {
  matchType: UrlMatchType;
  /** pattern=match pattern；contains=包含子串；regex=正则表达式 */
  value: string;
}

/** 匹配条件 */
export interface HeaderRuleCondition {
  /**
   * URL 匹配条件组（任一命中即生效）。
   * 兼容历史形态（urlFilter 单值 / urlFilters 数组 / matchType+urlValue），读取时自动迁移。
   */
  matches: UrlMatchItem[];
  /** 兼容历史字段：旧 matchType+urlValue 单值形态迁移用 */
  matchType?: UrlMatchType;
  urlValue?: string;
  /** 资源类型白名单；缺省 = 全部 */
  resourceTypes?: HeaderResourceType[];
  /** HTTP 方法白名单（大写）；缺省 = 全部 */
  methods?: string[];
}

/** 规则动作类型：改写头部 / 阻止请求 / 重定向 */
export type RuleKind = "headers" | "cancel" | "redirect";

/** 请求头规则（扁平、可独立启停） */
export interface HeaderRule {
  id: string;
  name: string;
  enabled: boolean;
  /** 动作类型；缺省视为 headers（兼容存量数据） */
  kind?: RuleKind;
  /** kind=redirect：目标地址。正则匹配模式支持 $1~$9 引用捕获组 */
  redirectTo?: string;
  /** 备注（可选，列表 tooltip 与编辑器展示） */
  comment?: string;
  condition: HeaderRuleCondition;
  actions: HeaderAction[];
  createdAt: number;
  updatedAt: number;
}

/** 创建一条空白规则（供编辑器新建） */
export function newHeaderRule(now = Date.now()): HeaderRule {
  return {
    id: "",
    name: "",
    enabled: true,
    condition: { matches: [{ matchType: "pattern", value: "*://*/*" }] },
    actions: [{ target: "request", op: "set", name: "", value: "" }],
    createdAt: now,
    updatedAt: now,
  };
}

/** RFC 7230 token 字符集（头名合法性） */
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** 校验规则，返回错误信息列表（空数组 = 合法）。对外部输入（导入 JSON）安全 */
export function validateHeaderRule(rule: HeaderRule): string[] {
  const errors: string[] = [];
  if (rule == null || typeof rule !== "object") return ["规则不是有效对象"];
  if (!rule.name || typeof rule.name !== "string" || !rule.name.trim()) {
    errors.push("规则名称不能为空");
  }
  const condition = rule.condition as
    | (HeaderRuleCondition & { urlFilter?: unknown; urlValue?: unknown })
    | undefined;
  const matchType: UrlMatchType =
    condition?.matchType === "contains" || condition?.matchType === "regex"
      ? condition.matchType
      : "pattern";

  const matches = Array.isArray(condition?.matches)
    ? (condition!.matches as UrlMatchItem[])
    : [];
  if (matches.length === 0) {
    errors.push("至少需要一条 URL 匹配条件");
  }
  matches.forEach((m, i) => {
    const label = `第 ${i + 1} 条匹配条件`;
    if (m == null || typeof m !== "object") {
      errors.push(`${label}：不是有效对象`);
      return;
    }
    const v = typeof m.value === "string" ? m.value.trim() : "";
    if (!v) {
      errors.push(`${label}：匹配值不能为空`);
      return;
    }
    if ((m.matchType ?? "pattern") === "pattern") {
      if (
        v !== "*" &&
        v !== "<all_urls>" &&
        v !== "*://*/*" &&
        !isValidMatchPattern(v)
      ) {
        errors.push(`${label}：match pattern 不合法（${v}）`);
      }
    } else if (m.matchType === "regex") {
      try {
        // eslint-disable-next-line no-new
        new RegExp(v);
      } catch {
        errors.push(`${label}：正则表达式不合法（${v}）`);
      }
    }
  });

  const actions = Array.isArray(rule.actions) ? rule.actions : [];
  const kind: RuleKind =
    rule.kind === "cancel" || rule.kind === "redirect" ? rule.kind : "headers";

  if (kind === "headers") {
    if (actions.length === 0) {
      errors.push("至少需要一条头部动作");
    }
  } else if (kind === "redirect") {
    const to =
      typeof rule.redirectTo === "string" ? rule.redirectTo.trim() : "";
    if (!to) {
      errors.push("重定向目标不能为空");
    } else if (matchType !== "regex" && !/^https?:\/\//i.test(to)) {
      errors.push("非正则匹配时，重定向目标必须是 http(s) 绝对地址");
    }
  }
  // cancel：命中即阻止，无额外字段

  actions.forEach((a, i) => {
    if (kind !== "headers") return;
    const label = `动作 #${i + 1}`;
    if (a == null || typeof a !== "object") {
      errors.push(`${label}：不是有效对象`);
      return;
    }
    const name = typeof a.name === "string" ? a.name : "";
    if (!HEADER_NAME_RE.test(name.trim())) {
      errors.push(`${label}：头部名称不合法（${name || "空"}）`);
    }
    if ((a.op === "set" || a.op === "append") && !a.value?.trim()) {
      errors.push(
        `${label}：${a.op === "set" ? "覆盖" : "追加"}操作需要填写头部值`,
      );
    }
    if (a.op === "remove" && !name.trim()) {
      errors.push(`${label}：删除操作需要填写头部名称`);
    }
  });
  return errors;
}

/**
 * match pattern 合法性校验：
 * 结构为 scheme://host/path；scheme 支持 http、https、ws、wss、ftp、data、file 与通配符；
 * host 可含「星点」前缀通配；http(s)/ws(s)/ftp 的 host 不允许为空。
 */
export function isValidMatchPattern(pattern: string): boolean {
  const m = /^(\*|https?|wss?|ftp|data|file):\/\/([^/*]*)(\/.*)$/.exec(pattern);
  if (!m) return false;
  const scheme = m[1]!;
  const host = m[2] ?? "";
  // 通配 scheme 与 file/data 允许空 host；其余 scheme 必须有 host
  if (host === "")
    return scheme === "*" || scheme === "data" || scheme === "file";
  return /^(\*(?:\.[^/*]+)?|\*|[^/*]+)$/.test(host);
}

/**
 * 旧格式迁移：单值 urlFilter → urlFilters 数组；补齐缺失字段。
 * 存储读取与导入路径统一调用，保证引擎与 UI 只面对新模型。
 */
export function migrateHeaderRule(raw: HeaderRule): HeaderRule {
  const rawCond = (raw.condition ?? {}) as HeaderRuleCondition & {
    urlFilter?: unknown;
    urlFilters?: unknown;
    matchType?: unknown;
    urlValue?: unknown;
  };

  const matches: UrlMatchItem[] = [];
  if (Array.isArray(rawCond.matches)) {
    for (const m of rawCond.matches) {
      if (
        m &&
        typeof m === "object" &&
        typeof m.value === "string" &&
        m.value.trim()
      ) {
        const t = m.matchType;
        matches.push({
          matchType: t === "contains" || t === "regex" ? t : "pattern",
          value: m.value.trim(),
        });
      }
    }
  } else if (
    typeof rawCond.urlFilter === "string" &&
    rawCond.urlFilter.trim()
  ) {
    // 最早期形态：单值 urlFilter
    matches.push({ matchType: "pattern", value: rawCond.urlFilter.trim() });
  } else if (Array.isArray(rawCond.urlFilters)) {
    // 上一代形态：模式数组
    for (const f of rawCond.urlFilters) {
      if (typeof f === "string" && f.trim()) {
        matches.push({ matchType: "pattern", value: f.trim() });
      }
    }
  }
  // 上一上代补充：matchType+urlValue 单值
  if (
    matches.length === 0 &&
    (rawCond.matchType === "contains" || rawCond.matchType === "regex") &&
    typeof rawCond.urlValue === "string" &&
    rawCond.urlValue.trim()
  ) {
    matches.push({
      matchType: rawCond.matchType,
      value: rawCond.urlValue.trim(),
    });
  }

  return {
    ...raw,
    name: typeof raw.name === "string" ? raw.name : "",
    enabled: Boolean(raw.enabled),
    kind:
      raw.kind === "cancel" || raw.kind === "redirect" ? raw.kind : "headers",
    createdAt: raw.createdAt ?? 0,
    updatedAt: raw.updatedAt ?? 0,
    comment: typeof raw.comment === "string" ? raw.comment : undefined,
    condition: { matches },
    actions: Array.isArray(raw.actions) ? raw.actions : [],
  };
}

/** 条件摘要（列表行副文案共用）：按匹配方式输出简短描述 */
export function describeCondition(condition: HeaderRuleCondition): string {
  const ms = condition.matches ?? [];
  if (ms.length === 0) return "无匹配条件";
  const label = (m: UrlMatchItem): string => {
    const v = m.value?.trim() ?? "";
    if (m.matchType === "contains") return `含 ${v}`;
    if (m.matchType === "regex") return `re: ${v}`;
    return v;
  };
  const first = label(ms[0]!);
  return ms.length > 1 ? `${first} 等 ${ms.length} 组` : first;
}

/** 规则动作类型的短标签 */
export function ruleKindLabel(kind: RuleKind | undefined): string {
  switch (kind) {
    case "cancel":
      return "阻止请求";
    case "redirect":
      return "重定向";
    default:
      return "改写头部";
  }
}

/** 动作摘要（列表行副文案）：按类型输出 */
export function describeActions(rule: HeaderRule): string {
  if (rule.kind === "cancel") return "命中即取消请求";
  if (rule.kind === "redirect") return `→ ${rule.redirectTo ?? "?"}`;
  const req = rule.actions.filter((a) => a.target === "request").length;
  const resp = rule.actions.filter((a) => a.target === "response").length;
  const parts: string[] = [];
  if (req > 0) parts.push(`请求 ×${req}`);
  if (resp > 0) parts.push(`响应 ×${resp}`);
  return parts.join(" / ") || "无动作";
}
