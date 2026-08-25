/**
 * 懒加载图片触发（content script 端）：
 * 1. 快速滚到底再回顶，触发 IntersectionObserver / loading=lazy；
 * 2. 将 data-src / data-original 等占位属性写入 src，loading=lazy 改为 eager 强制加载；
 * 3. 对未 complete 的图片调用 img.decode() 触发解码并等待。
 * CSS background-image 懒加载无法枚举，依赖「快速滚一遍」触发其 IntersectionObserver。
 */
import { nextFrame } from '@/utils/helpers';
import { detectScrollContainer, isWindowScroller } from './scroll';

export async function triggerLazyLoad(): Promise<void> {
  const container = detectScrollContainer();
  const windowLevel = isWindowScroller(container);
  const prevY = windowLevel ? window.scrollY : container.scrollTop;
  const maxY = Math.max(0, container.scrollHeight - container.clientHeight);

  // 快速滚到底，触发懒加载 observer
  if (windowLevel) {
    window.scrollTo(0, maxY);
  } else {
    container.scrollTop = maxY;
  }
  await nextFrame();
  await nextFrame();
  if (windowLevel) {
    window.scrollTo(0, prevY);
  } else {
    container.scrollTop = prevY;
  }
  await nextFrame();
  await nextFrame();

  // 强制加载懒加载图片
  for (const img of Array.from(document.images)) {
    const src =
      img.dataset.src ||
      img.dataset.original ||
      img.dataset.lazySrc ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-original');
    if (src && !img.getAttribute('src')) {
      img.setAttribute('src', src);
    }
    if (img.loading === 'lazy') {
      img.loading = 'eager';
    }
  }

  // 等待所有未完成的图片解码
  await Promise.all(
    Array.from(document.images).map(async (img) => {
      if (img.complete) return;
      try {
        if (typeof img.decode === 'function') {
          await img.decode();
        }
      } catch {
        // 解码失败忽略（图片可能损坏/404，截图仍尽力而为）
      }
    }),
  );
}
