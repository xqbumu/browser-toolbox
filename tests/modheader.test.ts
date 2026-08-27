import { describe, expect, it } from "vitest";
import { isModHeaderExport, parseModHeader } from "@/core/headers/modheader";
import { validateHeaderRule } from "@/types/headers";

const sample = {
  name: "ModHeader Export",
  profiles: [
    {
      title: "Add auth",
      enabled: true,
      urlFilter: "*://api.example.com/*",
      headers: [
        { key: "X-Token", value: "abc", type: "request", enabled: true },
        { key: "X-Strip", value: "", type: "request", enabled: true },
        { key: "Server", value: "hidden", type: "response", enabled: true },
        { key: "Disabled", value: "x", type: "request", enabled: false },
      ],
    },
  ],
};

describe("ModHeader 导入兼容", () => {
  it("识别 ModHeader 导出并转换", () => {
    expect(isModHeaderExport(sample)).toBe(true);
    expect(isModHeaderExport([{ headers: [] }])).toBe(true);
    expect(isModHeaderExport([{ title: "no headers" }])).toBe(false);
  });

  it("每个 profile 转一条规则，字段映射正确（含禁用头跳过、空值视为 remove）", () => {
    const rules = parseModHeader(sample).map((r) => ({
      ...r,
      condition: { ...r.condition, matches: r.condition.matches },
    }));
    expect(rules).toHaveLength(1);
    const r = rules[0]!;
    expect(r.name).toBe("Add auth");
    expect(r.enabled).toBe(true);
    expect(r.condition.matches[0]).toEqual({
      matchType: "pattern",
      value: "*://api.example.com/*",
    });
    const req = r.actions.filter((a) => a.target === "request");
    expect(req).toHaveLength(2); // 一条 set + 一条 remove，Disabled 被跳过
    expect(req[0]).toEqual({
      target: "request",
      op: "set",
      name: "X-Token",
      value: "abc",
    });
    expect(req[1]).toEqual({
      target: "request",
      op: "remove",
      name: "X-Strip",
    });
    expect(r.actions.some((a) => a.target === "response")).toBe(true);
    expect(validateHeaderRule(r)).toHaveLength(0);
  });

  it("导出直接是 profiles 数组也能解析", () => {
    const arr = [
      { title: "P", headers: [{ key: "A", value: "1", type: "request" }] },
    ];
    expect(parseModHeader(arr)).toHaveLength(1);
  });
});

describe("ModHeader 新版 urlConds 映射", () => {
  const v2 = {
    name: "ModHeader Export",
    profiles: [
      {
        title: "Conditional",
        enable: true,
        urlConds: [
          { type: "urls", value: ["*://api.example.com/*"] },
          { type: "methods", value: ["GET", "post"] },
          { type: "resourceTypes", value: ["main_frame", "xmlhttprequest"] },
          { type: "urlFilter", op: "contains", value: "/v1/" },
          {
            type: "urlFilter",
            op: "prefix",
            value: "https://api.example.com/sec",
          },
        ],
        headers: [
          {
            enabled: true,
            name: "X-Token",
            value: "abc",
            headerType: "request",
            op: "add",
          },
          {
            enabled: true,
            name: "X-Remove",
            value: "",
            headerType: "response",
            op: "remove",
          },
          {
            enabled: true,
            name: "X-Mixed",
            value: "m",
            headerType: "mixed",
            op: "modify",
          },
          {
            enabled: true,
            name: "X-Regex",
            value: "r",
            headerType: "request",
            op: "add",
          }, // 无 urlRegex 覆盖
        ],
      },
    ],
  };

  it("urlConds 映射为 matches/methods/resourceTypes", () => {
    const r = parseModHeader(v2)[0]!;
    expect(r.condition.matches).toEqual([
      { matchType: "pattern", value: "*://api.example.com/*" },
      { matchType: "contains", value: "/v1/" },
      { matchType: "regex", value: "^https://api\\.example\\.com/sec" },
    ]);
    expect(r.condition.methods).toEqual(["GET", "POST"]);
    expect(r.condition.resourceTypes).toEqual(["main_frame", "xmlhttprequest"]);
  });

  it("headerType/mixed/remove 映射正确", () => {
    const r = parseModHeader(v2)[0]!;
    const byName = (n: string) => r.actions.filter((a) => a.name === n);
    expect(byName("X-Token")).toEqual([
      { target: "request", op: "set", name: "X-Token", value: "abc" },
    ]);
    // remove 无 value
    expect(byName("X-Remove")).toEqual([
      { target: "response", op: "remove", name: "X-Remove" },
    ]);
    // mixed → request + response 两条
    expect(byName("X-Mixed")).toEqual([
      { target: "request", op: "set", name: "X-Mixed", value: "m" },
      { target: "response", op: "set", name: "X-Mixed", value: "m" },
    ]);
    expect(validateHeaderRule(r)).toHaveLength(0);
  });

  it("isModHeaderExport 识别 urlConds 形态", () => {
    expect(isModHeaderExport(v2)).toBe(true);
    expect(
      isModHeaderExport({
        profiles: [{ title: "x", urlConds: [], headers: [] }],
      }),
    ).toBe(true);
  });
});
