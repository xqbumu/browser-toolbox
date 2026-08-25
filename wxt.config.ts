import { defineConfig } from 'wxt';

// 说明：
// - WXT 0.20 的 `modules` 仍接受包名字符串（resolveWxtUserModules 会对每个字符串做
//   `import(resolve(moduleId))` 并读取其默认导出），故 module-react 沿用字符串形式注册。
// - WXT 0.20 已移除 webextension-polyfill，全局 `browser` 由 `@wxt-dev/browser` 提供
//   （`wxt prepare` 生成 `.wxt/` 类型后可直接全局使用）。本工程 background 已采用
//   `sendResponse` + `return true` 的 Chrome 回调范式，天然兼容 0.20，无需改动 `browser.*` 调用点。
// - 权限声明覆盖三端：截图必须的 `tabs`/`activeTab`/`<all_urls>`，保存结果所需的 `downloads`，
//   配置持久化所需的 `storage`。`<all_urls>` 同时放在 `host_permissions` 以适配 Chrome MV3。
// - content script 的 matches / run_at 由 `entrypoints/content.ts` 的 defineContentScript 声明，
//   WXT 会自动生成 manifest.content_scripts，避免手动维护内部脚本路径。
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  manifest: {
    name: '网页截图助手',
    description: '跨浏览器整页滚动截图、可见区域截图、选定区域截图与批量截图',
    version: '1.1.0',
    permissions: ['tabs', 'activeTab', 'downloads', 'storage', '<all_urls>'],
    host_permissions: ['<all_urls>'],
  },
});
