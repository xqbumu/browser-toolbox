# 浏览器工具箱（Browser Toolbox）

基于 [WXT](https://wxt.dev) 框架 + React + TypeScript + [TDesign](https://tdesign.tencent.com/react)（扁平化 UI）的跨浏览器扩展工具箱。当前内置两个工具：

1. **网页截图**——用「原生截图 API + 滚动拼接」实现无缝整页长图，攻克 SPA 内部滚动容器截图难题；
2. **请求头改写（Header Editor）**——按 match pattern 规则对请求/响应头进行覆盖 / 追加 / 删除，Chrome/Safari 走 `declarativeNetRequest`，Firefox MV2 走阻塞式 `webRequest`。

## 功能

### 截图

- **可见区域截图**：调用原生 `captureVisibleTab` / `captureTab` 截取当前视口。
- **选定区域截图**：拖拽框选，按选区坐标裁剪输出 PNG。
- **整页滚动截图（核心）**：精确滚动 + 逐帧捕获 + Canvas 拼接，处理 fixed/sticky 元素与懒加载图片；支持页面内部滚动容器（Dashboard/侧边栏布局也能完整截取）。
- **批量截图**：按当前窗口选项卡批量、按 URL 列表批量，失败自动重试，结果打包 Zip 下载。
- **历史记录**：截图自动写入本地历史（IndexedDB），支持缩略图预览、重新下载、删除与清空。

### 请求头改写

- 规则模型：URL 匹配模式（match pattern）+ HTTP 方法 + 资源类型 → 动作列表（请求/响应 × 覆盖/追加/删除 × 头名/头值）。
- 双引擎自动选择：
  - Chrome / Safari（MV3）：规则实时转换为 `declarativeNetRequest` 动态规则（独立 id 区间，幂等重建）；
  - Firefox（MV2）：阻塞式 `webRequest` 监听器改写请求/响应头。
- Popup「请求头」Tab 展示命中当前页的规则并可即时启停；Options 页提供完整 CRUD、导入导出 JSON。

## 目录结构

```
entrypoints/   背景 / content script / popup / options 四个入口
core/
  headers/     请求头引擎（match 匹配器 / DNR 转换 / webRequest 应用 / 引擎选择）
  *.ts         截图引擎（可见 / 滚动拼接 / 选区 / 批量）
adapters/      跨浏览器截图 API 适配层（Chrome / Firefox / Safari）
ui/            popup / options 共享组件（HeaderRuleEditor）与共享样式
utils/         能力探测、存储、header 规则仓库、下载、历史仓库、缩略图、Zip、日志等
types/         纯类型模块（background / content / popup 三端共享）
```

## 开发

```bash
pnpm install           # 安装依赖并执行 wxt prepare
npm run dev            # 开发模式（默认浏览器，web-ext 自动拉起）
npm run dev:firefox    # Firefox 开发模式
```

## 构建

```bash
npm run build:chrome     # Chrome MV3
npm run build:firefox    # Firefox MV2
npm run build:safari     # Safari MV3（生成 Xcode 项目壳，需真机签名）
```

构建产物输出到 `.output/` 目录。

## 权限说明

截图类工具必须声明 `tabs`、`activeTab`、`<all_urls>`；`downloads` 用于保存截图；`storage` 用于配置持久化。请求头改写按浏览器注入：Chrome/Safari 追加 `declarativeNetRequest`，Firefox MV2 追加 `webRequest` + `webRequestBlocking`（MV3 不允许 blocking，故不进 Chrome 权限表）。
