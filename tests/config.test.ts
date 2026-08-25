/**
 * types/config.ts 单测：DEFAULT_CONFIG 默认值完整性（字段齐全、类型一致、取值符合架构 §3.2 与增量 §2.2）。
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, type CaptureConfig } from '@/types/config';

describe('DEFAULT_CONFIG', () => {
  it('包含全部 12 个字段', () => {
    const keys = Object.keys(DEFAULT_CONFIG).sort();
    expect(keys).toEqual(
      [
        'mode',
        'format',
        'quality',
        'overlapRatio',
        'networkIdleMs',
        'stableWaitMs',
        'maxWaitMs',
        'handleFixed',
        'triggerLazyLoad',
        'maxHeight',
        'saveSubfolder',
        'historyLimit',
      ].sort(),
    );
  });

  it('取值与架构文档一致', () => {
    expect(DEFAULT_CONFIG).toEqual({
      mode: 'fullpage',
      format: 'png',
      quality: 0.92,
      overlapRatio: 0.15,
      networkIdleMs: 500,
      stableWaitMs: 800,
      maxWaitMs: 15000,
      handleFixed: true,
      triggerLazyLoad: true,
      maxHeight: null,
      saveSubfolder: '网页截图',
      historyLimit: 50,
    });
  });

  it('字段类型一致', () => {
    const cfg: CaptureConfig = DEFAULT_CONFIG;
    expect(typeof cfg.mode).toBe('string');
    expect(typeof cfg.format).toBe('string');
    expect(typeof cfg.quality).toBe('number');
    expect(typeof cfg.overlapRatio).toBe('number');
    expect(typeof cfg.networkIdleMs).toBe('number');
    expect(typeof cfg.stableWaitMs).toBe('number');
    expect(typeof cfg.maxWaitMs).toBe('number');
    expect(typeof cfg.handleFixed).toBe('boolean');
    expect(typeof cfg.triggerLazyLoad).toBe('boolean');
    expect(cfg.maxHeight).toBeNull();
    expect(typeof cfg.saveSubfolder).toBe('string');
    expect(typeof cfg.historyLimit).toBe('number');
  });

  it('overlapRatio 落在 0~0.3 合法区间', () => {
    expect(DEFAULT_CONFIG.overlapRatio).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_CONFIG.overlapRatio).toBeLessThanOrEqual(0.3);
  });

  it('historyLimit 落在 1~200 合法区间', () => {
    expect(DEFAULT_CONFIG.historyLimit).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_CONFIG.historyLimit).toBeLessThanOrEqual(200);
  });
});
