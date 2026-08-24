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

## 阶段 3：测试深度提升 (P1)

- [x] 3.1 补充 Service 层测试 (Reservation)：创建测试文件，使用 tests/setup.ts 的内存 DB 基础设施，绕过 HTTP 层直接调用 ReservationService.create，测试校验逻辑和冲突检测的边界情况。
  - [x] 基础流程（已完成）：创建成功、冲突检测、非自动审批降级、基础输入校验、非工作时间预定。
  - [x] 3.1.1 补充：时限硬约束（单次超限、单日累计超限）
  - [x] 3.1.2 补充：峰谷分离逻辑（忙时超限、allowExceed 闲忙时超额转 pending）
  - [x] 3.1.3 补充：前置白名单防线拦截
  - [x] 3.1.4 补充：提前预约期限制 (Advance Days) 拦截
  - [x] 3.1.5 补充：惩罚系统联动（BAN、REQUIRE_APPROVAL、reduce_days 天数缩水）
  - [x] 3.1.6 补充：爽约槽位抢占释放 (No-Show Release) 允许覆盖
  - [x] 3.1.7 补充：异常与隐藏拦截（设备隐藏、非法 JSON 降级）
- [ ] 3.2 补充 Service 层测试 (Violation)：直接调用 violation/evaluator.ts 中的 checkUserPenalty 和 evaluatePenaltiesOnViolation，测试多规则组合、窗口期边界、豁免判定等场景。
  - [ ] 3.2.1 补充：惩罚类型转化效果（ban, require_approval, reduce_advance_days, double_fee 的基础解析转化）
  - [ ] 3.2.2 补充：阈值触发与累积（边界触发、订单去重统计）
  - [ ] 3.2.3 补充：时间窗口隔离（自然周期跨月隔离、滚动天数掉出窗口）
  - [ ] 3.2.4 补充：撤销、豁免与降级恢复（单条撤销、组合豁免 waivers、固化惩罚过期）
  - [ ] 3.2.5 补充：规则叠加与合并（就高原则 BAN、多重参数化限制叠加）
  - [ ] 3.2.6 补充：解封时间预测（精准计算规则过期的时间点）
- [ ] 3.3 覆盖率报告：运行 `npm run test:coverage`，对比阶段 0 基线，确认覆盖率未下降。

## 阶段 4：接口一致性与类型安全 (P2 & P3)

- [ ] 4.1 统一路由导出风格：遍历 modules/*/routes.ts，统一改为 `export { xxxRouter, xxxAdminRouter }` 命名导出风格。
- [ ] 4.2 统一路由挂载方式：重构 server.ts 中的路由挂载，统一采用集中管理路径前缀的方式。对于路径前缀不统一的模块（如 violation 有 /api/public/、/api/user/、/api/admin/、/api/violations/ 四个前缀），在模块内部保留路径前缀以保证 API 兼容，仅统一导出风格。
- [ ] 4.3 消除类型盲区 (violation)：消除 violation 各文件中的 as any，为 DB 查询结果定义 TypeScript 接口。
- [ ] 4.4 消除类型盲区 (reservation)：消除 reservation 各文件中的 as any，补全 DB 返回结果的类型定义。
