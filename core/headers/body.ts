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
