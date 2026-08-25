/**
 * Popup 主面板：顶部「截图 / 历史」Tab 分段。
 * 截图 Tab：模式选择 + 主按钮 + 批量面板 + 进度/结果（Safari 降级提示保留）。
 * 历史 Tab：历史列表（搜索/清空/预览/重新下载/删除）。
 * 复用 ModeSelector / BatchPanel / ProgressBar 不改其内部逻辑。
 *
 * P0：整页分阶段进度（stage）、超时/下载失败 warn 状态、busy 时取消按钮（single/batch）。
 */
import { useEffect, useState } from 'react';
import { DEFAULT_CONFIG, type CaptureConfig } from '@/types/config';
import type { CaptureMode, CaptureResult, BatchResult } from '@/types/capture';
import type { ScreenshotRecord, ScreenshotListItem } from '@/types/history';
import type { PopupRequest, PopupResponse, ProgressEvent } from '@/types/messages';
import type { Capabilities } from '@/adapters/browser-adapter';
import { getCapabilities } from '@/utils/capabilities';
import { ModeSelector } from './components/ModeSelector';
import { BatchPanel } from './components/BatchPanel';
import { ProgressBar } from './components/ProgressBar';
import { HistoryList } from './components/HistoryList';
import { PreviewModal } from './components/PreviewModal';

