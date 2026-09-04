import { describe, expect, it } from "vitest";
import { DNR_START_ID, toDnrRules } from "@/core/headers/dnr";
import {
  newHeaderRule,
  type HeaderRule,
  type UrlMatchItem,
} from "@/types/headers";

function rule(partial: Partial<HeaderRule>): HeaderRule {
  return {
    ...newHeaderRule(),
    id: "r1",
    name: "r",
    enabled: true,
    condition: { matches: [{ matchType: "pattern", value: "*://*/*" }] },
    actions: [],
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

const setA = { target: "request", op: "set", name: "A", value: "" } as const;
const P = (value: string): UrlMatchItem => ({ matchType: "pattern", value });

describe("toDnrRules", () => {
  it("禁用规则不产出；无动作也不产出", () => {
    expect(toDnrRules([rule({ enabled: false })])).toEqual([]);
    expect(toDnrRules([rule({})])).toEqual([]);
  });

  it("请求与响应动作拆分为两条，id 连续", () => {
    const out = toDnrRules([
      rule({
        actions: [
          { target: "request", op: "set", name: "A", value: "1" },
          { target: "response", op: "remove", name: "B" },
        ],
      }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe(DNR_START_ID);
    expect(out[1]!.id).toBe(DNR_START_ID + 1);
    expect(out[0]!.action.type).toBe("modifyHeaders");
    expect(
      out[0]!.action.type === "modifyHeaders"
        ? out[0]!.action.requestHeaders
        : undefined,
    ).toEqual([{ header: "A", operation: "set", value: "1" }]);
    expect(out[1]!.action.type).toBe("modifyHeaders");
    expect(
      out[1]!.action.type === "modifyHeaders"
        ? out[1]!.action.responseHeaders
        : undefined,
    ).toEqual([{ header: "B", operation: "remove" }]);
  });

  it("全匹配吞并其余条件，仅产出一条无条件规则", () => {
    for (const all of ["*", "<all_urls>", "*://*/*"]) {
      const out = toDnrRules([
        rule({
          condition: {
            matches: [P(all), P("https://x.com/*")],
          },
          actions: [{ ...setA }],
        }),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]!.condition.urlFilter).toBeUndefined();
      expect(out[0]!.condition.regexFilter).toBeUndefined();
    }
  });

  it("pattern 多模式展开为多条规则（去重），id 连续", () => {
    const out = toDnrRules([
      rule({
        condition: {
          matches: [
            P("https://a.com/*"),
            P("https://a.com/*"),
            P("https://b.com/*"),
          ],
        },
        actions: [{ ...setA }],
      }),
    ]);
    expect(out.map((r) => r.condition.urlFilter)).toEqual([
      "https://a.com/*",
      "https://b.com/*",
    ]);
    expect(out.map((r) => r.id)).toEqual([DNR_START_ID, DNR_START_ID + 1]);
  });

  it("contains 转义为 regexFilter；regex 自动加 (?i) 对齐 MV2 大小写不敏感", () => {
    const out = toDnrRules([
      rule({
        condition: {
          matches: [
            { matchType: "contains", value: "/api/v2/" },
            { matchType: "regex", value: "^https://a\\.com/v[0-9]+/" },
          ],
        },
        actions: [{ ...setA }],
      }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.condition.regexFilter != null)).toBe(true);
    expect(
      out.every(
        (r) =>
          r.action.type === "modifyHeaders" &&
          r.action.requestHeaders?.[0]?.header === "A",
      ),
    ).toBe(true);
    // 用户 regex 被前缀 (?i)（RE2 与 MV2 new RegExp(v,"i") 语义一致）
    expect(out.map((r) => r.condition.regexFilter)).toContain(
      "(?i)^https://a\\.com/v[0-9]+/",
    );
  });

  it("regex 大小写对齐：前缀 (?i)；自带 (?…) 旗标原样；prefix/suffix/contains 不额外加", () => {
    const out = toDnrRules([
      rule({
        condition: {
          matches: [
            { matchType: "regex", value: "^https://a\\.com/User" },
            { matchType: "regex", value: "(?i)^https://b\\.com/" },
            { matchType: "regex", value: "(?m)^https://c\\.com/" },
            { matchType: "prefix", value: "https://d.com" },
            { matchType: "contains", value: "/api" },
          ],
        },
        actions: [{ ...setA }],
      }),
    ]);
    const filters = out
      .map((r) => r.condition.regexFilter)
      .filter((f): f is string => f != null);
    expect(filters).toContain("(?i)^https://a\\.com/User");
    expect(filters).toContain("(?i)^https://b\\.com/");
    expect(filters).toContain("(?m)^https://c\\.com/");
    expect(filters).toContain("^https://d\\.com"); // prefix：字面匹配不加 (?i)
    expect(filters).toContain("/api"); // contains：字面子串不加 (?i)
  });

  it("prefix/suffix 转义并加锚点后走 regexFilter", () => {
    const out = toDnrRules([
      rule({
        condition: {
          matches: [
            { matchType: "prefix", value: "https://api.example.com/" },
            { matchType: "suffix", value: "/api/v1" },
          ],
        },
        actions: [{ ...setA }],
      }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.condition.regexFilter)).toEqual([
      "^https://api\\.example\\.com/",
      "/api/v1$",
    ]);
    // 正则元字符整体转义：suffix 含 . 不当作通配
    const dot = toDnrRules([
      rule({
        condition: {
          matches: [{ matchType: "suffix", value: "v1.js" }],
        },
        actions: [{ ...setA }],
      }),
    ]);
    expect(dot[0]!.condition.regexFilter).toBe("v1\\.js$");
  });

  it("方法转小写、资源类型透传", () => {
    const out = toDnrRules([
      rule({
        condition: {
          matches: [P("*://x.com/*")],
          methods: ["GET", "POST"],
          resourceTypes: ["xmlhttprequest", "main_frame"],
        },
        actions: [{ ...setA }],
      }),
    ]);
    expect(out[0]!.condition.requestMethods).toEqual(["get", "post"]);
    expect(out[0]!.condition.resourceTypes).toEqual([
      "xmlhttprequest",
      "main_frame",
    ]);
  });
});

describe("migrateHeaderRule：三代形态归一", () => {
  it("最早期 urlFilter 单值 → matches", async () => {
    const { migrateHeaderRule, newHeaderRule } =
      await import("@/types/headers");
    const m = migrateHeaderRule({
      ...(newHeaderRule() as HeaderRule),
      condition: {
        urlFilter: "*://api.example.com/*",
      } as unknown as HeaderRule["condition"],
    });
    expect(m.condition.matches).toEqual([
      { matchType: "pattern", value: "*://api.example.com/*" },
    ]);
  });

  it("urlFilters 数组形态 → matches", async () => {
    const { migrateHeaderRule, newHeaderRule } =
      await import("@/types/headers");
    const m = migrateHeaderRule({
      ...(newHeaderRule() as HeaderRule),
      condition: {
        matches: [P("https://a.com/*"), P("https://b.com/*")],
      },
    });
    expect(m.condition.matches).toHaveLength(2);
  });

  it("matchType+urlValue 形态 → 对应类型单条", async () => {
    const { migrateHeaderRule, newHeaderRule } =
      await import("@/types/headers");
    const m = migrateHeaderRule({
      ...(newHeaderRule() as HeaderRule),
      condition: {
        matchType: "regex",
        urlValue: "^/api/",
        matches: [],
      } as unknown as HeaderRule["condition"],
    });
    expect(m.condition.matches).toEqual([
      { matchType: "regex", value: "^/api/" },
    ]);
  });
});

describe("toDnrRules 排除域名", () => {
  it("excludeDomains 映射为 excludedRequestDomains，*. 通配被剥离", () => {
    const out = toDnrRules([
      rule({
        condition: {
          matches: [{ matchType: "pattern", value: "*://api.example.com/*" }],
          excludeDomains: ["*.ads.com", "tracker.net"],
        },
        actions: [{ ...setA }],
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.condition.excludedRequestDomains).toEqual([
      "ads.com",
      "tracker.net",
    ]);
  });
});

describe("toDnrRules 排序权重", () => {
  it("order 越大 priority 越高（同头冲突后写者生效）", () => {
    const out = toDnrRules([
      rule({ order: 0, actions: [{ ...setA }] }),
      rule({ order: 5, actions: [{ ...setA }] }),
    ]);
    const priorities = out.map((r) => r.priority);
    expect(priorities.every((p) => p > 0)).toBe(true);
    expect(Math.max(...priorities)).toBe(1 + 5);
  });
});

describe("toDnrRules 重定向", () => {
  it("正则匹配 → regexSubstitution 且 condition 为 regexFilter", () => {
    const out = toDnrRules([
      rule({
        kind: "redirect",
        redirectTo: "https://new.example.com/$1",
        condition: {
          matches: [{ matchType: "regex", value: "^https://a\\.com/(.*)" }],
        },
        actions: [],
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.condition.regexFilter).toBe("(?i)^https://a\\.com/(.*)");
    expect(out[0]!.action.type).toBe("redirect");
    if (out[0]!.action.type === "redirect") {
      expect(out[0]!.action.redirect.regexSubstitution).toBe(
        "https://new.example.com/$1",
      );
    }
  });

  it("模式匹配 → 固定 url 目标", () => {
    const out = toDnrRules([
      rule({
        kind: "redirect",
        redirectTo: "https://mirror.example.com/x",
        condition: { matches: [{ matchType: "pattern", value: "*://a.com/*" }] },
        actions: [],
      }),
    ]);
    expect(out[0]!.action.type).toBe("redirect");
    if (out[0]!.action.type === "redirect") {
      expect(out[0]!.action.redirect.url).toBe(
        "https://mirror.example.com/x",
      );
    }
  });
});

describe("toDnrRules 排除方法/类型", () => {
  it("excludeMethods/excludeResourceTypes 映射为 DNR excluded* 字段", () => {
    const out = toDnrRules([
      rule({
        condition: {
          matches: [{ matchType: "pattern", value: "*://*/*" }],
          excludeMethods: ["POST", "PUT"],
          excludeResourceTypes: ["script" as never],
        },
        actions: [{ ...setA }],
      }),
    ]);
    expect(out[0]!.condition.excludedRequestMethods).toEqual(["post", "put"]);
    expect(out[0]!.condition.excludedResourceTypes).toEqual(["script"]);
  });
});

describe("toDnrRules 查询参数改写", () => {
  it("query 规则产出 redirect.transform.queryTransform（add/replace + remove）", () => {
    const out = toDnrRules([
      rule({
        kind: "query",
        queryActions: [
          { op: "add", name: "token", value: "abc" },
          { op: "remove", name: "debug" },
        ],
        condition: { matches: [{ matchType: "pattern", value: "*://a.com/*" }] },
        actions: [],
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.action.type).toBe("redirect");
    if (out[0]!.action.type === "redirect") {
      const t = out[0]!.action.redirect.transform?.queryTransform;
      expect(t?.addOrReplaceParams).toEqual([{ key: "token", value: "abc" }]);
      expect(t?.removeParams).toEqual(["debug"]);
    }
  });
});

describe("toDnrRules URL 正则排除降级", () => {
  it("含 excludeRegex 的规则在 DNR 不下发（改由 Firefox MV2 全量处理）", () => {
    const out = toDnrRules([
      rule({
        condition: {
          matches: [{ matchType: "pattern", value: "*://a.com/*" }],
          excludeRegex: ["/internal/.*"],
        },
        actions: [{ ...setA }],
      }),
      rule({ condition: { matches: [{ matchType: "pattern", value: "*://b.com/*" }] }, actions: [{ ...setA }] }),
    ]);
    // 仅第二条（无排除正则）产出；第一条被跳过
    expect(out).toHaveLength(1);
    expect(out[0]!.condition.urlFilter).toBe("*://b.com/*");
  });
});

describe("toDnrRules 响应体规则降级", () => {
  it("body 类型规则在 DNR 不下发", () => {
    const out = toDnrRules([
      rule({ kind: "body", bodyActions: [{ match: "a", replace: "b" }] }),
      rule({ condition: { matches: [{ matchType: "pattern", value: "*://b.com/*" }] }, actions: [{ ...setA }] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.condition.urlFilter).toBe("*://b.com/*");
  });
});
