/**
 * Chrome/Edge 本地 MCP 传输层：用 chrome.sockets.tcpServer 在 127.0.0.1 起一个
 * Streamable HTTP 端点（POST /mcp）。监听套接字在 MV3 SW 休眠后仍能通过 onAccept 唤醒，
 * 因此无需 offscreen document 维持。Firefox MV2 无此 API，返回不可用。
 */
import {
  parseHttpRequest,
  jsonResponse,
  sseResponse,
  isSseAccepted,
} from "./http";
import { handleMcpRpc, type McpContext } from "./server";
import { getMcpToken, validateMcpToken } from "./token";
import type { JsonRpcRequest } from "./types";

const PATH = "/mcp";
const sockets = (
  browser as unknown as {
    sockets?: {
      tcpServer?: {
        listen: (opts: {
          address: string;
          port: number;
          backlog?: number;
        }) => Promise<{ socketId: number; localPort: number }>;
        close: (socketId: number) => Promise<void>;
        getSockets?: (
          cb: (sockets: { socketId: number; localPort?: number }[]) => void,
        ) => void;
        onAccept: {
          addListener: (
            cb: (info: { socketId: number; clientSocketId?: number }) => void,
          ) => void;
          removeListener: (cb: unknown) => void;
        };
      };
      tcp?: {
        setKeepAlive: (opts: {
          socketId: number;
          enable: boolean;
          delay?: number;
        }) => Promise<void>;
        setPaused: (opts: {
          socketId: number;
          paused: boolean;
        }) => Promise<void>;
        send: (opts: { socketId: number; data: ArrayBuffer }) => Promise<void>;
        disconnect: (socketId: number) => Promise<void>;
        close: (socketId: number) => Promise<void>;
        onReceive: {
          addListener: (
            cb: (info: { socketId: number; data: ArrayBuffer }) => void,
          ) => void;
          removeListener: (cb: unknown) => void;
        };
        onReceiveError: {
          addListener: (
            cb: (info: { socketId: number; resultCode: number }) => void,
          ) => void;
          removeListener: (cb: unknown) => void;
        };
      };
    };
  }
).sockets;

let serverSocketId: number | null = null;
let listenPort = 0;
let ctx: McpContext | null = null;
// 按字节缓冲（而非字符串），以正确处理 Content-Length（字节）与跨包的多字节 UTF-8
const buffers = new Map<number, Uint8Array>();

export function isSocketsAvailable(): boolean {
  return Boolean(sockets?.tcpServer && sockets?.tcp);
}

export function isSocketsRunning(): boolean {
  return serverSocketId !== null;
}

export function getMcpPort(): number {
  return listenPort;
}

export async function startMcpServer(context: McpContext): Promise<number> {
  if (!isSocketsAvailable()) {
    throw new Error("chrome.sockets.tcpServer 不可用（仅 Chrome/Edge 支持）");
  }
  ctx = context;
  if (serverSocketId !== null) return listenPort;

  // SW 重启后清理可能残留的监听套接字，避免重复监听
  try {
    await new Promise<void>((resolve) => {
      const gs = sockets!.tcpServer!.getSockets;
      if (!gs) {
        resolve();
        return;
      }
      gs((list) => {
        for (const s of list) void sockets!.tcpServer!.close(s.socketId);
        resolve();
      });
    });
  } catch {
    // 忽略
  }

  const info = await sockets!.tcpServer!.listen({
    address: "127.0.0.1",
    port: 0,
    backlog: 16,
  });
  serverSocketId = info.socketId;
  listenPort = info.localPort;
  sockets!.tcpServer!.onAccept.addListener(onAccept);
  sockets!.tcp!.onReceive.addListener(onReceive);
  sockets!.tcp!.onReceiveError.addListener(onReceiveError);
  return listenPort;
}

export async function stopMcpServer(): Promise<void> {
  if (serverSocketId !== null && sockets?.tcpServer) {
    try {
      await sockets.tcpServer.close(serverSocketId);
    } catch {
      // 忽略
    }
  }
  sockets?.tcpServer?.onAccept.removeListener(onAccept);
  sockets?.tcp?.onReceive.removeListener(onReceive);
  sockets?.tcp?.onReceiveError.removeListener(onReceiveError);
  serverSocketId = null;
  listenPort = 0;
}

function onAccept(info: { socketId: number; clientSocketId?: number }): void {
  const clientId = info.clientSocketId ?? info.socketId;
  if (clientId == null) return;
  void (async () => {
    try {
      await sockets!.tcp!.setKeepAlive({
        socketId: clientId,
        enable: true,
        delay: 30,
      });
      await sockets!.tcp!.setPaused({ socketId: clientId, paused: false });
    } catch {
      // 忽略
    }
  })();
}

