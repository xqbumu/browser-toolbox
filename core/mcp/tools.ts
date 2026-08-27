/**
 * MCP 工具清单：把后台已有的 PopupRequest 动作映射为 MCP tool。
 * 这是「工具定义」的唯一来源——后台 handleRequest 已包含全部实现，这里只做 schema 与请求构造。
 */
import type { HeaderRule, HeaderGroup } from "@/types/headers";
import type { CaptureConfig } from "@/types/config";
import type { Rect } from "@/types/capture";
import type { PopupRequest } from "@/types/messages";
import type { McpTool } from "./types";

const captureConfigSchema = {
  type: "object",
  description: "截图配置（可选，缺省使用扩展当前配置）",
  properties: {
    format: { type: "string", enum: ["png", "jpeg", "webp"] },
    quality: { type: "number", description: "jpeg/webp 质量 0-1" },
    saveSubfolder: { type: "string" },
    fullPage: { type: "boolean" },
    delayMs: { type: "number" },
    historyLimit: { type: "number" },
  },
};

export const MCP_TOOLS: McpTool[] = [
  {
    name: "tb_capture_visible",
    description: "对指定标签页截取当前可见区域",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "目标标签页 id（通常传当前活动标签）",
        },
        config: captureConfigSchema,
      },
      required: ["tabId"],
    },
  },
  {
    name: "tb_capture_fullpage",
    description: "对指定标签页截取整页长图（自动滚动拼接）",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "目标标签页 id" },
        config: captureConfigSchema,
      },
      required: ["tabId"],
    },
  },
  {
    name: "tb_capture_area",
    description: "对指定标签页截取选区矩形",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number" },
        rect: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
          },
          required: ["x", "y", "width", "height"],
          description: "选区（CSS 像素，相对视口）",
        },
        config: captureConfigSchema,
      },
      required: ["tabId", "rect"],
    },
  },
  {
    name: "tb_batch_tabs",
    description: "对当前窗口所有标签页批量截图",
    inputSchema: {
      type: "object",
      properties: {
        windowId: { type: "number" },
        config: captureConfigSchema,
      },
      required: ["windowId"],
    },
  },
  {
    name: "tb_batch_urls",
    description: "按一组 URL 批量截图（逐个打开捕获）",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "目标 URL 列表",
        },
        config: captureConfigSchema,
      },
      required: ["urls"],
    },
  },
  {
    name: "tb_get_config",
    description: "读取当前截图配置",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tb_set_config",
    description: "更新截图配置（部分字段）",
    inputSchema: {
      type: "object",
      properties: {
        config: { ...captureConfigSchema, description: "要更新的配置字段" },
      },
      required: ["config"],
    },
  },
  {
    name: "tb_history_list",
    description: "列出截图历史（缩略信息）",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tb_history_get",
    description: "获取单条历史记录（含原图）",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "tb_history_delete",
    description: "删除单条历史记录",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "tb_history_delete_many",
    description: "批量删除历史记录",
    inputSchema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } } },
      required: ["ids"],
    },
  },
  {
    name: "tb_history_clear",
    description: "清空全部历史记录",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tb_history_redownload",
    description: "重新下载某条历史记录的原图",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "tb_headers_list",
    description: "列出全部请求头改写规则",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tb_headers_save",
    description: "新增或覆盖保存一条请求头改写规则",
    inputSchema: {
      type: "object",
      properties: {
        rule: { type: "object", description: "HeaderRule 对象" },
      },
      required: ["rule"],
    },
  },
  {
    name: "tb_headers_delete",
    description: "删除指定请求头规则",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "tb_headers_toggle",
    description: "启用/停用指定请求头规则",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["id", "enabled"],
    },
  },
  {
    name: "tb_headers_session_override",
    description: "会话级临时覆盖：强制启用/停用某规则（重启即清）",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        enabled: {
          type: ["boolean", "null"],
          description: "true=强制启用 false=强制停用 null=清除覆盖",
        },
      },
      required: ["id", "enabled"],
    },
  },
  {
    name: "tb_headers_session_list",
    description: "拉取当前会话级覆盖快照",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tb_headers_import",
    description: "导入请求头规则（merge 或 replace）",
    inputSchema: {
      type: "object",
      properties: {
        rules: {
          type: "array",
          items: { type: "object" },
          description: "HeaderRule[]",
        },
        mode: { type: "string", enum: ["merge", "replace"] },
      },
      required: ["rules", "mode"],
    },
  },
  {
    name: "tb_groups_list",
    description: "列出请求头分组",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tb_groups_save",
    description: "新增或覆盖保存分组",
    inputSchema: {
      type: "object",
      properties: {
        group: { type: "object", description: "HeaderGroup 对象" },
      },
      required: ["group"],
    },
  },
  {
    name: "tb_groups_delete",
    description: "删除分组",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "tb_groups_toggle",
    description: "启用/停用分组",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, enabled: { type: "boolean" } },
      required: ["id", "enabled"],
    },
  },
];

