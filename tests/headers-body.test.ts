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

import { rewriteResponse, type FilterSink } from "@/core/headers/body";

function mockFilter(): {
  sink: FilterSink;
  written: string;
  closed: boolean;
  feed: (text: string) => void;
  stop: () => void;
} {
  let buf = "";
  const written: string[] = [];
  let closed = false;
  let onData: ((e: { data: ArrayBuffer }) => void) | undefined;
  let onStop: (() => void) | undefined;
  const decoder = new TextDecoder("utf-8");
  const sink: FilterSink = {
    write: (chunk: Uint8Array) => written.push(decoder.decode(chunk)),
    close: () => {
      closed = true;
    },
    ondata: { addListener: (cb) => (onData = cb) },
    onstop: { addListener: (cb) => (onStop = cb) },
    onerror: { addListener: () => {} },
  };
  return {
    sink,
    get written() {
      return written.join("");
    },
    get closed() {
      return closed;
    },
    feed: (text: string) => onData?.({ data: new TextEncoder().encode(text).buffer as ArrayBuffer }),
    stop: () => onStop?.(),
  };
}

describe("rewriteResponse 流式路径", () => {
  it("文本响应按 chunk 拼装后整体改写并回写", () => {
    const f = mockFilter();
    rewriteResponse(f.sink, "text/html; charset=utf-8", [
      { match: "foo", replace: "bar" },
    ]);
    f.feed("<p>foo</p>");
    f.feed("<p>foo2</p>");
    f.stop();
    expect(f.written).toBe("<p>bar</p><p>bar2</p>");
    expect(f.closed).toBe(true);
  });
  it("非文本响应直接关闭、不回写", () => {
    const f = mockFilter();
    rewriteResponse(f.sink, "image/png", [{ match: "x", replace: "y" }]);
    f.feed("binary");
    f.stop();
    expect(f.written).toBe("");
    expect(f.closed).toBe(true);
  });
  it("无动作时同样关闭、不回写", () => {
    const f = mockFilter();
    rewriteResponse(f.sink, "application/json", []);
    expect(f.written).toBe("");
    expect(f.closed).toBe(true);
  });
});
