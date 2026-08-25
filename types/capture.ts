/**
 * 截图核心类型：截图模式、结果、分片、页面度量、fixed 元素信息等。
 * 纯类型模块，不产生运行时代码，background / content / popup 三端共享。
 */

/** 截图模式：可见区域 / 选定区域 / 整页滚动 */
export type CaptureMode = 'visible' | 'area' | 'fullpage';

/** 输出格式 */
export type OutputFormat = 'png' | 'jpeg';

/** 矩形区域（CSS px，相对视口/页面左上角） */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 页面度量（content script 采集，CSS px + DPR） */
export interface PageMetrics {
  viewportWidth: number; // window.innerWidth
  viewportHeight: number; // window.innerHeight
  fullWidth: number; // 真实滚动容器的 scrollWidth（window 级滚动 = 页面总宽）
  fullHeight: number; // 真实滚动容器的 scrollHeight（修复内部容器滚动只截第一屏的关键）
  devicePixelRatio: number; // window.devicePixelRatio
  scrollY: number; // 当前滚动位置（真实滚动容器的 scrollTop）
  /** 滚动容器可见高（内部容器滚动 = 容器 clientHeight；window 级滚动 = viewportHeight）。
   *  可选以兼容旧调用方，缺失时按 viewportHeight 处理。 */
  scrollViewportHeight?: number;
  /** 滚动容器相对视口的纵向偏移（window 级滚动 = 0；内部容器滚动 = 容器 getBoundingClientRect().top）。
   *  可选以兼容旧调用方，缺失时按 0 处理。 */
  scrollOffsetY?: number;
  /** 滚动容器可见宽（内部容器滚动 = 容器 clientWidth；window 级滚动 = viewportWidth）。
   *  可选以兼容旧调用方，缺失时按 viewportWidth 处理。 */
  scrollViewportWidth?: number;
  /** 滚动容器相对视口的水平偏移（window 级滚动 = 0；内部容器滚动 = 容器 getBoundingClientRect().left）。
   *  可选以兼容旧调用方，缺失时按 0 处理。 */
  scrollOffsetX?: number;
}

/** 固定/粘性元素信息（滚动前扫描记录） */
export interface FixedElementInfo {
  index: number;
  tagName: string;
  position: 'fixed' | 'sticky';
  /** scrollY=0 时 getBoundingClientRect()（CSS px，相对视口） */
  rect: Rect;
  id?: string;
  className?: string;
}

/** 单个滚动分片 */
export interface Slice {
  index: number;
  /** 该分片对应的页面滚动位置（CSS px，整数，滚动后实测值） */
  scrollY: number;
  /** 原生截图 dataURL */
  dataUrl: string;
  /** 物理像素宽 */
  width: number;
  /** 物理像素高 */
  height: number;
}

/** 单次截图结果 */
export interface CaptureResult {
  ok: boolean;
  mode: CaptureMode;
  fileName?: string;
  /** 最终结果（整页/可见/选区）dataURL */
  dataUrl?: string;
  /** 输出格式（历史记录需要，可选以兼容旧调用方） */
  format?: OutputFormat;
  tabId?: number;
  url?: string;
  title?: string;
  /** 失败原因 */
  error?: string;
  /** 是否已自动重试 */
  retried?: boolean;
  /** 用户主动取消（A5） */
  cancelled?: boolean;
  /** 警告提示，如「页面等待超时，内容可能未加载完整」（A4） */
  warning?: string;
  /** 截图成功但下载失败（A2） */
  downloadFailed?: boolean;
  /** 下载失败原因（A2） */
  downloadError?: string;
  /** 下载成功时的 downloadId（B3，popup「打开文件夹」用 browser.downloads.show） */
  downloadId?: number;
}

/** 批量截图汇总 */
export interface BatchResult {
  total: number;
  success: number;
  failed: number;
  items: CaptureResult[];
  /** 批量任务被用户取消（A5） */
  cancelled?: boolean;
  /** Zip 打包下载失败（A2） */
  downloadFailed?: boolean;
  downloadError?: string;
  /** 被跳过的不可截取项数量（B6，如 chrome:// 受保护选项卡） */
  skipped?: number;
}
