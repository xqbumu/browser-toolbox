import { describe, expect, it } from "vitest";
import { applyBodyActions, isTextualContentType } from "@/core/headers/body";
import {
  validateHeaderRule,
  newHeaderRule,
  type HeaderRule,
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

describe("applyBodyActions 纯文本替换", () => {
  it("字符串替换（默认不区分大小写）", () => {
    expect(
      applyBodyActions("Hello WORLD", [{ match: "world", replace: "X" }]),
    ).toBe("Hello X");
  });
  it("区分大小写时保持原样", () => {
    expect(
      applyBodyActions("Hello WORLD", [
        { match: "world", replace: "X", caseSensitive: true },
      ]),
    ).toBe("Hello WORLD");
  });
  it("正则替换", () => {
    expect(
      applyBodyActions("<div>1</div><div>2</div>", [
        { match: "<div>(.*?)</div>", replace: "[$1]", isRegex: true },
      ]),
    ).toBe("[1][2]");
  });
  it("多条动作顺序执行", () => {
    expect(
      applyBodyActions("a b c", [
        { match: "a", replace: "x" },
        { match: "b", replace: "y" },
      ]),
    ).toBe("x y c");
  });
  it("替换值为空则删除匹配内容", () => {
    expect(
      applyBodyActions("foo BAR baz", [{ match: "bar", replace: "" }]),
    ).toBe("foo  baz");
  });
  it("非法正则跳过该动作", () => {
    expect(
      applyBodyActions("abc", [{ match: "(", replace: "x", isRegex: true }]),
    ).toBe("abc");
  });
});

describe("isTextualContentType", () => {
  it("识别文本与 json", () => {
    expect(isTextualContentType("text/html; charset=utf-8")).toBe(true);
    expect(isTextualContentType("application/json")).toBe(true);
    expect(isTextualContentType("image/png")).toBe(false);
    expect(isTextualContentType(undefined)).toBe(false);
  });
});

describe("validateHeaderRule - 响应体", () => {
  const hasErr = (errs: string[], sub: string) =>
    expect(errs.some((e) => e.includes(sub))).toBe(true);
  it("缺少 bodyActions 时报错", () => {
    hasErr(
      validateHeaderRule(rule({ kind: "body" })),
      "至少需要一条响应体替换动作",
    );
  });
  it("查找为空或正则非法时报错", () => {
    hasErr(
      validateHeaderRule(rule({ kind: "body", bodyActions: [{ match: "" }] })),
      "查找内容不能为空",
    );
    hasErr(
      validateHeaderRule(
        rule({ kind: "body", bodyActions: [{ match: "(", isRegex: true }] }),
      ),
      "正则表达式不合法",
    );
  });
  it("合法时通过", () => {
    expect(
      validateHeaderRule(
        rule({ kind: "body", bodyActions: [{ match: "a", replace: "b" }] }),
      ),
    ).toHaveLength(0);
  });
});
