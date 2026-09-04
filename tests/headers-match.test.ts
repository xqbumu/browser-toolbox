import { describe, expect, it } from "vitest";
import {
  conditionMatches,
  matchPatternToRegExp,
  urlMatchesPattern,
} from "@/core/headers/match";
import {
  describeCondition,
  newHeaderRule,
  type HeaderRule,
  type UrlMatchItem,
} from "@/types/headers";

function rule(partial: Partial<HeaderRule>): HeaderRule {
  return {
    ...newHeaderRule(),
    id: "r1",
    name: "测试规则",
    enabled: true,
    condition: { matches: [{ matchType: "pattern", value: "*://*/*" }] },
    actions: [{ target: "request", op: "set", name: "X-Test", value: "1" }],
    ...partial,
  };
}

const P = (value: string): UrlMatchItem => ({ matchType: "pattern", value });

describe("matchPatternToRegExp", () => {
  it("全匹配 pattern", () => {
    expect(urlMatchesPattern("https://a.com/x", "<all_urls>")).toBe(true);
    expect(urlMatchesPattern("ftp://b.org/", "*")).toBe(true);
  });

  it("scheme 通配与指定 scheme", () => {
    expect(urlMatchesPattern("http://api.x.com/a", "*://*.x.com/*")).toBe(true);
    expect(urlMatchesPattern("https://api.x.com/a", "*://*.x.com/*")).toBe(
      true,
    );
    expect(urlMatchesPattern("https://x.com/a", "https://x.com/*")).toBe(true);
    expect(urlMatchesPattern("http://x.com/a", "https://x.com/*")).toBe(false);
  });

  it("子域通配含多级且不误匹配后缀", () => {
    const re = matchPatternToRegExp("*://*.example.com/*");
    expect(re?.test("https://a.b.example.com/p")).toBe(true);
    expect(re?.test("https://example.com/p")).toBe(true);
    // notexample.com 不应命中 *.example.com
    expect(re?.test("https://notexample.com/p")).toBe(false);
  });

  it("路径前缀精确到字符", () => {
    expect(
      urlMatchesPattern("https://x.com/api/v1", "https://x.com/api/*"),
    ).toBe(true);
    expect(
      urlMatchesPattern("https://x.com/apiv2", "https://x.com/api/*"),
    ).toBe(false);
  });

  it("非法 pattern 恒不命中", () => {
    expect(urlMatchesPattern("https://x.com/", "not a pattern")).toBe(false);
  });
});

describe("条件组（matches）判定", () => {
  const c = (items: UrlMatchItem[]) =>
    ({ matches: items }) as HeaderRule["condition"];

  it("任一命中即生效（OR）", () => {
    const cond = c([P("https://a.com/*"), P("https://b.org/api/*")]);
    expect(conditionMatches(cond, "https://b.org/api/x")).toBe(true);
    expect(conditionMatches(cond, "https://c.io/")).toBe(false);
  });

  it("混合方式：pattern + contains + regex 组合判定", () => {
    const cond = c([
      P("https://a.com/*"),
      { matchType: "contains", value: "/api/v2/" },
      { matchType: "regex", value: "^https://cdn\\.[a-z]+\\.net/" },
    ]);
    expect(conditionMatches(cond, "https://x.io/api/v2/u")).toBe(true);
    expect(conditionMatches(cond, "https://cdn.abc.net/f.js")).toBe(true);
    expect(conditionMatches(cond, "https://plain.org/")).toBe(false);
  });

  it("空组恒不命中；非法正则恒不命中", () => {
    expect(conditionMatches(c([]), "https://a.com/")).toBe(false);
    expect(
      conditionMatches(
        c([{ matchType: "regex", value: "(" }]),
        "https://a.com/",
      ),
    ).toBe(false);
  });
});

describe("prefix / suffix 匹配方式", () => {
  const c = (m: UrlMatchItem) => ({ matches: [m] }) as HeaderRule["condition"];

  it("prefix 命中 URL 开头，不误匹配相邻前缀", () => {
    const cond = c({ matchType: "prefix", value: "https://api.example.com/" });
    expect(conditionMatches(cond, "https://api.example.com/v1/x")).toBe(true);
    expect(conditionMatches(cond, "https://api.example.com")).toBe(false);
    expect(conditionMatches(cond, "https://api.example.com.evil.org/x")).toBe(
      false,
    );
  });

  it("suffix 按完整 URL 字面结尾匹配（含查询串 / 锚点会中断）", () => {
    const cond = c({ matchType: "suffix", value: "/api/v1" });
    expect(conditionMatches(cond, "https://a.com/api/v1")).toBe(true);
    // 后缀作用于完整 URL 字符串：带查询串时不命中（如需忽略查询请用正则）
    expect(conditionMatches(cond, "https://a.com/api/v1?x=1")).toBe(false);
    expect(conditionMatches(cond, "https://a.com/api/v1x")).toBe(false);
  });

  it("describeCondition 输出可读标签", () => {
    expect(
      describeCondition(c({ matchType: "prefix", value: "https://a.com/" })),
    ).toBe("前缀 https://a.com/");
    expect(
      describeCondition(c({ matchType: "suffix", value: "/v1" })),
    ).toBe("后缀 /v1");
  });
});

describe("conditionMatches 方法/资源过滤", () => {
  const base = {
    urlFilters: undefined,
    matches: [P("*://*/*")],
  } as HeaderRule["condition"];

  it("方法受限：大小写不敏感匹配", () => {
    const cond = { ...base, methods: ["POST"] };
    expect(conditionMatches(cond, "https://x.com/", "POST")).toBe(true);
    expect(conditionMatches(cond, "https://x.com/", "GET")).toBe(false);
  });

  it("资源类型受限：类型未知时跳过判断（宽松）", () => {
    const cond: HeaderRule["condition"] = {
      ...base,
      resourceTypes: ["xmlhttprequest"],
    };
    expect(conditionMatches(cond, "https://x.com/", "GET")).toBe(true); // 未传类型 → 不限
    expect(
      conditionMatches(cond, "https://x.com/", "GET", "xmlhttprequest"),
    ).toBe(true);
    expect(conditionMatches(cond, "https://x.com/", "GET", "main_frame")).toBe(
      false,
    );
  });
});
