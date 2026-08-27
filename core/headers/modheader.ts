/**
 * ModHeader 导出格式兼容：将其公开的 profiles/headers 结构转换为本工具的规则。
 * 尽量向前兼容多个版本的导出形态：
 *   简单形态：{ profiles:[ { title, enabled, urlFilter, headers:[ { key,value,type } ] } ] }
 *   数组形态：[ { title, headers:[...] } ]
 *   新版（urlConds）形态：profile 带 urlConds:[ {type:'urls'|'methods'|'resourceTypes'|'urlFilter'|'urlRegex', op?, value } ]
 *                        header 带 op:'add'|'modify'|'remove' 与 headerType:'request'|'response'|'mixed'
 * 仅做结构化映射，逐条校验交由调用方（validateHeaderRule）完成。
 */
import {
  newHeaderRule,
  type HeaderAction,
  type HeaderRule,
  type HeaderResourceType,
  type UrlMatchItem,
} from "@/types/headers";
import { genId } from "@/utils/helpers";

interface MHUrlCond {
  type?: string;
  op?: string;
  value?: unknown;
}
interface MHHeader {
  key?: string;
  name?: string;
  value?: string;
  type?: string;
  headerType?: string;
  op?: string;
  enabled?: boolean;
}
interface MHProfile {
  title?: string;
  name?: string;
  enabled?: boolean;
  enable?: boolean;
  urlFilter?: string;
  urlFilters?: string[];
  urlConds?: MHUrlCond[];
  headers?: MHHeader[];
}
type MHExport =
  | { profiles?: MHProfile[]; export?: { profiles?: MHProfile[] } }
  | MHProfile[]
  | Record<string, unknown>;

function toMatchItems(cond: MHUrlCond): UrlMatchItem[] {
  const type = (cond.type ?? "urlFilter").toString();
  const asArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x) => typeof x === "string")
      : typeof v === "string"
        ? [v]
        : [];
  if (type === "urls" || type === "url") {
    return asArray(cond.value).map((v) => ({
      matchType: "pattern" as const,
      value: v.trim(),
    }));
  }
  if (type === "urlRegex") {
    return asArray(cond.value).map((v) => ({
      matchType: "regex" as const,
      value: v.trim(),
    }));
  }
  if (type === "urlFilter") {
    const op = (cond.op ?? "contains").toString();
    return asArray(cond.value).map((raw) => {
      const value = raw.trim();
      if (op === "equals") return { matchType: "pattern" as const, value };
      if (op === "regex") return { matchType: "regex" as const, value };
      if (op === "prefix")
        return { matchType: "regex" as const, value: `^${escapeRe(value)}` };
      if (op === "suffix")
        return { matchType: "regex" as const, value: `${escapeRe(value)}$` };
      return { matchType: "contains" as const, value };
    });
  }
  return [];
}

function escapeRe(s: string): string {
  return s.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function normalizeProfile(p: MHProfile): HeaderRule | null {
  const name = (p.title ?? p.name ?? "ModHeader 导入").toString();
  const enabled = (p.enable ?? p.enabled) !== false;
  const actions: HeaderAction[] = [];
  for (const h of p.headers ?? []) {
    const key = (h.key ?? h.name ?? "").toString().trim();
    if (!key) continue;
    if (h.enabled === false) continue;
    const value = (h.value ?? "").toString();
    const isRemove = h.op === "remove" || !value;
    const headerType = (h.headerType ?? h.type ?? "request")
      .toString()
      .toLowerCase();
    const targets: Array<"request" | "response"> =
      headerType === "response"
        ? ["response"]
        : headerType === "mixed"
          ? ["request", "response"]
          : ["request"];
    for (const target of targets) {
      actions.push(
        isRemove
          ? { target, op: "remove", name: key }
          : { target, op: "set", name: key, value },
      );
    }
  }

  const matches: UrlMatchItem[] = [];
  for (const cond of p.urlConds ?? []) {
    matches.push(...toMatchItems(cond));
  }
  const methods: string[] = [];
  const resourceTypes: HeaderResourceType[] = [];
  for (const cond of p.urlConds ?? []) {
    const t = (cond.type ?? "").toString();
    if (t === "methods" && Array.isArray(cond.value)) {
      for (const v of cond.value)
        if (typeof v === "string") methods.push(v.toUpperCase());
    }
    if (t === "resourceTypes" && Array.isArray(cond.value)) {
      for (const v of cond.value)
        if (typeof v === "string") resourceTypes.push(v as HeaderResourceType);
    }
  }
  if (matches.length === 0) {
    const legacy =
      (p.urlFilter ?? p.urlFilters?.[0] ?? "").toString().trim() || "*://*/*";
    matches.push({ matchType: "pattern", value: legacy });
  }

  const rule = newHeaderRule();
  return {
    ...rule,
    id: genId(),
    name,
    enabled,
    condition: {
      ...rule.condition,
      matches,
      ...(methods.length ? { methods } : {}),
      ...(resourceTypes.length ? { resourceTypes } : {}),
    },
    actions,
  };
}

export function isModHeaderExport(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as MHExport;
  if (Array.isArray(obj)) return obj.some((p) => (p as MHProfile).headers);
  if (
    "profiles" in obj &&
    Array.isArray((obj as Record<string, unknown>).profiles)
  )
    return true;
  if (
    obj.export &&
    typeof obj.export === "object" &&
    "profiles" in (obj.export as Record<string, unknown>)
  )
    return true;
  // 新版 urlConds 形态：含 urlConds 的 profile 也算
  if (Array.isArray((obj as Record<string, unknown>).profiles)) {
    return (obj.profiles as MHProfile[]).some((p) => Array.isArray(p.urlConds));
  }
  return false;
}

export function parseModHeader(raw: unknown): HeaderRule[] {
  let profiles: MHProfile[] = [];
  if (Array.isArray(raw)) {
    profiles = raw as MHProfile[];
  } else if (raw && typeof raw === "object") {
    const obj = raw as {
      profiles?: MHProfile[];
      export?: { profiles?: MHProfile[] };
    };
    profiles = obj.profiles ?? obj.export?.profiles ?? [];
  }
  return profiles
    .map(normalizeProfile)
    .filter((r): r is HeaderRule => r != null);
}
