# 任务拆解与进度清单: 惩罚规则 RESTRICTED 字段改造

- [x] **[存储层改造]** 修改 `server.ts` 中的 `evaluatePenaltiesOnViolation` 方法，直接将 `action.type` 存入 `user_penalties` 表的 `penalty_method`，不转大写和聚合。
- [x] **[聚合状态计算改造]** 修改 `server.ts` 中 `checkUserPenalty` 逻辑：根据从数据库读出的 `penalty_method`，映射为 `BAN` / `REQUIRE_APPROVAL` / `RESTRICTED` 以供核心预约流拦截使用，同时将真实的 `action.type` 组装进 `triggeredRulesDetails` 给前端明细使用。
- [x] **[受限名单API改造]** 修改 `server.ts` 中的 `GET /api/admin/penalties/active` API 组装动态惩罚的部分：不再对动态返回的 `action.type` 做聚合强转。
- [x] **[数据清洗脚本]** 新建并执行 `/scripts/migrate_penalties.ts`，修复大写的遗留数据，通过解析 `restrictions` 的 JSON 将 `RESTRICTED` 洗为 `double_fee` 或 `reduce_advance_days` (修正了使用 `multiplier` 而非 `fee_multiplier`)。
