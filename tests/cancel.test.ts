/**
 * core/cancel.ts 纯逻辑单测（P0 A5）：
 * CaptureCancelledError 标记错误的构造（name 固定、message 默认/自定义），
 * isCaptureCancelled 按 name 判定的边界（跨模块边界稳定、非 Error 一律 false）。
 */
import { describe, it, expect } from 'vitest';
import { CaptureCancelledError, isCaptureCancelled } from '@/core/cancel';

describe('CaptureCancelledError', () => {
  it('是 Error 子类，name 固定为 CaptureCancelledError', () => {
    const err = new CaptureCancelledError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CaptureCancelledError');
  });

  it('默认 message 为「已取消截图」', () => {
    expect(new CaptureCancelledError().message).toBe('已取消截图');
  });

  it('支持自定义 message', () => {
    expect(new CaptureCancelledError('已取消').message).toBe('已取消');
  });
});

describe('isCaptureCancelled', () => {
  it('识别 CaptureCancelledError 实例', () => {
    expect(isCaptureCancelled(new CaptureCancelledError())).toBe(true);
  });

  it('按 name 判定（跨模块边界稳定），普通 Error 改名后同样识别', () => {
    const plain = new Error('x');
    plain.name = 'CaptureCancelledError';
    expect(isCaptureCancelled(plain)).toBe(true);
  });

  it('普通 Error / 其他 Error 子类为 false', () => {
    expect(isCaptureCancelled(new Error('截图失败'))).toBe(false);
    expect(isCaptureCancelled(new TypeError('boom'))).toBe(false);
  });

  it('非 Error 值一律 false（字符串/对象/null/undefined）', () => {
    expect(isCaptureCancelled('已取消截图')).toBe(false);
    expect(isCaptureCancelled({ name: 'CaptureCancelledError' })).toBe(false);
    expect(isCaptureCancelled(null)).toBe(false);
    expect(isCaptureCancelled(undefined)).toBe(false);
  });
});
