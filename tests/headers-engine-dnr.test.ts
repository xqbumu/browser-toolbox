/**
 * 引擎端到端（DNR 路径）：用带 declarativeNetRequest 的内存 browser shim 驱动
 * createHeaderEngine 的 dnr 分支，覆盖此前零覆盖的关键路径：
 * - sync：清理旧规则 → 写入新规则（removeRuleIds / addRules）；
 * - Safari 场景：有 DNR、无 webRequest → 不挂观测、不抛错、无日志；
 * - Chrome 场景：DNR + 只读 webRequest → 观测命中触发 onRewrite；
 * - 总开关关闭时 sync 清空动态规则。
 * 注意：webRequest 路径的端到端见 headers-engine-e2e.test.ts。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { newHeaderRule, type HeaderRule } from "@/types/headers";
import { createHeaderEngine } from "@/core/headers/engine";
import { DNR_START_ID } from "@/core/headers/dnr";

function rule(partial: Partial<HeaderRule>): HeaderRule {
  return {
    ...newHeaderRule(),
    id: "dnr-1",
    name: "dnr",
    enabled: true,
    condition: {
      matches: [{ matchType: "pattern", value: "*://api.example.com/*" }],
    },
    actions: [],
    ...partial,
  };
}

function makeDnrShim(
  store: Record<string, unknown>,
  opts: { webRequest?: boolean } = {},
) {
  const recorded: number[] = [];
  const listeners: Record<string, ((...a: unknown[]) => unknown) | undefined> =
    {};
  const dnr = {
    updateDynamicRules: vi.fn(
      async (options: { removeRuleIds?: number[]; addRules?: { id: number }[] }) => {
        for (const id of options.removeRuleIds ?? []) {
          const i = recorded.indexOf(id);
          if (i >= 0) recorded.splice(i, 1);
        }
        for (const r of options.addRules ?? []) recorded.push(r.id);
      },
    ),
    getDynamicRules: vi.fn(
      (cb: (rules: { id: number }[]) => void) =>
        cb(recorded.map((id) => ({ id }))),
    ),
  };
  const shim = {
    storage: {
      local: {
        get: async (key: string | string[]) => {
          if (Array.isArray(key)) {
            const out: Record<string, unknown> = {};
            for (const k of key) out[k] = store[k];
            return out;
          }
          return { [key]: store[key] };
        },
        set: async (obj: Record<string, unknown>) => {
          Object.assign(store, obj);
        },
      },
    },
    runtime: { sendMessage: async () => ({}) },
    declarativeNetRequest: dnr,
    ...(opts.webRequest
      ? {
          webRequest: {
            onBeforeSendHeaders: {
              addListener: (cb: (...a: unknown[]) => unknown) =>
                (listeners.onBeforeSendHeaders = cb),
              removeListener: () => {},
            },
            onHeadersReceived: {
              addListener: (cb: (...a: unknown[]) => unknown) =>
                (listeners.onHeadersReceived = cb),
              removeListener: () => {},
            },
          },
        }
      : {}),
    __recorded: recorded,
    __dnr: dnr,
    __listeners: listeners,
  };
  return shim as unknown as typeof browser & {
    __recorded: number[];
    __dnr: typeof dnr;
    __listeners: typeof listeners;
  };
}

describe("引擎端到端（DNR 路径）", () => {
  let store: Record<string, unknown>;
  let shim: ReturnType<typeof makeDnrShim>;

  beforeAll(() => {
    store = {};
    shim = makeDnrShim(store, { webRequest: false });
    vi.stubGlobal("browser", shim);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("能力探测：有 declarativeNetRequest 即走 dnr，无需 webRequest（Safari）", async () => {
    store["headerRules"] = [
      rule({
        actions: [
          { target: "request", op: "set", name: "X-DNR", value: "1" },
        ],
      }),
    ];
    store["headerEnabled"] = true;
    const engine = await createHeaderEngine({ onRewrite: vi.fn() });
    expect(engine?.kind).toBe("dnr");
    await engine?.sync();

    // 同步写入动态规则；无 webRequest 时不上报（无观测监听）
    expect(shim.__dnr.updateDynamicRules).toHaveBeenCalled();
    const last = shim.__dnr.updateDynamicRules.mock.calls[
      shim.__dnr.updateDynamicRules.mock.calls.length - 1
    ]![0];
    expect(last.removeRuleIds ?? []).toEqual([]);
    expect(last.addRules!.length).toBeGreaterThan(0);
    expect(last.addRules![0]!.id).toBeGreaterThanOrEqual(DNR_START_ID);
    expect(shim.__recorded.length).toBeGreaterThan(0);
    expect(engine?.dispose).toBeTypeOf("function");
    engine?.dispose();
  });

  it("sync 幂等重建：二次同步会先清理上一批动态规则（删除规则即失效）", async () => {
    store["headerRules"] = [
      rule({
        actions: [
          { target: "request", op: "set", name: "X-DNR", value: "1" },
        ],
      }),
    ];
    store["headerEnabled"] = true;
    const engine = await createHeaderEngine();
    await engine?.sync();
    const firstAdd = [...shim.__recorded];
    expect(firstAdd.length).toBeGreaterThan(0);

    // 删除全部规则后再次 sync：旧的动态规则被整体移除
    store["headerRules"] = [];
    await engine?.sync();
    expect(shim.__recorded).toEqual([]);
    const last = shim.__dnr.updateDynamicRules.mock.calls[
      shim.__dnr.updateDynamicRules.mock.calls.length - 1
    ]![0];
    expect([...(last.removeRuleIds ?? [])].sort()).toEqual([...firstAdd].sort());
    expect(last.addRules).toEqual([]);
    engine?.dispose();
  });

  it("总开关关闭：sync 清空动态规则（规则数据保留）", async () => {
    store["headerRules"] = [
      rule({
        actions: [
          { target: "request", op: "set", name: "X-DNR", value: "1" },
        ],
      }),
    ];
    store["headerEnabled"] = false;
    const engine = await createHeaderEngine();
    await engine?.sync();
    expect(shim.__recorded).toEqual([]);
    engine?.dispose();
  });

  it("Chrome 场景：DNR + 只读 webRequest 观测，命中上报 onRewrite", async () => {
    shim = makeDnrShim(store, { webRequest: true });
    vi.stubGlobal("browser", shim);
    store["headerRules"] = [
      rule({
        name: "观测命中",
        actions: [
          { target: "request", op: "set", name: "X-Obs", value: "1" },
        ],
      }),
    ];
    store["headerEnabled"] = true;
    const onRewrite = vi.fn();
    const engine = await createHeaderEngine({ onRewrite });
    await engine?.sync();

    // 观测回调等价于只读观测（DNR 已在浏览器侧应用改写，此处仅记录）
    shim.__listeners.onBeforeSendHeaders?.({
      url: "https://api.example.com/x",
      method: "GET",
      type: "xmlhttprequest",
    });
    expect(onRewrite).toHaveBeenCalledTimes(1);
    expect(onRewrite.mock.calls[0]![0]).toMatchObject({
      ruleId: "dnr-1",
      ruleName: "观测命中",
      target: "request",
      actionCount: 1,
    });

    // 未命中 URL 不上报
    onRewrite.mockClear();
    shim.__listeners.onBeforeSendHeaders?.({
      url: "https://other.com/x",
      method: "GET",
      type: "main_frame",
    });
    expect(onRewrite).not.toHaveBeenCalled();
    engine?.dispose();
  });
});
