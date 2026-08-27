/**
 * Firefox MV2 桥接：扩展侧通过 runtime.connectNative 与 native host 进程通信。
 * native host（mcp-bridge/native-host.mjs）会再在本地起一个 MCP HTTP 端点，
 * 把客户端的 JSON-RPC 经 nativeMessaging 转发到本模块，由 handleMcpRpc 执行后回传。
 *
 * 注意：Chrome/Edge 使用 chrome.sockets 直接监听（见 sockets-server.ts），
 * 此处仅当 chrome.sockets 不可用且浏览器为 Firefox 时启用。
 */
import { handleMcpRpc, type McpContext } from "./server";
import type { JsonRpcRequest } from "./types";
import type { PopupRequest, PopupResponse } from "@/types/messages";

export const MCP_BRIDGE_NAME = "com.browsertoolbox.mcp";

const BRIDGE_MSG = "mcp-rpc";

// native host 端口（Firefox MV2 专属），用结构类型避开跨浏览器 runtime 差异
type NativePort = {
  postMessage: (m: unknown) => void;
  disconnect: () => void;
  onMessage: { addListener: (cb: (m: unknown) => void) => void };
  onDisconnect: { addListener: (cb: () => void) => void };
};
let port: NativePort | null = null;
let ctx: McpContext | null = null;
function isFirefox(): boolean {
  try {
    return (
      typeof navigator !== "undefined" && /Firefox/i.test(navigator.userAgent)
    );
  } catch {
    return false;
  }
}

export function isFirefoxBridgeAvailable(): boolean {
  return (
    isFirefox() &&
    typeof browser !== "undefined" &&
    typeof browser.runtime?.connectNative === "function"
  );
}

export function startFirefoxBridge(
  fn: (msg: PopupRequest) => Promise<PopupResponse<unknown>>,
): void {
  if (port) return;
  ctx = {
    callTool: fn,
    serverInfo: { name: "browser-toolbox", version: "2.0.0" },
  };
  const p = (
    browser.runtime as unknown as {
      connectNative: (name: string) => NativePort;
    }
  ).connectNative(MCP_BRIDGE_NAME);
  port = p;
  p.onMessage.addListener((msg: unknown) => {
    void onBridgeMessage(msg as BridgeMessage);
  });
  p.onDisconnect.addListener(() => {
    port = null;
    ctx = null;
  });
}

export function stopFirefoxBridge(): void {
  if (port) {
    try {
      port.disconnect();
    } catch {
      // 忽略
    }
  }
  port = null;
  ctx = null;
}

export function isFirefoxBridgeRunning(): boolean {
  return port !== null;
}

async function onBridgeMessage(msg: BridgeMessage): Promise<void> {
  if (!msg || msg.type !== BRIDGE_MSG || !msg.payload) return;
  const rpc = msg.payload as JsonRpcRequest;
  // 来自 native host 的客户端请求：交给 handleMcpRpc 执行，并把结果回传
  if (!ctx) return;
  try {
    const res = await handleMcpRpc(rpc, ctx);
    const out: BridgeMessage = {
      type: BRIDGE_MSG,
      id: rpc.id ?? null,
      payload: res,
    };
    port?.postMessage(out);
  } catch {
    const out: BridgeMessage = {
      type: BRIDGE_MSG,
      id: rpc.id ?? null,
      payload: {
        jsonrpc: "2.0",
        id: rpc.id ?? null,
        error: { code: -32603, message: "internal error" },
      },
    };
    port?.postMessage(out);
  }
}

interface BridgeMessage {
  type: string;
  id?: number | string | null;
  payload?: unknown;
}
