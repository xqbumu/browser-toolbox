/**
 * 通用小工具：延时、动画帧、错误信息归一化、Blob→dataURL、tab 信息读取。
 * 该模块不依赖 adapters 的运行时代码（仅类型引用），避免与 adapters 产生循环依赖。
 */
import type { TabInfo } from '@/adapters/browser-adapter';

/** 延时指定毫秒 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 等待下一动画帧（Service Worker 环境无 rAF 时退化为 16ms 定时器） */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 16);
    }
  });
}

/** 将任意异常归一化为可展示的字符串 */
export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

/** Blob → dataURL（分块编码，避免大图 String.fromCharCode 栈溢出） */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

/** dataURL → Blob（历史写入与缩略图生成的输入转换，与 blobToDataUrl 对称） */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const idx = dataUrl.indexOf(',');
  const meta = idx >= 0 ? dataUrl.slice(0, idx) : '';
  const b64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  const mime = /data:(.*?)(;|$)/.exec(meta)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** 生成唯一 id：优先 crypto.randomUUID，降级时间戳+随机数（兼容无 UUID 的旧环境） */
export function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 估算批量剩余耗时（ms）：平均单页耗时 × 剩余页数（B1）。
 * 无法估算（无已完成项 / 已完成已覆盖全部）时返回 null，由调用方决定是否展示。
 * @param elapsedMs 已耗时（ms）
 * @param completed 已完成项数量
 * @param total 总项数
 */
export function estimateRemainingMs(
  elapsedMs: number,
  completed: number,
  total: number,
): number | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return null;
  if (!Number.isFinite(completed) || completed <= 0) return null;
  if (!Number.isFinite(total) || total <= completed) return null;
  const avg = elapsedMs / completed;
  return Math.max(0, Math.round(avg * (total - completed)));
}

/** 毫秒 → 秒字符串（四舍五入到整数秒），用于「已耗时 Xs · 剩余约 Ys」展示 */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${s}s`;
}

/** 读取单个 tab 信息（browser.tabs.get 为通用 API，无跨浏览器差异） */
export async function fetchTabInfo(tabId: number): Promise<TabInfo> {
  const tab = await browser.tabs.get(tabId);
  return {
    id: tab.id ?? -1,
    windowId: tab.windowId ?? -1,
    url: tab.url,
    title: tab.title,
    active: tab.active ?? false,
  };
}
