import { describe, expect, it } from "vitest";
import { DNR_START_ID, toDnrRules } from "@/core/headers/dnr";
import { newHeaderRule, type HeaderRule } from "@/types/headers";

function rule(partial: Partial<HeaderRule>): HeaderRule {
  return {
    ...newHeaderRule(),
    id: "r1",
    name: "r",
    enabled: true,
    condition: { urlFilters: ["*://*/*"] },
    actions: [],
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

const setA = { target: "request", op: "set", name: "A", value: "" } as const;

describe("toDnrRules", () => {
  it("禁用规则不产生动态规则；无动作也不产出", () => {
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
    expect(out[0]!.action.requestHeaders).toEqual([
      { header: "A", operation: "set", value: "1" },
    ]);
    expect(out[1]!.action.responseHeaders).toEqual([
      { header: "B", operation: "remove" },
    ]);
    expect(out[1]!.action.requestHeaders).toBeUndefined();
  });

  it("全匹配省略 urlFilter；具体 pattern 原样透传", () => {
    const all = toDnrRules([rule({ actions: [{ ...setA }] })]);
    expect(all[0]!.condition.urlFilter).toBeUndefined();

    const specific = toDnrRules([
      rule({
        condition: { urlFilters: ["*://api.example.com/*"] },
        actions: [{ ...setA }],
      }),
    ]);
    expect(specific[0]!.condition.urlFilter).toBe("*://api.example.com/*");
  });

  it("多模式展开为多条动态规则，id 连续且头动作一致", () => {
    const out = toDnrRules([
      rule({
        condition: { urlFilters: ["https://a.com/*", "https://b.com/*"] },
        actions: [{ ...setA }],
      }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.condition.urlFilter)).toEqual([
      "https://a.com/*",
      "https://b.com/*",
    ]);
    expect(out.every((r) => r.action.requestHeaders?.[0]?.header === "A")).toBe(
      true,
    );
  });

  it("全匹配吞并其余模式，仅产出一条无条件规则", () => {
    const variants = ["*", "<all_urls>", "*://*/*"];
    for (const all of variants) {
      const out = toDnrRules([
        rule({
          condition: { urlFilters: [all, "https://x.com/*"] },
          actions: [{ ...setA }],
        }),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]!.condition.urlFilter).toBeUndefined();
    }
  });

  it("方法转小写、资源类型透传", () => {
    const out = toDnrRules([
      rule({
        condition: {
          urlFilters: ["*://x.com/*"],
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

  it("多条件规则的 id 从自定义起点连续分配", () => {
    const out = toDnrRules(
      [
        rule({ actions: [{ ...setA }] }),
        rule({ actions: [{ ...setA, name: "B" }] }),
      ],
      500,
    );
    expect(out.map((r) => r.id)).toEqual([500, 501]);
  });
});

describe("normalizePatterns 去重", () => {
  it("重复 pattern 只产出一条动态规则", () => {
    const out = toDnrRules([
      rule({
        condition: {
          urlFilters: ["https://a.com/*", " https://a.com/* ", "https://a.com/*"],
        },
        actions: [{ ...setA }],
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.condition.urlFilter).toBe("https://a.com/*");
  });
});
