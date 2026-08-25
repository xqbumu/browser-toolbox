/**
 * fixed/sticky 元素处理（content script 端）：
 * scan：遍历所有元素，记录 position:fixed/sticky 且可见的元素的初始 rect（scrollY=0）；
 * hide：用 visibility:hidden 隐藏（保留占位避免布局抖动）；
 * restore：恢复 visibility 并清理 dataset 标记。
 */
import type { FixedElementInfo } from '@/types/capture';

const MARK_INDEX = '__wxtFixedIdx';
const MARK_PREV_VIS = '__wxtPrevVisibility';

export class FixedElementHandler {
  private elements: HTMLElement[] = [];

  /** 扫描并记录 fixed/sticky 元素（应在 scrollY=0 时调用，保证 rect 为初始位置） */
  scan(): FixedElementInfo[] {
    this.elements = [];
    const list: FixedElementInfo[] = [];

    const all = document.querySelectorAll<HTMLElement>('body *');
    for (const el of Array.from(all)) {
      let position: string;
      try {
        position = getComputedStyle(el).position;
      } catch {
        continue;
      }
      if (position !== 'fixed' && position !== 'sticky') continue;

      const rect = el.getBoundingClientRect();
      // 过滤零尺寸或完全在视口之外的（如顶部之外）元素
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.bottom <= 0 || rect.right <= 0) continue;
      if (rect.top >= window.innerHeight || rect.left >= window.innerWidth) continue;

      const index = list.length;
      el.dataset[MARK_INDEX] = String(index);
      this.elements.push(el);
      list.push({
        index,
        tagName: el.tagName.toLowerCase(),
        position: position as 'fixed' | 'sticky',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        id: el.id || undefined,
        className: typeof el.className === 'string' ? el.className : undefined,
      });
    }
    return list;
  }

  /** 隐藏所有已标记元素（保留占位） */
  hide(): void {
    for (const el of this.elements) {
      el.dataset[MARK_PREV_VIS] = el.style.visibility;
      el.style.visibility = 'hidden';
    }
  }

  /** 恢复所有已标记元素，返回恢复数量 */
  restore(): number {
    let count = 0;
    for (const el of this.elements) {
      const prev = el.dataset[MARK_PREV_VIS];
      el.style.visibility = prev ?? '';
      delete el.dataset[MARK_PREV_VIS];
      delete el.dataset[MARK_INDEX];
      count += 1;
    }
    this.elements = [];
    return count;
  }
}
