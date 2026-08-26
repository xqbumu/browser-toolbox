import { describe, expect, it } from "vitest";
import { applyHeaderActions, pickActions } from "@/core/headers/webrequest";
import { newHeaderRule, type HeaderRule } from "@/types/headers";

function rule(partial: Partial<HeaderRule>): HeaderRule {
  return {
    ...newHeaderRule(),
    id: "r",
    name: "r",
    enabled: true,
    condition: { urlFilters: ["*://*/*"] },
    actions: [],
    ...partial,
  };
}

const base = [
  { name: "Accept", value: "text/html" },
  { name: "X-Old", value: "gone" },
];

describe("applyHeaderActions", () => {
  it("set 替换同名头（大小写不敏感）", () => {
    const out = applyHeaderActions(base, [
      {
        target: "request",
        op: "set",
        name: "accept",
        value: "application/json",
      },
    ]);
    expect(out.filter((h) => h.name.toLowerCase() === "accept")).toEqual([
      { name: "accept", value: "application/json" },
    ]);
  });

  it("append 保留原值并追加", () => {
    const out = applyHeaderActions(base, [
      {
        target: "request",
        op: "append",
        name: "Accept",
        value: "application/json",
      },
    ]);
    expect(out.filter((h) => h.name === "Accept")).toHaveLength(2);
  });

  it("remove 删除全部同名头", () => {
    const out = applyHeaderActions(
      [...base, { name: "x-old", value: "dup" }],
      [{ target: "request", op: "remove", name: "X-Old" }],
    );
    expect(out.some((h) => h.name.toLowerCase() === "x-old")).toBe(false);
  });

  it("空头部名被忽略", () => {
    const out = applyHeaderActions(base, [
      { target: "request", op: "set", name: "  ", value: "v" },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("pickActions", () => {
  it("仅收集命中 URL 且方向匹配的动作；禁用规则跳过", () => {
    const rules = [
      rule({
        enabled: false,
        actions: [{ target: "request", op: "set", name: "Nope", value: "" }],
      }),
      rule({
        condition: { urlFilters: ["https://api.example.com/*"] },
        actions: [
          { target: "request", op: "set", name: "Req", value: "1" },
          { target: "response", op: "set", name: "Resp", value: "2" },
        ],
      }),
    ];
    const req = pickActions(rules, "https://api.example.com/x", "request");
    expect(req.map((a) => a.name)).toEqual(["Req"]);

    const resp = pickActions(rules, "https://other.com/", "response");
    expect(resp).toEqual([]);
  });

  it("方法受限规则：方法匹配才应用，未知方法不应用", () => {
    const rules = [
      rule({
        condition: { urlFilters: ["*://*/*"], methods: ["POST"] },
        actions: [{ target: "request", op: "set", name: "M", value: "" }],
      }),
    ];
    expect(
      pickActions(rules, "https://x.com/", "request", "POST").map(
        (a) => a.name,
      ),
    ).toEqual(["M"]);
    expect(pickActions(rules, "https://x.com/", "request", "GET")).toEqual([]);
    expect(pickActions(rules, "https://x.com/", "request")).toEqual([]);
  });

  it("资源类型受限规则：类型未知保守跳过，类型不匹配跳过", () => {
    const rules = [
      rule({
        condition: {
          urlFilters: ["*://*/*"],
          resourceTypes: ["xmlhttprequest"],
        },
        actions: [{ target: "request", op: "set", name: "T", value: "" }],
      }),
    ];
    expect(
      pickActions(
        rules,
        "https://x.com/",
        "request",
        "GET",
        "xmlhttprequest",
      ).map((a) => a.name),
    ).toEqual(["T"]);
    expect(
      pickActions(rules, "https://x.com/", "request", "GET", "main_frame"),
    ).toEqual([]);
    // 未知类型（如 csp_report）：宁可漏改不可错改
    expect(pickActions(rules, "https://x.com/", "request", "GET")).toEqual([]);
  });

  it("多模式任一命中即应用", () => {
    const rules = [
      rule({
        condition: { urlFilters: ["https://a.com/*", "https://b.com/*"] },
        actions: [{ target: "request", op: "set", name: "Multi", value: "" }],
      }),
    ];
    expect(pickActions(rules, "https://b.com/x", "request")).toHaveLength(1);
    expect(pickActions(rules, "https://c.io/", "request")).toHaveLength(0);
  });
});
