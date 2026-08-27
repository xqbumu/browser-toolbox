import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyTheme, getThemePref, setThemePref } from "@/ui/theme";

const mem: Record<string, unknown> = {};
(globalThis as { browser?: unknown }).browser = {
  storage: {
    sync: {
      get: async (k: string) => (k in mem ? { [k]: mem[k] } : {}),
      set: async (o: Record<string, unknown>) => {
        Object.assign(mem, o);
      },
    },
  },
};

// node 环境无 DOM，提供最小 document 桩
const docStub = { documentElement: { dataset: {} as Record<string, string> } };
(globalThis as { document?: unknown }).document = docStub;

describe("theme util", () => {
  beforeEach(() => {
    delete mem["uiTheme"];
    (document.documentElement as { dataset: Record<string, string> }).dataset =
      {};
  });

  it("缺省偏好为 system，applyTheme 写入 data-theme", async () => {
    expect(await getThemePref()).toBe("system");
    await applyTheme();
    expect(document.documentElement.dataset.theme).toMatch(/light|dark/);
  });

  it("setThemePref 持久化偏好并切换", async () => {
    await setThemePref("dark");
    expect(await getThemePref()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
