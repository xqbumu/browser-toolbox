/**
 * IndexedDB 历史仓库：截图记录的增 / 查（倒序）/ 删 / 清 / LRU 淘汰。
 * 统一收敛 IndexedDB 访问，业务代码不直接 `indexedDB.open`；
 * DB 名 / 版本 / Object Store / 索引由本文件唯一定义。
 * 记录以结构化克隆直接存 Blob（缩略图 + 原图），无需转 dataURL。
 */
import type { ScreenshotRecord, ScreenshotListItem } from '@/types/history';

const DB_NAME = 'web-screenshot-assistant';
const DB_VERSION = 1;
const STORE = 'screenshots';

/** 单例连接 Promise，复用同一连接 */
let dbPromise: Promise<IDBDatabase> | null = null;

/** 打开（或创建）数据库：onupgradeneeded 建 store + createdAt 索引 */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
  });
  return dbPromise;
}

/** 将 IDBRequest 包装为 Promise */
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
  });
}

/** 等待事务完成（需在发起请求前注册，避免事务已完成才挂监听导致的竞态） */
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务中止'));
  });
}

/** 新增记录（写入即按 limit 触发 LRU 淘汰，避免超限累积） */
export async function addRecord(record: ScreenshotRecord, limit: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore(STORE).put(record);
  await done;
  await prune(limit);
}

/** 查询历史列表（createdAt 倒序，丢弃原图 imageBlob，仅返回元数据 + 缩略图） */
export async function listRecords(limit = 200): Promise<ScreenshotListItem[]> {
  const db = await openDb();
  const items: ScreenshotListItem[] = [];
  const tx = db.transaction(STORE, 'readonly');
  const index = tx.objectStore(STORE).index('createdAt');
  const req = index.openCursor(null, 'prev');
  await new Promise<void>((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor && items.length < limit) {
        const r = cursor.value as ScreenshotRecord;
        items.push({
          id: r.id,
          fileName: r.fileName,
          url: r.url,
          title: r.title,
          mode: r.mode,
          format: r.format,
          createdAt: r.createdAt,
          sizeBytes: r.sizeBytes,
          thumbBlob: r.thumbBlob,
        });
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error ?? new Error('查询历史列表失败'));
  });
  return items;
}

/** 按 id 读取完整记录（含原图 Blob），不存在返回 null */
export async function getRecord(id: string): Promise<ScreenshotRecord | null> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const result = await requestToPromise(tx.objectStore(STORE).get(id));
  return (result as ScreenshotRecord | undefined) ?? null;
}

/** 删除单条记录 */
export async function deleteRecord(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore(STORE).delete(id);
  await done;
}

/** 清空全部记录，返回清除条数 */
export async function clearRecords(): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const done = transactionDone(tx);
  const store = tx.objectStore(STORE);
  const count = await requestToPromise(store.count());
  store.clear();
  await done;
  return count;
}

/**
 * LRU 淘汰：删除最旧超限条目，返回删除数。
 * 用 createdAt 索引升序游标，删除 count - limit 条最旧记录（整条删除，Blob 一并释放）。
 */
export async function prune(limit: number): Promise<number> {
  // 防御：非法 limit 不淘汰（由调用方 clamp 到 1~200）
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const done = transactionDone(tx);
  const store = tx.objectStore(STORE);
  const count = await requestToPromise(store.count());
  if (count <= limit) {
    await done;
    return 0;
  }
  const toDelete = count - limit;
  const index = store.index('createdAt');
  let deleted = 0;
  const req = index.openKeyCursor();
  await new Promise<void>((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor && deleted < toDelete) {
        store.delete(cursor.primaryKey);
        deleted += 1;
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error ?? new Error('LRU 淘汰失败'));
  });
  await done;
  return deleted;
}
