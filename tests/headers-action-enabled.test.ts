import { describe, expect, it } from "vitest";
import {
  cloneHeaderRule,
  describeActions,
  isActionEnabled,
  isGroupOff,
  makeRuleCopy,
  migrateHeaderRule,
  newHeaderRule,
  validateHeaderRule,
  type HeaderRule,
} from "@/types/headers";
import { toDnrRules } from "@/core/headers/dnr";
import {
  applyHeaderActions,
  applyQueryTransform,
  collectRuleHits,
} from "@/core/headers/webrequest";

const base: HeaderRule = {
  ...newHeaderRule(),
  id: "r1",
  name: "测试",
  condition: { matches: [{ matchType: "pattern", value: "*://*/*" }] },
  actions: [
    { target: "request", op: "set", name: "X-A", value: "1" },
    { target: "request", op: "set", name: "X-B", value: "2", enabled: false },
  ],
};

describe("动作启用开关", () => {
  it("isActionEnabled 缺省视为启用", () => {
    expect(isActionEnabled({})).toBe(true);
    expect(isActionEnabled({ enabled: false })).toBe(false);
  });
  it("停用动作不参与校验（可保留草稿）", () => {
    const bad: HeaderRule = {
      ...base,
      actions: [
        { target: "request", op: "set", name: "X-A", value: "1" },
        { target: "request", op: "set", name: "", value: "", enabled: false },
      ],
    };
    expect(validateHeaderRule(bad)).toEqual([]);
  });
  it("动作可全部停用（整组停放），仅空列表才报错", () => {
    const allOff: HeaderRule = {
      ...base,
      actions: [
        {
          target: "request",
          op: "set",
          name: "X-A",
          value: "1",
          enabled: false,
        },
      ],
    };
    expect(validateHeaderRule(allOff)).toEqual([]);
    expect(validateHeaderRule({ ...base, actions: [] })).toContain(
      "至少需要一条头部动作",
    );
    expect(describeActions(allOff)).toBe("动作已全部停用");
  });
  it("错误编号保留原下标（与编辑器行号一致）", () => {
    const bad: HeaderRule = {
      ...base,
      actions: [
        { target: "request", op: "set", name: "X-A", value: "1" },
        { target: "request", op: "set", name: "X-B", value: "2" },
        { target: "request", op: "set", name: "", value: "x" },
      ],
    };
    expect(validateHeaderRule(bad)).toContain("动作 #3：头部名称不合法（空）");
  });
  it("describeActions 只统计启用并标注停用数", () => {
    expect(describeActions(base)).toBe("请求 ×1（1 已停用）");
  });
  it("DNR 只下发启用动作", () => {
    const dnr = toDnrRules([base]);
    expect(dnr.length).toBe(1);
    const headers =
      dnr[0]!.action.type === "modifyHeaders"
        ? ((dnr[0]!.action as { requestHeaders?: { header: string }[] })
            .requestHeaders ?? [])
        : [];
    expect(headers.map((h) => h.header)).toEqual(["X-A"]);
  });
  it("DNR 跳过启用动作全空的 query 规则（不下发空 transform）", () => {
    const q: HeaderRule = {
      ...base,
      id: "rq",
      kind: "query",
      actions: [],
      queryActions: [{ op: "add", name: "k", value: "1", enabled: false }],
    };
    expect(toDnrRules([q])).toEqual([]);
    const qOn: HeaderRule = {
      ...q,
      queryActions: [{ op: "add", name: "k", value: "1" }],
    };
    expect(toDnrRules([qOn]).length).toBe(1);
  });
  it("webRequest 命中/应用跳过停用动作", () => {
    const hits = collectRuleHits([base], "https://a.com/", "request", "GET");
    expect(hits[0]!.actions.map((a) => a.name)).toEqual(["X-A"]);
    const out = applyHeaderActions(
      [{ name: "X-Old", value: "0" }],
      base.actions,
    );
    expect(out.map((h) => h.name)).toEqual(["X-Old", "X-A"]);
  });
  it("query 变换跳过停用动作", () => {
    const url = applyQueryTransform("https://a.com/?k=1", [
      { op: "remove", name: "k", enabled: false },
    ]);
    expect(url).toBe("https://a.com/?k=1");
  });
  it("cloneHeaderRule 生成副本", () => {
    const copy = cloneHeaderRule(base, "r2");
    expect(copy.id).toBe("r2");
    expect(copy.name).toBe("测试 副本");
    expect(copy.actions.length).toBe(2);
  });
  it("makeRuleCopy 追加到末尾（order 取最大 +1）", () => {
    const copy = makeRuleCopy(
      [
        { ...base, order: 3 },
        { ...base, id: "r9", order: 7 },
      ],
      base,
      "r3",
    );
    expect(copy.id).toBe("r3");
    expect(copy.order).toBe(8);
  });
  it("isGroupOff：未分组恒启用，组停用则成员停用", () => {
    const groups = [
      { id: "g1", name: "A", enabled: true, createdAt: 0 },
      { id: "g2", name: "B", enabled: false, createdAt: 0 },
    ];
    expect(isGroupOff({ ...base, groupId: undefined }, groups)).toBe(false);
    expect(isGroupOff({ ...base, groupId: "g1" }, groups)).toBe(false);
    expect(isGroupOff({ ...base, groupId: "g2" }, groups)).toBe(true);
  });
  it("migrate 保留排除条件与方法/资源类型及前后缀匹配", () => {
    const raw = {
      ...base,
      condition: {
        matches: [
          { matchType: "prefix", value: "https://api.example.com/" },
          { matchType: "suffix", value: "/v1" },
        ],
        resourceTypes: ["script"],
        methods: ["GET"],
        excludeDomains: ["ads.example.com"],
        excludeMethods: ["OPTIONS"],
        excludeResourceTypes: ["image"],
        excludeRegex: ["/internal/.*"],
      },
    } as HeaderRule;
    const migrated = migrateHeaderRule(raw);
    expect(migrated.condition.matches).toEqual([
      { matchType: "prefix", value: "https://api.example.com/" },
      { matchType: "suffix", value: "/v1" },
    ]);
    expect(migrated.condition.resourceTypes).toEqual(["script"]);
    expect(migrated.condition.methods).toEqual(["GET"]);
    expect(migrated.condition.excludeDomains).toEqual(["ads.example.com"]);
    expect(migrated.condition.excludeMethods).toEqual(["OPTIONS"]);
    expect(migrated.condition.excludeResourceTypes).toEqual(["image"]);
    expect(migrated.condition.excludeRegex).toEqual(["/internal/.*"]);
    expect(validateHeaderRule(migrated)).toEqual([]);
  });
});
