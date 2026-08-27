#!/usr/bin/env node
/**
 * Firefox 原生消息桥接宿主（native host）。
 *
 * 工作方式：
 *   1. 扩展后台调用 runtime.connectNative("com.browsertoolbox.mcp")，由浏览器启动本进程，
 *      其 stdin/stdout 被浏览器接管为 native messaging 通道（4 字节长度前缀帧）。
 *   2. 本进程在 127.0.0.1 随机端口起一个本地 MCP（Streamable HTTP）端点。
 *   3. MCP 客户端（Claude Desktop / IDE）连接该本地端点并发送 JSON-RPC。
 *   4. 本进程把每个 JSON-RPC 用 native messaging 帧转发给扩展；扩展用既有 handleMcpRpc
 *      执行后回传结果，本进程再把结果返回给 MCP 客户端。
 *
 * 注意：stdout 专用于 native messaging，任何日志/输出必须写 stderr，否则会破坏协议。
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import os from "node:os";
import { encodeMessage, NmDecoder } from "./nm-frame.mjs";

const BRIDGE_MSG = "mcp-rpc";

// 每次运行生成一次性 token，仅本机 stderr 输出，避免本地端点被任意进程调用
const token = randomUUID();
// 等待扩展回传的 JSON-RPC 响应（按 id 关联）
const pending = new Map();

// ---- 与扩展通信（native messaging over stdio）----
const decoder = new NmDecoder((msg) => {
  if (!msg || msg.type !== BRIDGE_MSG) return;
  const id = msg.id ?? null;
  if (id == null) return; // 通知无需响应
  const resolve = pending.get(String(id));
  if (resolve) {
    pending.delete(String(id));
    resolve(msg.payload);
  }
});

process.stdin.resume();
process.stdin.on("data", (chunk) => decoder.push(chunk));
process.stdin.on("end", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

function sendToExtension(rpc) {
  process.stdout.write(encodeMessage({ type: BRIDGE_MSG, id: rpc.id ?? null, payload: rpc }));
}

// ---- 本地 MCP HTTP 端点（供 MCP 客户端连接）----
const server = http.createServer((req, res) => {
  const allowCors = (r) => {
    r.setHeader("Access-Control-Allow-Origin", "*");
    r.setHeader("Access-Control-Allow-Headers", "*");
    r.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  };
  allowCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "POST" || (req.url || "").split("?")[0] !== "/mcp") {
    res.writeHead(404).end(JSON.stringify({ error: "not found" }));
    return;
  }
  const auth = req.headers["authorization"] || "";
  if (!auth.endsWith(token)) {
    res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let rpc;
    try {
      rpc = JSON.parse(body);
    } catch {
      res.writeHead(400).end(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }),
      );
      return;
    }
    const id = rpc.id ?? null;
    const accept = (req.headers["accept"] || "").includes("text/event-stream");

    // 通知：无需响应
    if (id == null) {
      sendToExtension(rpc);
      res.writeHead(202).end();
      return;
    }

    const done = (result) => {
      const payload = JSON.stringify(result);
      const bytes = Buffer.byteLength(payload);
      if (accept) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Content-Length": Buffer.byteLength(`data: ${payload}\n\n`),
          Connection: "close",
        });
        res.end(`event: message\ndata: ${payload}\n\n`);
      } else {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": bytes,
          Connection: "close",
        });
        res.end(payload);
      }
    };

    pending.set(String(id), done);
    sendToExtension(rpc);
  });
});

server.listen(0, "127.0.0.1", () => {
  const addr = server.address();
  const url = `http://127.0.0.1:${addr.port}/mcp`;
  // native host 由浏览器经 connectNative 启动，其 stdout 专用于 native messaging，
  // 终端里看不到 stderr；把端点与 token 写入文件供用户读取。
  const infoPath = `${os.tmpdir()}/browser-toolbox-mcp.json`;
  const info = { url, token, note: "在 MCP 客户端以 Streamable HTTP 连接 url，请求头携带 Authorization: Bearer <token>" };
  try {
    writeFileSync(infoPath, JSON.stringify(info, null, 2));
  } catch {
    // 忽略写入失败，退而求其次依赖 stderr
  }
  process.stderr.write(`[browser-toolbox-mcp] MCP endpoint: ${url}\n`);
  process.stderr.write(`[browser-toolbox-mcp] Token: ${token}\n`);
  process.stderr.write(`[browser-toolbox-mcp] 连接信息已写入: ${infoPath}\n`);
});
