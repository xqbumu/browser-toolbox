/**
 * 引擎端到端（集成）测试：用内存 browser shim 驱动真实引擎的 webRequest 路径，
 * 覆盖 sync → 监听回调 → 头部改写/取消/重定向/查询改写/响应体改写/会话覆盖。
 *
 * 说明：本环境无 Firefox 运行时，无法跑真实 filterResponseData；此处用注入式
 * Sink mock 验证引擎到 rewriteResponse 的接线正确性。真实 Firefox 行为
 * 仍需在 Firefox MV2 下人工/CI 验证（已在迁移计划标注）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { newHeaderRule, type HeaderRule } from "@/types/headers";
import { createHeaderEngine, setSessionOverride } from "@/core/headers/engine";

interface Sink {
  write: (chunk: Uint8Array) => void;
  close: () => void;
  ondata: { addListener: (cb: (e: { data: ArrayBuffer }) => void) => void };
  onstop: { addListener: (cb: () => void) => void };
  onerror: { addListener: (cb: () => void) => void };
  written: string;
  closed: boolean;
  feed: (text: string) => void;
  stop: () => void;
}
const sinks: Sink[] = [];

function makeSink(): Sink {
  let ondata: ((e: { data: ArrayBuffer }) => void) | undefined;
  let onstop: (() => void) | undefined;
  const written: string[] = [];
  let closed = false;
  const sink: Sink = {
    write: (chunk: Uint8Array) => written.push(new TextDecoder().decode(chunk)),
    close: () => {
      closed = true;
    },
    ondata: {
      addListener: (cb: (e: { data: ArrayBuffer }) => void) => (ondata = cb),
    },
    onstop: { addListener: (cb: () => void) => (onstop = cb) },
    onerror: { addListener: () => {} },
    get written() {
      return written.join("");
    },
    get closed() {
      return closed;
    },
    feed: (text: string) =>
      ondata?.({ data: new TextEncoder().encode(text).buffer as ArrayBuffer }),
    stop: () => onstop?.(),
  };
  sinks.push(sink);
  return sink;
}

function makeBrowserShim(store: Record<string, unknown>) {
  const listeners: Record<string, ((...a: unknown[]) => unknown) | undefined> =
    {};
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
    webRequest: {
      filterResponseData: (): unknown => makeSink(),
      onBeforeRequest: {
        addListener: (cb: (...a: unknown[]) => unknown) =>
          (listeners.onBeforeRequest = cb),
        removeListener: () => {},
      },
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
    __listeners: listeners,
  };
  return shim as unknown as typeof browser & { __listeners: typeof listeners };
}

function rule(partial: Partial<HeaderRule>): HeaderRule {
  return {
    ...newHeaderRule(),
    id: "e2e-1",
    name: "e2e",
    enabled: true,
    condition: {
      matches: [{ matchType: "pattern", value: "*://api.example.com/*" }],
    },
    actions: [],
    ...partial,
  };
}

describe("引擎端到端（webRequest 路径）", () => {
  let store: Record<string, unknown>;
  let shim: ReturnType<typeof makeBrowserShim>;
  let engine: Awaited<ReturnType<typeof createHeaderEngine>> | null = null;

  beforeAll(() => {
    store = {};
    shim = makeBrowserShim(store);
    vi.stubGlobal("browser", shim);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  async function bootWith(r: HeaderRule) {
    store["headerRules"] = [r];
    store["headerEnabled"] = true;
    engine = await createHeaderEngine();
    await engine?.sync();
    return shim.__listeners;
  }

  it("请求头改写：onBeforeSendHeaders 注入自定义头", async () => {
    const L = await bootWith(
      rule({
        actions: [
          { target: "request", op: "set", name: "X-E2E", value: "yes" },
        ],
      }),
    );
    const res = L.onBeforeSendHeaders?.({
      url: "https://api.example.com/x",
      method: "GET",
      type: "main_frame",
      requestHeaders: [{ name: "Accept", value: "*/*" }],
    }) as { requestHeaders?: { name: string; value: string }[] };
    expect(
      res?.requestHeaders?.some((h) => h.name === "X-E2E" && h.value === "yes"),
    ).toBe(true);
  });

  it("取消请求：onBeforeRequest 返回 cancel", async () => {
    const L = await bootWith(rule({ kind: "cancel" }));
    const res = L.onBeforeRequest?.({
      url: "https://api.example.com/x",
      method: "GET",
      type: "main_frame",
    }) as { cancel?: boolean };
    expect(res?.cancel).toBe(true);
  });

  it("重定向：onBeforeRequest 返回 redirectUrl", async () => {
    const L = await bootWith(
      rule({ kind: "redirect", redirectTo: "https://other.com/y" }),
    );
    const res = L.onBeforeRequest?.({
      url: "https://api.example.com/x",
      method: "GET",
      type: "main_frame",
    }) as { redirectUrl?: string };
    expect(res?.redirectUrl).toBe("https://other.com/y");
  });

  it("MV2 缓存重建清零：删除 cancel 规则后再 sync 不再取消（P0 回归）", async () => {
    store["headerRules"] = [rule({ kind: "cancel" })];
    store["headerEnabled"] = true;
    engine = await createHeaderEngine();
    await engine?.sync();
    expect(
      (shim.__listeners.onBeforeRequest?.({
        url: "https://api.example.com/x",
        method: "GET",
        type: "main_frame",
      }) as { cancel?: boolean } | undefined)?.cancel,
    ).toBe(true);

    // 删除规则后同一引擎再 sync：内存缓存必须清空残留的 cancel 规则
    store["headerRules"] = [];
    await engine?.sync();
    expect(
      shim.__listeners.onBeforeRequest?.({
        url: "https://api.example.com/x",
        method: "GET",
        type: "main_frame",
      }),
    ).toBeUndefined();
  });

  it("正则重定向：redirectTo 用 RE2/DNR 替换语法（\\1）时 MV2 等价命中捕获组", async () => {
    store["headerRules"] = [
      rule({
        kind: "redirect",
        redirectTo: "https://other.com/files/\\1",
        condition: {
          matches: [
            {
              matchType: "regex",
              value: "^https://api\\.example\\.com/([a-z]+)$",
            },
          ],
        },
      }),
    ];
    store["headerEnabled"] = true;
    engine = await createHeaderEngine();
    await engine?.sync();
    const res = shim.__listeners.onBeforeRequest?.({
      url: "https://api.example.com/x",
      method: "GET",
      type: "main_frame",
    }) as { redirectUrl?: string } | undefined;
    // MV2 侧把 \1 翻译为 JS $1，与 DNR regexSubstitution 语义对齐
    expect(res?.redirectUrl).toBe("https://other.com/files/x");
  });

  it("查询改写：onBeforeRequest 返回带新参数的 redirectUrl", async () => {
    const L = await bootWith(
      rule({
        kind: "query",
        queryActions: [{ op: "add", name: "token", value: "T" }],
      }),
    );
    const res = L.onBeforeRequest?.({
      url: "https://api.example.com/x?a=1",
      method: "GET",
      type: "main_frame",
    }) as { redirectUrl?: string };
    expect(res?.redirectUrl).toContain("token=T");
    expect(res?.redirectUrl).toContain("a=1");
  });

  it("响应体改写：onHeadersReceived 触发 filterResponseData 回写", async () => {
    sinks.length = 0;
    const L = await bootWith(
      rule({ kind: "body", bodyActions: [{ match: "foo", replace: "bar" }] }),
    );
    L.onHeadersReceived?.({
      requestId: "r1",
      url: "https://api.example.com/x",
      method: "GET",
      type: "main_frame",
      responseHeaders: [{ name: "content-type", value: "text/html" }],
    });
    const sink = sinks[sinks.length - 1]!;
    sink.feed("<p>foo</p>");
    sink.stop();
    expect(sink.written).toBe("<p>bar</p>");
    expect(sink.closed).toBe(true);
  });

  it("会话覆盖：禁用规则经 setSessionOverride(true) 后生效", async () => {
    store["headerRules"] = [
      rule({
        enabled: false,
        actions: [{ target: "request", op: "set", name: "X-Sess", value: "1" }],
      }),
    ];
    store["headerEnabled"] = true;
    engine = await createHeaderEngine();
    setSessionOverride("e2e-1", true);
    await engine?.sync();
    const res = shim.__listeners.onBeforeSendHeaders?.({
      url: "https://api.example.com/x",
      method: "GET",
      type: "main_frame",
      requestHeaders: [{ name: "Accept", value: "*/*" }],
    }) as { requestHeaders?: { name: string; value: string }[] };
    expect(res?.requestHeaders?.some((h) => h.name === "X-Sess")).toBe(true);
    setSessionOverride("e2e-1", null);
  });

  it("改写成功上报：onRewrite 在实际改写发生时携带规则与分组归属", async () => {
    store["headerRules"] = [
      rule({
        name: "登录接口",
        groupId: "g-api",
        actions: [
          { target: "request", op: "set", name: "X-Token", value: "t1" },
        ],
      }),
    ];
    store["headerGroups"] = [
      { id: "g-api", name: "API 分组", enabled: true, createdAt: 1 },
    ];
    store["headerEnabled"] = true;
    const onRewrite = vi.fn();
    engine = await createHeaderEngine({ onRewrite });
    await engine?.sync();

    // 命中：应上报一次 request 事件
    shim.__listeners.onBeforeSendHeaders?.({
      url: "https://api.example.com/x",
      method: "GET",
      type: "main_frame",
      requestHeaders: [{ name: "Accept", value: "*/*" }],
    });
    expect(onRewrite).toHaveBeenCalledTimes(1);
    expect(onRewrite.mock.calls[0]![0]).toMatchObject({
      ruleId: "e2e-1",
      ruleName: "登录接口",
      groupId: "g-api",
      groupName: "API 分组",
      target: "request",
      url: "https://api.example.com/x",
      method: "GET",
      actionCount: 1,
    });

    // 未命中 URL：不上报
    onRewrite.mockClear();
    shim.__listeners.onBeforeSendHeaders?.({
      url: "https://other.com/x",
      method: "GET",
      type: "main_frame",
      requestHeaders: [{ name: "Accept", value: "*/*" }],
    });
    expect(onRewrite).not.toHaveBeenCalled();

    // 未传 onRewrite：缺省 no-op（不抛错）
    engine = await createHeaderEngine();
    await engine?.sync();
  });
});
