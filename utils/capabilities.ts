/**
 * 运行时能力探测：统一从 createAdapter() 的 capabilities 获取，
 * 供 Popup 等 UI 做降级（Safari 禁用整页/选区/按 URL 批量入口）。
 */
import type { Capabilities } from '@/adapters/browser-adapter';
import { createAdapter } from '@/adapters/browser-adapter';

let cached: Capabilities | null = null;

/** 获取当前浏览器能力（结果缓存，避免重复创建 adapter） */
export function getCapabilities(): Capabilities {
  if (!cached) {
    cached = createAdapter().capabilities;
  }
  return cached;
}
