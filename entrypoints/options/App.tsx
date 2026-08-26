/**
 * Options 管理页：仅承载「请求头规则」的完整管理（CRUD + 导入导出）。
 * 截图工具的参数设置已内联至 popup 截图工具的设置视图（齿轮入口），
 * 后续新工具同样遵循「设置跟随工具」约定，此页不再集中承载各工具表单。
 */
import { HeaderRulesSection } from "./components/HeaderRulesSection";

export default function App() {
  return (
    <div className="options-page">
      <h1>🧩 请求头规则管理</h1>
      <HeaderRulesSection />
    </div>
  );
}
