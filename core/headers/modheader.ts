/**
 * ModHeader 导出格式兼容：将其公开的 profiles/headers 结构转换为本工具的规则。
 * 公开导出形态（不同版本略有差异，这里尽量向前兼容）：
 *   { name, profiles: [ { title, enabled, urlFilter, headers: [ { key, value, type, enabled } ] } ] }
 *   { export: { profiles: [...] } }
 *   [ { title, headers: [...] } ]   // 直接是 profiles 数组
 * 仅做结构化映射，逐条校验交由调用方完成。
 */
import {
  newHeaderRule,
  type HeaderAction,
  type HeaderRule,
} from "@/types/headers";
import { genId } from "@/utils/helpers";

interface MHHeader {
  key?: string;
  name?: string;
  value?: string;
  type?: string;
  enabled?: boolean;
}
interface MHProfile {
  title?: string;
  name?: string;
  enabled?: boolean;
  urlFilter?: string;
  urlFilters?: string[];
  headers?: MHHeader[];
}
type MHExport =
  | { profiles?: MHProfile[]; export?: { profiles?: MHProfile[] } }
  | MHProfile[]
  | Record<string, unknown>;

function normalizeProfile(p: MHProfile): HeaderRule | null {
  const name = (p.title ?? p.name ?? "ModHeader 导入").toString();
  const enabled = p.enabled !== false;
  const urlPattern =
    (p.urlFilter ?? p.urlFilters?.[0] ?? "").toString().trim() || undefined;
  const headers = p.headers ?? [];
  const actions: HeaderAction[] = [];
  for (const h of headers) {
    const key = (h.key ?? h.name ?? "").toString().trim();
    if (!key) continue;
    if (h.enabled === false) continue;
    const value = (h.value ?? "").toString();
    actions.push({
      target: h.type === "response" ? "response" : "request",
      op: value ? "set" : "remove",
      name: key,
      ...(value ? { value } : {}),
    });
  }
  const rule = newHeaderRule();
  return {
    ...rule,
    id: genId(),
    name,
    enabled,
    condition: {
      ...rule.condition,
      matches: urlPattern
        ? [{ matchType: "pattern", value: urlPattern }]
        : [{ matchType: "pattern", value: "*://*/*" }],
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
