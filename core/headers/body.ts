/**
 * 响应体改写（纯逻辑，便于单测）：
 * 对文本型响应体按一组替换动作重写。仅 Firefox MV2 的 filterResponseData 会调用；
 * Chrome/Safari MV3 无等价能力，引擎层直接跳过（详见 engine.ts）。
 */
import type { BodyAction } from "@/types/headers";

export function applyBodyActions(text: string, actions: BodyAction[]): string {
  let out = text;
  for (const a of actions) {
    const find = a.match ?? "";
    if (!find) continue;
    const replacement = a.replace ?? "";
    if (a.isRegex) {
      let flags = "g";
      if (!a.caseSensitive) flags += "i";
      try {
        out = out.replace(new RegExp(find, flags), replacement);
      } catch {
        // 非法正则跳过该动作
      }
    } else if (a.caseSensitive) {
      out = out.split(find).join(replacement);
    } else {
      // 忽略大小写：用正则兜底（逐动作成本可接受）
      try {
        out = out.replace(new RegExp(escapeForRegExp(find), "gi"), replacement);
      } catch {
        // 理论上不会发生
      }
    }
  }
  return out;
}

function escapeForRegExp(s: string): string {
  return s.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

/** 依据 Content-Type 判断是否为可安全改写的文本类型 */
export function isTextualContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(";")[0]!.trim();
  return (
    ct.startsWith("text/") ||
    ct === "application/json" ||
    ct === "application/javascript" ||
    ct === "application/x-javascript" ||
    ct === "application/xml" ||
    (ct.startsWith("application/") && ct.endsWith("+json")) ||
    (ct.startsWith("application/") && ct.endsWith("+xml"))
  );
}

/** filterResponseData 注入点的最小接口（Firefox 运行时与测试 mock 均实现） */
export interface FilterSink {
  write: (chunk: Uint8Array) => void;
  close: () => void;
  ondata: { addListener: (cb: (e: { data: ArrayBuffer }) => void) => void };
  onstop: { addListener: (cb: () => void) => void };
  onerror: { addListener: (cb: () => void) => void };
}

/**
 * 将响应体改写逻辑与 Firefox 运行时解耦：
 * - 非文本类型或无动作时直接关闭，避免损坏二进制响应；
 * - 文本类型时按 chunk 拼装成字符串，停止后统一改写并回写。
 * 该函数为纯逻辑（依赖注入 FilterSink），便于单测覆盖流式路径。
 */
export function rewriteResponse(
  filter: FilterSink,
  contentType: string | undefined,
  actions: BodyAction[],
): void {
  if (actions.length === 0 || !isTextualContentType(contentType)) {
    filter.close();
    return;
  }
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();
  let buf = "";
  filter.ondata.addListener((ev) => {
    buf += decoder.decode(ev.data, { stream: true });
  });
  filter.onstop.addListener(() => {
    buf += decoder.decode();
    filter.write(encoder.encode(applyBodyActions(buf, actions)));
    filter.close();
  });
  filter.onerror.addListener(() => {
    filter.close();
  });
}
