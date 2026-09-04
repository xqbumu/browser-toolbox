/**
 * 请求头规则仓库：browser.storage.local 单键 JSON（规则量小、便于整包导入导出）。
 * 引擎重建由 background 的 storage.onChanged 兜底统一触发（headerRules / headerGroups /
 * headerEnabled 三键落盘即重建；消息写库与旁路直写同源，无重复触发）。
 * 例外：会话覆盖不落 local（内存 + storage.session），由 background 在
 * HEADERS_SESSION_OVERRIDE 消息分支内显式 requestSync。
 * 跨端广播（__HEADER_RULES_CHANGED__ / __HEADER_GROUPS_CHANGED__）：供多窗口 UI
 * 自行同步展示，background 不消费（避免重复重建）。
 */
import type { HeaderRule, HeaderGroup } from "@/types/headers";
import { createLogger } from "@/utils/logger";
import { genId } from "@/utils/helpers";

const log = createLogger("header-rules-store");

const STORAGE_KEY = "headerRules";
const MASTER_KEY = "headerEnabled";

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

// ---- 全局总开关（Requestly 式：关闭后引擎应用空规则集，规则数据保留） ----

export async function isHeaderMasterEnabled(): Promise<boolean> {
  const result = await browser.storage.local.get(MASTER_KEY);
  // 缺省视为开启（首次安装即开箱可用）
  return result[MASTER_KEY] !== false;
}

export async function setHeaderMasterEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [MASTER_KEY]: enabled });
  broadcastChanged();
}

// ---- 分组 CRUD ----

const GROUPS_KEY = "headerGroups";

export interface GroupsChangedPush {
  type: "__HEADER_GROUPS_CHANGED__";
}

async function readGroups(): Promise<HeaderGroup[]> {
  const result = await browser.storage.local.get(GROUPS_KEY);
  const groups = result[GROUPS_KEY] as HeaderGroup[] | undefined;
  return Array.isArray(groups) ? groups : [];
}

async function writeGroups(groups: HeaderGroup[]): Promise<HeaderGroup[]> {
  await browser.storage.local.set({ [GROUPS_KEY]: groups });
  broadcastGroupsChanged();
  return groups;
}

function broadcastGroupsChanged(): void {
  const push: GroupsChangedPush = { type: "__HEADER_GROUPS_CHANGED__" };
  browser.runtime.sendMessage(push).catch(() => {});
}

export async function listGroups(): Promise<HeaderGroup[]> {
  return readGroups();
}

export async function saveGroup(group: HeaderGroup): Promise<HeaderGroup> {
  const groups = await readGroups();
  const idx = groups.findIndex((g) => g.id === group.id);
  if (idx >= 0) {
    groups[idx] = group;
  } else {
    groups.push(group);
  }
  await writeGroups(groups);
  return group;
}

export async function deleteGroup(id: string): Promise<void> {
  const groups = await readGroups();
  await writeGroups(groups.filter((g) => g.id !== id));
  // 删除组后，成员规则 groupId 归 undefined（未分组）
  const rules = await readAll();
  let changed = false;
  for (const rule of rules) {
    if (rule.groupId === id) {
      rule.groupId = undefined;
      changed = true;
    }
  }
  if (changed) await writeAll(rules);
}

export async function toggleGroup(id: string, enabled: boolean): Promise<void> {
  const groups = await readGroups();
  const group = groups.find((g) => g.id === id);
  if (!group) return;
  group.enabled = enabled;
  await writeGroups(groups);
}

/**
 * 按组批量启停成员规则（组开关本身不动，仅翻转成员 rule.enabled）。
 * groupId 传空串表示「未分组」（groupId 缺省/undefined 的规则）。
 * 返回实际变更的规则条数；无成员变更时不写库。
 */
export async function toggleRulesByGroup(
  groupId: string,
  enabled: boolean,
): Promise<number> {
  const rules = await readAll();
  const now = Date.now();
  let changed = 0;
  for (const rule of rules) {
    const inGroup =
      groupId === ""
        ? rule.groupId == null
        : rule.groupId === groupId;
    if (inGroup && rule.enabled !== enabled) {
      rule.enabled = enabled;
      rule.updatedAt = now;
      changed += 1;
    }
  }
  if (changed > 0) await writeAll(rules);
  return changed;
}
