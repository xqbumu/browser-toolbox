/** 暗色主题：偏好存 storage.sync，运行时通过 <html data-theme> 切换 */
import { createLogger } from "@/utils/logger";

const log = createLogger("theme");
const KEY = "uiTheme";

export type ThemePref = "light" | "dark" | "system";

function systemPrefersDark(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function resolve(pref: ThemePref): "light" | "dark" {
  if (pref === "system") return systemPrefersDark() ? "dark" : "light";
  return pref;
}

export async function getThemePref(): Promise<ThemePref> {
  try {
    const r = await browser.storage.sync.get(KEY);
    const v = r[KEY];
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch (e) {
    log.warn("读取主题偏好失败", e);
  }
  return "system";
}

export async function setThemePref(pref: ThemePref): Promise<void> {
  try {
    await browser.storage.sync.set({ [KEY]: pref });
  } catch (e) {
    log.warn("保存主题偏好失败", e);
  }
  applyTheme();
}

/** 应用当前偏好到 documentElement（需在 DOM 就绪后调用） */
export async function applyTheme(): Promise<void> {
  const pref = await getThemePref();
  const mode = resolve(pref);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = mode;
  }
}

/** 监听系统主题变化（pref=system 时实时跟随） */
export function watchSystemTheme(cb: () => void): void {
  if (typeof matchMedia !== "function") return;
  matchMedia("(prefers-color-scheme: dark)").addEventListener(
    "change",
    () => void getThemePref().then((p) => p === "system" && cb()),
  );
}
