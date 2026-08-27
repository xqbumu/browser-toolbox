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
