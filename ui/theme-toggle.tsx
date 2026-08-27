import { useEffect, useState } from "react";
import { Select } from "tdesign-react";
import {
  applyTheme,
  getThemePref,
  setThemePref,
  watchSystemTheme,
  type ThemePref,
} from "@/ui/theme";

const OPTIONS = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

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

  return (
    <Select
      size="small"
      value={pref}
      options={OPTIONS}
      onChange={(v) => {
        const next = v as ThemePref;
        setPref(next);
        void setThemePref(next);
      }}
      style={{ width: 110 }}
    />
  );
}
