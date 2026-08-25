/**
 * 历史记录类型：截图成功后写入 IndexedDB 的记录结构。
 * 存储语义：fileName 存「基础文件名」（不含子目录前缀），下载/重下载时再拼当前 saveSubfolder。
 */
import type { CaptureMode, OutputFormat } from './capture';

/** 历史记录元数据（列表与详情共有，不含任何 Blob） */
export interface ScreenshotRecordMeta {
  /** uuid（crypto.randomUUID / genId 兜底） */
  id: string;
  /** 基础文件名（不含子目录前缀） */
  fileName: string;
  /** 来源 URL */
  url: string;
  /** 页面标题 */
  title: string;
  /** 截图模式 */
  mode: CaptureMode;
  /** 输出格式 */
  format: OutputFormat;
  /** 创建时间戳（ms），LRU 淘汰与倒序排序依据 */
  createdAt: number;
  /** 原图大小（字节） */
  sizeBytes: number;
}

/** 历史详情（含缩略图与原图 Blob），HISTORY_GET 返回 */
export interface ScreenshotRecord extends ScreenshotRecordMeta {
  /** 缩略图（降采样，最大边 320px，JPEG q0.7） */
  thumbBlob: Blob;
  /** 原图 Blob */
  imageBlob: Blob;
}

/** 历史列表项 = 元数据 + 缩略图（不含大原图 Blob），HISTORY_LIST 返回 */
export interface ScreenshotListItem extends ScreenshotRecordMeta {
  thumbBlob: Blob;
}
