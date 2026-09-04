/**
 * utils/header-log-store.ts 单测：
 * - 缓冲落盘（push → flush → list 倒序）；
 * - 自动清理：按条数上限、按保留天数（设置变更即惰性收敛）；
 * - 清空 / 设置读写与 clamp；
 * - aggregateStats 纯聚合（总量/今日/近7天/按分组含未分组/近14天/按方向）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  aggregateStats,
  clearHeaderLogs,
  flushHeaderLogs,
  getHeaderLogSettings,
  getHeaderRewriteStats,
  initHeaderLogStore,
  listHeaderLogs,
  pushHeaderLogHits,
  setHeaderLogSettings,
} from "@/utils/header-log-store";
import type {
  HeaderRewriteHit,
  HeaderRewriteLogEntry,
} from "@/types/header-log";
import { IMPLICIT_GROUP_LABEL } from "@/types/headers";

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

const hit = (p: Partial<HeaderRewriteHit> = {}): HeaderRewriteHit => ({
  ruleId: "r1",
  ruleName: "规则A",
  target: "request",
  url: "https://api.example.com/v1",
  method: "GET",
  actionCount: 1,
  ...p,
});

beforeEach(async () => {
  for (const k of Object.keys(mem)) delete mem[k];
  await initHeaderLogStore();
});

describe("header log store", () => {
  it("push + flush 后按时间倒序落盘并可列表读取", async () => {
    pushHeaderLogHits([hit({ ruleId: "r1", ruleName: "旧" })]);
    await flushHeaderLogs();
    pushHeaderLogHits([
      hit({ ruleId: "r2", ruleName: "新" }),
      hit({ ruleId: "r3", ruleName: "中" }),
    ]);
    await flushHeaderLogs();

    const { entries, total } = await listHeaderLogs();
    expect(total).toBe(3);
    expect(entries.map((e) => e.ruleName)).toContain("新");
    // 倒序：首条时间不早于末条
    const times = entries.map((e) => e.ts);
    expect(times[0]!).toBeGreaterThanOrEqual(times[times.length - 1]!);
    expect(entries[0]!.id).toBeTruthy();
  });

  it("设置上限后存量立即按条数收敛（保留最新）", async () => {
    const seed: HeaderRewriteLogEntry[] = Array.from({ length: 300 }, (_, i) => ({
      id: `seed-${i}`,
      ts: 1_700_000_000_000 - i,
      ruleId: "r",
      ruleName: `seed-${i}`,
      target: "request",
      url: "https://x.com/",
      actionCount: 1,
    }));
    mem.headerRewriteLogs = seed;
    await setHeaderLogSettings({ maxEntries: 100, retentionDays: 0 });
    const { total } = await listHeaderLogs(10_000);
    expect(total).toBe(100);
  });

  it("超出保留天数的日志在读取/设置时被清理", async () => {
    const now = Date.now();
    const day = 86_400_000;
    mem.headerRewriteLogs = [
      {
        id: "old",
        ts: now - 10 * day,
        ruleId: "r1",
        ruleName: "过期",
        target: "request",
        url: "https://x.com/",
        actionCount: 1,
      },
      {
        id: "fresh",
        ts: now - day, // 恰好一天内（retention=7 保留）
        ruleId: "r2",
        ruleName: "新鲜",
        target: "response",
        url: "https://x.com/",
        actionCount: 2,
      },
    ];
    await setHeaderLogSettings({ retentionDays: 7, maxEntries: 500 });
    const { entries } = await listHeaderLogs();
    expect(entries.map((e) => e.id)).toEqual(["fresh"]);
  });

  it("清空后列表为空；设置读写生效且 clamp 越界值", async () => {
    pushHeaderLogHits([hit()]);
    await flushHeaderLogs();
    expect((await listHeaderLogs()).total).toBe(1);

    expect(await clearHeaderLogs()).toBe(0);
    expect((await listHeaderLogs()).total).toBe(0);

    const next = await setHeaderLogSettings({
      maxEntries: 10_000,
      retentionDays: 99,
    });
    expect(next).toMatchObject({ maxEntries: 10_000, retentionDays: 99 });
    const clamped = await setHeaderLogSettings({
      maxEntries: 999_999,
      retentionDays: -1,
    });
    expect(clamped.maxEntries).toBe(20_000);
    expect(clamped.retentionDays).toBe(0);
    expect((await getHeaderLogSettings()).enabled).toBe(true);
  });

  it("clamp 下界：maxEntries 低于 100 / retentionDays 超 365 均被收敛", async () => {
    const next = await setHeaderLogSettings({ maxEntries: 5, retentionDays: 999 });
    expect(next.maxEntries).toBe(100);
    expect(next.retentionDays).toBe(365);
  });

  it("清空后统计归零骨架（总量/今日/近7天归零，逐日仍 14 键）", async () => {
    pushHeaderLogHits([hit(), hit({ target: "response" })]);
    await flushHeaderLogs();
    expect((await getHeaderRewriteStats()).total).toBe(2);

    await clearHeaderLogs();
    const stats = await getHeaderRewriteStats();
    expect(stats.total).toBe(0);
    expect(stats.today).toBe(0);
    expect(stats.last7d).toBe(0);
    expect(stats.byDay).toHaveLength(14);
    expect(stats.byGroup).toEqual([]);
    expect(stats.byTarget.every((t) => t.count === 0)).toBe(true);
  });
});

describe("aggregateStats 聚合", () => {
  const now = Date.now();
  const day = 86_400_000;
  const mk = (
    ruleName: string,
    groupName: string | undefined,
    ts: number,
    target: "request" | "response",
  ): HeaderRewriteLogEntry => ({
    id: `${ruleName}-${ts}`,
    ts,
    ruleId: ruleName,
    ruleName,
    groupId: groupName ? `g-${groupName}` : undefined,
    groupName,
    target,
    url: "https://api.example.com/",
    method: "GET",
    actionCount: 1,
  });

  it("按分组（含未分组）与时间维度聚合", () => {
    const entries = [
      mk("rA", "登录", now, "request"), // 今日
      mk("rB", "登录", now, "request"),
      mk("rC", undefined, now, "response"), // 未分组 · 今日
      mk("rD", "登录", now - 2 * day, "request"),
      mk("rE", "埋点", now - 6 * day, "request"),
      mk("rF", "埋点", now - 10 * day, "request"), // 仍在近14天内
      mk("rG", "登录", now - 20 * day, "request"), // 超出 14 天窗口
    ];
    const stats = aggregateStats(entries, now);

    expect(stats.total).toBe(7);
    expect(stats.today).toBe(3);
    // 近 7 个自然日：today + 2d + 6d = 5 条；20d 前的不算
    expect(stats.last7d).toBe(5);
    expect(stats.byDay).toHaveLength(14);
    expect(stats.byDay[stats.byDay.length - 1]!.count).toBe(3);
    // 分组桶按计数倒序，未分组参与
    expect(stats.byGroup[0]!.label).toBe("登录");
    expect(stats.byGroup[0]!.count).toBe(4);
    const none = stats.byGroup.find((g) => g.label === IMPLICIT_GROUP_LABEL);
    expect(none?.count).toBe(1);
    // 按方向
    expect(
      stats.byTarget.find((t) => t.target === "request")?.count,
    ).toBe(6);
    expect(
      stats.byTarget.find((t) => t.target === "response")?.count,
    ).toBe(1);
  });

  it("空日志返回零值骨架", () => {
    const stats = aggregateStats([], now);
    expect(stats.total).toBe(0);
    expect(stats.today).toBe(0);
    expect(stats.last7d).toBe(0);
    expect(stats.byDay).toHaveLength(14);
    expect(stats.byGroup).toEqual([]);
  });
});
