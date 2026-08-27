# MCP 原生消息桥接（Firefox MV2）

Firefox MV2 没有 `chrome.sockets`，无法像 Chrome/Edge 那样直接在扩展内监听本地端口。
本目录提供一个 **native host** 作为桥接：由扩展通过 `nativeMessaging` 启动本进程，
它在本地起一个 MCP（Streamable HTTP）端点，把客户端的 JSON-RPC 转发给扩展执行。

## 组件
- `native-host.mjs`：原生宿主进程。stdio 走 native messaging 与扩展通信；另起本地 HTTP 端点供 MCP 客户端。
- `nm-frame.mjs`：native messaging 4 字节长度前缀帧的编解码（纯函数，已单测）。
- `com.browsertoolbox.mcp.json.template` + `install-host.sh`：宿主清单模板与安装脚本。

## 使用步骤（Firefox）
1. 加载扩展（about:debugging → 临时加载，或已签名版本），记下其 **扩展 ID**。
2. 安装宿主清单：
   ```bash
   bash mcp-bridge/install-host.sh <firefox-extension-id>
   ```
   （macOS 写入 `~/Library/Application Support/Mozilla/NativeMessagingHosts`，
   Linux 写入 `~/.mozilla/native-messaging-hosts`）
3. 在扩展「选项页 → MCP 本地服务」点「启动」。扩展会经 `runtime.connectNative`
   触发浏览器启动本 native host（无需手动运行）。
4. 宿主启动后把端点与 Token 写入临时文件（stdout 已用于 native messaging，终端看不到）：
   - macOS / Linux：`<系统临时目录>/browser-toolbox-mcp.json`
   - 文件内容示例：
     ```json
     { "url": "http://127.0.0.1:54321/mcp", "token": "<uuid>", "note": "..." }
     ```
5. 在 MCP 客户端（如 Claude Desktop / IDE）以 Streamable HTTP 连接该 `url`，
   请求头携带 `Authorization: Bearer <token>`。

> 说明：native host 由浏览器托管，每次点击「启动」会生成一次性 Token 并写入上述文件。
> `npm run mcp:native` 仅用于本地手动调试（此时无扩展连接，HTTP 请求会无响应），
> 正常流程请直接通过扩展「启动」按钮触发。

## 说明
- Chrome/Edge 不需要本桥接，扩展内直接用 `chrome.sockets` 监听本地端点（见 `core/mcp/sockets-server.ts`）。
- 本桥接与扩展侧的桥接逻辑（`core/mcp/firefox-bridge.ts`）配套：扩展只负责执行 MCP 工具，
  传输与本地监听由本 native host 承担。
