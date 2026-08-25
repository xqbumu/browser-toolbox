/**
 * utils/clipboard.ts 单测：copyImageToClipboard 能力探测（ClipboardItem / clipboard.write）
 * 与 Firefox 降级路径，确认任何情况下都不抛未捕获异常。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { copyImageToClipboard } from "@/utils/clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyImageToClipboard", () => {
  it("ClipboardItem 构造器缺失 → unsupported", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn() } });
    const res = await copyImageToClipboard(
      new Blob(["x"], { type: "image/png" }),
    );
    expect(res).toEqual({ ok: false, reason: "unsupported" });
  });

  it("navigator.clipboard.write 缺失 → unsupported", async () => {
    vi.stubGlobal("ClipboardItem", class {});
    vi.stubGlobal("navigator", { clipboard: { write: undefined } });
    const res = await copyImageToClipboard(
      new Blob(["x"], { type: "image/png" }),
    );
    expect(res).toEqual({ ok: false, reason: "unsupported" });
  });

  it("成功写入 → ok，且以 ClipboardItem 包裹原始 Blob", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    class MockClipboardItem {
      constructor(public data: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    vi.stubGlobal("navigator", { clipboard: { write } });
    const blob = new Blob(["x"], { type: "image/png" });

    const res = await copyImageToClipboard(blob);

    expect(res).toEqual({ ok: true });
    expect(write).toHaveBeenCalledTimes(1);
    const arg = write.mock.calls[0]![0] as Array<{
      data: Record<string, Blob>;
    }>;
    expect(arg[0]).toBeInstanceOf(MockClipboardItem);
    expect(arg[0]!.data["image/png"]).toBe(blob);
  });

  it("写入抛错 → error，且不向上抛异常", async () => {
    const write = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("ClipboardItem", class {});
    vi.stubGlobal("navigator", { clipboard: { write } });

    await expect(
      copyImageToClipboard(new Blob(["x"], { type: "image/png" })),
    ).resolves.toEqual({ ok: false, reason: "error" });
  });

  it("Blob.type 为空时兜底 image/png", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    class MockClipboardItem {
      constructor(public data: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    vi.stubGlobal("navigator", { clipboard: { write } });

    await copyImageToClipboard(new Blob(["x"])); // 无 type

    const arg = write.mock.calls[0]![0] as Array<{
      data: Record<string, Blob>;
    }>;
    expect(Object.keys(arg[0]!.data)).toEqual(["image/png"]);
  });
});
