/**
 * utils/history-store.ts 单测：增 / 查（倒序）/ 删 / 清空 / LRU 淘汰。
 * 使用 fake-indexeddb 在 Node 环境模拟 IndexedDB（Blob 经结构化克隆存储）。
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addRecord,
  listRecords,
  getRecord,
  deleteRecord,
  clearRecords,
  prune,
} from '@/utils/history-store';
import type { ScreenshotRecord } from '@/types/history';

function makeRecord(id: string, createdAt: number): ScreenshotRecord {
  return {
    id,
    fileName: `file_${id}.png`,
    url: 'https://example.com/page',
    title: '示例页面',
    mode: 'fullpage',
    format: 'png',
    createdAt,
    sizeBytes: 100,
    thumbBlob: new Blob([`thumb-${id}`], { type: 'image/jpeg' }),
    imageBlob: new Blob([`image-${id}`], { type: 'image/png' }),
  };
}

beforeEach(async () => {
  await clearRecords();
});

describe('history-store', () => {
  it('addRecord 后 listRecords 按 createdAt 倒序返回且不含原图 imageBlob', async () => {
    await addRecord(makeRecord('a', 1000), 50);
    await addRecord(makeRecord('b', 2000), 50);
    await addRecord(makeRecord('c', 1500), 50);

    const list = await listRecords();
    expect(list.map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(list[0]).not.toHaveProperty('imageBlob');
    expect(list[0].thumbBlob).toBeInstanceOf(Blob);
    expect(list[0].mode).toBe('fullpage');
  });

  it('getRecord 返回完整记录（含原图 imageBlob）', async () => {
    await addRecord(makeRecord('x', 500), 50);
    const rec = await getRecord('x');
    expect(rec).not.toBeNull();
    expect(rec!.imageBlob).toBeInstanceOf(Blob);
    expect(rec!.fileName).toBe('file_x.png');
  });

  it('getRecord 不存在返回 null', async () => {
    expect(await getRecord('nope')).toBeNull();
  });

  it('deleteRecord 删除单条', async () => {
    await addRecord(makeRecord('a', 1), 50);
    await addRecord(makeRecord('b', 2), 50);
    await deleteRecord('a');
    expect((await listRecords()).map((i) => i.id)).toEqual(['b']);
  });

  it('clearRecords 清空并返回条数', async () => {
    await addRecord(makeRecord('a', 1), 50);
    await addRecord(makeRecord('b', 2), 50);
    const n = await clearRecords();
    expect(n).toBe(2);
    expect(await listRecords()).toEqual([]);
  });

  it('addRecord 超限触发 LRU 淘汰最旧', async () => {
    for (let i = 1; i <= 5; i++) await addRecord(makeRecord(`r${i}`, i), 3);
    const list = await listRecords();
    expect(list.map((i) => i.id)).toEqual(['r5', 'r4', 'r3']);
  });

  it('prune 删除最旧超限条目并返回删除数', async () => {
    for (let i = 1; i <= 5; i++) await addRecord(makeRecord(`r${i}`, i), 50);
    const deleted = await prune(2);
    expect(deleted).toBe(3);
    expect((await listRecords()).map((i) => i.id)).toEqual(['r5', 'r4']);
  });
});
