/**
 * 截图历史管理页（独立标签页）：
 * 大屏网格浏览 + 批量多选删除 + 搜索 + 预览大图 + 重新下载。
 * 与 popup 紧凑列表共用 background 消息与共享样式令牌；交互按桌面页面习惯设计。
 */
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Input, MessagePlugin } from "tdesign-react";
import { BrowseIcon, DeleteIcon } from "tdesign-icons-react";
import type { ScreenshotListItem, ScreenshotRecord } from "@/types/history";
import type { PopupRequest, PopupResponse } from "@/types/messages";
import { ConfirmDialog, EmptyState } from "@/ui/kit";
import { PreviewModal } from "@/entrypoints/popup/components/PreviewModal";

async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export default function App() {
  const [items, setItems] = useState<ScreenshotListItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [previewRecord, setPreviewRecord] = useState<ScreenshotRecord | null>(
    null,
  );
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteMany, setConfirmDeleteMany] = useState(false);
  const [confirmOne, setConfirmOne] = useState<ScreenshotListItem | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      setItems(
        await request<ScreenshotListItem[]>({
          type: "HISTORY_LIST",
          payload: {},
        }),
      );
    } catch (e) {
      void MessagePlugin.error({
        content: e instanceof Error ? e.message : String(e),
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
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

  function toggleSelect(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode(): void {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function deleteSelected(): Promise<void> {
    const ids = [...selected];
    const { deleted } = await request<{ deleted: number }>({
      type: "HISTORY_DELETE_MANY",
      payload: { ids },
    }).catch(() => ({ deleted: 0 }));
    void MessagePlugin.success({
      content: `已删除 ${deleted} 条`,
      duration: 2000,
    });
    exitSelectMode();
    await load();
  }

  async function clearAll(): Promise<void> {
    const { cleared } = await request<{ cleared: number }>({
      type: "HISTORY_CLEAR",
      payload: {},
    }).catch(() => ({ cleared: 0 }));
    void MessagePlugin.success({
      content: `已清空 ${cleared} 条记录`,
      duration: 2000,
    });
    exitSelectMode();
    await load();
  }

  async function redownload(id: string): Promise<void> {
    try {
      await request({ type: "HISTORY_REDOWNLOAD", payload: { id } });
      void MessagePlugin.success({ content: "已重新下载", duration: 2000 });
    } catch (e) {
      void MessagePlugin.error({
        content: e instanceof Error ? e.message : String(e),
        duration: 2500,
      });
    }
  }

  async function openPreview(item: ScreenshotListItem): Promise<void> {
    const record = await request<ScreenshotRecord>({
      type: "HISTORY_GET",
      payload: { id: item.id },
    }).catch(() => null);
    if (record) setPreviewRecord(record);
  }

  const allShownSelected =
    filtered.length > 0 && filtered.every((it) => selected.has(it.id));

  return (
    <div className="history-page">
      <header className="page-head">
        <h1>
          <span role="img" aria-label="toolbox">
            🧰
          </span>
          截图历史
          {items.length > 0 && (
            <span className="count-tag">{items.length}</span>
          )}
        </h1>
        <div className="page-actions">
          <Input
            placeholder="搜索文件名 / 标题 / 域名"
            clearable
            value={query}
            style={{ width: 240 }}
            onChange={(v) => setQuery(String(v ?? ""))}
          />
          <Button
            variant={selectMode ? "base" : "outline"}
            theme={selectMode ? "primary" : "default"}
            disabled={items.length === 0}
            onClick={() =>
              selectMode ? exitSelectMode() : setSelectMode(true)
            }
          >
            {selectMode ? "退出选择" : "批量管理"}
          </Button>
          <Button
            theme="danger"
            variant="text"
            disabled={items.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            清空全部
          </Button>
        </div>
      </header>

      {selectMode && (
        <div className="select-bar">
          <Checkbox
            checked={allShownSelected}
            indeterminate={!allShownSelected && selected.size > 0}
            onChange={(v) =>
              setSelected((prev) => {
                if (v) {
                  const next = new Set(prev);
                  filtered.forEach((it) => next.add(it.id));
                  return next;
                }
                const keepIds = new Set(
                  items
                    .filter((it) => !filtered.some((f) => f.id === it.id))
                    .map((it) => it.id),
                );
                return keepIds;
              })
            }
          >
            全选当前结果（{filtered.length}）
          </Checkbox>
          <span className="muted">已选 {selected.size} 条</span>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <EmptyState
          icon={<BrowseIcon />}
          title={query ? "没有匹配的截图" : "暂无截图记录"}
          hint="使用工具栏中的截图功能后，记录会出现在这里"
        />
      )}

      {!loading && filtered.length > 0 && (
        <div className={`card-grid${selectMode ? " selecting" : ""}`}>
          {filtered.map((it) => (
            <HistoryCard
              key={it.id}
              item={it}
              selectMode={selectMode}
              checked={selected.has(it.id)}
              onToggle={() => toggleSelect(it.id)}
              onPreview={() => void openPreview(it)}
              onRedownload={() => void redownload(it.id)}
              onDelete={() => setConfirmOne(it)}
            />
          ))}
        </div>
      )}

      {selectMode && selected.size > 0 && (
        <div className="bulk-bar">
          <span>已选 {selected.size} 条</span>
          <Button theme="danger" onClick={() => setConfirmDeleteMany(true)}>
            删除所选
          </Button>
        </div>
      )}

      {previewRecord && (
        <PreviewModal
          record={previewRecord}
          onClose={() => setPreviewRecord(null)}
        />
      )}

      <ConfirmDialog
        open={confirmClear}
        header="清空历史"
        body="确定清空全部截图历史？此操作不可恢复。"
        confirmText="清空"
        danger
        onConfirm={() => {
          setConfirmClear(false);
          void clearAll();
        }}
        onClose={() => setConfirmClear(false)}
      />

      <ConfirmDialog
        open={confirmOne != null}
        header="删除记录"
        body={`确定删除「${confirmOne?.fileName || "未命名记录"}」？此操作不可恢复。`}
        confirmText="删除"
        danger
        onConfirm={() => {
          if (!confirmOne) return;
          const id = confirmOne.id;
          setConfirmOne(null);
          void request({ type: "HISTORY_DELETE", payload: { id } }).then(() =>
            load(),
          );
        }}
        onClose={() => setConfirmOne(null)}
      />

      <ConfirmDialog
        open={confirmDeleteMany}
        header="批量删除"
        body={`确定删除所选 ${selected.size} 条记录？此操作不可恢复。`}
        confirmText="删除"
        danger
        onConfirm={() => {
          setConfirmDeleteMany(false);
          void deleteSelected();
        }}
        onClose={() => setConfirmDeleteMany(false)}
      />
    </div>
  );
}

function HistoryCard({
  item,
  selectMode,
  checked,
  onToggle,
  onPreview,
  onRedownload,
  onDelete,
}: {
  item: ScreenshotListItem;
  selectMode: boolean;
  checked: boolean;
  onToggle: () => void;
  onPreview: () => void;
  onRedownload: () => void;
  onDelete: () => void;
}): React.ReactNode {
  return (
    <div
      className={`card${checked ? " checked" : ""}`}
      onClick={selectMode ? onToggle : undefined}
    >
      {selectMode && (
        <label className="card-check" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={checked} onChange={() => onToggle()} />
        </label>
      )}
      <button className="card-thumb" title="预览大图" onClick={onPreview}>
        <Thumb blob={item.thumbBlob} />
      </button>
      <div className="card-body">
        <p className="card-name" title={item.fileName}>
          {item.fileName}
        </p>
        <p className="muted">
          {item.title || extractHost(item.url)} · {formatTime(item.createdAt)}
        </p>
      </div>
      {!selectMode && (
        <div className="card-actions">
          <Button size="small" variant="text" onClick={onPreview}>
            预览
          </Button>
          <Button size="small" variant="text" onClick={onRedownload}>
            下载
          </Button>
          <Button size="small" variant="text" theme="danger" onClick={onDelete}>
            删除
          </Button>
        </div>
      )}
    </div>
  );
}

/** 缩略图：Blob → objectURL，卸载时 revoke */
function Thumb({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  if (!url) return <div className="thumb-ph" />;
  return <img className="thumb-img" src={url} alt="" />;
}

function formatTime(ms: number): string {
  const t = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

function extractHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url || "";
  }
}
