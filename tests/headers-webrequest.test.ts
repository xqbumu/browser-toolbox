import { describe, expect, it } from "vitest";
import {
  applyHeaderActions,
  applyQueryTransform,
  pickActions,
} from "@/core/headers/webrequest";
import {
  newHeaderRule,
  type HeaderRule,
  type UrlMatchItem,
} from "@/types/headers";

function rule(partial: Partial<HeaderRule>): HeaderRule {
  return {
    ...newHeaderRule(),
    id: "r",
    name: "r",
    enabled: true,
    condition: { matches: [{ matchType: "pattern", value: "*://*/*" }] },
    actions: [],
    ...partial,
  };
}

const P = (value: string): UrlMatchItem => ({
  matchType: "pattern",
  value,
});

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
  it("仅收集命中 URL 且方向匹配的动作（enabled 过滤由调用方负责）", () => {
    const rules = [
      rule({
        // 不命中下方 URL，故被 URL 匹配阶段排除（pickActions 不再二次判断 enabled）
        condition: { matches: [P("https://other.com/*")] },
        actions: [{ target: "request", op: "set", name: "Nope", value: "" }],
      }),
      rule({
        condition: {
          matches: [
            P("https://api.example.com/*"),
            P("https://api.example.org/*"),
          ],
        },
        actions: [
          { target: "request", op: "set", name: "Req", value: "1" },
          { target: "response", op: "set", name: "Resp", value: "2" },
        ],
      }),
    ];
    expect(
      pickActions(rules, "https://api.example.com/x", "request").map(
        (a) => a.name,
      ),
    ).toEqual(["Req"]);
    expect(pickActions(rules, "https://other.com/", "response")).toEqual([]);
  });

  it("多条件组任一命中即应用", () => {
    const rules = [
      rule({
        condition: {
          matches: [P("https://a.com/*"), P("https://b.com/*")],
        },
        actions: [{ target: "request", op: "set", name: "Multi", value: "" }],
      }),
    ];
    expect(pickActions(rules, "https://b.com/x", "request")).toHaveLength(1);
    expect(pickActions(rules, "https://c.io/", "request")).toEqual([]);
  });

  it("contains 匹配走同一谓词", () => {
    const rules = [
      rule({
        condition: {
          matches: [{ matchType: "contains", value: "/api/v2/" }],
        },
        actions: [{ target: "request", op: "set", name: "C", value: "" }],
      }),
    ];
    expect(pickActions(rules, "https://x.io/api/v2/u", "request")).toHaveLength(
      1,
    );
    expect(pickActions(rules, "https://x.io/api/v1/u", "request")).toEqual([]);
  });

  it("方法受限规则：方法匹配才应用，未知方法不应用", () => {
    const rules = [
      rule({
        condition: { matches: [P("*://*/*")], methods: ["POST"] },
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
          matches: [P("*://*/*")],
          resourceTypes: ["xmlhttprequest"],
        },
        actions: [{ target: "request", op: "set", name: "T", value: "" }],
      }),
    ];
    expect(
      pickActions(rules, "https://x.com/", "request", "GET", "xmlhttprequest"),
    ).toHaveLength(1);
    expect(
      pickActions(rules, "https://x.com/", "request", "GET", "main_frame"),
    ).toEqual([]);
    // 未知类型（如 csp_report）：宁可漏改不可错改
    expect(pickActions(rules, "https://x.com/", "request", "GET")).toEqual([]);
  });
});

describe("pickActions 排除域名", () => {
  it("命中排除域名时不返回任何动作", () => {
    const r = rule({
      condition: {
        matches: [{ matchType: "pattern", value: "*://api.example.com/*" }],
        excludeDomains: ["*.ads.com"],
      },
      actions: [{ target: "request", op: "set", name: "X", value: "1" }],
    });
    const hit = pickActions([r], "https://api.example.com/x", "request");
    const excluded = pickActions(
      [r],
      "https://sub.ads.com/x?back=https://api.example.com/x",
      "request",
    );
    expect(hit.length).toBe(1);
    expect(excluded.length).toBe(0);
  });
});

describe("pickActions 排除方法/类型", () => {
  it("命中排除方法或资源类型时不返回动作", () => {
    const r = rule({
      condition: {
        matches: [{ matchType: "pattern", value: "*://api.example.com/*" }],
        excludeMethods: ["POST"],
      },
      actions: [{ target: "request", op: "set", name: "X", value: "1" }],
    });
    expect(
      pickActions([r], "https://api.example.com/x", "request", "GET"),
    ).toHaveLength(1);
    expect(
      pickActions([r], "https://api.example.com/x", "request", "POST"),
    ).toHaveLength(0);
  });
});

describe("applyQueryTransform", () => {
  it("添加覆盖参数并移除参数，原样未变时返回原 URL", () => {
    const base = "https://a.com/x?foo=1";
    const a = applyQueryTransform(base, [
      { op: "add", name: "bar", value: "2" },
      { op: "remove", name: "foo" },
    ]);
    expect(a).toBe("https://a.com/x?bar=2");
    const same = applyQueryTransform("https://a.com/x?foo=1", [
      { op: "add", name: "foo", value: "1" },
    ]);
    expect(same).toBe("https://a.com/x?foo=1");
  });

  it("非法 URL 原样返回", () => {
    expect(
      applyQueryTransform("not-a-url", [{ op: "add", name: "x", value: "1" }]),
    ).toBe("not-a-url");
  });
});

describe("pickActions URL 正则排除", () => {
  it("命中排除正则时不返回动作（仅 Firefox 全量生效）", () => {
    const r = rule({
      condition: {
        matches: [{ matchType: "pattern", value: "*://api.example.com/*" }],
        excludeRegex: ["/internal/.*"],
      },
      actions: [{ target: "request", op: "set", name: "X", value: "1" }],
    });
    expect(
      pickActions([r], "https://api.example.com/internal/secret", "request"),
    ).toHaveLength(0);
    expect(
      pickActions([r], "https://api.example.com/public", "request"),
    ).toHaveLength(1);
  });
});
