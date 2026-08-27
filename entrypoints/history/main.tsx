import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "tdesign-react/es/style/index.css";
import "@/ui/tool-ui.css";
import "@/ui/dark.css";
import "./style.css";

void import('@/ui/theme').then(m=>m.applyTheme());
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
