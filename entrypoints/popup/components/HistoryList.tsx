/**
 * 历史列表组件：倒序展示截图记录（缩略图 / 文件名 / 时间 / 域名），
 * 支持客户端搜索、单条删除、清空、预览、重新下载；加载后回传条数供 Tab 角标展示。
 * 破坏性操作统一使用受控 ConfirmDialog（声明式，popup 环境可靠）。
 */
import { useEffect, useMemo, useState } from "react";
import { Button, Input } from "tdesign-react";
import { AppIcon, BrowseIcon } from "tdesign-icons-react";
import type { ScreenshotListItem } from "@/types/history";
import type { PopupRequest, PopupResponse } from "@/types/messages";
import { ConfirmDialog, EmptyState } from "@/ui/kit";

/** 向 background 发送请求并解包响应 */
async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

interface Props {
  onPreview: (item: ScreenshotListItem) => void;
  onCountChange: (count: number) => void;
}

/** 确认意图：清空 / 删除单条 */
type ConfirmIntent = { type: "clear" } | { type: "delete"; id: string } | null;

export function HistoryList({ onPreview, onCountChange }: Props) {
  const [items, setItems] = useState<ScreenshotListItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmIntent>(null);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const list = await request<ScreenshotListItem[]>({
        type: "HISTORY_LIST",
        payload: {},
      });
      setItems(list);
      onCountChange(list.length);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      [it.fileName, it.title, it.url].some((s) =>
        (s ?? "").toLowerCase().includes(q),
      ),
    );
  }, [items, query]);

  async function doClear(): Promise<void> {
    try {
      const { cleared } = await request<{ cleared: number }>({
        type: "HISTORY_CLEAR",
        payload: {},
      });
      setMessage(`已清空 ${cleared} 条记录`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function doDelete(id: string): Promise<void> {
    try {
      await request<{ deleted: string }>({
        type: "HISTORY_DELETE",
        payload: { id },
      });
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRedownload(id: string): Promise<void> {
    setMessage("正在重新下载…");
    try {
      const { fileName } = await request<{ fileName: string }>({
        type: "HISTORY_REDOWNLOAD",
        payload: { id },
      });
      setMessage(`已重新下载到：${fileName}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="history-list">
      <div className="history-toolbar">
        <Input
          placeholder="搜索文件名 / 标题 / 域名"
          clearable
          value={query}
          onChange={(v) => setQuery(String(v ?? ""))}
        />
        <Button
          shape="square"
          variant="text"
          theme="default"
          title="在新标签页打开历史管理"
          onClick={() =>
            void browser.tabs.create({
              url: browser.runtime.getURL("/history.html"),
            })
          }
        >
          <AppIcon />
        </Button>
        <Button
          theme="danger"
          variant="text"
          disabled={items.length === 0}
          onClick={() => setConfirm({ type: "clear" })}
        >
          清空
        </Button>
      </div>

      {message && <p className="history-message">{message}</p>}

      {loading && <p className="muted">加载中…</p>}

      {!loading && filtered.length === 0 && (
        <EmptyState
          icon={<BrowseIcon />}
          title={query ? "没有匹配的截图" : "暂无截图记录"}
        />
      )}

      {!loading && filtered.length > 0 && (
        <div className="history-items">
          {filtered.map((it) => (
            <HistoryItem
              key={it.id}
              item={it}
              onPreview={onPreview}
              onDelete={(id) => setConfirm({ type: "delete", id })}
              onRedownload={(id) => void handleRedownload(id)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirm != null}
        header={confirm?.type === "clear" ? "清空历史" : "删除记录"}
        body={
          confirm?.type === "clear"
            ? "确定清空全部截图历史？此操作不可恢复。"
            : "确定删除这条截图记录？此操作不可恢复。"
        }
        confirmText={confirm?.type === "clear" ? "清空" : "删除"}
        danger
        onConfirm={() => {
          if (confirm?.type === "clear") void doClear();
          else if (confirm) void doDelete(confirm.id);
        }}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

function HistoryItem({
  item,
  onPreview,
  onDelete,
  onRedownload,
}: {
  item: ScreenshotListItem;
  onPreview: (item: ScreenshotListItem) => void;
  onDelete: (id: string) => void;
  onRedownload: (id: string) => void;
}) {
  return (
    <div className="history-item">
      <button
        className="history-thumb"
        onClick={() => onPreview(item)}
        title="预览原图"
      >
        <Thumb blob={item.thumbBlob} />
      </button>
      <div className="history-meta">
        <p className="history-filename" title={item.fileName}>
          {item.fileName}
        </p>
        <p className="muted">
          {item.title} · {formatTime(item.createdAt)}
        </p>
        <p className="muted history-domain">{extractHost(item.url)}</p>
        <div className="history-actions">
          <Button size="small" variant="text" onClick={() => onPreview(item)}>
            预览
          </Button>
          <Button
            size="small"
            variant="text"
            onClick={() => onRedownload(item.id)}
          >
            重新下载
          </Button>
          <Button
            size="small"
            variant="text"
            theme="danger"
            onClick={() => onDelete(item.id)}
          >
            删除
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 缩略图：Blob → objectURL，组件卸载时 revoke，避免内存泄漏 */
function Thumb({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  if (!url) return <div className="history-thumb-placeholder" />;
  return <img className="history-thumb-img" src={url} alt="缩略图" />;
}

/** 时间戳 → YYYY-MM-DD HH:mm */
function formatTime(ms: number): string {
  const t = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(
    t.getMinutes(),
  )}`;
}

/** URL → 域名（仅展示用，异常回退原串） */
function extractHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url || "";
  }
}
