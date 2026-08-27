/**
 * 极简 HTTP 解析/序列化辅助（纯函数，便于单测）。
 * 用于 chrome.sockets 上的 MCP Streamable HTTP 端点；仅覆盖 localhost 单请求单响应场景。
 */

export interface ParsedHttpRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
}

export function parseHttpRequest(input: string): ParsedHttpRequest | null {
  // 请求行与头部以空行结束（CRLF 或 LF）
  const sepIdx = input.indexOf("\r\n\r\n");
  const useCrlf = sepIdx !== -1;
  const idx = useCrlf ? sepIdx : input.indexOf("\n\n");
  if (idx === -1) return null;

  const head = input.slice(0, idx);
  const body = input.slice(idx + (useCrlf ? 4 : 2));
  const lines = head.split(useCrlf ? "\r\n" : "\n");
  const firstLine = lines[0] ?? "";
  const parts = firstLine.split(" ");
  const methodRaw = parts[0];
  const target = parts[1];
  if (!methodRaw || !target) return null;

  const [rawPath = "", queryStr = ""] = target.split("?");
  const query: Record<string, string> = {};
  for (const pair of queryStr.split("&")) {
    if (!pair) continue;
    const [k = "", v = ""] = pair.split("=");
    query[decodeURIComponent(k)] = decodeURIComponent(v);
  }

  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const ci = line.indexOf(":");
    if (ci === -1) continue;
    const key = line.slice(0, ci).trim().toLowerCase();
    const value = line.slice(ci + 1).trim();
    headers[key] = value;
  }

  return {
    method: methodRaw.toUpperCase(),
    path: rawPath,
    query,
    headers,
    body,
  };
}

export function buildHttpResponse(
  status: number,
  statusText: string,
  headers: Record<string, string>,
  body: string,
): string {
  const head = [`HTTP/1.1 ${status} ${statusText}`];
  for (const [k, v] of Object.entries(headers)) head.push(`${k}: ${v}`);
  return `${head.join("\r\n")}\r\n\r\n${body}`;
}

export function jsonResponse(
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): string {
  const body = JSON.stringify(payload);
  return buildHttpResponse(
    status,
    statusText(status),
    {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(byteLength(body)),
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
    body,
  );
}

/** 把 JSON-RPC 响应包成 SSE 帧（兼容 Accept: text/event-stream 的客户端） */
export function sseFrame(payload: unknown): string {
  const json = JSON.stringify(payload);
  // SSE 数据中的换行需拆成多行 data:
  const dataLines = json
    .split("\n")
    .map((l) => `data: ${l}`)
    .join("\n");
  return `${dataLines}\n\n`;
}

export function sseResponse(payload: unknown): string {
  const body = sseFrame(payload);
  return buildHttpResponse(
    200,
    "OK",
    {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Content-Length": String(byteLength(body)),
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
      Connection: "close",
    },
    body,
  );
}

export function isSseAccepted(accept: string | undefined): boolean {
  return /text\/event-stream/i.test(accept ?? "");
}

function statusText(status: number): string {
  const map: Record<number, string> = {
    200: "OK",
    202: "Accepted",
    400: "Bad Request",
    401: "Unauthorized",
    404: "Not Found",
    405: "Method Not Allowed",
    500: "Internal Server Error",
  };
  return map[status] ?? "OK";
}

function byteLength(s: string): number {
  // HTTP Content-Length 必须是 UTF-8 字节数，不能照抄 JS 字符串长度（UTF-16）
  return new TextEncoder().encode(s).length;
}
