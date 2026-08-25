/**
 * 页面内 overlay toast（A3 选区回显）：
 * 顶部居中、2.5s 自动消失、可堆叠的轻量 DOM 提示。
 * 采用页面内 DOM 而非 browser.notifications（需授权、SW 跨平台行为差异大），
 * 选区页面本身就在前台，回显自然且无权限/无跨平台差异。
 */
import type { ToastKind } from '@/types/messages';

const CONTAINER_ID = '__wxt-toast-container';
const STYLE_ID = '__wxt-toast-style';

const STYLE = `
  #__wxt-toast-container{position:fixed;top:16px;left:50%;transform:translateX(-50%);
    z-index:2147483647;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;}
  .__wxt-toast{max-width:80vw;padding:8px 14px;border-radius:8px;font:13px/1.5 system-ui,sans-serif;
    color:#fff;box-shadow:0 4px 16px rgba(0,0,0,0.25);word-break:break-all;
    animation:__wxt-toast-in .18s ease;}
  .__wxt-toast-ok{background:rgba(34,197,94,0.95);}
  .__wxt-toast-err{background:rgba(229,72,77,0.95);}
  .__wxt-toast-warn{background:rgba(234,160,0,0.95);}
  .__wxt-toast-info{background:rgba(31,35,41,0.9);}
  @keyframes __wxt-toast-in{from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:translateY(0);}}
`;

const DURATION_MS = 2500;

/** 确保样式与容器已注入（幂等） */
function ensureContainer(): HTMLElement {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  let container = document.getElementById(CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = CONTAINER_ID;
    document.body.appendChild(container);
  }
  return container;
}

/** 弹出页面内 toast（kind: ok/err/warn/info），2.5s 后自动移除 */
export function showToast(kind: ToastKind, text: string): void {
  // 防御：非 content（DOM）环境调用时静默忽略
  if (typeof document === 'undefined' || !document.body) return;
  const container = ensureContainer();
  const el = document.createElement('div');
  el.className = `__wxt-toast __wxt-toast-${kind}`;
  el.textContent = text;
  container.appendChild(el);
  setTimeout(() => el.remove(), DURATION_MS);
}
