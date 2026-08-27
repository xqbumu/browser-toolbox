/**
 * 选项页 MCP 服务卡片：展示本地端点状态、鉴权 token 与启停控制。
 * Chrome/Edge 经 chrome.sockets 起本地端点；Firefox 显示不可用原因（需 nativeMessaging 桥接）。
 */
import { useEffect, useState } from "react";
import { Button, MessagePlugin } from "tdesign-react";
import type { McpStatus, PopupRequest, PopupResponse } from "@/types/messages";

async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function McpPanel(): React.ReactNode {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    try {
      setStatus(await request<McpStatus>({ type: "MCP_STATUS", payload: {} }));
    } catch {
      // 忽略
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function toggle(): Promise<void> {
    setBusy(true);
    try {
      if (status?.running) {
        await request({ type: "MCP_STOP", payload: {} });
      } else {
        await request({ type: "MCP_START", payload: {} });
      }
      await refresh();
    } catch (e) {
      void MessagePlugin.error({
        content: e instanceof Error ? e.message : String(e),
        duration: 3000,
      });
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      void MessagePlugin.success({ content: "已复制", duration: 1500 });
    } catch {
      void MessagePlugin.error({ content: "复制失败", duration: 2000 });
    }
  }

  return (
    <div className="mcp-card">
      <div className="mcp-head">
        <h2>MCP 本地服务</h2>
        <Button
          size="small"
          theme={status?.running ? "warning" : "primary"}
          loading={busy}
          onClick={() => void toggle()}
        >
          {status?.running ? "停止" : "启动"}
        </Button>
      </div>

      {!status && <p className="muted">加载中…</p>}

      {status && !status.running && !status.unsupportedReason && (
        <p className="muted">未运行（点击「启动」开启本地 MCP 端点）</p>
      )}

      {status?.unsupportedReason && (
        <p className="muted">{status.unsupportedReason}</p>
      )}

      {status?.running && status.url && (
        <div className="mcp-body">
          <div className="mcp-row">
            <span className="mcp-key">端点</span>
            <code>{status.url}</code>
            <button className="link-btn" onClick={() => void copy(status.url!)}>
              复制
            </button>
          </div>
          <div className="mcp-row">
            <span className="mcp-key">Token</span>
            <code className="mcp-token">{status.token}</code>
            <button
              className="link-btn"
              onClick={() => void copy(status.token ?? "")}
            >
              复制
            </button>
          </div>
          <p className="muted">
            在 MCP 客户端（如 Claude Desktop / IDE）以 Streamable HTTP
            方式连接， 请求头携带{" "}
            <code>Authorization: Bearer &lt;token&gt;</code>。
          </p>
        </div>
      )}
    </div>
  );
}
