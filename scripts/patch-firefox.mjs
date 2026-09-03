import { readFileSync, writeFileSync } from "fs";

const FILE = ".output/firefox-mv2/background.js";

try {
  const content = readFileSync(FILE, "utf8");
  let patched = content;

  // 形态 A（历史产物）：`new Function("" + callback)` → 直接用回调
  patched = patched.replace(/new Function\("" \+ callback\)/g, "callback");

  // 形态 B（当前产物）：core-js setImmediate polyfill 对非函数参数走 Function 字符串构造的兜底分支。
  // 该分支仅服务于“传字符串给 setImmediate”的非标准用法，项目内从不使用，整体移除即可消除
  // addons-linter 的 DANGEROUS_EVAL 警告。移除后非函数参数保持原样，flush 时自然抛 TypeError。
  patched = patched.replace(
    new RegExp("typeof e!=`function`&&\\(e=Function\\(``\\+e\\)\\);?", "g"),
    "",
  );

  if (patched !== content) {
    writeFileSync(FILE, patched);
    console.log("Patched background.js: removed Function() string-constructor usage");
  } else {
    console.log("No patch needed");
  }
} catch (e) {
  console.error("Failed to patch background.js:", e.message);
  process.exit(1);
}
