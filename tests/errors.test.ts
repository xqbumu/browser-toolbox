/**
 * utils/errors.ts 单测：friendlyError 错误特征 → 友好文案映射 + 兜底保留原文。
 */
import { describe, it, expect } from 'vitest';
import { friendlyError } from '@/utils/errors';

describe('friendlyError', () => {
  it('Access denied → 下载失败提示', () => {
    expect(friendlyError('Download failed: Access denied')).toBe(
      '浏览器拒绝了下载请求（文件可能过大）',
    );
  });

  it('Cannot access / 注入失败 → 权限不足', () => {
    expect(friendlyError('Cannot access contents of the page')).toBe(
      '权限不足：无法访问或注入该页面',
    );
    expect(friendlyError('内容脚本注入失败')).toBe('权限不足：无法访问或注入该页面');
  });

  it('timed out / 超时 → 超时提示', () => {
    expect(friendlyError('Request timed out after 15000ms')).toBe(
      '操作超时，页面可能未加载完整',
    );
    expect(friendlyError('页面等待超时')).toBe('操作超时，页面可能未加载完整');
  });

  it('取消语义 → 已取消截图', () => {
    expect(friendlyError('已取消选区')).toBe('已取消截图');
    expect(friendlyError('Operation cancelled by user')).toBe('已取消截图');
  });

  it('受保护页面 → 无法截图', () => {
    expect(friendlyError('Cannot capture chrome://settings page')).toBe(
      '受浏览器保护的页面无法截图',
    );
  });

  it('未命中任何规则时保留原文', () => {
    expect(friendlyError('Some unknown error')).toBe('Some unknown error');
  });

  it('空串 / null / undefined → 默认失败文案', () => {
    expect(friendlyError('')).toBe('截图失败');
    expect(friendlyError('   ')).toBe('截图失败');
    expect(friendlyError(null)).toBe('截图失败');
    expect(friendlyError(undefined)).toBe('截图失败');
  });
});
