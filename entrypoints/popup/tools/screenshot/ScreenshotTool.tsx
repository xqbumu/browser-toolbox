/**
 * 截图工具（工具箱第一个工具）：模式选择 + 主按钮 + 批量面板 + 进度/结果 + 历史子页。
 * 由 popup 壳按工具注册表挂载；本组件自治管理截图域的全部状态与进度监听。
 *
 * P0/P1/P2 的既有行为保持不变：stage 进度、取消、失败重试、快捷操作、剪贴板、进度恢复、toast。
 */
import { useEffect, useState } from "react";
import { Alert, Button, Progress, Tabs } from "tdesign-react";
import { BrowseIcon, CopyIcon, FolderOpenIcon } from "tdesign-icons-react";
import { SettingIcon } from "tdesign-icons-react";
import { ScreenshotSettings } from "./ScreenshotSettings";
import { DEFAULT_CONFIG, type CaptureConfig } from "@/types/config";
import type { CaptureMode, CaptureResult, BatchResult } from "@/types/capture";
import type { ScreenshotRecord, ScreenshotListItem } from "@/types/history";
import type {
  PopupRequest,
  PopupResponse,
  ProgressEvent,
  ToastKind,
} from "@/types/messages";
import type { Capabilities } from "@/adapters/browser-adapter";
import { getCapabilities } from "@/utils/capabilities";
import { dataUrlToBlob } from "@/utils/helpers";
import { friendlyError } from "@/utils/errors";
import { copyImageToClipboard } from "@/utils/clipboard";
import { CaptureTiles } from "@/entrypoints/popup/components/CaptureTiles";
import { BatchPanel } from "@/entrypoints/popup/components/BatchPanel";
import { ProgressBar } from "@/entrypoints/popup/components/ProgressBar";
import { HistoryList } from "@/entrypoints/popup/components/HistoryList";
import { PreviewModal } from "@/entrypoints/popup/components/PreviewModal";
import { MessagePlugin } from "tdesign-react";

/** 向 background 发送请求并解包响应 */
async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

type Section = "capture" | "history";

type StatusKind = "ok" | "err" | "info" | "warn";
type StatusState = { kind: StatusKind; text: string } | null;

type ActiveJob =
  { kind: "single"; tabId: number } | { kind: "batch"; batchId?: string };

const EMPTY_RECT = { x: 0, y: 0, width: 0, height: 0 };

function notify(kind: ToastKind, text: string): void {
  const fn =
    kind === "ok"
      ? MessagePlugin.success
      : kind === "err"
        ? MessagePlugin.error
        : kind === "warn"
          ? MessagePlugin.warning
          : MessagePlugin.info;
  void fn({ content: text, duration: 2500 });
}

function captureStatus(result: CaptureResult): StatusState {
  if (result.cancelled) return { kind: "info", text: "已取消截图" };
  if (!result.ok) return { kind: "err", text: friendlyError(result.error) };
  if (result.downloadFailed) {
    return {
      kind: "warn",
      text: `✅ 截图完成，⚠️ 下载失败：${friendlyError(result.downloadError)}`,
    };
  }
  if (result.warning) {
    return {
      kind: "warn",
      text: `已下载：${result.fileName ?? ""}（${result.warning}）`,
    };
  }
  return { kind: "ok", text: `已下载：${result.fileName ?? ""}` };
}

function batchStatus(result: BatchResult): StatusState {
  if (result.cancelled) {
    return {
      kind: "info",
      text: `已取消批量截图（成功 ${result.success}，失败 ${result.failed}）`,
    };
  }
  if (result.downloadFailed) {
    return {
      kind: "warn",
      text: `批量截图完成，但打包下载失败：${result.downloadError ?? ""}`,
    };
  }
  return { kind: "ok", text: "批量截图完成，已打包下载" };
}

function loadingLabel(progress: ProgressEvent | null): string {
  if (progress?.kind === "stage") {
    if (
      progress.phase === "scrolling" &&
      progress.current != null &&
      progress.total != null
    ) {
      return `截图 ${progress.current}/${progress.total}`;
    }
    return progress.label;
  }
  if (progress?.kind === "item")
    return `批量截图 ${progress.index}/${progress.total}`;
  if (progress?.kind === "start") return "批量准备中…";
  return "截图中…";
}