/** 工具名称 → 构造对应的 PopupRequest（供 tools/call 使用） */
export function buildRequest(
  name: string,
  args: Record<string, unknown>,
): PopupRequest {
  const a = args as Record<string, any>;
  switch (name) {
    case "tb_capture_visible":
      return {
        type: "CAPTURE_VISIBLE",
        payload: { tabId: a.tabId, config: (a.config ?? {}) as CaptureConfig },
      };
    case "tb_capture_fullpage":
      return {
        type: "CAPTURE_FULLPAGE",
        payload: { tabId: a.tabId, config: (a.config ?? {}) as CaptureConfig },
      };
    case "tb_capture_area":
      return {
        type: "CAPTURE_AREA",
        payload: {
          tabId: a.tabId,
          rect: a.rect as Rect,
          config: (a.config ?? {}) as CaptureConfig,
        },
      };
    case "tb_batch_tabs":
      return {
        type: "BATCH_TABS",
        payload: {
          windowId: a.windowId,
          config: (a.config ?? {}) as CaptureConfig,
        },
      };
    case "tb_batch_urls":
      return {
        type: "BATCH_URLS",
        payload: {
          urls: a.urls as string[],
          config: (a.config ?? {}) as CaptureConfig,
        },
      };
    case "tb_get_config":
      return { type: "GET_CONFIG", payload: {} };
    case "tb_set_config":
      return {
        type: "SET_CONFIG",
        payload: a.config as Partial<CaptureConfig>,
      };
    case "tb_history_list":
      return { type: "HISTORY_LIST", payload: {} };
    case "tb_history_get":
      return { type: "HISTORY_GET", payload: { id: a.id } };
    case "tb_history_delete":
      return { type: "HISTORY_DELETE", payload: { id: a.id } };
    case "tb_history_delete_many":
      return {
        type: "HISTORY_DELETE_MANY",
        payload: { ids: a.ids as string[] },
      };
    case "tb_history_clear":
      return { type: "HISTORY_CLEAR", payload: {} };
    case "tb_history_redownload":
      return { type: "HISTORY_REDOWNLOAD", payload: { id: a.id } };
    case "tb_headers_list":
      return { type: "HEADERS_LIST", payload: {} };
    case "tb_headers_save":
      return { type: "HEADERS_SAVE", payload: { rule: a.rule as HeaderRule } };
    case "tb_headers_delete":
      return { type: "HEADERS_DELETE", payload: { id: a.id } };
    case "tb_headers_toggle":
      return {
        type: "HEADERS_TOGGLE",
        payload: { id: a.id, enabled: a.enabled },
      };
    case "tb_headers_session_override":
      return {
        type: "HEADERS_SESSION_OVERRIDE",
        payload: { id: a.id, enabled: a.enabled as boolean | null },
      };
    case "tb_headers_session_list":
      return { type: "HEADERS_SESSION_LIST" };
    case "tb_headers_import":
      return {
        type: "HEADERS_IMPORT",
        payload: { rules: a.rules as HeaderRule[], mode: a.mode },
      };
    case "tb_groups_list":
      return { type: "GROUPS_LIST", payload: {} };
    case "tb_groups_save":
      return {
        type: "GROUPS_SAVE",
        payload: { group: a.group as HeaderGroup },
      };
    case "tb_groups_delete":
      return { type: "GROUPS_DELETE", payload: { id: a.id } };
    case "tb_groups_toggle":
      return {
        type: "GROUPS_TOGGLE",
        payload: { id: a.id, enabled: a.enabled },
      };
    default:
      throw new Error(`未知 MCP 工具：${name}`);
  }
}
