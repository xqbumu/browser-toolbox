/**
 * 后台入口（Service Worker / Background Page）：
 * 注册消息路由，调用 CaptureService 完成截图编排与批量任务；
 * 单张截图自动下载，批量结果自动 Zip 打包下载；进度事件主动推送给 popup；
 * 截图成功后 best-effort 写入历史（IndexedDB，含缩略图 + 原图 + 元数据）。
 */
import { CaptureService } from "@/core/capture-service";
import { getConfig, setConfig } from "@/utils/storage";
import { initLogger, createLogger } from "@/utils/logger";
import {
  downloadDataUrl,
  downloadBlob,
  resolveDownloadPath,
} from "@/utils/download";
import { zipScreenshots } from "@/utils/zip";
import { toErrorMessage, dataUrlToBlob, genId } from "@/utils/helpers";
import {
  addRecord,
  listRecords,
  getRecord,
  deleteRecord,
  clearRecords,
  prune,
} from "@/utils/history-store";
import { createThumbnail } from "@/utils/thumbnail";
import type {
  PopupRequest,
  PopupResponse,
  ProgressEvent,
  CaptureJobContext,
  ToastKind,
  McpStatus,
} from "@/types/messages";
import type { CaptureResult, BatchResult, Rect } from "@/types/capture";
import type { CaptureConfig } from "@/types/config";
import type { ScreenshotRecord } from "@/types/history";
import {
  createHeaderEngine,
  setSessionOverride,
  getSessionOverrides,
  type HeaderEngine,
} from "@/core/headers/engine";
import { initMcp, startMcp, stopMcp, getMcpStatus } from "@/core/mcp/manager";
import {
  deleteHeaderRule,
  deleteGroup,
  importHeaderRules,
  listHeaderRules,
  listGroups,
  saveHeaderRule,
  saveGroup,
  toggleHeaderRule,
  toggleGroup,
  toggleRulesByGroup,
} from "@/utils/header-rules-store";
import {
  clearHeaderLogs,
  flushHeaderLogs,
  getHeaderLogSettings,
  getHeaderRewriteStats,
  initHeaderLogStore,
  listHeaderLogs,
  pushHeaderLogHits,
  setHeaderLogSettings,
} from "@/utils/header-log-store";

const log = createLogger("background");

// 最近一次进度快照（供 popup 重新打开时 GET_PROGRESS 拉取）
let lastProgress: ProgressEvent | null = null;

// 取消标志（A5）：background 内存 Map，任务结束后 delete 避免泄漏。
// key: `single:${tabId}` | `batch:${batchId}`，值 true 表示请求取消。
const cancelFlags = new Map<string, boolean>();

// 请求头改写引擎实例（工具箱）：defineBackground 内异步创建后赋值
let headerEngine: HeaderEngine | null = null;

// 同步队列：多条规则变更并发到达时合并为串行重建，避免 DNR 清理/写入交错
let syncChain: Promise<void> = Promise.resolve();
function requestSync(reason: string): Promise<void> {
  const next = syncChain
    .then(async () => {
      if (headerEngine) await headerEngine.sync();
    })
    .catch((e) => log.warn(`请求头引擎同步失败（${reason}）`, e));
  syncChain = next;
  return next;
}