export function ScreenshotTool(): React.ReactNode {
  const [section, setSection] = useState<Section>("capture");
  const [pending, setPending] = useState<CaptureMode | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState<CaptureConfig>(DEFAULT_CONFIG);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [windowId, setWindowId] = useState<number | null>(null);
  const [tabCount, setTabCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [status, setStatus] = useState<StatusState>(null);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [historyCount, setHistoryCount] = useState(0);
  const [preview, setPreview] = useState<ScreenshotRecord | null>(null);
  const [lastResult, setLastResult] = useState<CaptureResult | null>(null);
  const [lastFailedMode, setLastFailedMode] = useState<CaptureMode | null>(
    null,
  );
  const pushToast = notify;

  useEffect(() => {
    void init();
    const listener = (message: unknown): void => {
      const msg = message as { type?: string; event?: ProgressEvent };
      if (msg && msg.type === "__WXT_PROGRESS__" && msg.event) {
        setProgress(msg.event);
        if (msg.event.kind === "start" && msg.event.batchId) {
          const batchId = msg.event.batchId;
          setActiveJob((prev) =>
            prev?.kind === "batch" ? { kind: "batch", batchId } : prev,
          );
        }
        if (msg.event.kind === "done") {
          setBusy(false);
          setActiveJob(null);
        }
      }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  async function init(): Promise<void> {
    try {
      setCaps(getCapabilities());
      const [cfg, tabs, activeTabs, savedProgress] = await Promise.all([
        request<CaptureConfig>({ type: "GET_CONFIG", payload: {} }),
        browser.tabs.query({ currentWindow: true }),
        browser.tabs.query({ active: true, currentWindow: true }),
        request<ProgressEvent | null>({ type: "GET_PROGRESS", payload: {} }),
      ]);
      setConfig(cfg);
      setTabCount(tabs.length);
      const active = activeTabs[0];
      if (active?.id != null) {
        setTabId(active.id);
        setWindowId(active.windowId ?? null);
      }
      if (savedProgress) restoreProgress(savedProgress, active?.id ?? null);
    } catch (e) {
      setStatus({
        kind: "err",
        text: friendlyError(e instanceof Error ? e.message : String(e)),
      });
    }
  }

  function restoreProgress(
    p: ProgressEvent,
    currentTabId: number | null,
  ): void {
    if (p.kind === "done") {
      setBusy(false);
      setActiveJob(null);
      setProgress(null);
      return;
    }
    setBusy(true);
    setProgress(p);
    if (p.kind === "stage") {
      setActiveJob(
        currentTabId != null ? { kind: "single", tabId: currentTabId } : null,
      );
    } else if (p.kind === "start" && p.batchId) {
      setActiveJob({ kind: "batch", batchId: p.batchId });
    } else if (p.kind === "item") {
      setActiveJob(
        p.batchId ? { kind: "batch", batchId: p.batchId } : { kind: "batch" },
      );
    } else if (p.kind === "cancelled") {
      setActiveJob({ kind: "batch" });
    }
  }

  function ensureReady(): boolean {
    if (tabId == null) {
      setStatus({ kind: "err", text: "未找到当前选项卡" });
      return false;
    }
    return true;
  }

  async function onCapture(m: CaptureMode): Promise<void> {
    if (!ensureReady() || busy) return;
    setBusy(true);
    setPending(m);
    setProgress(null);
    setActiveJob({ kind: "single", tabId: tabId! });
    setStatus(null);
    setLastResult(null);
    setLastFailedMode(null);
    try {
      const type = m === "visible" ? "CAPTURE_VISIBLE" : "CAPTURE_FULLPAGE";
      const result = await request<CaptureResult>({
        type,
        payload: { tabId: tabId!, config },
      });
      setStatus(captureStatus(result));
      if (result.ok) {
        setLastResult(result);
      } else if (!result.cancelled) {
        setLastFailedMode(m);
      }
    } catch (e) {
      setStatus({
        kind: "err",
        text: friendlyError(e instanceof Error ? e.message : String(e)),
      });
      setLastFailedMode(m);
    } finally {
      setBusy(false);
      setPending(null);
      setActiveJob(null);
      setProgress(null);
    }
  }

  function onCaptureArea(): void {
    if (!ensureReady() || busy) return;
    setStatus({ kind: "info", text: "已进入选区模式，请在页面拖拽框选" });
    browser.runtime
      .sendMessage({
        type: "CAPTURE_AREA",
        payload: { tabId: tabId!, rect: EMPTY_RECT, config },
      } satisfies PopupRequest)
      .catch(() => {});
    window.close();
  }

  async function onBatchTabs(): Promise<void> {
    if (windowId == null || busy) return;
    setBusy(true);
    setProgress(null);
    setActiveJob({ kind: "batch" });
    setStatus({ kind: "info", text: "正在批量截图（按选项卡）…" });
    try {
      const result = await request<BatchResult>({
        type: "BATCH_TABS",
        payload: { windowId, config },
      });
      setStatus(batchStatus(result));
    } catch (e) {
      setStatus({
        kind: "err",
        text: friendlyError(e instanceof Error ? e.message : String(e)),
      });
    } finally {
      setBusy(false);
      setActiveJob(null);
    }
  }

  async function onBatchUrls(urls: string[]): Promise<void> {
    if (busy) return;
    setBusy(true);
    setProgress(null);
    setActiveJob({ kind: "batch" });
    setStatus({ kind: "info", text: "正在批量截图（按 URL）…" });
    try {
      const result = await request<BatchResult>({
        type: "BATCH_URLS",
        payload: { urls, config },
      });
      setStatus(batchStatus(result));
    } catch (e) {
      setStatus({
        kind: "err",
        text: friendlyError(e instanceof Error ? e.message : String(e)),
      });
    } finally {
      setBusy(false);
      setActiveJob(null);
    }
  }

  async function onCancel(): Promise<void> {
    if (!activeJob) return;
    try {
      if (activeJob.kind === "single") {
        await request<{ cancelled: boolean }>({
          type: "CANCEL_CAPTURE",
          payload: { scope: "single", tabId: activeJob.tabId },
        });
      } else if (activeJob.batchId) {
        await request<{ cancelled: boolean }>({
          type: "CANCEL_CAPTURE",
          payload: { scope: "batch", batchId: activeJob.batchId },
        });
      }
    } catch {
      // 取消失败不阻断主流程，静默忽略
    }
  }

  async function previewResult(result: CaptureResult): Promise<void> {
    if (!result.dataUrl) return;
    try {
      const imageBlob = await dataUrlToBlob(result.dataUrl);
      setPreview({
        id: "temp",
        fileName: result.fileName ?? "截图.png",
        url: result.url ?? "",
        title: result.title ?? "",
        mode: result.mode,
        format: result.format ?? config.format,
        createdAt: Date.now(),
        sizeBytes: imageBlob.size,
        thumbBlob: imageBlob,
        imageBlob,
      });
    } catch (e) {
      pushToast(
        "err",
        `预览失败：${friendlyError(e instanceof Error ? e.message : String(e))}`,
      );
    }
  }

  async function copyResult(result: CaptureResult): Promise<void> {
    if (!result.dataUrl) {
      pushToast("err", "无图片数据可复制");
      return;
    }
    try {
      const blob = await dataUrlToBlob(result.dataUrl);
      const res = await copyImageToClipboard(blob);
      if (res.ok) pushToast("ok", "已复制到剪贴板");
      else if (res.reason === "unsupported")
        pushToast("warn", "当前浏览器不支持复制图片，请改用「预览 → 另存为」");
      else pushToast("err", "复制失败，请重试");
    } catch {
      pushToast("err", "复制失败，请重试");
    }
  }

  async function openFolder(downloadId: number): Promise<void> {
    try {
      await browser.downloads.show(downloadId);
    } catch {
      pushToast("err", "打开文件夹失败，请前往浏览器下载目录查看");
    }
  }

  async function handlePreview(item: ScreenshotListItem): Promise<void> {
    try {
      const record = await request<ScreenshotRecord>({
        type: "HISTORY_GET",
        payload: { id: item.id },
      });
      setPreview(record);
    } catch (e) {
      setStatus({
        kind: "err",
        text: friendlyError(e instanceof Error ? e.message : String(e)),
      });
    }
  }

  const degraded = caps != null && !caps.canScrollCapture;
  const availability = {
    visible: caps?.canCaptureVisible ?? true,
    area: caps?.canAreaSelection ?? true,
    fullpage: caps?.canScrollCapture ?? true,
  };

  const showQuickActions =
    lastResult != null && (status?.kind === "ok" || status?.kind === "warn");

  return (
    <>
      <div className="tool-topbar">
        <Tabs
          value={section}
          onChange={(v: unknown) => setSection(v as Section)}
          list={[
            {
              value: "capture",
              label: `截图${historyCount > 0 ? ` · ${historyCount}` : ""}`,
            },
            { value: "history", label: "历史" },
          ]}
        />
        <Button
          shape="circle"
          variant="text"
          theme="default"
          size="small"
          title="截图设置"
          onClick={() => setShowSettings(true)}
        >
          <SettingIcon />
        </Button>
      </div>

      {showSettings ? (
        <ScreenshotSettings onBack={() => setShowSettings(false)} />
      ) : (
        <>
          {section === "capture" && (
            <>
              {degraded && (
                <div className="degrade-banner">
                  当前浏览器仅支持可见区域截图。整页滚动截图、选定区域与按 URL
                  批量截图已禁用。
                </div>
              )}

              <CaptureTiles
                availability={availability}
                pending={pending}
                progressLabel={loadingLabel(progress)}
                onStart={(m) =>
                  m === "area" ? onCaptureArea() : void onCapture(m)
                }
              />

              {status && (
                <Alert
                  theme={
                    status.kind === "ok"
                      ? "success"
                      : status.kind === "err"
                        ? "error"
                        : status.kind === "warn"
                          ? "warning"
                          : "info"
                  }
                  className="status-alert"
                  message={status.text}
                />
              )}

              {status?.kind === "err" && lastFailedMode && !busy && (
                <Button
                  block
                  variant="outline"
                  onClick={() => void onCapture(lastFailedMode)}
                >
                  ↻ 重试
                </Button>
              )}

              {showQuickActions && (
                <div className="quick-actions">
                  <Button
                    size="small"
                    variant="text"
                    icon={<BrowseIcon />}
                    onClick={() => void previewResult(lastResult!)}
                  >
                    预览
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    icon={<CopyIcon />}
                    onClick={() => void copyResult(lastResult!)}
                  >
                    复制
                  </Button>
                  {lastResult!.downloadId != null && (
                    <Button
                      size="small"
                      variant="text"
                      icon={<FolderOpenIcon />}
                      onClick={() => void openFolder(lastResult!.downloadId!)}
                    >
                      文件夹
                    </Button>
                  )}
                </div>
              )}

              <ProgressBar progress={progress} busy={busy} />

              {busy && activeJob && (
                <Button
                  block
                  theme="danger"
                  variant="outline"
                  onClick={() => void onCancel()}
                >
                  ✕ 取消截图
                </Button>
              )}

              <BatchPanel
                tabCount={tabCount}
                canBatchTabs={caps?.canBatchTabs ?? true}
                canBatchUrls={caps?.canBatchUrls ?? true}
                busy={busy}
                onBatchTabs={() => void onBatchTabs()}
                onBatchUrls={(urls) => void onBatchUrls(urls)}
              />

              <p className="capture-foot muted">
                {config.saveSubfolder
                  ? `自动保存到「下载」目录的 ${config.saveSubfolder}/ 子文件夹`
                  : "结果自动下载到浏览器「下载」目录"}
              </p>
            </>
          )}

          {section === "history" && (
            <HistoryList
              onPreview={(item) => void handlePreview(item)}
              onCountChange={setHistoryCount}
            />
          )}
        </>
      )}

      {preview && (
        <PreviewModal
          record={preview}
          onClose={() => setPreview(null)}
          onToast={pushToast}
        />
      )}
    </>
  );
}
