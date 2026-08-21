# 规格说明书 (Refactor Post-Evaluation)

## 1. 背景与目标

前期的 `server.ts` 单体文件重构成功将其瘦身，并按业务领域垂直拆分了 11 个子模块，同时建立了基础的自动化测试体系。然而在重构质量深度评估中，暴露出一些“形似神不似”的遗留问题，主要集中在 `violation` 模块的物理搬运（未提取 Service 层）、路由定义与挂载的不一致，以及类型安全（`as any` 泛滥）的缺失。

本项目的目标是**清理重构遗留的技术债务**，提升系统的类型安全、内聚度，以及可维护性，将架构质量推进到真正的生产可用标准。

## 2. 核心优化项

### 2.1 核心分层治理 (P0)
- **`violation` 模块彻底解耦**：当前 `violation/routes.ts` 达 1011 行，包含超过 50 处 `db.prepare` 的直接调用和大量业务计算逻辑。目标是将其所有直接的数据库查询、聚合逻辑、违规判定算法全部下沉。为避免产出新的巨型 Service 文件，需按子域拆分：
  - `violation/service.ts`：保留核心惩罚引擎逻辑（如 `checkUserPenalty`、`evaluatePenaltiesOnViolation`）。
  - `violation/repository.ts`：集中所有 `db.prepare` 数据库操作（规则 CRUD、记录查询、状态更新等）。
  - `violation/stats.ts`：统计聚合逻辑（统计查询与模拟报表等纯计算）。
  
### 2.2 测试基线加固 (P1)
- 在分层刚完成后，趁热打铁进行测试加固。当前 135 个测试全部为通过 `supertest` 发起的 HTTP 集成测试，虽然流程覆盖率高，但对深层业务逻辑粒度较粗。
- 需要为高复杂度的纯业务核心（如预约冲突校验 `ReservationService.create`，违规计分与处罚生成 `evaluatePenaltiesOnViolation`、`checkUserPenalty`）补充直接调用 Service 层的纯逻辑测试（使用内存 DB）。

### 2.3 接口一致性与类型安全 (P2 & P3)
- **统一路由导出与挂载**：当前各模块的路由导出混合使用了默认导出（`export default router`）和命名导出（`export { xxxRouter }`），导致 `server.ts` 中的导入和挂载缺乏一致性。所有模块必须统一使用命名导出，且挂载路径的前缀应在 `server.ts` 中集中声明。
- **清除 `as any`**：`violation` 和 `reservation` 中大量使用了 `as any` 来应对 SQLite 的原生查询结果。需要为这部分结果（尤其是关联查询、统计报表查询结果）建立标准的 TypeScript Interface。

## 3. 设计决策 (Design Decisions)
- **渐进式重构与双重保障**：采用单步执行（修改 -> 编译 -> 跑测试）的迭代策略。基于已有的 135 个 HTTP 集成测试用例，我们修改底层逻辑时，可以直接利用这些测试作为安全网，确保重构不破坏原有业务逻辑。
- **类型定义隔离**：为数据库聚合查询创建的特定 Type/Interface 将优先定义在各自模块内部（如 Service 文件的顶部），不对全局 `src/types.ts` 造成污染，除非它是跨模块强依赖的数据结构。
- **路由侧禁止跨模块调用**：Routes 层禁止直接调用跨模块 Service（例如 `violation/routes.ts` 中直接调用 `notifyEvent`）。所有副作用和外部模块调用均由本模块的 Service 层承担。
- **路由瘦身原则**：路由文件 (`routes.ts`) 禁止出现任何直接操作数据库（如 `db.prepare`）或处理领域核心算法的代码。原则上单文件不应过大，对于端点超过 15 个的模块（如 `violation`），应拆分为 `routes/public.ts` 和 `routes/admin.ts` 等多个文件，或适当放宽行数上限。
