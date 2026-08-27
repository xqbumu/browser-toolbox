import { describe, expect, it } from "vitest";
import { validateHeaderRule, newHeaderRule } from "@/types/headers";

describe("validateHeaderRule 重定向", () => {
  it("正则匹配重定向允许 $1 引用目标（非绝对地址不报错）", () => {
    const rule = {
      ...newHeaderRule(),
      name: "t",
      kind: "redirect" as const,
      redirectTo: "https://new.example.com/$1",
      condition: {
        matches: [
          { matchType: "regex" as const, value: "^https://a\\.com/(.*)" },
        ],
      },
      actions: [],
    };
    expect(validateHeaderRule(rule)).toHaveLength(0);
  });

  it("模式匹配重定向要求绝对地址", () => {
    const rule = {
      ...newHeaderRule(),
      name: "t",
      kind: "redirect" as const,
      redirectTo: "/relative",
      condition: {
        matches: [{ matchType: "pattern" as const, value: "*://a.com/*" }],
      },
      actions: [],
    };
    expect(validateHeaderRule(rule)).toEqual(
      expect.arrayContaining([
        "非正则匹配时，重定向目标必须是 http(s) 绝对地址",
      ]),
    );
  });

  it("重定向目标为空报错", () => {
    const rule = {
      ...newHeaderRule(),
      name: "t",
      kind: "redirect" as const,
      redirectTo: "",
      condition: {
        matches: [{ matchType: "pattern" as const, value: "*://a.com/*" }],
      },
      actions: [],
    };
    expect(validateHeaderRule(rule)).toEqual(
      expect.arrayContaining(["重定向目标不能为空"]),
    );
  });
});
