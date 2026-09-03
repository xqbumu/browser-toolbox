import { readFileSync, writeFileSync } from "fs";

const DIR = ".output/firefox-mv2";
const MANIFEST = `${DIR}/manifest.json`;
const BACKGROUND = `${DIR}/background.js`;

// AMO 对 manifest.version 只接受 1-4 段纯数字(每段 0-999999999、禁前导零、无字母/连字符)，
// 且同 addon 同版本号判重、版本须单调递增。
// 为免跨天发布人工 bump 撞 "already exists"，在签名前自动追加 YYMMDD 第 4 段：
//   "2.0.3" → "2.0.3.260903"
// 同日重复构建保持幂等(段值相同)；同日确需再发新版本时人工 bump 主链(2.0.3 → 2.0.4)即可。
// 仅改写签名包的 manifest.json —— package.json/tag 仍用主链版本，tag 同步校验不受影响。
function appendDateSegment(version) {
  const segs = version.trim().split(".");
  if (segs.length >= 4) return version; // 已是 4 段(含人工写死的)，尊重原值
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replace(/-/g, "");
  return `${version}.${date}`;
}

function patchManifest() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch (e) {
    console.error("Failed to read manifest.json:", e.message);
    process.exit(1);
  }
  const before = manifest.version;
  const after = appendDateSegment(before);
  if (after !== before) {
    manifest.version = after;
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    console.log(`Patched manifest.json: version ${before} -> ${after}`);
  } else {
    console.log(`manifest version ${before}: no change needed`);
  }
  return after;
}

function patchBackground() {
  try {
    const content = readFileSync(BACKGROUND, "utf8");
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
      writeFileSync(BACKGROUND, patched);
      console.log("Patched background.js: removed Function() string-constructor usage");
    } else {
      console.log("background.js: no patch needed");
    }
  } catch (e) {
    console.error("Failed to patch background.js:", e.message);
    process.exit(1);
  }
}

patchManifest();
patchBackground();
