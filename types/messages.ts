/**
 * 消息协议：background ↔ content ↔ popup 三端共用的判别联合类型。
 * 命名约定：统一 SCREAMING_SNAKE_CASE 大写动词开头，`type` 字段区分，禁止魔法字符串散落。
 */
import type {
  PageMetrics,
  FixedElementInfo,
  Rect,
  CaptureResult,
  BatchResult,
} from "./capture";
import type { CaptureConfig } from "./config";
import type { HeaderRule, HeaderGroup } from "./headers";
import type {
  HeaderRewriteLogEntry,
  HeaderLogSettings,
  HeaderRewriteStats,
} from "./header-log";

// ---- 取消粒度 / 整页分阶段 / toast 种类（P0 优化） ----

/** 取消粒度：单张任务 / 批量任务（A5） */
export type CancelScope = "single" | "batch";

/** 单张整页分阶段进度（A1） */
export type FullpagePhase =
  | "preparing" // 采集度量 / 回顶 / 扫描 fixed / 懒加载
  | "waiting" // 等待页面渲染稳定（可携带 warning=超时）
  | "scrolling" // 逐片滚动截图（携带 current/total 百分比）
  | "stitching" // 拼接合成
  | "downloading"; // 下载 / 写历史（可选，background 侧触发）

/** 选区/页面 toast 种类（A3 回显） */
export type ToastKind = "ok" | "err" | "warn" | "info";

// ---- background → content script ----

export type ContentRequest =
  | { type: "SCROLL_TO"; payload: { y: number } } // 精确滚动到 y（CSS px）
  | { type: "GET_PAGE_METRICS"; payload: Record<string, never> } // 采集页面度量
  | { type: "SCAN_FIXED"; payload: Record<string, never> } // 扫描 fixed/sticky
  | { type: "HIDE_FIXED"; payload: Record<string, never> } // 隐藏 fixed/sticky
  | { type: "RESTORE_FIXED"; payload: Record<string, never> } // 恢复 fixed/sticky
  | { type: "TRIGGER_LAZY_LOAD"; payload: Record<string, never> } // 触发懒加载并等待图片
  | {
      type: "WAIT_STABLE";
      payload: {
        networkIdleMs: number;
        stableWaitMs: number;
        maxWaitMs: number;
      };
    }
  | { type: "START_SELECTION"; payload: Record<string, never> } // 进入选区模式
  | { type: "CANCEL_SELECTION"; payload: Record<string, never> } // 取消选区
  | { type: "SHOW_TOAST"; payload: { kind: ToastKind; text: string } }; // 页面内 toast 回显

// ---- content script → background（响应） ----

export type ContentResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string };

/** content 各类响应数据的类型映射（文档用途，便于三端对齐） */
export type ContentResponseData =
  | PageMetrics
  | FixedElementInfo[]
  | { stable: boolean; timedOut: boolean; elapsedMs: number } // WAIT_STABLE（含超时）
  | Rect // 选区结果
  | { restored: number } // 恢复的 fixed 元素数
  | { y: number }; // 滚动后实际 scrollY

// ---- popup/options → background ----

/** 取消请求负载（A5） */
export type CancelCapturePayload =
  { scope: "single"; tabId: number } | { scope: "batch"; batchId: string };

