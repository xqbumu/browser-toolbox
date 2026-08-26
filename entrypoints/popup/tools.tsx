/**
 * popup 工具注册表：新工具只需在此追加一条 ToolDef 并实现组件，
 * 壳（App.tsx）的切换器自动渲染，无需改动任何分发逻辑。
 * icon 使用 TDesign SVG 图标（与 rail 的 SettingIcon 视觉一致）。
 */
import type { ReactNode } from "react";
import { CameraIcon, FilterIcon } from "tdesign-icons-react";
import { ScreenshotTool } from "./tools/screenshot/ScreenshotTool";
import { HeadersTool } from "./tools/headers/HeadersTool";

export interface ToolDef {
  id: string;
  icon: ReactNode;
  label: string;
  render: () => ReactNode;
}

export const TOOLS: ToolDef[] = [
  {
    id: "screenshot",
    icon: <CameraIcon />,
    label: "截图",
    render: () => <ScreenshotTool />,
  },
  {
    id: "headers",
    icon: <FilterIcon />,
    label: "请求头",
    render: () => <HeadersTool />,
  },
];
