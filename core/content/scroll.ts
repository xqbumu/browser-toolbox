/**
 * 精确滚动与页面度量采集（content script 端，页面顶层 frame 运行）。
 * 兼容两类滚动模型：
 * - window 级滚动（普通页面）：document.scrollingElement 可滚；
 * - 内部容器滚动（SPA，如腾讯云控制台）：实际滚动发生在某个 overflow 容器内，window 不滚。
 * 度量与滚动统一以「真实滚动容器」为准，避免内部容器页面只截到第一屏。
 */
import type { PageMetrics } from "@/types/capture";
import { nextFrame } from "@/utils/helpers";

/** 滚动容器候选（纯数据，便于脱离 DOM 单测） */
export interface ScrollCandidate {
  scrollHeight: number;
  clientHeight: number;
  /** 计算样式 overflow-y */
  overflowY: string;
  /** 计算样式 overflow（overflow-y 未显式设置时的兜底） */
  overflow: string;
}

/** 判断单个元素是否为可滚动容器：scrollHeight 超过可视高，且 overflow 允许滚动 */
export function isScrollableElement(c: ScrollCandidate): boolean {
  if (c.scrollHeight <= c.clientHeight + 1) return false;
  const oy = (c.overflowY || "").toLowerCase();
  const o = (c.overflow || "").toLowerCase();
  return (
    oy === "auto" ||
    oy === "scroll" ||
    oy === "overlay" ||
    o === "auto" ||
    o === "scroll" ||
    o === "overlay"
  );
}

/** 从候选集合中选出主滚动容器（scrollHeight 最大者），无则返回 -1 */
export function pickBestScrollContainer(candidates: ScrollCandidate[]): number {
  let best = -1;
  let bestHeight = -1;
  for (let i = 0; i < candidates.length; i += 1) {
    const cand = candidates[i];
    if (!cand || !isScrollableElement(cand)) continue;
    if (cand.scrollHeight > bestHeight) {
      bestHeight = cand.scrollHeight;
      best = i;
    }
  }
  return best;
}

/** 模块级缓存：同一页面多次调用返回同一容器（SPA 容器稳定，避免重复遍历） */
let cachedContainer: HTMLElement | null = null;

/**
 * 检测页面真实滚动容器：
 * 1. window 级可滚 → 返回 document.scrollingElement；
 * 2. 否则遍历所有元素，找出 overflow 可滚且 scrollHeight 最大的内部容器；
 * 3. 找不到则回退 document.scrollingElement。
 */
export function detectScrollContainer(): HTMLElement {
  if (cachedContainer) return cachedContainer;
  const se = (document.scrollingElement ||
    document.documentElement) as HTMLElement;

  // window 级可滚：直接返回 scrollingElement
  if (se.scrollHeight > se.clientHeight + 1) {
    cachedContainer = se;
    return se;
  }

  // 内部容器滚动：遍历所有元素找 scrollHeight 最大的可滚动容器
  const els = Array.from(document.querySelectorAll("*")) as HTMLElement[];
  const candidates: Array<{ el: HTMLElement; data: ScrollCandidate }> = [];
  for (const el of els) {
    const style = window.getComputedStyle(el);
    candidates.push({
      el,
      data: {
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        overflowY: style.overflowY,
        overflow: style.overflow,
      },
    });
  }
  const best = pickBestScrollContainer(candidates.map((c) => c.data));
  cachedContainer = best >= 0 ? candidates[best]!.el : se;
  return cachedContainer;
}

/** 是否 window 级滚动容器（此类容器需走 window.scrollTo / window.scrollY） */
export function isWindowScroller(container: HTMLElement): boolean {
  return (
    container === document.scrollingElement ||
    container === document.documentElement ||
    container === document.body
  );
}

/** 读取容器当前滚动位置（CSS px） */
function getScrollY(container: HTMLElement): number {
  return isWindowScroller(container) ? window.scrollY : container.scrollTop;
}

/** 精确滚动到 y（CSS px，整数），返回滚动后实测值 */
export async function scrollToY(y: number): Promise<number> {
  const container = detectScrollContainer();
  const target = Math.max(0, Math.round(y));
  if (isWindowScroller(container)) {
    window.scrollTo(0, target);
  } else {
    container.scrollTop = target;
  }
  // 等待两帧，确保滚动与合成完成（滚动条到底时实测值可能与目标有偏差，以实测为准）
  await nextFrame();
  await nextFrame();
  return Math.round(getScrollY(container));
}

/** 采集页面度量（CSS px + DPR），以真实滚动容器为准 */
export function getPageMetrics(): PageMetrics {
  const container = detectScrollContainer();
  const windowLevel = isWindowScroller(container);
  const rect = container.getBoundingClientRect();
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    // window 级：画布至少整窗宽；内部容器：以容器内容真实宽度为准（不被整窗撑宽）
    fullWidth: windowLevel
      ? Math.max(container.scrollWidth, window.innerWidth)
      : container.scrollWidth,
    fullHeight: container.scrollHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    scrollY: Math.round(getScrollY(container)),
    // window 级滚动时强制可见宽高 = 视口宽高、偏移 = 0，保证不触发裁剪（零回归）
    scrollViewportWidth: windowLevel
      ? window.innerWidth
      : container.clientWidth,
    scrollViewportHeight: windowLevel
      ? window.innerHeight
      : container.clientHeight,
    scrollOffsetX: windowLevel ? 0 : Math.round(rect.left),
    scrollOffsetY: windowLevel ? 0 : Math.round(rect.top),
  };
}
