/**
 * Popup 壳：左侧图标工具栏（rail）+ 右侧内容区。
 * - 工具在 tools.tsx 注册表声明；新增工具 = 注册表加一项，rail 自动出现图标；
 * - rail 不随工具数增加而消耗内容区纵向空间，为后续工具扩展预留结构；
 * - 固定弹窗高度，切换工具时无布局跳动，内容区独立滚动。
 */
import { useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  DashboardIcon,
  SettingIcon,
} from "tdesign-icons-react";
import { Button, Tooltip } from "tdesign-react";
import { TOOLS } from "./tools";

export default function App() {
  const [toolId, setToolId] = useState<string>(TOOLS[0]?.id ?? "");
  const [showSettings, setShowSettings] = useState(false);
  const active = TOOLS.find((t) => t.id === toolId) ?? TOOLS[0];

  // 各工具启停状态（由 enableKey 声明），驱动 rail 状态点
  const enableKeys = TOOLS.map((t) => t.enableKey).filter(Boolean) as string[];
  const [enables, setEnables] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void (async () => {
      const next: Record<string, boolean> = {};
      for (const key of enableKeys) {
        const res = await browser.storage.local.get(key);
        next[key] = res[key] !== false;
      }
      setEnables(next);
    })();
    const listener = (
      changes: Record<string, { newValue?: unknown }>,
      area: string,
    ): void => {
      if (area !== "local") return;
      setEnables((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const key of enableKeys) {
          if (changes[key]) {
            next[key] = changes[key]!.newValue !== false;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  // 切换工具时退出设置视图
  function switchTool(id: string): void {
    setToolId(id);
    setShowSettings(false);
  }

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
                onClick={() => switchTool(tool.id)}
              >
                <span className="tool-icon">{tool.icon}</span>
                {tool.enableKey && enables[tool.enableKey] != null && (
                  <span
                    className={`rail-dot${enables[tool.enableKey] ? "" : " off"}`}
                    title={enables[tool.enableKey] ? "已启用" : "已关闭"}
                  />
                )}
              </button>
            </Tooltip>
          ))}
        </div>

        <div className="tool-rail-footer">
          {/* 统一设置入口：随激活工具变化（无设置的工具回退为打开管理页） */}
          <Button
            shape="circle"
            variant="text"
            theme={showSettings ? "primary" : "default"}
            title={
              active?.settings ? `${active.label}设置` : "打开管理页"
            }
            onClick={() => {
              if (active?.settings) setShowSettings((v) => !v);
              else void browser.runtime.openOptionsPage();
            }}
          >
            <SettingIcon />
          </Button>
          <Button
            shape="circle"
            variant="text"
            theme="default"
            title="打开管理页"
            onClick={() => void browser.runtime.openOptionsPage()}
          >
            <DashboardIcon />
          </Button>
        </div>
      </nav>

      <main className="tool-content" key={`${active?.id}-${showSettings}`}>
        {active?.settings && showSettings ? (
          <>
            <div className="settings-back">
              <Button
                size="small"
                variant="text"
                icon={<ArrowLeftIcon />}
                onClick={() => setShowSettings(false)}
              >
                {active.label}设置
              </Button>
            </div>
            {active.settings()}
          </>
        ) : (
          <>
            {active?.render()}
          </>
        )}
      </main>
    </div>
  );
}
