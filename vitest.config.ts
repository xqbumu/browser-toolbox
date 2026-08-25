import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * vitest 测试配置：
 * - 复用项目 `@/` 路径别名（映射到项目根，与 tsconfig.json 的 paths 一致）；
 * - 仅运行 tests/ 下的单测；node 环境（不加载 DOM，聚焦纯逻辑）。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@/': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