export default defineBackground(() => {
  void initLogger();

  const captureService = new CaptureService();

  // 请求头改写引擎：按能力选择 DNR / webRequest，规则变更即重建。
  // 日志上报：先初始化日志仓库（读启用开关/设置缓存），再挂接改写成功回调。
  void initHeaderLogStore()
    .then(() =>
      createHeaderEngine({
        onRewrite: (hit) => pushHeaderLogHits([hit]),
      }),
    )
    .then(async (engine) => {
      headerEngine = engine;
      await engine?.sync();
    })
    .catch((e) => log.warn("请求头引擎初始化失败", e));

  // storage 直改兜底（popup/管理中心直写 headerEnabled 总开关、旁路写 headerRules/headerGroups
  // 时触发引擎重建）。所有经存储落盘的规则/分组写操作（含消息分支）都由此统一触发重建——
  // 唯一例外是会话覆盖（仅内存 + storage.session，不落 local，见 HEADERS_SESSION_OVERRIDE 分支）。
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const touched = Object.keys(changes).some((k) =>
      ["headerRules", "headerGroups", "headerEnabled"].includes(k),
    );
    if (touched) {
      void requestSync("storage 变更");
    }
  });

  // 进度事件转发给 popup（popup 可能已关闭，忽略失败）
  captureService.onProgress((event: ProgressEvent) => {
    lastProgress = event;
    browser.runtime
      .sendMessage({ type: "__WXT_PROGRESS__", event })
      .catch(() => {});
  });

  browser.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
      const msg = message as PopupRequest;
      handleRequest(msg, captureService)
        .then((res) => sendResponse(res))
        .catch((err) =>
          sendResponse({
            ok: false,
            error: toErrorMessage(err),
          } satisfies PopupResponse),
        );
      return true; // 异步响应
    },
  );

  // MCP 本地服务：默认关闭（opt-in）。若用户在选项中启用过，则随后台自动恢复监听。
  // Chrome/Edge 走 chrome.sockets（Firefox 桥接见 firefox-bridge.ts）。
  void initMcp((msg) => handleRequest(msg, captureService))
    .then((status) => {
      if (status.running)
        log.info("MCP 本地服务已启动", (status as McpStatus).url);
      else if ((status as McpStatus).unsupportedReason)
        log.info(
          "MCP 本地服务不可用：",
          (status as McpStatus).unsupportedReason,
        );
    })
    .catch((e) => log.warn("MCP 本地服务启动失败", e));

  log.info("后台已启动");
});

