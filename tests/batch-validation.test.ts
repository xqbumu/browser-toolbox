/**
 * utils/batch-validation.ts 单测：validateBatchUrls 解析/校验/非法计数/超限判断。
 */
import { describe, it, expect } from 'vitest';
import { validateBatchUrls, isHttpUrl, MAX_BATCH_URLS } from '@/utils/batch-validation';

describe('isHttpUrl', () => {
  it('识别 http/https', () => {
    expect(isHttpUrl('http://a.com')).toBe(true);
    expect(isHttpUrl('https://a.com')).toBe(true);
  });

  it('拒绝非 http(s) 协议', () => {
    expect(isHttpUrl('chrome://settings')).toBe(false);
    expect(isHttpUrl('ftp://a.com')).toBe(false);
    expect(isHttpUrl('a.com/path')).toBe(false);
  });
});

describe('validateBatchUrls', () => {
  it('按换行切分、去空行、去首尾空白', () => {
    const r = validateBatchUrls('  https://a.com  \n\n  https://b.com  ');
    expect(r.lines).toEqual(['https://a.com', 'https://b.com']);
    expect(r.validUrls).toEqual(['https://a.com', 'https://b.com']);
    expect(r.invalidCount).toBe(0);
    expect(r.overLimit).toBe(false);
  });

  it('统计非法（非 http(s)）URL 数量', () => {
    const r = validateBatchUrls('https://a.com\nchrome://settings\nftp://x\nabout:blank');
    expect(r.validUrls).toEqual(['https://a.com']);
    expect(r.invalidCount).toBe(3);
  });

  it('空输入返回空结果', () => {
    const r = validateBatchUrls('  \n \n ');
    expect(r.lines).toEqual([]);
    expect(r.validUrls).toEqual([]);
    expect(r.invalidCount).toBe(0);
    expect(r.overLimit).toBe(false);
  });

  it('超过上限标记 overLimit（上限为 MAX_BATCH_URLS）', () => {
    const many = Array.from({ length: MAX_BATCH_URLS + 1 }, (_, i) => `https://site${i}.com`);
    const r = validateBatchUrls(many.join('\n'));
    expect(r.validUrls.length).toBe(MAX_BATCH_URLS + 1);
    expect(r.overLimit).toBe(true);
  });

  it('恰好等于上限不标记 overLimit', () => {
    const many = Array.from({ length: MAX_BATCH_URLS }, (_, i) => `https://site${i}.com`);
    const r = validateBatchUrls(many.join('\n'));
    expect(r.overLimit).toBe(false);
  });
});
