# Reservation 模块重构与极限测试规范 (Specification)

## 1. 目标与背景
Reservation（预约模块）是系统中最核心、状态流转最复杂的部分。为了在物理剥离代码时不引入任何回归问题，必须遵循严格的 TDD（测试驱动开发）流程。在修改业务代码前，先建立一张致密的“安全网”，即覆盖全生命周期的 API 测试。

## 2. 测试策略：六大维度极限测试网
根据 `server.ts` 中的真实代码分支，我们需要覆盖以下 6 大类边界与业务规则。

### 一、基础参数与边界校验 (`POST /api/reservations`)
- **必填项与格式**：空值、非字符串、字符溢出 (`student_name`/`email` > 100/200)、`equipment_id` 非整数的 400 拦截。
- **硬编码强拦截**：导师包含“教授/老师”时的拦截；邮箱后缀白名单拦截。
- **时间极性边界**：`start_time` 格式错误、早于当前时间、`end_time <= start_time` 的拦截。

### 二、设备规则与惩罚降级引擎 (核心深水区)
- **时长下限**：`< minDurationMinutes` 拦截。
- **双轨制时长上限限制**：单日累计超额（`dailyMaxDuration`）拦截，闲时超长/忙时占用超长的拦截逻辑。
- **惩罚动态降级 (`Penalty`)**：
  - `REQUIRE_APPROVAL` 处罚：强制将 `auto_approve=true` 预约降级为 `pending`。
  - `reduce_days` 处罚：基于 `min_retain_days`，动态拦截超出可提前天数范围的预约。
- **营业时间 (`Operating Hours`)**：允许非营业时间预约时 (`allowOutOfHours`)，状态强制为 `pending`。

### 三、并发防重与豁免抢占 (冲突检测)
- **3 种冲突类型**：完全重叠、头尾交叠、跨越包围的 400 拦截。
- **状态豁免**：冲突订单状态为 `cancelled` 或 `rejected` 时，允许预约。
- **爽约抢占 (`release_noshow_slots`)**：冲突订单为 `approved` 且 `actual_start_time = null`，当前时间超过 `start_time` 30分钟时，允许抢占坑位。

### 四、预约查询与批量获取
- **单条查询 (`/:code`)**：200 (附带设备等联表信息) 和 404。
- **批量查询 (`/batch`)**：正常查询与超过 200 个 codes 的 400 拦截。

### 五、状态机与违规记录 (Update / Cancel / Checkin / Checkout)
- **修改次数锁**：`modified_count >= 1` 时调用 update 遭 400 拦截。
- **晚取消触发违规**：在晚取消惩罚宽限期内 cancel，订单变 `cancelled` 并在 `violation_records` 插入 `late_cancel`。
- **操作死线硬锁**：时间超过 `start_time + maxLateMinutes` 时，彻底禁止 cancel 和 update。
- **状态流转**：`approved` -> 签到 -> `active` -> 签退 -> `completed`，及越级操作拦截。

### 六、管理员后门与聚合统计
- **权限边界**：管理员接口的 `401/403` 拦截。
- **强制修改/物理删除**：`PUT` 豁免前端规则，`DELETE` 物理删表。
- **聚合统计 (`/stats`)**：验证返回的 `total_hours`、`machine_hours` 的正确性。

## 3. 实施约束
- **严禁修改业务代码**：本阶段唯一目标是编写 `tests/03_reservations.test.ts`。
- **数据隔离**：必须利用 `beforeEach` 在每次 `it` 前清理相关表并初始化独立的测试设备/设置。
