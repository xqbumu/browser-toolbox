/**
 * Popup 壳：左侧图标工具栏（rail）+ 右侧内容区。
 * - 工具在 tools.tsx 注册表声明；新增工具 = 注册表加一项，rail 自动出现图标；
 * - rail 不随工具数增加而消耗内容区纵向空间，为后续工具扩展预留结构；
 * - 固定弹窗高度，切换工具时无布局跳动，内容区独立滚动。
 */
import { useState } from "react";
import { SettingIcon } from "tdesign-icons-react";
import { Button, Tooltip } from "tdesign-react";
import { TOOLS } from "./tools";

export default function App() {
  const [toolId, setToolId] = useState<string>(TOOLS[0]?.id ?? "");
  const active = TOOLS.find((t) => t.id === toolId) ?? TOOLS[0];

  return (
    <div className="shell">
      <nav className="tool-rail" aria-label="工具切换">
        <div className="tool-rail-logo" title="浏览器工具箱">
          🧰
        </div>


        <div className="tool-rail-items">
          {TOOLS.map((tool) => (
            <Tooltip key={tool.id} content={tool.label} placement="right">
              <button
                type="button"
                className={`tool-rail-item${tool.id === active?.id ? " active" : ""}`}
                aria-label={tool.label}
                aria-current={tool.id === active?.id}
                onClick={() => setToolId(tool.id)}
              >
                <span className="tool-icon">{tool.icon}</span>
              </button>
            </Tooltip>
          ))}
        </div>

        <div className="tool-rail-footer">
          <Button
            shape="circle"
            variant="text"
            theme="default"
            title="设置"
            onClick={() => void browser.runtime.openOptionsPage()}
          >
            <SettingIcon />
          </Button>
        </div>
      </nav>

      <main className="tool-content" key={active?.id}>
        {active?.render()}
      </main>
    </div>
  );
}
