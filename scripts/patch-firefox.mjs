import { readFileSync, writeFileSync } from "fs";

const DIR = ".output/firefox-mv2";
const MANIFEST = `${DIR}/manifest.json`;
const BACKGROUND = `${DIR}/background.js`;

// AMO 对 manifest.version 只接受 1-4 段纯数字(每段 0-999999999、禁前导零、无字母/连字符)，
// 且同 addon 同版本号判重、版本须单调递增。git hash 含 hex 字母无法入版本号，
// AMO 版本列表 API 又有索引滞后(本仓库已实证) —— 故唯一可靠防冲突因子是
// 「每次发布动作的序号」：CI 注入 github.run_number，本地 fallback 分钟时间戳。
// 签名前自动追加第 4 段：
//   CI:    "2.0.3" → "2.0.3.47"   (github.run_number，每次 run 唯一)
//   本地:  "2.0.3" → "2.0.3.29800000"  (epoch/60，跨平台无依赖)
// 附带红利：断线/限流重跑是新 run 号 → 天然免疫 AMO 同版本 upload 锁死。
//
// 版本线纪律(单 addon 共用 stable 与 latest/preview 时)：
//   - latest/preview：锁低位主链(如 2.0.3)，只靠第 4 段递增 → 永不 bump、可同日多发
//   - stable：发布前 bump 主链并写完整 4 段(如 2.0.4.0)，脚本尊重 4 段不覆盖，
//     保证 stable 恒高于所有历史 preview，已装 stable 的用户不会被后续 preview 高版本覆盖
// 仅改写签名包的 manifest.json —— package.json/tag 仍用主链版本，tag 同步校验不受影响。
function buildSegment() {
  const run = process.env.RUN_NUMBER?.trim();
  if (run && /^(0|[1-9][0-9]{0,8})$/.test(run)) return run; // CI run 序号
  return String(Math.floor(Date.now() / 60000)); // 本地 fallback: 分钟时间戳(60s 粒度唯一)
}

function appendBuildSegment(version) {
  const segs = version.trim().split(".");
  if (segs.length >= 4) return version; // 已是 4 段(如人工写死的 stable 2.0.4.0)，尊重原值
  return `${version}.${buildSegment()}`;
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
  const after = appendBuildSegment(before);
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
