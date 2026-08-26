/**
 * 请求头规则仓库：browser.storage.local 单键 JSON（规则量小、便于整包导入导出）。
 * 每次写操作后广播 __HEADER_RULES_CHANGED__，background 收到即重建引擎
 * （DNR 动态规则 / MV2 webRequest 缓存）；storage.onChanged 作为兜底监听。
 */
import type { HeaderRule } from "@/types/headers";
import { createLogger } from "@/utils/logger";
import { genId } from "@/utils/helpers";

const log = createLogger("header-rules-store");

const STORAGE_KEY = "headerRules";

/** 规则变更推送包裹结构 */
export interface HeaderRulesChangedPush {
  type: "__HEADER_RULES_CHANGED__";
}

async function readAll(): Promise<HeaderRule[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const rules = result[STORAGE_KEY] as HeaderRule[] | undefined;
  return Array.isArray(rules) ? rules : [];
}

async function writeAll(rules: HeaderRule[]): Promise<HeaderRule[]> {
  await browser.storage.local.set({ [STORAGE_KEY]: rules });
  broadcastChanged();
  return rules;
}

/** 通知 background 重建引擎（接收方可能不存在，忽略失败） */
function broadcastChanged(): void {
  const push: HeaderRulesChangedPush = { type: "__HEADER_RULES_CHANGED__" };
  browser.runtime.sendMessage(push).catch(() => {});
}

export async function listHeaderRules(): Promise<HeaderRule[]> {
  return readAll();
}

/** 新增或按 id 覆盖保存（id/createdAt/updatedAt 由本层统一维护） */
export async function saveHeaderRule(rule: HeaderRule): Promise<HeaderRule> {
  const next: HeaderRule = { ...rule, updatedAt: Date.now() };
  if (!next.id) {
    // 防御调用方漏填 id，避免空 id 规则重复堆积
    next.id = genId();
    next.createdAt = next.updatedAt;
  }
  const rules = await readAll();
  const idx = rules.findIndex((r) => r.id === next.id);
  if (idx >= 0) {
    if (!next.createdAt) next.createdAt = rules[idx]!.createdAt;
    rules[idx] = next;
  } else {
    if (!next.createdAt) next.createdAt = next.updatedAt;
    rules.push(next);
  }
  await writeAll(rules);
  return next;
}

export async function deleteHeaderRule(id: string): Promise<void> {
  const rules = await readAll();
  await writeAll(rules.filter((r) => r.id !== id));
}

export async function toggleHeaderRule(
  id: string,
  enabled: boolean,
): Promise<void> {
  const rules = await readAll();
  const target = rules.find((r) => r.id === id);
  if (!target) {
    log.warn("toggle 目标不存在", id);
    return;
  }
  target.enabled = enabled;
  target.updatedAt = Date.now();
  await writeAll(rules);
}

/**
 * 导入规则：merge（按 id 去重合并，同名 id 以导入为准）/ replace（整体替换）。
 * 返回写入后的全量列表。
 */
export async function importHeaderRules(
  incoming: HeaderRule[],
  mode: "merge" | "replace",
): Promise<HeaderRule[]> {
  if (mode === "replace") return writeAll([...incoming]);
  const current = await readAll();
  const map = new Map(current.map((r) => [r.id, r]));
  for (const rule of incoming) map.set(rule.id, rule);
  return writeAll([...map.values()]);
}
