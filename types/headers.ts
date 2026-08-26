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

/** 匹配条件 */
export interface HeaderRuleCondition {
  /**
   * URL 匹配模式列表（Chrome match pattern 风格），任一命中即生效：
   * `*://api.example.com/*`、`https://example.com/api/*`，
   * 全匹配可用 `<all_urls>` 或 `*`。DNR 路径按模式展开为多条动态规则。
   * 兼容历史字段 urlFilter（单值），读取时自动迁移。
   */
  urlFilters: string[];
  /** 资源类型白名单；缺省 = 全部 */
  resourceTypes?: HeaderResourceType[];
  /** HTTP 方法白名单（大写）；缺省 = 全部 */
  methods?: string[];
}

/** 请求头规则（扁平、可独立启停） */
export interface HeaderRule {
  id: string;
  name: string;
  enabled: boolean;
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
    condition: { urlFilters: ["*://*/*"] },
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
    (HeaderRuleCondition & { urlFilter?: unknown }) | undefined;
  const rawFilters =
    condition && Array.isArray(condition.urlFilters)
      ? condition.urlFilters
      : condition && typeof condition.urlFilter === "string"
        ? [condition.urlFilter]
        : [];
  const filters = rawFilters
    .filter((f) => typeof f === "string" && f.trim())
    .map((f) => (f as string).trim());
  if (filters.length === 0) {
    errors.push("至少需要一条 URL 匹配模式");
  }
  for (const f of filters) {
    if (f !== "*" && f !== "<all_urls>" && !isValidMatchPattern(f)) {
      errors.push(`URL 匹配模式不合法：${f}（示例：*://api.example.com/*）`);
    }
  }
  const actions = Array.isArray(rule.actions) ? rule.actions : [];
  if (actions.length === 0) {
    errors.push("至少需要一条头部动作");
  }
  actions.forEach((a, i) => {
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
  const condition = { ...(raw.condition ?? {}) } as HeaderRuleCondition & {
    urlFilter?: string;
  };
  if (!Array.isArray(condition.urlFilters)) {
    condition.urlFilters =
      typeof condition.urlFilter === "string" && condition.urlFilter.trim()
        ? [condition.urlFilter.trim()]
        : Array.isArray(condition.urlFilters)
          ? condition.urlFilters
          : [];
  }
  delete condition.urlFilter;
  return {
    ...raw,
    name: typeof raw.name === "string" ? raw.name : "",
    enabled: Boolean(raw.enabled),
    createdAt: raw.createdAt ?? 0,
    updatedAt: raw.updatedAt ?? 0,
    condition,
    actions: Array.isArray(raw.actions) ? raw.actions : [],
  };
}
