/**
 * 取消语义建模（P0 A5）：
 * 统一用「抛错 + 捕获」表达用户主动取消，禁止在业务代码中散落 '取消' 字符串判断。
 * 引擎/runner 在检查点抛出 CaptureCancelledError，CaptureService 捕获后转
 * CaptureResult { ok:false, cancelled:true }，保证返回类型不破坏既有 ok/error 契约。
 */

/** 用户主动取消的标记错误（core 内部抛/捕获用，不污染通用 error 文案） */
export class CaptureCancelledError extends Error {
  constructor(message = '已取消截图') {
    super(message);
    this.name = 'CaptureCancelledError';
  }
}

/** 判断异常是否为主动取消错误（按 name 判定，跨模块边界稳定可靠） */
export function isCaptureCancelled(err: unknown): boolean {
  return err instanceof Error && err.name === 'CaptureCancelledError';
}