/** 处理 popup/options 请求 */
async function handleRequest(
  msg: PopupRequest,
  service: CaptureService,
): Promise<PopupResponse<unknown>> {
  switch (msg.type) {
    case "GET_CONFIG":
      return { ok: true, data: await getConfig() };

    case "SET_CONFIG": {
      const next = await setConfig(msg.payload);
      // historyLimit 下调时懒淘汰，保证下次列表已收敛（best-effort）
      if (msg.payload.historyLimit !== undefined) {
        await prune(clampLimit(next.historyLimit)).catch((e) =>
          log.warn("SET_CONFIG 后淘汰历史失败", e),
        );
      }
      return { ok: true, data: next };
    }

    case "GET_PROGRESS":
      return { ok: true, data: lastProgress };

    case "CAPTURE_VISIBLE": {
      try {
        const result = await service.captureVisible(
          msg.payload.tabId,
          msg.payload.config,
        );
        await maybeDownload(result, msg.payload.config);
        await recordHistory(result, msg.payload.config);
        return { ok: true, data: result };
      } finally {
        // B5：单张任务完成即清理进度快照，避免 popup 重开误判「进行中」
        lastProgress = null;
      }
    }

    case "CAPTURE_FULLPAGE": {
      const key = `single:${msg.payload.tabId}`;
      cancelFlags.set(key, false);
      // A1 + A5：单张整页开启 stage 进度 + 注入取消检查
      const ctx: CaptureJobContext = {
        reportStage: true,
        shouldCancel: () => cancelFlags.get(key) === true,
      };
      try {
        const result = await service.captureFullpage(
          msg.payload.tabId,
          msg.payload.config,
          ctx,
        );
        await maybeDownload(result, msg.payload.config);
        await recordHistory(result, msg.payload.config);
        return { ok: true, data: result };
      } finally {
        cancelFlags.delete(key);
        // B5：单张任务完成即清理进度快照（stage 事件不留残余）
        lastProgress = null;
      }
    }

    case "CAPTURE_AREA": {
      try {
        // rect 为空表示需先进入选区模式；否则直接按给定 rect 裁剪
        let rect = msg.payload.rect;
        if (rect.width <= 0 || rect.height <= 0) {
          const selected = await startSelection(msg.payload.tabId);
          if (!selected.ok) return { ok: false, error: selected.error };
          rect = selected.data;
        }
        const result = await service.captureArea(
          msg.payload.tabId,
          rect,
          msg.payload.config,
        );
        await maybeDownload(result, msg.payload.config);
        await recordHistory(result, msg.payload.config);
        // A3：选区完成后向页面回显结果（取消场景已在 startSelection 提前返回，不会重复）
        await notifyAreaResult(msg.payload.tabId, result);
        return { ok: true, data: result };
      } finally {
        // B5：单张任务完成即清理进度快照（选区取消/失败提前 return 也走 finally）
        lastProgress = null;
      }
    }

    case "BATCH_TABS": {
      const batchId = genId();
      const key = `batch:${batchId}`;
      cancelFlags.set(key, false);
      const ctx: CaptureJobContext = {
        batchId,
        shouldCancel: () => cancelFlags.get(key) === true,
      };
      try {
        const result = await service.batchTabs(
          msg.payload.windowId,
          msg.payload.config,
          ctx,
        );
        await maybeDownloadZip(result, msg.payload.config);
        // 批量按单条写入历史，Zip 本身不入历史
        for (const item of result.items) {
          await recordHistory(item, msg.payload.config);
        }
        return { ok: true, data: result };
      } finally {
        cancelFlags.delete(key);
      }
    }

    case "BATCH_URLS": {
      const batchId = genId();
      const key = `batch:${batchId}`;
      cancelFlags.set(key, false);
      const ctx: CaptureJobContext = {
        batchId,
        shouldCancel: () => cancelFlags.get(key) === true,
      };
      try {
        const result = await service.batchUrls(
          msg.payload.urls,
          msg.payload.config,
          ctx,
        );
        await maybeDownloadZip(result, msg.payload.config);
        for (const item of result.items) {
          await recordHistory(item, msg.payload.config);
        }
        return { ok: true, data: result };
      } finally {
        cancelFlags.delete(key);
      }
    }

    case "CANCEL_CAPTURE": {
      // A5：定位到 single/batch 的取消标志并置 true；任务结束后由各自分支 delete
      const key =
        msg.payload.scope === "single"
          ? `single:${msg.payload.tabId}`
          : `batch:${msg.payload.batchId}`;
      if (!cancelFlags.has(key))
        return { ok: true, data: { cancelled: false } };
      cancelFlags.set(key, true);
      return { ok: true, data: { cancelled: true } };
    }

    case "HISTORY_LIST":
      return { ok: true, data: await listRecords() };

    case "HISTORY_GET": {
      const record = await getRecord(msg.payload.id);
      if (!record) return { ok: false, error: "历史记录不存在" };
      return { ok: true, data: record };
    }

    case "HISTORY_DELETE":
      await deleteRecord(msg.payload.id);
      return { ok: true, data: { deleted: msg.payload.id } };

    case "HISTORY_DELETE_MANY": {
      let deleted = 0;
      for (const id of msg.payload.ids) {
        await deleteRecord(id).catch(() => {});
        deleted += 1;
      }
      return { ok: true, data: { deleted } };
    }

    case "HISTORY_CLEAR":
      return { ok: true, data: { cleared: await clearRecords() } };

    case "HISTORY_REDOWNLOAD": {
      try {
        const record = await getRecord(msg.payload.id);
        if (!record) return { ok: false, error: "历史记录不存在" };
        const config = await getConfig();
        const path = resolveDownloadPath(config.saveSubfolder, record.fileName);
        await downloadBlob(record.imageBlob, path); // 重下载不再写历史，避免重复
        return { ok: true, data: { fileName: path } };
      } catch (e) {
        // 下载失败时返回结构化错误，避免异常冒泡到 popup 导致未捕获
        return { ok: false, error: toErrorMessage(e) };
      }
    }

    case "HEADERS_LIST":
      return { ok: true, data: await listHeaderRules() };

    case "HEADERS_SAVE": {
      const saved = await saveHeaderRule(msg.payload.rule);
      // 引擎重建统一由 storage.onChanged 兜底触发（storage.local 落盘即广播）
      return { ok: true, data: saved };
    }

    case "HEADERS_DELETE": {
      await deleteHeaderRule(msg.payload.id);
      return { ok: true, data: { deleted: msg.payload.id } };
    }

    case "HEADERS_TOGGLE": {
      await toggleHeaderRule(msg.payload.id, msg.payload.enabled);
      return {
        ok: true,
        data: { id: msg.payload.id, enabled: msg.payload.enabled },
      };
    }

    case "HEADERS_IMPORT": {
      const all = await importHeaderRules(msg.payload.rules, msg.payload.mode);
      return { ok: true, data: all };
    }

    case "HEADERS_SESSION_OVERRIDE": {
      // 会话级覆盖不落 storage.local（仅内存 + storage.session），onChanged 兜底不覆盖，
      // 故此处显式重建引擎以即时生效
      setSessionOverride(msg.payload.id, msg.payload.enabled);
      await requestSync("会话覆盖变更");
      return {
        ok: true,
        data: { id: msg.payload.id, enabled: msg.payload.enabled },
      };
    }

    case "HEADERS_SESSION_LIST":
      return { ok: true, data: getSessionOverrides() };

    case "GROUPS_LIST":
      return { ok: true, data: await listGroups() };

    case "GROUPS_SAVE": {
      const saved = await saveGroup(msg.payload.group);
      return { ok: true, data: saved };
    }

    case "GROUPS_DELETE": {
      await deleteGroup(msg.payload.id);
      return { ok: true, data: { deleted: msg.payload.id } };
    }

    case "GROUPS_TOGGLE": {
      await toggleGroup(msg.payload.id, msg.payload.enabled);
      return {
        ok: true,
        data: { id: msg.payload.id, enabled: msg.payload.enabled },
      };
    }

    case "GROUPS_SET_RULES": {
      // 批量「启用成员」的语义是「让组内规则生效」：目标分组若当前停用则先连带开启组开关，
      // 否则成员 enabled=true 会被组级开关屏蔽（engine 优先级：组开关 > 成员开关），
      // UI 会显示已启用但实际不生效。引擎重建由 storage.onChanged 兜底统一触发。
      const { groupId, enabled } = msg.payload;
      if (enabled && groupId !== "") {
        const groups = await listGroups();
        const group = groups.find((g) => g.id === groupId);
        if (group && !group.enabled) await toggleGroup(groupId, true);
      }
      const updated = await toggleRulesByGroup(groupId, enabled);
      return { ok: true, data: { updated } };
    }

    case "HEADER_LOG_LIST":
      // 读前内部先落盘，保证 UI 视图与引擎事件一致
      return { ok: true, data: await listHeaderLogs(msg.payload.limit) };

    case "HEADER_LOG_CLEAR":
      return { ok: true, data: { cleared: await clearHeaderLogs() } };

    case "HEADER_LOG_STATS":
      return { ok: true, data: await getHeaderRewriteStats() };

    case "HEADER_LOG_SETTINGS_GET":
      return { ok: true, data: await getHeaderLogSettings() };

    case "HEADER_LOG_SETTINGS_SET":
      return { ok: true, data: await setHeaderLogSettings(msg.payload) };

    case "MCP_STATUS":
      return { ok: true, data: await getMcpStatus() };

    case "MCP_START":
      return {
        ok: true,
        data: await startMcp((m) => handleRequest(m, service)),
      };

    case "MCP_STOP":
      await stopMcp();
      return { ok: true, data: await getMcpStatus() };

    default: {
      const unknown = msg as { type?: string };
      return {
        ok: false,
        error: `未知请求类型: ${unknown.type ?? "undefined"}`,
      };
    }
  }
}

