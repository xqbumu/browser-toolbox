/**
 * popup 工具注册表：新工具只需在此追加一条 ToolDef 并实现组件，
 * 壳（App.tsx）的切换器自动渲染，无需改动任何分发逻辑。
 * icon 使用 TDesign SVG 图标（与 rail 的 SettingIcon 视觉一致）。
 */
import type { ReactNode } from "react";
import { CameraIcon, FilterIcon } from "tdesign-icons-react";
import { ScreenshotTool } from "./tools/screenshot/ScreenshotTool";
import { ScreenshotSettings } from "./tools/screenshot/ScreenshotSettings";
import { HeadersTool } from "./tools/headers/HeadersTool";
import { HeadersSettings } from "./tools/headers/HeadersSettings";

export interface ToolDef {
  id: string;
  icon: ReactNode;
  label: string;
  render: () => ReactNode;
  /** 可选：工具设置子视图；存在时壳层在内容区右上角渲染统一齿轮入口 */
  settings?: () => ReactNode;
  /**
   * 可选：工具全局启停的 storage 键。声明后 rail 图标实时显示启停状态点
   * （绿=开启 / 灰=关闭），供一眼判断当前工具是否生效。
   */
  enableKey?: string;
}

export const TOOLS: ToolDef[] = [
  {
    id: "screenshot",
    icon: <CameraIcon />,
    label: "截图",
    render: () => <ScreenshotTool />,
    settings: () => <ScreenshotSettings />,
  },
  {
    id: "headers",
    icon: <FilterIcon />,
    label: "请求头",
    render: () => <HeadersTool />,
    settings: () => <HeadersSettings />,
    enableKey: "headerEnabled",
  },
];
