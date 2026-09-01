import { readFileSync, writeFileSync } from "fs";

const FILE = ".output/firefox-mv2/background.js";

try {
  const content = readFileSync(FILE, "utf8");
  const patched = content.replace(/new Function\("" \+ callback\)/g, "callback");
  if (patched !== content) {
    writeFileSync(FILE, patched);
    console.log("Patched background.js: replaced new Function() call");
  } else {
    console.log("No patch needed");
  }
} catch (e) {
  console.error("Failed to patch background.js:", e.message);
  process.exit(1);
}