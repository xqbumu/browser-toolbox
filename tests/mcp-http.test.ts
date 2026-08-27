import { describe, it, expect } from "vitest";
import {
  parseHttpRequest,
  buildHttpResponse,
  jsonResponse,
  sseFrame,
  sseResponse,
  isSseAccepted,
} from "@/core/mcp/http";
import type { JsonRpcResponse } from "@/core/mcp/types";

describe("HTTP 解析/序列化", () => {
  it("解析 POST 请求行、头部与 body", () => {
    const raw =
      "POST /mcp HTTP/1.1\r\n" +
      "Host: 127.0.0.1\r\n" +
      "Authorization: Bearer abc123\r\n" +
      "Content-Type: application/json\r\n" +
      "\r\n" +
      '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
    const p = parseHttpRequest(raw);
    expect(p).not.toBeNull();
    expect(p!.method).toBe("POST");
    expect(p!.path).toBe("/mcp");
    expect(p!.headers["authorization"]).toBe("Bearer abc123");
    expect(JSON.parse(p!.body).method).toBe("tools/list");
  });

  it("解析查询串 token", () => {
    const raw =
      "POST /mcp?token=xyz HTTP/1.1\n" +
      "Content-Type: application/json\n\n" +
      "{}";
    const p = parseHttpRequest(raw);
    expect(p!.path).toBe("/mcp");
    expect(p!.query["token"]).toBe("xyz");
  });

  it("无法找到头部结束符时返回 null", () => {
    expect(parseHttpRequest("POST /mcp HTTP/1.1\r\nHost: x")).toBeNull();
  });

  it("buildHttpResponse 含状态行与空行", () => {
    const s = buildHttpResponse(200, "OK", { "X-Test": "1" }, "body");
    expect(s).toContain("HTTP/1.1 200 OK");
    expect(s).toContain("X-Test: 1");
    expect(s.endsWith("\r\n\r\nbody")).toBe(true);
  });

  it("jsonResponse 设置 JSON 头与长度", () => {
    const s = jsonResponse(200, { ok: true });
    expect(s).toContain("Content-Type: application/json");
    expect(s).toContain("Content-Length: 11");
  });

  it("isSseAccepted 按 Accept 头判定", () => {
    expect(isSseAccepted("application/json, text/event-stream")).toBe(true);
    expect(isSseAccepted("application/json")).toBe(false);
  });

  it("sseFrame 与 sseResponse 包裹 JSON-RPC", () => {
    const rpc: JsonRpcResponse = { jsonrpc: "2.0", id: 1, result: { a: 1 } };
    expect(sseFrame(rpc)).toContain("data: ");
    expect(sseResponse(rpc)).toContain("text/event-stream");
  });
});