export type PopupRequest =
  | {
      type: "CAPTURE_VISIBLE";
      payload: { tabId: number; config: CaptureConfig };
    }
  | {
      type: "CAPTURE_FULLPAGE";
      payload: { tabId: number; config: CaptureConfig };
    }
  | {
      type: "CAPTURE_AREA";
      payload: { tabId: number; rect: Rect; config: CaptureConfig };
    }
  | { type: "BATCH_TABS"; payload: { windowId: number; config: CaptureConfig } }
  | { type: "BATCH_URLS"; payload: { urls: string[]; config: CaptureConfig } }
  | { type: "CANCEL_CAPTURE"; payload: CancelCapturePayload } // 取消进行中的截图（A5）
  | { type: "GET_PROGRESS"; payload: Record<string, never> }
  | { type: "GET_CONFIG"; payload: Record<string, never> }
  | { type: "SET_CONFIG"; payload: Partial<CaptureConfig> }
  | { type: "HISTORY_LIST"; payload: Record<string, never> } // 返回 ScreenshotListItem[]
  | { type: "HISTORY_GET"; payload: { id: string } } // 返回 ScreenshotRecord（含原图）
  | { type: "HISTORY_DELETE"; payload: { id: string } }
  | { type: "HISTORY_DELETE_MANY"; payload: { ids: string[] } } // 批量删除（历史页多选） // 删除单条
  | { type: "HISTORY_CLEAR"; payload: Record<string, never> } // 清空
  | { type: "HISTORY_REDOWNLOAD"; payload: { id: string } } // 重新下载原图
  // ---- 请求头改写（工具箱第二个工具） ----
  | { type: "HEADERS_LIST"; payload: Record<string, never> } // 返回 HeaderRule[]
  | { type: "HEADERS_SAVE"; payload: { rule: HeaderRule } } // 新增或覆盖保存
  | { type: "HEADERS_DELETE"; payload: { id: string } }
  | { type: "HEADERS_TOGGLE"; payload: { id: string; enabled: boolean } }
  | {
      // 会话级临时覆盖：强制启用/停用某规则（仅当前会话，重启即清）
      type: "HEADERS_SESSION_OVERRIDE";
      payload: { id: string; enabled: boolean | null };
    }
  | {
      // 拉取当前会话级覆盖快照（用于 UI 在 SW 重启后恢复显示）
      type: "HEADERS_SESSION_LIST";
    }
  | {
      type: "HEADERS_IMPORT";
      payload: { rules: HeaderRule[]; mode: "merge" | "replace" };
    }
  // ---- 分组管理 ----
  | { type: "GROUPS_LIST"; payload: Record<string, never> }
  | { type: "GROUPS_SAVE"; payload: { group: HeaderGroup } }
  | { type: "GROUPS_DELETE"; payload: { id: string } }
  | { type: "GROUPS_TOGGLE"; payload: { id: string; enabled: boolean } }
  | {
      // 按组批量启停成员规则（组开关本身不动；返回更新条数）
      type: "GROUPS_SET_RULES";
      payload: { groupId: string; enabled: boolean };
    }
  // ---- 改写日志与统计 ----
  | { type: "HEADER_LOG_LIST"; payload: { limit?: number } } // 返回 { entries, total }
  | { type: "HEADER_LOG_CLEAR"; payload: Record<string, never> }
  | { type: "HEADER_LOG_STATS"; payload: Record<string, never> } // 返回 HeaderRewriteStats
  | { type: "HEADER_LOG_SETTINGS_GET"; payload: Record<string, never> }
  | {
      type: "HEADER_LOG_SETTINGS_SET";
      payload: Partial<HeaderLogSettings>;
    }
  // ---- MCP 本地服务（仅 Chrome/Edge 经 chrome.sockets 起本地端点） ----
  | { type: "MCP_STATUS"; payload: Record<string, never> }
  | { type: "MCP_START"; payload: Record<string, never> }
  | { type: "MCP_STOP"; payload: Record<string, never> };

/** MCP 本地服务传输方式 */
export type McpTransport = "sockets" | "native";

/** MCP 本地服务状态（MCP_STATUS 返回） */
export interface McpStatus {
  running: boolean;
  /** 传输方式：Chrome 走 chrome.sockets，Firefox 走 nativeMessaging 桥接 */
  transport?: McpTransport;
  /** 本地监听端口（Chrome/Edge sockets 传输） */
  port?: number;
  /** 当前鉴权 token（仅运行时内存镜像，持久于 storage.local） */
  token?: string;
  /** 客户端可直接使用的端点 URL（sockets 传输有值；native 传输见 hint） */
  url?: string;
  /** 不支持 / 需额外操作时的说明（如 Firefox 需安装并运行 native host） */
  unsupportedReason?: string;
  /** 连接指引（native 传输下提示如何启动 native host） */
  hint?: string;
}

// ---- background → popup（进度/结果推送） ----

export type ProgressEvent =
  | { kind: "start"; total: number; batchId?: string; label?: string }
  | {
      kind: "item";
      index: number;
      total: number;
      label: string;
      retrying?: boolean;
      batchId?: string;
    }
  | {
      kind: "stage";
      phase: FullpagePhase;
      label: string;
      current?: number;
      total?: number;
      warning?: string;
    }
  | { kind: "cancelled"; scope: CancelScope; message: string }
  | { kind: "done"; result: BatchResult; warning?: string };

/** background → popup 的通用响应结构（消息层边界） */
export type PopupResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string };

/** background 通过 runtime.sendMessage 主动推送进度的包裹结构 */
export interface ProgressPush {
  type: "__WXT_PROGRESS__";
  event: ProgressEvent;
}

// ---- 截图任务运行上下文（background 注入，A1/A4/A5 共用） ----

/** 截图任务运行上下文：取消检查回调 + 进度路由开关 + 批量任务 id */
export interface CaptureJobContext {
  /** 取消检查：每片/每项之间调用，返回 true 表示中止（A5） */
  shouldCancel?: () => boolean;
  /** 单张整页是否向前端推送 stage 分阶段进度（批量内不传，防污染）（A1） */
  reportStage?: boolean;
  /** 批量任务 id（start 事件携带，popup 取消定位用）（A5） */
  batchId?: string;
}
