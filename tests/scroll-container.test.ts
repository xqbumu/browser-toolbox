/**
 * core/content/scroll.ts 纯逻辑单测：
 * detectScrollContainer 的判定核心抽成纯函数后，脱离 DOM 验证
 * isScrollableElement（overflow 可滚判定）与 pickBestScrollContainer（scrollHeight 最大者胜出）。
 */
import { describe, it, expect } from 'vitest';
import { isScrollableElement, pickBestScrollContainer, type ScrollCandidate } from '@/core/content/scroll';

describe('isScrollableElement（纯判定）', () => {
  it('scrollHeight 未超过可视高 +1 时不可滚', () => {
    expect(
      isScrollableElement({ scrollHeight: 100, clientHeight: 100, overflowY: 'auto', overflow: 'auto' }),
    ).toBe(false);
    expect(
      isScrollableElement({ scrollHeight: 101, clientHeight: 100, overflowY: 'auto', overflow: 'auto' }),
    ).toBe(false);
  });

  it('scrollHeight 超出可视高但 overflow 不可滚时不可滚', () => {
    expect(
      isScrollableElement({ scrollHeight: 200, clientHeight: 100, overflowY: 'visible', overflow: 'visible' }),
    ).toBe(false);
    expect(
      isScrollableElement({ scrollHeight: 200, clientHeight: 100, overflowY: 'hidden', overflow: 'hidden' }),
    ).toBe(false);
  });

  it('overflow-y 为 auto/scroll/overlay 时可滚', () => {
    for (const oy of ['auto', 'scroll', 'overlay']) {
      expect(isScrollableElement({ scrollHeight: 200, clientHeight: 100, overflowY: oy, overflow: '' })).toBe(
        true,
      );
    }
  });

  it('overflow-y 未显式设置时回退 overflow 判定', () => {
    expect(
      isScrollableElement({ scrollHeight: 200, clientHeight: 100, overflowY: '', overflow: 'auto' }),
    ).toBe(true);
    expect(
      isScrollableElement({ scrollHeight: 200, clientHeight: 100, overflowY: '', overflow: 'scroll' }),
    ).toBe(true);
  });

  it('overflow-y 未显式设置时回退 overflow：overlay 可滚、visible 不可滚', () => {
    expect(
      isScrollableElement({ scrollHeight: 200, clientHeight: 100, overflowY: '', overflow: 'overlay' }),
    ).toBe(true);
    expect(
      isScrollableElement({ scrollHeight: 200, clientHeight: 100, overflowY: '', overflow: 'visible' }),
    ).toBe(false);
  });

  it('1px 容差边界：超出可视高 2px 才判定可滚', () => {
    expect(
      isScrollableElement({ scrollHeight: 102, clientHeight: 100, overflowY: 'auto', overflow: '' }),
    ).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(
      isScrollableElement({ scrollHeight: 200, clientHeight: 100, overflowY: 'AUTO', overflow: '' }),
    ).toBe(true);
  });
});

describe('pickBestScrollContainer（选主容器）', () => {
  const cand = (scrollHeight: number, overflowY = 'auto'): ScrollCandidate => ({
    scrollHeight,
    clientHeight: 100,
    overflowY,
    overflow: overflowY,
  });

  it('无可滚动候选时返回 -1', () => {
    expect(pickBestScrollContainer([])).toBe(-1);
    expect(pickBestScrollContainer([cand(100), cand(100, 'hidden')])).toBe(-1);
  });

  it('唯一可滚动候选时返回其下标', () => {
    const list = [cand(100, 'hidden'), cand(300, 'auto'), cand(200, 'hidden')];
    expect(pickBestScrollContainer(list)).toBe(1);
  });

  it('多个可滚动候选时取 scrollHeight 最大者', () => {
    const list = [cand(500), cand(800), cand(300)];
    expect(pickBestScrollContainer(list)).toBe(1);
  });

  it('并列最大时取先出现的候选（下标最小）', () => {
    const list = [cand(800), cand(800), cand(300)];
    expect(pickBestScrollContainer(list)).toBe(0);
  });
});
