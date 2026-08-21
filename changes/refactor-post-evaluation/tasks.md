# 任务拆解与进度清单 (Refactor Post-Evaluation)

## 阶段 0：当前测试基线快照
- [ ] 0.1 运行 `npm run test:coverage`，记录当前覆盖率数据，作为重构安全网的基线。
- [ ] 0.2 确认现有的 135 个测试全部通过。

## 阶段 1：核心分层治理 (P0)
- [ ] 1.1 提取规则 CRUD 函数：将 `violation/routes.ts` 中的 `getRules`, `createRule`, `updateRule`, `deleteRule` 提取到 `violation/repository.ts`。完成后运行测试。
- [ ] 1.2 提取违规记录操作：提取 `createViolation`, `updateViolation`, `revokeViolation`, `restoreViolation`, `rejectAppeal` 等含状态机逻辑的代码。完成后运行测试。
- [ ] 1.3 提取统计与模拟：提取 `getViolationStats`, `simulatePenaltyRule`, `getActivePenalties`, `getViolationParams` 到 `violation/stats.ts`。完成后运行测试。
- [ ] 1.4 提取处罚执行：提取 `batchPenalties`, `waivePenalty` 等高危操作。完成后运行测试。
- [ ] 1.5 验证分层完成：确保所有的集成测试依旧通过。

## 阶段 2：测试深度提升 (P1)
- [ ] 2.1 补充单元测试 (`Reservation`)：创建针对 `ReservationService.create` 的 Service 层集成测试文件（使用 `tests/setup.ts` 的内存 DB，但绕过 HTTP 层，直接调用 Service 函数）。
- [ ] 2.2 补充单元测试 (`Violation`)：针对 `violation` 模块中的 `checkUserPenalty` 和 `evaluatePenaltiesOnViolation` 编写直接调用的 Service 层单元测试（含内存 DB）。

## 阶段 3：接口一致性与类型安全 (P2 & P3)
- [ ] 3.1 统一路由导出风格：遍历 `modules/*/routes.ts`，统一改为 `export { xxxRouter, xxxAdminRouter }` 命名导出风格。
- [ ] 3.2 统一路由挂载方式：清理并重构 `server.ts` 中的路由挂载部分。对于路径前缀不统一的模块（如 `violation` 有 4 个前缀），拆分为多个 sub-router (如 `publicRouter`, `adminRouter`) 并在 `server.ts` 集中挂载，或在内部保留路径前缀以保证 API 兼容。
- [ ] 3.3 消除类型盲区 (`violation`)：消除 `violation` 模块中的 `as any`，为统计查询、聚合查询定义明确的 TypeScript 接口。
- [ ] 3.4 消除类型盲区 (`reservation`)：消除 `reservation` 模块中的 `as any`，补全 DB 返回结果的类型定义。

## 阶段 4：Reservation Service 拆分 (P2)
- [ ] 4.1 按操作类型拆分：将 954 行的 `reservation/service.ts` 拆分为 `create.ts`, `lifecycle.ts` (包含 checkin/checkout), `admin.ts`。
- [ ] 4.2 验证拆分完成：运行测试确保重构未破坏原有逻辑。
