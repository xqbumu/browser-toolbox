import { defineConfig } from "wxt";

// AMO 对 browser_specific_settings.gecko.id 只接受两种格式：
//   1) "{GUID}" —— 花括号包裹的 UUID（8-4-4-4-12）
//   2) "name@domain" —— email 形
// 裸 UUID（无花括号）提交会被 addons.mozilla.org 以 JSON_INVALID 拒绝。
// 此处统一归一化：裸 UUID 自动补花括号；其余格式（含 email 形）原样透传。
function normalizeGeckoId(raw: string | undefined): string {
  const id = (raw ?? "").trim();
  const bare = id.replace(/^\{/, "").replace(/\}$/, "");
  const isBareUuid =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      bare,
    );
  return isBareUuid ? `{${bare}}` : id;
}

// 说明：
// - WXT 0.21 的 `modules` 仍接受包名字符串（module-react 沿用字符串形式注册）。
// - manifest 使用函数形式：请求头改写工具需要按目标浏览器注入不同权限——
//   Chrome/Safari(MV3) 走 declarativeNetRequest；Firefox(MV2) 走阻塞式 webRequest
//   （webRequestBlocking 在 MV3 不可用，不能进 Chrome 的权限表，否则商店审核拒绝）。
// - 权限声明覆盖三端：截图必须的 `tabs`/`activeTab`/`<all_urls>`，保存结果所需的 `downloads`，
//   配置持久化所需的 `storage`。`<all_urls>` 同时放在 `host_permissions` 以适配 Chrome MV3，
//   也是 webRequest 路径的拦截前提。
// - content script 的 matches / run_at 由 `entrypoints/content.ts` 的 defineContentScript 声明，
//   WXT 会自动生成 manifest.content_scripts，避免手动维护内部脚本路径。
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: ".",
  // 函数形式按目标浏览器生成权限表（env.browser / env.manifestVersion）
  manifest: ({ browser }) => ({
    name: "浏览器工具箱",
    description:
      "截图与请求头改写工具箱：整页滚动长图、选区/批量截图、Header 规则改写",
    version: "2.0.3",
    // 图标（PNG，Chrome/Edge 不接受 SVG 作为扩展图标）。源文件见 public/icon/icon.svg
    icons: {
      "16": "/icon/icon-16.png",
      "32": "/icon/icon-32.png",
      "48": "/icon/icon-48.png",
      "96": "/icon/icon-96.png",
      "128": "/icon/icon-128.png",
    },
    action: {
      default_icon: {
        "16": "/icon/icon-16.png",
        "32": "/icon/icon-32.png",
        "48": "/icon/icon-48.png",
        "128": "/icon/icon-128.png",
      },
    },
    // Firefox MV2 使用 browser_action，WXT 不会自动把 action.default_icon 转换过去
    ...(browser === "firefox"
      ? {
          browser_action: {
            default_icon: {
              "16": "/icon/icon-16.png",
              "32": "/icon/icon-32.png",
              "48": "/icon/icon-48.png",
              "128": "/icon/icon-128.png",
            },
          },
        }
      : {}),
    permissions: [
      "tabs",
      "activeTab",
      "downloads",
      "storage",
      "<all_urls>",
      // Firefox MV2：阻塞式 webRequest 改写请求头 + MCP 原生消息桥接
      ...(browser === "firefox"
        ? ([
            "webRequest",
            "webRequestBlocking",
            "nativeMessaging",
            "privacy",
          ] as const)
        : []),
      // Chrome/Safari MV3：declarativeNetRequest modifyHeaders
      ...(browser === "chrome" || browser === "safari"
        ? (["declarativeNetRequest"] as const)
        : []),
    ],
    host_permissions: ["<all_urls>"],
    browser_specific_settings: {
      gecko: {
        id: normalizeGeckoId(process.env.FIREFOX_EXTENSION_ID),
        data_collection_permissions: {
          required: ["none"],
        },
      },
    },
  }),
});
