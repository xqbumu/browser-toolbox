/**
 * MCP JSON-RPC 处理核心（纯函数，无浏览器 API 依赖，便于单测）。
 * 复用后台既有 handleRequest：tools/call 时构造对应 PopupRequest 并委托调用方执行。
 */
import { MCP_TOOLS, buildRequest } from "./tools";
import type { JsonRpcRequest, JsonRpcResponse, McpToolResult } from "./types";
import type { PopupRequest, PopupResponse } from "@/types/messages";

export interface McpContext {
  /** 执行一个 PopupRequest，返回后台统一响应结构 */
  callTool: (msg: PopupRequest) => Promise<PopupResponse<unknown>>;
  serverInfo?: { name: string; version: string };
}

const PROTOCOL_VERSION = "2024-11-05";

function ok(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}
function fail(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** 处理一个 JSON-RPC 请求；返回 null 表示这是通知（不应回包） */
export async function handleMcpRpc(
  req: JsonRpcRequest,
  ctx: McpContext,
): Promise<JsonRpcResponse | null> {
  if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return fail(req?.id ?? null, -32600, "Invalid Request");
  }

  // 通知（无 id）不回包
  const isNotification = req.id === null || req.id === undefined;
  if (isNotification) return null;

  const { method, id, params } = req;
  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion:
          (params as { protocolVersion?: string } | undefined)
            ?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: ctx.serverInfo ?? {
          name: "browser-toolbox",
          version: "2.0.0",
        },
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: MCP_TOOLS });
    case "tools/call": {
      const name = (params?.name as string) ?? "";
      const args = (params?.arguments as Record<string, unknown>) ?? {};
      let msg: PopupRequest;
      try {
        msg = buildRequest(name, args);
      } catch (e) {
        return fail(id, -32602, (e as Error).message);
      }
      let res: PopupResponse<unknown>;
      try {
        res = await ctx.callTool(msg);
      } catch (e) {
        return fail(id, -32603, (e as Error).message);
      }
      if (!res.ok) {
        const result: McpToolResult = {
          content: [{ type: "text", text: res.error }],
          isError: true,
        };
        return ok(id, result);
      }
      const result: McpToolResult = {
        content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }],
        structuredContent: res.data,
      };
      return ok(id, result);
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}
