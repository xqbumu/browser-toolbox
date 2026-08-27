#!/usr/bin/env node
/**
 * 浏览器工具箱扩展的 MCP stdio 桥接（透明代理）。
 *
 * 用法（在 MCP 客户端配置中作为 command 运行）：
 *   MCP_EXT_URL=http://127.0.0.1:<port>/mcp \
 *   MCP_EXT_TOKEN=<token> \
 *   node mcp-bridge/server.mjs
 *
 * 端点 URL 与 token 可在扩展「选项页 → MCP 本地服务」中查看并复制。
 *
 * - Chrome/Edge：扩展直接用 chrome.sockets 暴露本地端点，本脚本仅做 stdio ↔ HTTP 转发。
 * - Firefox MV2：扩展无 chrome.sockets，需把本脚本注册为 native host（nativeMessaging），
 *   由扩展 onConnectNative 触发；届时改用 native-messaging 4 字节长度帧通信（待实现）。
 */
const URL = process.env.MCP_EXT_URL;
const TOKEN = process.env.MCP_EXT_TOKEN;

if (!URL || !TOKEN) {
  process.stderr.write("缺少环境变量 MCP_EXT_URL 或 MCP_EXT_TOKEN\n");
  process.exit(1);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    void handleLine(line);
  }
});
process.stdin.on("end", () => process.exit(0));

async function handleLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  // 仅转发需要响应的请求（含 id 与 method）；通知直接忽略回包
  if (
    msg == null ||
    msg.id === undefined ||
    msg.id === null ||
    typeof msg.method !== "string"
  ) {
    return;
  }
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(msg),
    });
    const text = await res.text();
    const json = extractJson(text);
    process.stdout.write(JSON.stringify(json) + "\n");
  } catch (e) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32603, message: String(e) },
      }) + "\n",
    );
  }
}

function extractJson(text) {
  if (text.includes("data:")) {
    const data = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
