/**
 * 异步渲染完成判定（content script 端，Q2）：
 * PerformanceObserver('resource') 监控网络资源 + MutationObserver 监控 DOM 变化，
 * 任一触发即刷新「最后活动时间」；连续 networkIdleMs 无活动视为空闲；
 * 随后追加 stableWaitMs 固定延时兜底；总时长受 maxWaitMs 上限保护，超时按「已尽力」继续。
 */
import { sleep } from '@/utils/helpers';

export interface StableWaitOptions {
  networkIdleMs: number;
  stableWaitMs: number;
  maxWaitMs: number;
}

export interface StableWaitResult {
  /** 是否在 maxWaitMs 内达到 networkIdle（内容已稳定） */
  stable: boolean;
  /** 是否达到 maxWaitMs 仍未稳定（A4：仅影响 warning 提示，不改变出图结果） */
  timedOut: boolean;
  elapsedMs: number;
}

export class RenderStabilityWatcher {
  async waitUntilStable(opts: StableWaitOptions): Promise<StableWaitResult> {
    const start = performance.now();
    let lastActivity = start;

    let resObs: PerformanceObserver | null = null;
    try {
      resObs = new PerformanceObserver(() => {
        lastActivity = performance.now();
      });
      resObs.observe({ type: 'resource', buffered: true });
    } catch {
      resObs = null;
    }

    let mo: MutationObserver | null = null;
    try {
      mo = new MutationObserver(() => {
        lastActivity = performance.now();
      });
      mo.observe(document.body, { childList: true, subtree: true, attributes: true });
    } catch {
      mo = null;
    }

    const maxWaitMs = Math.max(0, opts.maxWaitMs);
    const networkIdleMs = Math.max(0, opts.networkIdleMs);

    // 连续 networkIdleMs 无资源/DOM 变化即视为空闲；否则受 maxWaitMs 兜底
    let settled = false;
    while (performance.now() - start < maxWaitMs) {
      if (performance.now() - lastActivity >= networkIdleMs) {
        settled = true;
        break;
      }
      await sleep(100);
    }

    // 固定延时兜底
    await sleep(Math.max(0, opts.stableWaitMs));

    resObs?.disconnect();
    mo?.disconnect();

    return {
      stable: settled,
      timedOut: !settled,
      elapsedMs: Math.round(performance.now() - start),
    };
  }
}
