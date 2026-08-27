/**
 * MCP 服务管理器：对外暴露 start/stop/status/init，把传输层、token、调用回调串起来。
 *
 * 默认关闭：是否启用持久化在 storage.local（mcpEnabled），启用后随后台/SW 重启自动恢复，
 * 但全新安装不会自动监听（opt-in）。
 *
 * Chrome/Edge 经 chrome.sockets 在 127.0.0.1 起 Streamable HTTP 端点；
 * Firefox MV2 无 chrome.sockets，其桥接在 firefox-bridge.ts（单独提交）。
 */
import {
  startMcpServer,
  stopMcpServer,
  getMcpPort,
  isSocketsAvailable,
  isSocketsRunning,
} from "./sockets-server";
import { getMcpToken } from "./token";
import type { PopupRequest, PopupResponse, McpStatus } from "@/types/messages";

const STORAGE_KEY = "mcpEnabled";

let running = false;

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
  if (!isSocketsAvailable()) {
    return {
      running: false,
      unsupportedReason:
        "当前浏览器不支持 chrome.sockets（Firefox MV2 请使用 nativeMessaging 桥接）",
    };
  }
  if (!isSocketsRunning()) {
    await startMcpServer({
      callTool: fn,
      serverInfo: { name: "browser-toolbox", version: "2.0.0" },
    });
  }
  running = true;
  const token = await getMcpToken();
  const port = getMcpPort();
  return {
    running: true,
    port,
    token,
    url: port ? `http://127.0.0.1:${port}/mcp` : undefined,
  };
}

export async function stopMcp(): Promise<void> {
  await saveMcpEnabled(false);
  await stopMcpServer();
  running = false;
}

/** 后台启动时调用：读取持久化的启用开关，若开启则自动恢复监听 */
export async function initMcp(
  fn: CallToolFn,
): Promise<McpStatus | { running: false }> {
  if (!(await isMcpEnabled())) return { running: false };
  return startMcp(fn);
}

export async function getMcpStatus(): Promise<McpStatus> {
  if (!running || !isSocketsAvailable()) return { running: false };
  const port = getMcpPort();
  const token = running ? await getMcpToken() : undefined;
  return {
    running,
    port,
    token,
    url: port ? `http://127.0.0.1:${port}/mcp` : undefined,
  };
}
