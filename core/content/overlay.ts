/**
 * 选区遮罩层（content script 端）：
 * 全屏半透明遮罩 + 十字光标，拖拽框选并实时显示尺寸，支持 Esc 取消、回车确认。
 * select() 返回 Promise<Rect>（相对视口 CSS px），cancel() 用于 background 主动取消。
 */
import type { Rect } from '@/types/capture';
import { showToast } from './toast';

const STYLE = `
  .__wxt-sel-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.4);
    cursor:crosshair;user-select:none;}
  .__wxt-sel-box{position:fixed;border:2px solid #4f9dff;background:rgba(79,157,255,0.15);
    box-sizing:border-box;pointer-events:none;display:none;}
  .__wxt-sel-label{position:fixed;background:#111;color:#fff;font:12px/1.4 sans-serif;
    padding:2px 8px;border-radius:4px;pointer-events:none;display:none;white-space:nowrap;}
  .__wxt-sel-hint{position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#111;
    color:#fff;font:12px/1.4 sans-serif;padding:4px 12px;border-radius:4px;pointer-events:none;}
`;

const MIN_SIZE = 4;

export class SelectionOverlay {
  private container: HTMLDivElement | null = null;
  private box: HTMLDivElement | null = null;
  private label: HTMLDivElement | null = null;
  private resolveFn: ((r: Rect) => void) | null = null;
  private rejectFn: ((e: Error) => void) | null = null;

  private startX = 0;
  private startY = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    this.dragging = true;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.updateBox(e.clientX, e.clientY);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.dragging) return;
    this.updateBox(e.clientX, e.clientY);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    const rect = this.normalizeRect(this.startX, this.startY, e.clientX, e.clientY);
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
      // 视为无效框选，忽略（保持遮罩，用户可继续拖拽）
      this.hideBox();
      return;
    }
    this.finish(rect);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.cancel();
    } else if (e.key === 'Enter') {
      if (this.box && this.box.style.display !== 'none') {
        const rect = this.normalizeRect(this.startX, this.startY, this.lastX, this.lastY);
        if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
          this.hideBox();
          return;
        }
        this.finish(rect);
      }
    }
  };

  /** 进入选区模式，返回 Promise<Rect>（相对视口 CSS px） */
  select(): Promise<Rect> {
    this.injectStyle();
    this.container = document.createElement('div');
    this.container.className = '__wxt-sel-overlay';
    this.container.innerHTML =
      '<div class="__wxt-sel-hint">拖拽框选区域 · Esc 取消 · 回车确认</div>' +
      '<div class="__wxt-sel-box"></div><div class="__wxt-sel-label"></div>';
    this.box = this.container.querySelector<HTMLDivElement>('.__wxt-sel-box');
    this.label = this.container.querySelector<HTMLDivElement>('.__wxt-sel-label');

    document.body.appendChild(this.container);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('keydown', this.onKeyDown);

    return new Promise<Rect>((resolve, reject) => {
      this.resolveFn = resolve;
      this.rejectFn = reject;
    });
  }

  /** 主动取消（background 发送 CANCEL_SELECTION / 用户按 Esc 时调用） */
  cancel(): void {
    this.cleanup();
    this.rejectFn?.(new Error('已取消选区'));
    this.resolveFn = null;
    this.rejectFn = null;
    // A3：本地即时回显，无需 background 往返
    showToast('info', '已取消选区');
  }

  private updateBox(x: number, y: number): void {
    if (!this.box || !this.label) return;
    const rect = this.normalizeRect(this.startX, this.startY, x, y);
    this.box.style.display = 'block';
    this.box.style.left = `${rect.x}px`;
    this.box.style.top = `${rect.y}px`;
    this.box.style.width = `${rect.width}px`;
    this.box.style.height = `${rect.height}px`;

    this.label.style.display = 'block';
    this.label.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    // 尺寸标签放在选区上方，避免被遮住
    const labelTop = Math.max(0, rect.y - 24);
    this.label.style.left = `${Math.max(0, rect.x)}px`;
    this.label.style.top = `${labelTop}px`;
  }

  private hideBox(): void {
    if (this.box) this.box.style.display = 'none';
    if (this.label) this.label.style.display = 'none';
  }

  private normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
    const x = Math.max(0, Math.min(window.innerWidth, Math.min(x1, x2)));
    const y = Math.max(0, Math.min(window.innerHeight, Math.min(y1, y2)));
    const right = Math.max(0, Math.min(window.innerWidth, Math.max(x1, x2)));
    const bottom = Math.max(0, Math.min(window.innerHeight, Math.max(y1, y2)));
    return { x, y, width: right - x, height: bottom - y };
  }

  private finish(rect: Rect): void {
    this.cleanup();
    this.resolveFn?.(rect);
    this.resolveFn = null;
    this.rejectFn = null;
  }

  private cleanup(): void {
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('keydown', this.onKeyDown);
    this.container?.remove();
    this.container = null;
    this.box = null;
    this.label = null;
    this.dragging = false;
  }

  private injectStyle(): void {
    if (document.getElementById('__wxt-sel-style')) return;
    const style = document.createElement('style');
    style.id = '__wxt-sel-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
}
