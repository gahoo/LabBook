# 任务拆解与进度清单 (Refactor Post-Evaluation)

## 阶段 1：核心分层治理 (P0)
- [ ] 1.1 `violation` 分层 - 用户侧：将 `violation/routes.ts` 中用户接口 (User API) 的逻辑提取到 `violation/service.ts` 中。
- [ ] 1.2 `violation` 分层 - 管理侧：将 `violation/routes.ts` 中管理后台接口 (Admin API，包括海量统计查询) 的复杂 SQL 和业务逻辑提取到 `violation/service.ts` 中。
- [ ] 1.3 `violation` 分层验证：运行 `npm run test`，确保所有的集成测试依旧通过。
- [ ] 1.4 职责归位：将 `getSettingsMap` 从 `notification/service.ts` 迁移到 `settings/service.ts`，并全局更新相关模块的 import 路径。

## 阶段 2：接口一致性与类型安全 (P2 & P3)
- [ ] 2.1 统一路由导出风格：遍历 `modules/*/routes.ts`，统一改为 `export { xxxRouter, xxxAdminRouter }` 命名导出风格。
- [ ] 2.2 统一路由挂载方式：清理并重构 `server.ts` 中的路由挂载部分，统一采用 `app.use('/api/xxx', xxxRouter)` 的形式集中管理路径。清理路由文件内部自带的前缀。
- [ ] 2.3 消除类型盲区 (`violation`)：消除 `violation/service.ts` 和 `violation/routes.ts` 中的 `as any`，为统计查询、聚合查询定义明确的 TypeScript 接口。
- [ ] 2.4 消除类型盲区 (`reservation`)：消除 `reservation/service.ts` 中的 `as any`，补全 DB 返回结果的类型定义。

## 阶段 3：测试深度提升 (P1)
- [ ] 3.1 补充单元测试 (`Reservation`)：创建针对 `ReservationService.create` 编写单独的 Service 层单元测试文件（无需通过 HTTP 层）。
- [ ] 3.2 补充单元测试 (`Violation`)：针对 `violation/service.ts` 中的 `checkUserPenalty` 和 `evaluatePenaltiesOnViolation` 编写直接调用的单元测试。
- [ ] 3.3 覆盖率基线确立：运行 `npm run test:coverage` (或等效指令)，生成覆盖率报告，确认当前基线并检查通过情况。

## 阶段 4：(可选) Reservation Service 拆分
- [ ] 4.1 评估并决定是否将 954 行的 `reservation/service.ts` 拆分为 `create.ts`, `lifecycle.ts`, `admin.ts`。如果执行，请补充至后续任务列表中。