/** 单张截图成功后自动下载（落到当前 saveSubfolder 子目录；下载失败写回结果，A2） */
async function maybeDownload(
  result: CaptureResult,
  config: CaptureConfig,
): Promise<void> {
  if (result.ok && result.dataUrl && result.fileName) {
    try {
      const path = resolveDownloadPath(config.saveSubfolder, result.fileName);
      const id = await downloadDataUrl(result.dataUrl, path);
      // B3：记录 downloadId，供 popup「打开文件夹」调用 browser.downloads.show
      result.downloadId = id;
      // 成功：downloadFailed 保持 undefined（=false 语义）
    } catch (e) {
      result.downloadFailed = true;
      result.downloadError = toErrorMessage(e);
      log.error("下载失败", e);
    }
  }
}

/** 批量结果：打包成功项为 Zip 并自动下载（下载失败写回结果，A2） */
async function maybeDownloadZip(
  result: BatchResult,
  config: CaptureConfig,
): Promise<void> {
  if (result.success === 0) return;
  try {
    const blob = await zipScreenshots(result.items);
    const fileName = `screenshots_${zipTimestamp()}.zip`;
    const path = resolveDownloadPath(config.saveSubfolder, fileName);
    await downloadBlob(blob, path);
  } catch (e) {
    result.downloadFailed = true;
    result.downloadError = toErrorMessage(e);
    log.error("Zip 打包下载失败", e);
  }
}

