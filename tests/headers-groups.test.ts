import { afterEach, describe, expect, it } from "vitest";
import {
  deleteGroup,
  listGroups,
  listHeaderRules,
  saveGroup,
  saveHeaderRule,
  toggleGroup,
  deleteHeaderRule,
} from "@/utils/header-rules-store";
import { newHeaderGroup, newHeaderRule } from "@/types/headers";

// 内存版 browser.storage.local 模拟（store 走单键 JSON）
const mem: Record<string, unknown> = {};
(globalThis as { browser?: unknown }).browser = {
  storage: {
    local: {
      get: async (k: string | string[] | null) => {
        if (k == null) return { ...mem };
        if (Array.isArray(k)) {
          const o: Record<string, unknown> = {};
          for (const key of k) o[key] = mem[key];
          return o;
        }
        return { [k]: mem[k] };
      },
      set: async (o: Record<string, unknown>) => {
        Object.assign(mem, o);
      },
    },
  },
  runtime: { sendMessage: async () => undefined },
};

afterEach(async () => {
  // 清理，避免影响其它用例
  for (const g of await listGroups()) await deleteGroup(g.id);
  for (const r of await listHeaderRules()) await deleteHeaderRule(r.id);
});

describe("header groups store", () => {
  it("saveGroup 后出现在列表中，且可禁用使成员规则失效", async () => {
    const group = { ...newHeaderGroup(), name: "API" };
    await saveGroup(group);
    expect((await listGroups()).some((g) => g.id === group.id)).toBe(true);

    const rule = {
      ...newHeaderRule(),
      id: "r1",
      name: "命中",
      groupId: group.id,
      enabled: true,
    };
    await saveHeaderRule(rule);

    expect(
      (await listHeaderRules()).some(
        (r) => r.id === "r1" && r.groupId === group.id,
      ),
    ).toBe(true);

    // 禁用组 → 引擎 listEffectiveRules 不应将其计入（逻辑在 engine，这里验证存储态）
    await toggleGroup(group.id, false);
    const groups = await listGroups();
    expect(groups.find((g) => g.id === group.id)?.enabled).toBe(false);
  });

  it("deleteGroup 后成员规则 groupId 归 undefined（未分组，不删除）", async () => {
    const group = { ...newHeaderGroup(), name: "G" };
    await saveGroup(group);
    await saveHeaderRule({
      ...newHeaderRule(),
      id: "r2",
      name: "m",
      groupId: group.id,
    });
    await deleteGroup(group.id);

    expect((await listGroups()).some((g) => g.id === group.id)).toBe(false);
    const rule = (await listHeaderRules()).find((r) => r.id === "r2");
    expect(rule?.groupId).toBeUndefined();
  });
});
