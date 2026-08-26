import { describe, expect, it } from "vitest";
import {
  conditionMatches,
  matchPatternToRegExp,
  matchedRules,
  urlMatchesPattern,
} from "@/core/headers/match";
import { newHeaderRule, type HeaderRule } from "@/types/headers";

function rule(partial: Partial<HeaderRule>): HeaderRule {
  return {
    ...newHeaderRule(),
    id: "r1",
    name: "测试规则",
    enabled: true,
    condition: { urlFilters: ["*://*/*"] },
    actions: [{ target: "request", op: "set", name: "X-Test", value: "1" }],
    ...partial,
  };
}

function matches(patterns: string[], url: string): boolean {
  return conditionMatches({ urlFilters: patterns }, url);
}

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

describe("matchedRules", () => {
  it("只返回启用且命中的规则", () => {
    const rules = [
      rule({ id: "hit", condition: { urlFilters: ["*://api.example.com/*"] } }),
      rule({
        id: "disabled",
        enabled: false,
        condition: { urlFilters: ["*://*/*"] },
      }),
      rule({ id: "miss", condition: { urlFilters: ["https://other.io/*"] } }),
    ];
    const got = matchedRules(rules, "https://api.example.com/v1/users");
    expect(got.map((r) => r.id)).toEqual(["hit"]);
  });

  it("空 URL 返回空", () => {
    expect(matchedRules([rule({})], "")).toEqual([]);
  });
});

describe("多模式条件", () => {
  it("任一 pattern 命中即生效", () => {
    expect(
      matches(
        ["https://a.com/*", "https://b.org/api/*"],
        "https://b.org/api/x",
      ),
    ).toBe(true);
    expect(
      matches(["https://a.com/*", "https://b.org/api/*"], "https://c.io/"),
    ).toBe(false);
  });

  it("空 pattern 列表恒不命中", () => {
    expect(matches([], "https://a.com/")).toBe(false);
  });

  it("全匹配与具体模式混用时整体命中", () => {
    expect(matches(["*", "https://a.com/*"], "https://anything.net/")).toBe(
      true,
    );
  });
});

describe('migrateHeaderRule', () => {
  it('旧单值 urlFilter 迁移为数组', async () => {
    const { migrateHeaderRule } = await import('@/types/headers');
    const legacy = {
      ...newHeaderRule(),
      condition: { urlFilter: '*://api.example.com/*' },
    } as unknown as HeaderRule;
    const migrated = migrateHeaderRule(legacy);
    expect(migrated.condition.urlFilters).toEqual(['*://api.example.com/*']);
    expect((migrated.condition as { urlFilter?: string }).urlFilter).toBeUndefined();
  });

  it('缺失字段补默认值', async () => {
    const { migrateHeaderRule } = await import('@/types/headers');
    const migrated = migrateHeaderRule({
      ...(newHeaderRule() as unknown as HeaderRule),
      name: undefined as unknown as string,
      enabled: undefined as unknown as boolean,
      createdAt: undefined as unknown as number,
      updatedAt: undefined as unknown as number,
    });
    expect(migrated.name).toBe('');
    expect(migrated.enabled).toBe(false);
    expect(Number.isFinite(migrated.createdAt)).toBe(true);
  });
});
