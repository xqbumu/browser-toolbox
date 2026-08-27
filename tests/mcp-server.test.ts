import { describe, it, expect } from "vitest";
import { handleMcpRpc } from "@/core/mcp/server";
import { MCP_TOOLS } from "@/core/mcp/tools";
import type { PopupRequest, PopupResponse } from "@/types/messages";

function ctx(
  fn: (msg: PopupRequest) => Promise<PopupResponse<unknown>>,
): Parameters<typeof handleMcpRpc>[1] {
  return { callTool: fn };
}

describe("MCP JSON-RPC 处理", () => {
  it("initialize 返回协议版本与 tools 能力", async () => {
    const res = await handleMcpRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      ctx(async () => ({ ok: true, data: {} })),
    );
    expect(res?.id).toBe(1);
    const result = res?.result as {
      protocolVersion: string;
      capabilities: unknown;
    };
    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.capabilities).toEqual({ tools: {} });
  });

  it("tools/list 返回工具清单", async () => {
    const res = await handleMcpRpc(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ctx(async () => ({ ok: true, data: {} })),
    );
    const result = res?.result as { tools: unknown[] };
    expect(result.tools.length).toBe(MCP_TOOLS.length);
  });

  it("tools/call 成功：回包 content 含 JSON 文本", async () => {
    const res = await handleMcpRpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "tb_headers_list", arguments: {} },
      },
      ctx(async (msg) => {
        expect((msg as { type: string }).type).toBe("HEADERS_LIST");
        return { ok: true, data: [{ id: "h1" }] };
      }),
    );
    const result = res?.result as { content: { type: string; text: string }[] };
    expect(result.content[0]!.type).toBe("text");
    expect(JSON.parse(result.content[0]!.text)).toEqual([{ id: "h1" }]);
  });

  it("tools/call 业务失败：isError=true 且透传错误信息", async () => {
    const res = await handleMcpRpc(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "tb_headers_list", arguments: {} },
      },
      ctx(async () => ({ ok: false, error: "boom" })),
    );
    const result = res?.result as {
      isError: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe("boom");
  });

  it("未知方法返回 method not found", async () => {
    const res = await handleMcpRpc(
      { jsonrpc: "2.0", id: 5, method: "nope" },
      ctx(async () => ({ ok: true, data: {} })),
    );
    expect(res?.error?.code).toBe(-32601);
  });

  it("通知（无 id）返回 null（不回包）", async () => {
    const res = await handleMcpRpc(
      { jsonrpc: "2.0", id: null, method: "notifications/initialized" },
      ctx(async () => ({ ok: true, data: {} })),
    );
    expect(res).toBeNull();
  });

  it("非法请求返回 invalid request", async () => {
    const res = await handleMcpRpc(
      { jsonrpc: "1.0", id: 1, method: "initialize" } as never,
      ctx(async () => ({ ok: true, data: {} })),
    );
    expect(res?.error?.code).toBe(-32600);
  });
});