const MAX_BUFFER = 2 * 1024 * 1024;

function appendBytes(
  prev: Uint8Array | undefined,
  chunk: ArrayBuffer,
): Uint8Array {
  const arr = new Uint8Array(chunk);
  if (!prev) return arr;
  const out = new Uint8Array(prev.length + arr.length);
  out.set(prev);
  out.set(arr, prev.length);
  return out;
}

// 在字节流中定位头部结束符：优先 \r\n\r\n，回退 \n\n
function findHeaderEnd(bytes: Uint8Array): number {
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (
      bytes[i] === 13 &&
      bytes[i + 1] === 10 &&
      bytes[i + 2] === 13 &&
      bytes[i + 3] === 10
    ) {
      return i + 4;
    }
  }
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 10 && bytes[i + 1] === 10) return i + 2;
  }
  return -1;
}

function onReceive(info: { socketId: number; data: ArrayBuffer }): void {
  const id = info.socketId;
  const all = appendBytes(buffers.get(id), info.data);
  buffers.set(id, all);

  // 防御：缓冲上限，避免异常连接耗尽内存
  if (all.length > MAX_BUFFER) {
    buffers.delete(id);
    void (async () => {
      await sendString(id, jsonResponse(413, { error: "payload too large" }));
      await closeSocket(id);
    })();
    return;
  }

  const headerEnd = findHeaderEnd(all);
  // 头部尚未接收完整，继续缓冲
  if (headerEnd === -1) return;

  const headerStr = new TextDecoder().decode(all.slice(0, headerEnd));
  const clMatch = /content-length:\s*(\d+)/i.exec(headerStr);
  const hasCl = Boolean(clMatch);
  const contentLength = clMatch ? Number(clMatch[1]) : 0;
  // 有 Content-Length：按字节确认 body 收齐（多字节 UTF-8 也正确）
  if (hasCl && all.length < headerEnd + contentLength) return;
  // 无 Content-Length：把头部之后的全部字节当作 body（localhost 客户端通常带该头）
  const bodyEnd = hasCl ? headerEnd + contentLength : all.length;
  const bodyBytes = all.slice(headerEnd, bodyEnd);
  const bodyStr = new TextDecoder().decode(bodyBytes);
  const full = `${headerStr}\r\n\r\n${bodyStr}`;
  buffers.delete(id);
  void handleConnection(id, full);
}

function onReceiveError(info: { socketId: number; resultCode: number }): void {
  buffers.delete(info.socketId);
  void closeSocket(info.socketId);
}

function extractToken(
  raw: ReturnType<typeof parseHttpRequest>,
): string | undefined {
  if (!raw) return undefined;
  const auth = raw.headers["authorization"];
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m) return m[1];
  }
  return raw.query["token"];
}

async function handleConnection(id: number, raw: string): Promise<void> {
  const parsed = parseHttpRequest(raw);
  if (!parsed) {
    await sendString(
      id,
      jsonResponse(400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      }),
    );
    return closeSocket(id);
  }
  if (parsed.path !== PATH) {
    await sendString(id, jsonResponse(404, { error: "not found" }));
    return closeSocket(id);
  }
  if (parsed.method !== "POST") {
    await sendString(id, jsonResponse(405, { error: "method not allowed" }));
    return closeSocket(id);
  }
  const valid = await validateMcpToken(extractToken(parsed));
  if (!valid) {
    await sendString(id, jsonResponse(401, { error: "unauthorized" }));
    return closeSocket(id);
  }
  let rpc: JsonRpcRequest | null = null;
  try {
    rpc = JSON.parse(parsed.body) as JsonRpcRequest;
  } catch {
    await sendString(
      id,
      jsonResponse(400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Invalid JSON" },
      }),
    );
    return closeSocket(id);
  }
  const result = ctx ? await handleMcpRpc(rpc, ctx) : null;
  if (result === null) {
    // 通知：不回包
    return closeSocket(id);
  }
  if (isSseAccepted(parsed.headers["accept"])) {
    await sendString(id, sseResponse(result));
  } else {
    await sendString(id, jsonResponse(200, result));
  }
  return closeSocket(id);
}

function sendString(id: number, str: string): Promise<void> {
  const data = new TextEncoder().encode(str).buffer;
  return sockets!.tcp!.send({ socketId: id, data }).then(
    () => undefined,
    () => undefined,
  );
}

function closeSocket(id: number): Promise<void> {
  return (async () => {
    try {
      await sockets!.tcp!.disconnect(id);
    } catch {
      // 忽略
    }
    try {
      await sockets!.tcp!.close(id);
    } catch {
      // 忽略
    }
  })();
}
