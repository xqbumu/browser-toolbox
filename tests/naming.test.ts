/**
 * utils/naming.ts 单测：`域名_标题_时间戳.png` 生成、
 * 非法字符清洗、标题截断、域名去 www. 与端口、格式扩展名映射。
 */
import { describe, it, expect } from 'vitest';
import { buildFileName, sanitizeSubfolder } from '@/utils/naming';

const fixedNow = new Date(2024, 0, 2, 3, 4, 5); // 2024-01-02 03:04:05

describe('buildFileName', () => {
  it('生成 `域名_标题_时间戳.png`', () => {
    const name = buildFileName('https://www.example.com/page', 'Hello World', 'png', fixedNow);
    expect(name).toBe('example.com_Hello World_20240102_030405.png');
  });

  it('域名去除 www. 前缀', () => {
    const name = buildFileName('https://www.example.com', 't', 'png', fixedNow);
    expect(name.startsWith('example.com_')).toBe(true);
    expect(name).not.toContain('www.');
  });

  it('域名去除端口', () => {
    const name = buildFileName('https://example.com:8080/x', 't', 'png', fixedNow);
    expect(name.startsWith('example.com_')).toBe(true);
    expect(name).not.toContain(':8080');
  });

  it('非法字符 \\/:*?"<>| 全部替换为下划线', () => {
    // 9 个非法字符 → 9 个下划线
    const name = buildFileName('https://example.com', 'a\\/:*?"<>|b', 'png', fixedNow);
    expect(name).toBe('example.com_a_________b_20240102_030405.png');
  });

  it('标题截断到 50 字符', () => {
    const longTitle = 'x'.repeat(60);
    const name = buildFileName('https://example.com', longTitle, 'png', fixedNow);
    expect(name).toBe(`example.com_${'x'.repeat(50)}_20240102_030405.png`);
  });

  it('标题为空或 undefined 时回退为 page', () => {
    expect(buildFileName('https://example.com', undefined, 'png', fixedNow)).toBe(
      'example.com_page_20240102_030405.png',
    );
    expect(buildFileName('https://example.com', '', 'png', fixedNow)).toBe(
      'example.com_page_20240102_030405.png',
    );
  });

  it('标题空白压缩为单个空格', () => {
    const name = buildFileName('https://example.com', 'hello   world', 'png', fixedNow);
    expect(name).toContain('hello world');
  });

  it('jpeg 格式映射为 jpg 扩展名', () => {
    const name = buildFileName('https://example.com', 't', 'jpeg', fixedNow);
    expect(name.endsWith('.jpg')).toBe(true);
  });

  it('无效 URL 回退域名为 page', () => {
    const name = buildFileName('not a valid url', 't', 'png', fixedNow);
    expect(name.startsWith('page_')).toBe(true);
  });

  it('localhost 域名正确生成', () => {
    const name = buildFileName('http://localhost:3000/x', 't', 'png', fixedNow);
    expect(name.startsWith('localhost_')).toBe(true);
  });
});

describe('sanitizeSubfolder', () => {
  it('合法目录名原样返回', () => {
    expect(sanitizeSubfolder('网页截图')).toBe('网页截图');
    expect(sanitizeSubfolder('screenshots')).toBe('screenshots');
  });

  it('空串 / 空白返回空串（存根目录）', () => {
    expect(sanitizeSubfolder('')).toBe('');
    expect(sanitizeSubfolder('   ')).toBe('');
  });

  it('拦截 `.` / `..` 返回空串', () => {
    expect(sanitizeSubfolder('.')).toBe('');
    expect(sanitizeSubfolder('..')).toBe('');
  });

  it('非法字符 \\/:*?"<>| 替换为下划线', () => {
    expect(sanitizeSubfolder('a/b\\c')).toBe('a_b_c');
    expect(sanitizeSubfolder('a:b*c?d"e<f>g|h')).toBe('a_b_c_d_e_f_g_h');
  });

  it('路径越界符号被清洗，不产生 .. 或 /', () => {
    const s = sanitizeSubfolder('../foo');
    expect(s).not.toContain('..');
    expect(s).not.toContain('/');
  });

  it('绝对路径前缀 /foo 被清洗为 _foo', () => {
    expect(sanitizeSubfolder('/foo')).toBe('_foo');
  });

  it('Windows 盘符路径 C:\\foo 被清洗为 C__foo', () => {
    expect(sanitizeSubfolder('C:\\foo')).toBe('C__foo');
  });

  it('../foo 精确清洗为 _foo（去首尾点后）', () => {
    expect(sanitizeSubfolder('../foo')).toBe('_foo');
  });

  it('首尾空白被去除，内部空白压缩为单空格', () => {
    expect(sanitizeSubfolder('  shots  ')).toBe('shots');
    expect(sanitizeSubfolder('my  shots')).toBe('my shots');
  });

  it('超长目录名截断到 100 字符', () => {
    const s = sanitizeSubfolder('x'.repeat(120));
    expect(s.length).toBe(100);
  });
});
