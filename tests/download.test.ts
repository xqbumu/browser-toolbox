/**
 * utils/download.ts 的 resolveDownloadPath 单测：
 * 子目录拼接、空目录回退根目录、非法/越界目录清洗。
 */
import { describe, it, expect } from 'vitest';
import { resolveDownloadPath } from '@/utils/download';

describe('resolveDownloadPath', () => {
  it('非空目录拼 `子目录/fileName`', () => {
    expect(resolveDownloadPath('网页截图', 'a.png')).toBe('网页截图/a.png');
  });

  it('空目录回退根目录（原样返回 fileName）', () => {
    expect(resolveDownloadPath('', 'a.png')).toBe('a.png');
  });

  it('目录为 `.` 或 `..` 时回退根目录', () => {
    expect(resolveDownloadPath('.', 'a.png')).toBe('a.png');
    expect(resolveDownloadPath('..', 'a.png')).toBe('a.png');
  });

  it('含路径分隔符/越界符号时被清洗，不产生越界', () => {
    const path = resolveDownloadPath('../foo', 'a.png');
    expect(path).not.toContain('..');
    expect(path).not.toContain('/foo');
  });

  it('目录首尾空白被去除', () => {
    expect(resolveDownloadPath('  shots  ', 'a.png')).toBe('shots/a.png');
  });
});
