/**
 * core/batch-tabs.ts 纯逻辑单测：summarize 汇总成功/失败计数。
 * （BatchTabsRunner.run 依赖 adapter 与 DOM 等待，不在 Node 下真机执行。）
 */
import { describe, it, expect } from 'vitest';
import { summarize } from '@/core/batch-tabs';
import type { CaptureResult } from '@/types/capture';

describe('summarize', () => {
  it('正确统计成功与失败数量', () => {
    const items: CaptureResult[] = [
      { ok: true, mode: 'visible' },
      { ok: false, mode: 'visible', error: 'x' },
      { ok: true, mode: 'fullpage' },
    ];
    const r = summarize(items);
    expect(r.total).toBe(3);
    expect(r.success).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.items).toBe(items);
  });

  it('空数组返回全 0', () => {
    const r = summarize([]);
    expect(r).toEqual({ total: 0, success: 0, failed: 0, items: [] });
  });

  it('全失败时 failed === total', () => {
    const items: CaptureResult[] = [
      { ok: false, mode: 'visible', error: 'a' },
      { ok: false, mode: 'visible', error: 'b' },
    ];
    expect(summarize(items).failed).toBe(2);
  });
});
