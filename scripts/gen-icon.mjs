// 单一来源生成扩展图标 PNG：从 public/icon/icon.svg（普通）与 icon-maskable.svg（蒙版/商店用）
// 栅格化出各尺寸 PNG。本地改 SVG 后运行 `pnpm icon` 即可重新生成，避免 PNG 与源漂移。
// 注：CI 不执行此脚本（PNG 已提交）；脚本仅在开发者本机运行，故依赖系统 rasterizer。
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const iconDir = join(here, "..", "public", "icon");

const NORMAL_SIZES = [16, 32, 48, 96, 128];

// 依次尝试常见栅格化工具，命中即用（适配不同开发机）
const rasterizers = [
  (svg, out, s) => `rsvg-convert -w ${s} -h ${s} "${svg}" -o "${out}"`,
  (svg, out, s) => `magick "${svg}" -resize ${s}x${s} "${out}"`,
  (svg, out, s) => `convert "${svg}" -resize ${s}x${s} "${out}"`,
];

function rasterize(svg, out, size) {
  for (const make of rasterizers) {
    try {
      execSync(make(svg, out, size), { stdio: "ignore" });
      return;
    } catch {
      // 尝试下一个工具
    }
  }
  throw new Error(
    `无法栅格化 ${svg}：未找到 rsvg-convert / magick / convert 任一工具`,
  );
}

mkdirSync(iconDir, { recursive: true });

for (const s of NORMAL_SIZES) {
  rasterize(
    join(iconDir, "icon.svg"),
    join(iconDir, `icon-${s}.png`),
    s,
  );
  console.log(`generated icon-${s}.png`);
}

rasterize(
  join(iconDir, "icon-maskable.svg"),
  join(iconDir, "icon-maskable-128.png"),
  128,
);
console.log("generated icon-maskable-128.png");
