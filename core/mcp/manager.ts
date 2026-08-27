/**
 * MCP 服务管理器：对外暴露 start/stop/status/init，把传输层、token、调用回调串起来。
 *
 * 传输方式：
 * - Chrome/Edge：chrome.sockets 直接在 127.0.0.1 起 Streamable HTTP 端点。
 * - Firefox MV2：无 chrome.sockets，改为 runtime.connectNative 桥接，由 native host
 *   （mcp-bridge/native-host.mjs）在本地起 MCP 端点并转发 JSON-RPC 到扩展执行。
 *
 * 默认关闭：是否启用持久化在 storage.local（mcpEnabled），启用后随后台/SW 重启自动恢复，
 * 但全新安装不会自动监听（opt-in）。
 */
import {
  startMcpServer,
  stopMcpServer,
  getMcpPort,
  isSocketsAvailable,
  isSocketsRunning,
} from "./sockets-server";
import {
  startFirefoxBridge,
  stopFirefoxBridge,
  isFirefoxBridgeAvailable,
  isFirefoxBridgeRunning,
} from "./firefox-bridge";
import { getMcpToken } from "./token";
import type {
  PopupRequest,
  PopupResponse,
  McpStatus,
  McpTransport,
} from "@/types/messages";

const STORAGE_KEY = "mcpEnabled";
const FIREFOX_HINT =
  "Firefox：需先安装 native host（见 mcp-bridge/README.md），运行 `npm run mcp:native` 后按其 stderr 输出的端点连接";

let running = false;
let activeTransport: McpTransport | null = null;

export type CallToolFn = (msg: PopupRequest) => Promise<PopupResponse<unknown>>;

export async function isMcpEnabled(): Promise<boolean> {
  try {
    const r = await browser.storage.local.get(STORAGE_KEY);
    return Boolean(r[STORAGE_KEY]);
  } catch {
    return false;
  }
}

async function saveMcpEnabled(v: boolean): Promise<void> {
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: v });
  } catch {
    // 忽略
  }
}

export async function startMcp(fn: CallToolFn): Promise<McpStatus> {
  await saveMcpEnabled(true);
  if (isSocketsAvailable()) {
    if (!isSocketsRunning()) {
      await startMcpServer({
        callTool: fn,
        serverInfo: { name: "browser-toolbox", version: "2.0.0" },
      });
    }
    running = true;
    activeTransport = "sockets";
    const token = await getMcpToken();
    const port = getMcpPort();
    return {
      running: true,
      transport: "sockets",
      port,
      token,
      url: port ? `http://127.0.0.1:${port}/mcp` : undefined,
    };
  }
  if (isFirefoxBridgeAvailable()) {
    startFirefoxBridge(fn);
    running = true;
    activeTransport = "native";
    const token = await getMcpToken();
    return { running: true, transport: "native", token, hint: FIREFOX_HINT };
  }
  return {
    running: false,
    unsupportedReason:
      "当前浏览器既不支持 chrome.sockets，也无法使用 nativeMessaging 桥接",
  };
}

export async function stopMcp(): Promise<void> {
  await saveMcpEnabled(false);
  if (activeTransport === "sockets") await stopMcpServer();
  else if (activeTransport === "native") stopFirefoxBridge();
  running = false;
  activeTransport = null;
}

/** 后台启动时调用：读取持久化的启用开关，若开启则自动恢复监听 */
export async function initMcp(
  fn: CallToolFn,
): Promise<McpStatus | { running: false }> {
  if (!(await isMcpEnabled())) return { running: false };
  return startMcp(fn);
}

export async function getMcpStatus(): Promise<McpStatus> {
  if (!running) return { running: false };
  if (activeTransport === "sockets" && isSocketsAvailable()) {
    const port = getMcpPort();
    const token = running ? await getMcpToken() : undefined;
    return {
      running,
      transport: "sockets",
      port,
      token,
      url: port ? `http://127.0.0.1:${port}/mcp` : undefined,
    };
  }
  if (activeTransport === "native" && isFirefoxBridgeRunning()) {
    const token = await getMcpToken();
    return { running, transport: "native", token, hint: FIREFOX_HINT };
  }
  return { running: false };
}
