/**
 * utils/download.ts 下载通道回归测试：
 * 锁定「大图 dataURL Access denied」修复——
 * 1. downloadBlob 走 objectURL 通道（而非超大 dataURL）；
 * 2. downloadDataUrl 先 dataUrl→Blob 再委托 objectURL 通道；
 * 3. objectURL 延迟 60s revoke，避免下载异步期提前释放。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadBlob, downloadDataUrl } from '@/utils/download';

const downloadMock = vi.fn();
const createObjectURLMock = vi.fn();
const revokeObjectURLMock = vi.fn();

beforeEach(() => {
  downloadMock.mockReset().mockResolvedValue(42);
  createObjectURLMock.mockReset().mockReturnValue('blob:mock/0001');
  revokeObjectURLMock.mockReset();
  // 代码仅依赖 URL.createObjectURL / URL.revokeObjectURL，用最小假实现替代全局 URL
  vi.stubGlobal('URL', {
    createObjectURL: createObjectURLMock,
    revokeObjectURL: revokeObjectURLMock,
  });
  vi.stubGlobal('browser', {
    downloads: { download: downloadMock },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('downloadBlob（objectURL 通道）', () => {
  it('优先走 objectURL 而非 dataURL，规避超大 dataURL Access denied', async () => {
    const id = await downloadBlob(new Blob(['hello'], { type: 'image/png' }), 'a.png');

    expect(id).toBe(42);
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(downloadMock).toHaveBeenCalledTimes(1);
    const arg = downloadMock.mock.calls[0][0] as { url: string; filename: string; saveAs: boolean };
    expect(arg.url).toBe('blob:mock/0001');
    expect(arg.url.startsWith('data:')).toBe(false);
    expect(arg.filename).toBe('a.png');
    expect(arg.saveAs).toBe(false);
  });

  it('objectURL 延迟 60s revoke，下载异步期不提前释放', async () => {
    vi.useFakeTimers();
    await downloadBlob(new Blob(['hello'], { type: 'image/png' }), 'a.png');

    // 下载发起后立即返回，此时不应 revoke
    expect(revokeObjectURLMock).not.toHaveBeenCalled();

    // 60s 后才释放 objectURL
    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock/0001');
  });

  it('createObjectURL 缺省时回退 dataURL 通道（小图兜底）', async () => {
    // 模拟无 createObjectURL 的极端环境
    vi.stubGlobal('URL', { revokeObjectURL: revokeObjectURLMock });
    await downloadBlob(new Blob(['hello'], { type: 'image/png' }), 'a.png');

    expect(downloadMock).toHaveBeenCalledTimes(1);
    const arg = downloadMock.mock.calls[0][0] as { url: string };
    expect(arg.url.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('downloadDataUrl（dataUrl→Blob→objectURL）', () => {
  it('把 dataURL 转 Blob 后委托 objectURL 通道', async () => {
    const id = await downloadDataUrl('data:image/png;base64,aGVsbG8=', 'b.png'); // "hello"

    expect(id).toBe(42);
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    const blob = createObjectURLMock.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('image/png');
    expect(downloadMock).toHaveBeenCalledTimes(1);
    const arg = downloadMock.mock.calls[0][0] as { url: string; filename: string };
    expect(arg.url).toBe('blob:mock/0001');
    expect(arg.url.startsWith('data:')).toBe(false);
    expect(arg.filename).toBe('b.png');
  });
});
