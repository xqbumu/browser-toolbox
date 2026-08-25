# 网页截图助手

基于 [WXT](https://wxt.dev) 框架 + React + TypeScript 的跨浏览器截图扩展，用「原生截图 API + 滚动拼接」实现无缝整页长截图。

## 功能

- **可见区域截图**：调用原生 `captureVisibleTab` / `captureTab` 截取当前视口。
- **选定区域截图**：拖拽框选，按选区坐标裁剪输出 PNG。
- **整页滚动截图（核心）**：精确滚动 + 逐帧捕获 + Canvas 拼接，处理 fixed/sticky 元素与懒加载图片。
- **批量截图**：按当前窗口选项卡批量、按 URL 列表批量，失败自动重试，结果打包 Zip 下载。
- **历史记录**：每次截图自动写入本地历史（IndexedDB），支持缩略图预览、重新下载、删除与清空，超限按最旧优先淘汰。
- **保存目录**：截图可保存到浏览器「下载」目录下的自定义子文件夹（默认「网页截图」）。
- **跨浏览器**：Chrome（MV3）、Firefox（MV2）完整支持；Safari（MV3）降级为仅可见区域。

## 目录结构

```
entrypoints/   背景 / content script / popup / options 四个入口
core/          截图引擎（可见 / 滚动拼接 / 选区 / 批量）+ content 端辅助模块
adapters/      跨浏览器截图 API 适配层（Chrome / Firefox / Safari）
utils/         能力探测、命名、存储、下载、历史仓库、缩略图、Zip、日志等工具
types/         纯类型模块（background / content / popup 三端共享）
```

## 开发

```bash
npm install            # 安装依赖并执行 wxt prepare
npm run dev            # 开发模式（默认浏览器）
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

截图类扩展必须声明 `tabs`、`activeTab`、`<all_urls>`（Firefox 的 `captureTab` 支持截后台 tab）；`downloads` 用于保存截图；`storage` 用于配置持久化。
