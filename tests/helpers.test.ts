/**
 * utils/helpers.ts 单测：toErrorMessage 归一化、sleep 延时。
 * （nextFrame/blobToDataUrl/fetchTabInfo 依赖浏览器/rAF/btoa，不在 Node 下真机断言，
 *   仅覆盖其纯逻辑可测的 toErrorMessage 与 sleep。）
 */
import { describe, it, expect } from 'vitest';
import {
  toErrorMessage,
  sleep,
  dataUrlToBlob,
  estimateRemainingMs,
  formatDuration,
} from '@/utils/helpers';

describe('toErrorMessage', () => {
  it('Error 取 message', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('字符串原样返回', () => {
    expect(toErrorMessage('plain string')).toBe('plain string');
  });

  it('普通对象 JSON 序列化', () => {
    expect(toErrorMessage({ code: 42 })).toBe('{"code":42}');
    expect(toErrorMessage({ a: 1, b: { c: 2 } })).toBe('{"a":1,"b":{"c":2}}');
  });

  it('数字/布尔等标量转字符串', () => {
    expect(toErrorMessage(404)).toBe('404');
    expect(toErrorMessage(true)).toBe('true');
    expect(toErrorMessage(null)).toBe('null');
  });

  it('循环引用对象回退 String(e)', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(toErrorMessage(obj)).toBe('[object Object]');
  });

  // 回归：修复 #2 后，undefined/Symbol/function 不再返回 undefined，而是归一化为 string
  it('undefined/Symbol/function 归一化为字符串（回归）', () => {
    expect(toErrorMessage(undefined)).toBe('undefined');
    expect(toErrorMessage(Symbol('s'))).toBe('Symbol(s)');
    expect(typeof toErrorMessage(() => {})).toBe('string');
  });
});

describe('sleep', () => {
  it('在指定毫秒后 resolve', async () => {
    const start = Date.now();
    await sleep(5);
    expect(Date.now() - start).toBeGreaterThanOrEqual(4);
  });
});

describe('dataUrlToBlob', () => {
  it('将 base64 dataURL 解码为 Blob，类型正确', async () => {
    const blob = await dataUrlToBlob('data:image/png;base64,aGVsbG8='); // "hello"
    expect(blob.type).toBe('image/png');
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(Buffer.from(buf).toString('utf-8')).toBe('hello');
  });

  it('缺省 mime 回退 image/png', async () => {
    const blob = await dataUrlToBlob('aGVsbG8='); // 无 data: 前缀
    expect(blob.type).toBe('image/png');
  });
});

describe('estimateRemainingMs', () => {
  it('平均单页耗时 × 剩余页数', () => {
    // 已耗时 4000ms 完成 2 项 → 平均 2000ms/项；剩余 3 项 → 6000ms
    expect(estimateRemainingMs(4000, 2, 5)).toBe(6000);
  });

  it('已完成 0 项时无法估算，返回 null', () => {
    expect(estimateRemainingMs(1000, 0, 5)).toBeNull();
  });

  it('已完成覆盖全部时返回 null', () => {
    expect(estimateRemainingMs(4000, 5, 5)).toBeNull();
  });

  it('非法入参返回 null', () => {
    expect(estimateRemainingMs(0, 2, 5)).toBeNull();
    expect(estimateRemainingMs(Number.NaN, 2, 5)).toBeNull();
    expect(estimateRemainingMs(4000, 2, 0)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('四舍五入到整数秒', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(400)).toBe('0s');
    expect(formatDuration(500)).toBe('1s');
    expect(formatDuration(4500)).toBe('5s');
  });
});
