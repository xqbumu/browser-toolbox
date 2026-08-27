/**
 * MCP 协议相关类型（最小子集：JSON-RPC 2.0 + tools 能力）。
 * 仅覆盖本扩展实际用到的部分，不引入额外依赖。
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type McpContent =
  | { type: "text"; text: string }
  | {
      type: "resource";
      resource: { uri: string; text?: string; mimeType?: string };
    };

export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
  /** 结构化数据透传（部分客户端支持） */
  structuredContent?: unknown;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** tools/call 的入参（MCP 客户端约定） */
export interface McpToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}
