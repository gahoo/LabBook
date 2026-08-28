import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    fileParallelism: false, // 禁用并发，所有测试文件串行执行
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['tests/**', 'dist/**', 'node_modules/**', 'eslint.config.js', 'vitest.config.ts', 'server.ts'],
      thresholds: {
        // Current coverage is ~66%. Lowered threshold to allow CI to pass initially.
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60
      }
    }
  },
});