/** 向 background 发送请求并解包响应 */
async function request<T>(msg: PopupRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as PopupResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

type Tab = 'capture' | 'history';

type StatusKind = 'ok' | 'err' | 'info' | 'warn';
type StatusState = { kind: StatusKind; text: string } | null;

/** 当前进行中的任务，用于取消定位（A5） */
type ActiveJob = { kind: 'single'; tabId: number } | { kind: 'batch'; batchId?: string };

const EMPTY_RECT = { x: 0, y: 0, width: 0, height: 0 };

/** 单张截图结果 → 状态文案（区分取消/下载失败/超时/成功） */
function captureStatus(result: CaptureResult): StatusState {
  if (result.cancelled) return { kind: 'info', text: '已取消截图' };
  if (!result.ok) return { kind: 'err', text: result.error ?? '截图失败' };
  if (result.downloadFailed) {
    return { kind: 'warn', text: `✅ 截图完成，⚠️ 下载失败：${result.downloadError ?? ''}` };
  }
  if (result.warning) {
    return { kind: 'warn', text: `已下载：${result.fileName ?? ''}（${result.warning}）` };
  }
  return { kind: 'ok', text: `已下载：${result.fileName ?? ''}` };
}

/** 批量结果 → 状态文案（区分取消/打包下载失败/成功） */
function batchStatus(result: BatchResult): StatusState {
  if (result.cancelled) {
    return { kind: 'info', text: `已取消批量截图（成功 ${result.success}，失败 ${result.failed}）` };
  }
  if (result.downloadFailed) {
    return { kind: 'warn', text: `批量截图完成，但打包下载失败：${result.downloadError ?? ''}` };
  }
  return { kind: 'ok', text: '批量截图完成，已打包下载' };
}

export default function App() {
  const [tab, setTab] = useState<Tab>('capture');
  const [mode, setMode] = useState<CaptureMode>(DEFAULT_CONFIG.mode);
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

  useEffect(() => {
    void init();
    // 监听 background 主动推送的进度事件
    const listener = (message: unknown): void => {
      const msg = message as { type?: string; event?: ProgressEvent };
      if (msg && msg.type === '__WXT_PROGRESS__' && msg.event) {
        setProgress(msg.event);
        if (msg.event.kind === 'start' && msg.event.batchId) {
          // 批量任务回填 batchId（取消定位用）
          const batchId = msg.event.batchId;
          setActiveJob((prev) =>
            prev?.kind === 'batch' ? { kind: 'batch', batchId } : prev,
          );
        }
        if (msg.event.kind === 'done') {
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
      const [cfg, tabs, activeTabs] = await Promise.all([
        request<CaptureConfig>({ type: 'GET_CONFIG', payload: {} }),
        browser.tabs.query({ currentWindow: true }),
        browser.tabs.query({ active: true, currentWindow: true }),
      ]);
      setConfig(cfg);
      setMode(cfg.mode);
      setTabCount(tabs.length);
      const active = activeTabs[0];
      if (active?.id != null) {
        setTabId(active.id);
        setWindowId(active.windowId ?? null);
      }
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  }

  function ensureReady(): boolean {
    if (tabId == null) {
      setStatus({ kind: 'err', text: '未找到当前选项卡' });
      return false;
    }
    return true;
  }

  async function onCapture(m: CaptureMode): Promise<void> {
    if (!ensureReady() || busy) return;
    setBusy(true);
    setProgress(null);
    setActiveJob({ kind: 'single', tabId: tabId! });
    setStatus({ kind: 'info', text: '正在截图…' });
    try {
      const type = m === 'visible' ? 'CAPTURE_VISIBLE' : 'CAPTURE_FULLPAGE';
      const result = await request<CaptureResult>({
        type,
        payload: { tabId: tabId!, config },
      });
      setStatus(captureStatus(result));
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setActiveJob(null);
      // 单张截图完成后清空进度，避免残留 stage 空卡片
      setProgress(null);
    }
  }

  function onCaptureArea(): void {
    if (!ensureReady() || busy) return;
    setStatus({ kind: 'info', text: '已进入选区模式，请在页面拖拽框选' });
    // 选区交互需要关闭 popup，消息发出后立即关闭
    browser.runtime
      .sendMessage({
        type: 'CAPTURE_AREA',
        payload: { tabId: tabId!, rect: EMPTY_RECT, config },
      } satisfies PopupRequest)
      .catch(() => {});
    window.close();
  }

  async function onBatchTabs(): Promise<void> {
    if (windowId == null || busy) return;
    setBusy(true);
    setProgress(null);
    setActiveJob({ kind: 'batch' });
    setStatus({ kind: 'info', text: '正在批量截图（按选项卡）…' });
    try {
      const result = await request<BatchResult>({
        type: 'BATCH_TABS',
        payload: { windowId, config },
      });
      setStatus(batchStatus(result));
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setActiveJob(null);
    }
  }

  async function onBatchUrls(urls: string[]): Promise<void> {
    if (busy) return;
    setBusy(true);
    setProgress(null);
    setActiveJob({ kind: 'batch' });
    setStatus({ kind: 'info', text: '正在批量截图（按 URL）…' });
    try {
      const result = await request<BatchResult>({
        type: 'BATCH_URLS',
        payload: { urls, config },
      });
      setStatus(batchStatus(result));
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setActiveJob(null);
    }
  }

  /** 取消进行中的截图（single/batch 两粒度，A5） */
  async function onCancel(): Promise<void> {
    if (!activeJob) return;
    try {
      if (activeJob.kind === 'single') {
        await request<{ cancelled: boolean }>({
          type: 'CANCEL_CAPTURE',
          payload: { scope: 'single', tabId: activeJob.tabId },
        });
      } else if (activeJob.batchId) {
        await request<{ cancelled: boolean }>({
          type: 'CANCEL_CAPTURE',
          payload: { scope: 'batch', batchId: activeJob.batchId },
        });
      }
    } catch (e) {
      // 取消失败不阻断主流程，静默忽略
    }
  }

  async function handlePreview(item: ScreenshotListItem): Promise<void> {
    try {
      const record = await request<ScreenshotRecord>({
        type: 'HISTORY_GET',
        payload: { id: item.id },
      });
      setPreview(record);
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  }

  function openSettings(): void {
    void browser.runtime.openOptionsPage();
  }

  function startCapture(): void {
    if (mode === 'area') {
      onCaptureArea();
    } else {
      void onCapture(mode);
    }
  }

  const degraded = caps != null && !caps.canScrollCapture;
  const availability = {
    visible: caps?.canCaptureVisible ?? true,
    area: caps?.canAreaSelection ?? true,
    fullpage: caps?.canScrollCapture ?? true,
  };

  const statusClass = !status
    ? 'muted'
    : status.kind === 'err'
      ? 'status-err'
      : status.kind === 'ok'
        ? 'status-ok'
        : status.kind === 'warn'
          ? 'status-warn'
          : 'muted';

  return (
    <div>
      <header className="app-header">
        <h1>
          <span role="img" aria-label="screenshot">
            🖼️
          </span>
          网页截图助手
        </h1>
        <a className="settings-link" title="设置" onClick={openSettings}>
          ⚙️
        </a>
      </header>

      <div className="tab-bar">
        <button className={`tab${tab === 'capture' ? ' active' : ''}`} onClick={() => setTab('capture')}>
          截图
        </button>
        <button className={`tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
          历史{historyCount > 0 ? ` · ${historyCount}` : ''}
        </button>
      </div>

      {tab === 'capture' && (
        <>
          {degraded && (
            <div className="degrade-banner">
              当前浏览器仅支持可见区域截图。整页滚动截图、选定区域与按 URL 批量截图已禁用。
            </div>
          )}

          <ModeSelector value={mode} availability={availability} onChange={setMode} />

          <button
            className="primary block capture-btn"
            disabled={busy || !availability[mode]}
            onClick={startCapture}
          >
            {mode === 'visible' && '📸 截取可见区域'}
            {mode === 'area' && '🔲 选定区域'}
            {mode === 'fullpage' && '📜 整页滚动截图'}
          </button>

          <BatchPanel
            tabCount={tabCount}
            canBatchTabs={caps?.canBatchTabs ?? true}
            canBatchUrls={caps?.canBatchUrls ?? true}
            busy={busy}
            onBatchTabs={() => void onBatchTabs()}
            onBatchUrls={(urls) => void onBatchUrls(urls)}
          />

          {status && <p className={`status-line ${statusClass}`}>{status.text}</p>}

          <ProgressBar progress={progress} busy={busy} />

          {busy && activeJob && (
            <button className="danger block cancel-btn" onClick={() => void onCancel()}>
              ✕ 取消截图
            </button>
          )}

          <p className="muted" style={{ marginTop: 0 }}>
            结果自动下载到浏览器「下载」目录
          </p>
        </>
      )}

      {tab === 'history' && (
        <HistoryList onPreview={(item) => void handlePreview(item)} onCountChange={setHistoryCount} />
      )}

      {preview && <PreviewModal record={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
