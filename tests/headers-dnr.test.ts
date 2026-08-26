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

  it("contains 转义为 regexFilter；regex 原样透传", () => {
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
