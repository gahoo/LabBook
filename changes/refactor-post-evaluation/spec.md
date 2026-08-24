# 规格说明书 (Refactor Post-Evaluation)

## 1. 背景与目标

前期的 `server.ts` 单体文件重构成功将其瘦身，并按业务领域垂直拆分了 11 个子模块，同时建立了基础的自动化测试体系。然而在重构质量深度评估中，暴露出一些“形似神不似”的遗留问题，主要集中在 `violation` 模块的物理搬运（未提取 Service 层）、路由定义与挂载的不一致，以及类型安全（`as any` 泛滥）的缺失。

本项目的目标是**清理重构遗留的技术债务**，提升系统的类型安全、内聚度，以及可维护性，将架构质量推进到真正的生产可用标准。

## 2. 核心优化项

### 2.1 核心分层治理 (P0)
- **`violation` 模块彻底解耦**：当前 `violation/routes.ts` 达 1011 行，包含超过 50 处 `db.prepare` 的直接调用和大量业务计算逻辑。目标是将其所有直接的数据库查询、聚合逻辑、违规判定算法全部下沉。为避免产出新的巨型 Service 文件，按子域拆分为以下文件（不引入 repository 层，SQL 与业务逻辑保持同文件，与项目其他模块惯例一致）：
  - `violation/service.ts`：违规记录管理（create, update, revoke, restore, appeal, query 等状态机操作，约 300 行）。
  - `violation/evaluator.ts`：惩罚评估引擎（`checkUserPenalty`、`evaluatePenaltiesOnViolation`，约 470 行）。这是被 `reservation` 跨模块调用的核心算法，独立文件便于追踪依赖。时间周期工具函数（`getNaturalPeriodStart`、`getNextNaturalPeriodStart`）作为该文件的私有函数保留，不移到 `lib/`，避免引入不必要的跨层依赖。
  - `violation/rules.ts`：规则管理（CRUD + `simulateRule` + `formatRuleName`，约 200 行）。
  - `violation/penalty.ts`：处罚执行（`batchPenalties`、`waivePenalty`、`getActivePenalties`，约 250 行写操作）。
  - `violation/stats.ts`：统计报表（`getViolationStats`、`getViolationParams`，约 180 行只读聚合）。

- **`reservation` 模块拆分**：当前 `reservation/service.ts` 954 行，按子域拆分：
  - `reservation/service.ts`：核心预约操作（create, cancel, update, checkin, checkout, adminUpdate, adminDelete, getBatch，约 550 行）。
  - `reservation/validation.ts`：共享校验与冲突检测逻辑（约 250 行）。从 `service.ts` 中提取 `create` 和 `update` 共享的校验流程（参数校验、惩罚检查、时长限制、运营时间、冲突检测），消除两者之间约 80 行的重复代码。同时将 `lib/validators.ts` 中仅被 reservation 调用的 `validateOperatingHours` 和 `calculatePeakAccumulatedMinutes` 迁回此文件。`lib/validators.ts` 仅保留跨模块通用的 `validateTimeRange`。
  - `reservation/stats.ts`：查询与报表（`getAdminList`、`getStats`、`calculateReportStatus`、`getViolationSettings`，约 200 行只读聚合与计算）。
  