/**
 * 截图成功后写历史（best-effort）：dataURL → 原图 Blob → 缩略图 → addRecord。
 * 失败仅记日志，不阻断截图响应与下载；缩略图失败时兜底使用原图作为缩略图。
 */
async function recordHistory(
  result: CaptureResult,
  config: CaptureConfig,
): Promise<void> {
  if (!result.ok || !result.dataUrl) return;
  try {
    const imageBlob = await dataUrlToBlob(result.dataUrl);
    const thumbBlob = await createThumbnail(imageBlob).catch(() => imageBlob);
    const record: ScreenshotRecord = {
      id: genId(),
      fileName: result.fileName ?? "",
      url: result.url ?? "",
      title: result.title ?? "",
      mode: result.mode,
      format: result.format ?? config.format,
      createdAt: Date.now(),
      sizeBytes: imageBlob.size,
      thumbBlob,
      imageBlob,
    };
    await addRecord(record, clampLimit(config.historyLimit));
  } catch (e) {
    log.error("写历史失败（不阻断截图主流程）", e);
  }
}

/** 进入选区模式：向 content 发送 START_SELECTION 并等待用户框选 */
async function startSelection(
  tabId: number,
): Promise<{ ok: true; data: Rect } | { ok: false; error: string }> {
  try {
    const res = (await browser.tabs.sendMessage(tabId, {
      type: "START_SELECTION",
      payload: {},
    })) as { ok: true; data: Rect } | { ok: false; error: string };
    return res;
  } catch (e) {
    return { ok: false, error: toErrorMessage(e) };
  }
}

/** 选区完成/失败/下载失败后向页面回显 toast（A3） */
async function notifyAreaResult(
  tabId: number,
  result: CaptureResult,
): Promise<void> {
  let kind: ToastKind = "info";
  let text = "";
  if (!result.ok) {
    kind = "err";
    text = `选区截图失败：${result.error ?? "未知错误"}`;
  } else if (result.downloadFailed) {
    kind = "warn";
    text = `选区截图已生成，但下载失败：${result.downloadError ?? ""}`;
  } else {
    kind = "ok";
    text = `已保存选区截图：${result.fileName ?? ""}`;
  }
  try {
    await browser.tabs.sendMessage(tabId, {
      type: "SHOW_TOAST",
      payload: { kind, text },
    });
  } catch (e) {
    // content 可能已卸载/无法注入，回显失败不影响主流程
    log.warn("选区回显失败", e);
  }
}

/** historyLimit 收敛到 1~200，异常值回退 50 */
function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(200, Math.max(1, Math.floor(value)));
}

/** Zip 文件名时间戳：YYYYMMDD_HHmmss */
function zipTimestamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(
    d.getMinutes(),
  )}${p(d.getSeconds())}`;
}
