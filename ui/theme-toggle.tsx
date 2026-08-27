import { useEffect, useState } from "react";
import { SunnyIcon, MoonIcon, DesktopIcon } from "tdesign-icons-react";
import {
  applyTheme,
  getThemePref,
  setThemePref,
  watchSystemTheme,
  type ThemePref,
} from "@/ui/theme";

const ICON: Record<ThemePref, typeof SunnyIcon> = {
  system: DesktopIcon,
  light: SunnyIcon,
  dark: MoonIcon,
};
const LABEL: Record<ThemePref, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};
const NEXT: Record<ThemePref, ThemePref> = {
  system: "light",
  light: "dark",
  dark: "system",
};

export function ThemeToggle(): React.ReactNode {
  const [pref, setPref] = useState<ThemePref>("system");

  useEffect(() => {
    void getThemePref().then(setPref);
    const sync = (): void => {
      void getThemePref().then(setPref);
      void applyTheme();
    };
    browser.storage.onChanged.addListener(sync);
    watchSystemTheme(sync);
    return () => browser.storage.onChanged.removeListener(sync);
  }, []);

  const Icon = ICON[pref];
  const next = NEXT[pref];
  return (
    <button
      type="button"
      className="theme-toggle"
      title={`主题：${LABEL[pref]}（点击切换为${LABEL[next]}）`}
      aria-label={`主题：${LABEL[pref]}`}
      onClick={() => {
        setPref(next);
        void setThemePref(next);
      }}
    >
      <Icon size="18px" />
    </button>
  );
}
