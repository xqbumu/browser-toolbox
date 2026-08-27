import { describe, it, expect } from "vitest";
import { encodeMessage, NmDecoder } from "../mcp-bridge/nm-frame.mjs";

describe("native messaging 帧编解码", () => {
  it("encodeMessage 输出 4 字节长度前缀 + JSON", () => {
    const buf = encodeMessage({ a: 1 });
    expect(buf.readUInt32LE(0)).toBe(buf.length - 4);
    const parsed = JSON.parse(buf.slice(4).toString("utf8"));
    expect(parsed).toEqual({ a: 1 });
  });

  it("分片到达也能拼出完整消息", () => {
    const full = encodeMessage({ hello: "world", n: 42 });
    const got: unknown[] = [];
    const dec = new NmDecoder((m: unknown) => got.push(m));
    // 逐字节喂入，模拟 TCP 分片
    for (const b of full) dec.push(Buffer.from([b]));
    expect(got).toEqual([{ hello: "world", n: 42 }]);
  });

  it("多条消息连续到达全部解析", () => {
    const a = encodeMessage({ i: 1 });
    const b = encodeMessage({ i: 2 });
    const got: unknown[] = [];
    const dec = new NmDecoder((m: unknown) => got.push(m));
    dec.push(Buffer.concat([a, b]));
    expect(got).toEqual([{ i: 1 }, { i: 2 }]);
  });

  it("多字节 UTF-8 不破坏帧", () => {
    const msg = { text: "中文测试🔧" };
    const full = encodeMessage(msg);
    const got: unknown[] = [];
    const dec = new NmDecoder((m: unknown) => got.push(m));
    dec.push(full);
    expect(got[0]).toEqual(msg);
  });
});
