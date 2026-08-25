/**
 * 配置项类型与默认值。配置持久化到 browser.storage.sync（跨设备）。
 */
import type { CaptureMode, OutputFormat } from './capture';

export interface CaptureConfig {
  /** 默认截图模式 */
  mode: CaptureMode;
  /** 输出格式 */
  format: OutputFormat;
  /** jpeg 质量 0~1，png 忽略 */
  quality: number;
  /** 相邻分片重叠区比例 0~0.3，默认 0.15 */
  overlapRatio: number;
  /** 网络空闲判定窗口（ms），默认 500 */
  networkIdleMs: number;
  /** 空闲后追加固定延时兜底（ms），默认 800 */
  stableWaitMs: number;
  /** 单页等待总上限（ms），默认 15000 */
  maxWaitMs: number;
  /** 是否处理 fixed/sticky 元素，默认 true */
  handleFixed: boolean;
  /** 是否触发懒加载，默认 true */
  triggerLazyLoad: boolean;
  /** 高度上限（物理像素），null=不设硬上限 */
  maxHeight: number | null;
  /** 默认保存子文件夹名（下载目录下）；空字符串 = 直接存下载根目录 */
  saveSubfolder: string;
  /** 历史保留条数（LRU 淘汰，1~200），默认 50 */
  historyLimit: number;
}

export const DEFAULT_CONFIG: CaptureConfig = {
  mode: 'fullpage',
  format: 'png',
  quality: 0.92,
  overlapRatio: 0.15,
  networkIdleMs: 500,
  stableWaitMs: 800,
  maxWaitMs: 15000,
  handleFixed: true,
  triggerLazyLoad: true,
  maxHeight: null,
  saveSubfolder: '网页截图',
  historyLimit: 50,
};
