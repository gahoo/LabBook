# 测试基建 (Test Infrastructure Setup) 任务清单

## 1. 基础依赖与配置
- [ ] 安装依赖：`vitest`, `supertest`, `@types/supertest` (作为 devDependencies)。
- [ ] 在根目录创建 `vitest.config.ts`，配置测试环境并引入 `tests/setup.ts`。
- [ ] 修改 `package.json`，添加 `"test": "vitest run"` 脚本。

## 2. 改造 server.ts 以支持脱机测试
- [ ] 在 `server.ts` 末尾，包裹 `app.listen()` 和 `startNoShowScanner()` 的执行，条件为 `if (process.env.NODE_ENV !== 'test')`。
- [ ] 导出必需对象：`export { app, db };`，使其作为系统第一接缝（HTTP Seam）和验证探针供测试调用。

## 3. 测试工具与边界 Mock
- [ ] 编写 `tests/setup.ts`：设定全局测试环境变量，并配置全局拦截（Mock `nodemailer` 和 `fetch`）。
- [ ] 编写 `tests/utils/db-helper.ts`：实现测试每次运行前数据库表的自动构建（重用 `src/db/schema.ts` 如果后续已抽离，或者直接执行 SQL），以及表数据的清空方法。
- [ ] 编写 `tests/utils/auth-helper.ts`：封装直接生成管理员 JWT Token 的辅助函数，避免每次测试都走网络请求登录。

## 4. 探路测试与验证
- [ ] 编写 `tests/00_setup_health.test.ts`，仅测试 `/api/health` 接口，确认 Express 应用未发生端口冲突且响应正常。
- [ ] 运行 `npm run test`，保证基线连通性成功。
