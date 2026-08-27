import { describe, it, expect } from "vitest";
import { MCP_TOOLS, buildRequest } from "@/core/mcp/tools";
import type { PopupRequest } from "@/types/messages";

const names = MCP_TOOLS.map((t) => t.name);

describe("MCP 工具清单", () => {
  it("覆盖全部既有动作且无重名", () => {
    expect(names.length).toBe(24);
    expect(new Set(names).size).toBe(names.length);
  });

  it("每个工具都能构造出合法的 PopupRequest", () => {
    for (const tool of MCP_TOOLS) {
      const req = buildRequest(tool.name, sampleArgs(tool.name));
      expect((req as { type: string }).type).toBeTruthy();
    }
  });

  it("构造请求与类型对齐", () => {
    const req = buildRequest("tb_headers_toggle", {
      id: "x",
      enabled: true,
    }) as Extract<PopupRequest, { type: "HEADERS_TOGGLE" }>;
    expect(req.type).toBe("HEADERS_TOGGLE");
    expect(req.payload).toEqual({ id: "x", enabled: true });
  });

  it("未知工具抛错", () => {
    expect(() => buildRequest("tb_no_such", {})).toThrow();
  });
});

function sampleArgs(name: string): Record<string, unknown> {
  switch (name) {
    case "tb_capture_visible":
    case "tb_capture_fullpage":
      return { tabId: 1 };
    case "tb_capture_area":
      return { tabId: 1, rect: { x: 0, y: 0, width: 10, height: 10 } };
    case "tb_batch_tabs":
      return { windowId: 1 };
    case "tb_batch_urls":
      return { urls: ["https://a.com"] };
    case "tb_set_config":
      return { config: { quality: 0.9 } };
    case "tb_history_get":
    case "tb_history_delete":
    case "tb_history_redownload":
      return { id: "r1" };
    case "tb_history_delete_many":
      return { ids: ["r1", "r2"] };
    case "tb_headers_save":
      return { rule: { id: "h1" } };
    case "tb_headers_delete":
    case "tb_headers_toggle":
    case "tb_headers_session_override":
    case "tb_groups_delete":
    case "tb_groups_toggle":
      return { id: "h1", enabled: true };
    case "tb_headers_import":
      return { rules: [], mode: "merge" };
    case "tb_groups_save":
      return { group: { id: "g1" } };
    default:
      return {};
  }
}