### 2.2 测试基线加固 (P1)
- 在分层刚完成后，趁热打铁进行测试加固。当前 135 个测试全部为通过 `supertest` 发起的 HTTP 集成测试，虽然流程覆盖率高，但对深层业务逻辑粒度较粗。
- 需要为高复杂度的纯业务核心（如预约冲突校验 `ReservationService.create`，违规计分与处罚生成 `evaluatePenaltiesOnViolation`、`checkUserPenalty`）补充直接调用 Service 层的纯逻辑测试（使用内存 DB）。
  - **Reservation 测试重点覆盖 7 大边界场景**：
    1. **时限硬约束**：单次超限 (`> maxDurationMinutes`) 与单日累计超限 (`> dailyMaxDurationMinutes`) 的拒绝逻辑。
    2. **峰谷（忙闲时）分离逻辑**：忙时超限被拒、开启 `allowExceed` 时忙时/闲时超额转 `pending`。
    3. **前置白名单防线**：`whitelist_enabled = true` 且用户不在名单中的拦截。
    4. **提前预约期限制 (Advance Days)**：预约时间超过允许的提前天数时的硬拦截。
    5. **惩罚系统联动**：用户有 `BAN` 状态硬拦截、有 `REQUIRE_APPROVAL` 降级为 `pending`、有 `reduce_days` 惩罚时导致其提前预约天数缩水。
    6. **爽约槽位抢占释放 (No-Show Release)**：开启 `release_noshow_slots` 时，超 30 分钟未签到槽位允许并发抢占覆盖。
    7. **异常与隐藏拦截**：隐藏设备 (`is_hidden = true`) 拦截，异常 JSON 配置的降级安全保护。
  - **Violation 测试重点覆盖 6 大边界场景**：
    1. **惩罚类型转化效果（Penalty Type Effects）**：验证不同的 `action_config`（`ban`, `require_approval`, `reduce_advance_days`, `double_fee`）能否被正确解析并输出对应的状态标识及限制参数。
    2. **阈值触发与累积（Metric & Threshold）**：精确边界触发（如2次不罚3次罚），以及基于订单去重统计（`by_reservation`）的准确性。
    3. **时间窗口隔离（Time Windows）**：自然周期（如跨月不合并）与滚动窗口（如近30天内掉出）的边界隔离与合并逻辑。
    4. **撤销、豁免与降级恢复（Revocation, Waivers & Recovery）**：单条违规 `revoked` 后的实时降级、针对特定违规组合记录的 `penalty_waivers` 免疫跳过、以及固化惩罚过期自动恢复。
    5. **规则叠加与合并（Restrictions Merge）**：状态就高原则叠加（REQUIRE_APPROVAL + BAN = BAN），参数化限制合并（叠加扣费翻倍与提前期缩减）。
    6. **解封时间预测（Unban Time Prediction）**：基于违规记录掉出窗口的时间点，精确预测自动解封时间。

### 2.3 接口一致性与类型安全 (P2 & P3)
- **统一路由导出与挂载**：当前各模块的路由导出混合使用了默认导出（`export default router`）和命名导出（`export { xxxRouter }`），导致 `server.ts` 中的导入和挂载缺乏一致性。所有模块必须统一使用命名导出，且挂载路径的前缀应在 `server.ts` 中集中声明。
- **清除 `as any`**：`violation` 和 `reservation` 中大量使用了 `as any` 来应对 SQLite 的原生查询结果。需要为这部分结果（尤其是关联查询、统计报表查询结果）建立标准的 TypeScript Interface。

## 3. 设计决策 (Design Decisions)
- **渐进式重构与双重保障**：采用单步执行（修改 -> 编译 -> 跑测试）的迭代策略。基于已有的 135 个 HTTP 集成测试用例，我们修改底层逻辑时，可以直接利用这些测试作为安全网，确保重构不破坏原有业务逻辑。
- **类型定义隔离**：为数据库聚合查询创建的特定 Type/Interface 将优先定义在各自模块内部（如 Service 文件的顶部），不对全局 `src/types.ts` 造成污染，除非它是跨模块强依赖的数据结构。
- **路由侧禁止跨模块调用**：Routes 层禁止直接调用跨模块 Service（例如 `violation/routes.ts` 中直接调用 `notifyEvent`）。所有副作用和外部模块调用均由本模块的 Service 层承担。
- **路由瘦身原则**：路由文件 (`routes.ts`) 禁止出现任何直接操作数据库（如 `db.prepare`）或处理领域核心算法的代码。原则上单文件不应过大，对于端点超过 15 个的模块（如 `violation`），应拆分为 `routes/public.ts` 和 `routes/admin.ts` 等多个文件，或适当放宽行数上限。
- **按子域拆分，不按角色拆分**：文件按操作的数据/职责本质划分（如 `evaluator`、`rules`、`penalty`、`stats`），不按"用户侧/管理侧"划分。权限控制是 routes 层的职责。文件名使用名词，描述它管理的"东西"。
- **Service 体积管控**：`violation/service.ts` 合并后约 300 行，`reservation/service.ts` 约 550 行，均在合理范围。若单文件后续超过 800 行应进一步拆分。
