# 任务拆解与进度清单 (Refactor Post-Evaluation)

## 阶段 0：当前测试基线快照
- [x] 0.1 运行 `npm run test:coverage`，记录当前覆盖率数据，作为重构安全网的基线。
- [x] 0.2 确认现有的 135 个测试全部通过。

## 阶段 1：violation 核心分层治理 (P0)

按子域逐步提取，每步完成后运行测试确保不破坏已有行为。

- [x] 1.1 提取 `violation/rules.ts`：从 routes.ts 中提取规则 CRUD 五个函数（getPublicRules, getAdminRules, createRule, updateRule, deleteRule）+ simulateRule + 从 service.ts 迁入 formatRuleName。运行测试。
- [x] 1.2 提取 `violation/evaluator.ts`：从 service.ts 中提取 checkUserPenalty、evaluatePenaltiesOnViolation、getNaturalPeriodStart、getNextNaturalPeriodStart（后两个作为未导出的私有函数）。更新 reservation/service.ts 的 import 路径指向 evaluator.ts。运行测试。
- [x] 1.3 提取 `violation/stats.ts`：从 routes.ts 中提取 getViolationStats、getViolationParams。运行测试。
- [x] 1.4 提取 `violation/penalty.ts`：从 routes.ts 中提取 batchPenalties、waivePenalty、getActivePenalties。这些含事务操作，属高危提取，需仔细核对。运行测试。
- [x] 1.5 整理 `violation/service.ts`：从 routes.ts 中提取剩余的违规记录操作（createViolation, updateViolation, revokeViolation, restoreViolation, rejectAppeal, submitAppeal, getMyViolations, getAdminViolations）。routes.ts 中不再出现任何 db.prepare 和 notifyEvent 调用。运行测试。
- [x] 1.6 最终验证：确认 violation/routes.ts 已瘦身至约 200 行，仅含参数解析、service 调用和 HTTP 响应。运行全量测试。

## 阶段 2：reservation 拆分 (P0)

- [x] 2.1 提取 `reservation/validation.ts`：从 service.ts 的 create 和 update 方法中提取共享校验逻辑（参数校验、惩罚检查、提前天数限制、时长限制、运营时间校验、冲突检测），消除两者的重复代码。将 `lib/validators.ts` 中的 validateOperatingHours 和 calculatePeakAccumulatedMinutes 迁入此文件（它们仅被 reservation 调用）。`lib/validators.ts` 仅保留 validateTimeRange。运行测试。
- [x] 2.2 提取 `reservation/stats.ts`：从 service.ts 中提取 getAdminList、getStats，连同它们依赖的 calculateReportStatus 和 getViolationSettings 辅助函数。运行测试。
- [x] 2.3 最终验证：确认 reservation/service.ts 约 550 行，运行全量测试。

## 阶段 3：测试深度提升与边界增强 (P1)

- [x] 3.1 补充 Service 层测试 (Reservation)：创建测试文件，使用 tests/setup.ts 的内存 DB 基础设施，绕过 HTTP 层直接调用 ReservationService.create，测试校验逻辑和冲突检测的边界情况。
  - [x] 基础流程（已完成）：创建成功、冲突检测、非自动审批降级、基础输入校验、非工作时间预定。
  - [x] 3.1.1 补充：时限硬约束（单次超限、单日累计超限）
  - [x] 3.1.2 补充：峰谷分离逻辑（忙时超限、allowExceed 闲忙时超额转 pending）
  - [x] 3.1.3 补充：前置白名单防线拦截
  - [x] 3.1.4 补充：提前预约期限制 (Advance Days) 拦截
  - [x] 3.1.5 补充：惩罚系统联动（BAN、REQUIRE_APPROVAL、reduce_days 天数缩水）
  - [x] 3.1.6 补充：爽约槽位抢占释放 (No-Show Release) 允许覆盖
  - [x] 3.1.7 补充：异常与隐藏拦截（设备隐藏、非法 JSON 降级）
- [x] 3.2 高风险评估器逻辑攻坚 (Violation Evaluator 增强)：
  - [x] 3.2.1 修复固定处罚的幂等性测试，确保多次评估不会错误顺延解封时间。
  - [x] 3.2.2 明确并添加 30 天滚动窗口的毫秒级边界断言（恰好30天 vs 30天+1ms）。
  - [x] 3.2.3 补充新增违规打破已有“豁免 (Waivers)”的回归测试。
  - [x] 3.2.4 补充 `metric: 'duration'` 和 `target_equipment_id` 的维度测试。
- [x] 3.3 预约测试基建与边界增强 (Reservation Service 增强)：
  - [x] 3.3.1 提取 `createReservationData` 等 fixtures，减少重复，合成冲突断言。
  - [x] 3.3.2 补充所有真正的边界测试（首尾相接 `A.end === B.start`、恰好跨 0 点、最小/最大时长边缘）。
  - [x] 3.3.3 补充 pending 状态的真实查库断言，确保数据不仅返回 pending 且已持久化。
- [x] 3.4 补齐预约状态机生命周期测试 (Reservation Service Lifecycle)：
  - [x] 3.4.1 补充 `checkin` 的测试（签到时间窗限制）。
  - [x] 3.4.2 补充 `checkout` 的测试（计费与超时处罚判定）。
  - [x] 3.4.3 补充 `cancel` 的测试（迟到/临时取消的处罚逻辑）。
  - [x] 3.4.4 补充 `update`，`adminUpdate` 及 `adminDelete` 的测试与通知触发断言。
- [ ] 3.5 覆盖率报告：运行 `npm run test:coverage`，对比阶段 0 基线，确认覆盖率未下降。

## 阶段 4：接口一致性与类型安全 (P2 & P3)

- [ ] 4.1 统一路由导出风格：遍历 modules/*/routes.ts，统一改为 `export { xxxRouter, xxxAdminRouter }` 命名导出风格。
- [ ] 4.2 统一路由挂载方式：重构 server.ts 中的路由挂载，统一采用集中管理路径前缀的方式。对于路径前缀不统一的模块（如 violation 有 /api/public/、/api/user/、/api/admin/、/api/violations/ 四个前缀），在模块内部保留路径前缀以保证 API 兼容，仅统一导出风格。
- [ ] 4.3 消除类型盲区 (violation)：消除 violation 各文件中的 as any，为 DB 查询结果定义 TypeScript 接口。
- [ ] 4.4 消除类型盲区 (reservation)：消除 reservation 各文件中的 as any，补全 DB 返回结果的类型定义。
