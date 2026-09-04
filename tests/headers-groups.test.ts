import { afterEach, describe, expect, it } from "vitest";
import {
  deleteGroup,
  listGroups,
  listHeaderRules,
  saveGroup,
  saveHeaderRule,
  toggleGroup,
  toggleRulesByGroup,
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

  it("toggleRulesByGroup 批量启停组内成员（组开关不动，仅翻转成员）", async () => {
    const group = { ...newHeaderGroup(), name: "API" };
    await saveGroup(group);
    await saveHeaderRule({
      ...newHeaderRule(),
      id: "a1",
      name: "A1",
      groupId: group.id,
      enabled: true,
    });
    await saveHeaderRule({
      ...newHeaderRule(),
      id: "a2",
      name: "A2",
      groupId: group.id,
      enabled: false,
    });
    await saveHeaderRule({
      ...newHeaderRule(),
      id: "u1",
      name: "U1",
      enabled: true,
    });

    // 停用：a1 翻转，a2 已停不重复计
    expect(await toggleRulesByGroup(group.id, false)).toBe(1);
    let rs = await listHeaderRules();
    expect(rs.find((r) => r.id === "a1")?.enabled).toBe(false);
    expect(rs.find((r) => r.id === "a2")?.enabled).toBe(false);
    // 未分组规则不受影响
    expect(rs.find((r) => r.id === "u1")?.enabled).toBe(true);

    // 启用：两条成员均翻转
    expect(await toggleRulesByGroup(group.id, true)).toBe(2);
    rs = await listHeaderRules();
    expect(rs.find((r) => r.id === "a1")?.enabled).toBe(true);
    expect(rs.find((r) => r.id === "a2")?.enabled).toBe(true);

    // 空串 groupId = 未分组
    expect(await toggleRulesByGroup("", false)).toBe(1);
    rs = await listHeaderRules();
    expect(rs.find((r) => r.id === "u1")?.enabled).toBe(false);
    expect(rs.find((r) => r.id === "a1")?.enabled).toBe(true);
  });

  it("toggleRulesByGroup 对不存在的分组 / 无成员分组返回 0 且不改写任何规则", async () => {
    await saveHeaderRule({
      ...newHeaderRule(),
      id: "k1",
      name: "K1",
      enabled: true,
    });

    // 分组不存在：无成员可翻转，返回 0
    expect(await toggleRulesByGroup("ghost-group", true)).toBe(0);
    expect(await toggleRulesByGroup("ghost-group", false)).toBe(0);
    let rs = await listHeaderRules();
    expect(rs.find((r) => r.id === "k1")?.enabled).toBe(true);

    // 分组存在但无成员：同样返回 0 且不写库
    const group = { ...newHeaderGroup(), name: "空组" };
    await saveGroup(group);
    expect(await toggleRulesByGroup(group.id, false)).toBe(0);
    rs = await listHeaderRules();
    expect(rs.find((r) => r.id === "k1")?.enabled).toBe(true);
  });
});
