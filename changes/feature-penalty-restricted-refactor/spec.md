# 惩罚规则 RESTRICTED 字段改造方案

## 🎯 目标描述 (Goal Description)

解决管理员在“受限名单”页面中无法区分具体惩罚动作（如“费用加倍”和“减少预约天数”均显示为 RESTRICTED）以及相关筛选器失效的问题。

### 🐞 问题的根因 (Root Cause)
系统在设计时，将 `user_penalties.penalty_method` 字段混用了两个概念：
1. **具体动作 (Action Type)**: `ban`, `require_approval`, `double_fee`, `reduce_advance_days`
2. **访问控制等级 (Access Level)**: `BAN`（完全封禁）, `REQUIRE_APPROVAL`（需审批）, `RESTRICTED`（部分受限）

在惩罚触发时（`evaluatePenaltiesOnViolation`），原本具体的 `double_fee` 等动作被强制转换为更高维度的 `RESTRICTED` 存入了数据库。这导致：
- 数据库丢失了惩罚的具体类型信息。
- 前端受限名单 UI 只能拿到 `RESTRICTED`，导致 `getPenaltyMethodLabel` 匹配失败，并使针对“费用加倍”等选项的筛选器彻底变成死代码。

## ⚠️ 需用户确认的事项 (User Review Required)

> [!WARNING]
> **强依赖数据迁移**
> 由于我们在后端代码中移除了对旧大写存量数据（如 `BAN`, `RESTRICTED`）的兼容逻辑，**代码上线前必须严格执行一次性迁移脚本**，否则会导致用户的现有受限状态失效。

> [!IMPORTANT]
> **API 返回字段契约**
> 我们不会改变 `/api/bookings` 等预约接口用于拦截的 `penaltyMethod` 字段的含义（依然保持为 `BAN`/`REQUIRE_APPROVAL`/`RESTRICTED` 聚合态），这使得前端预约拦截逻辑无需任何改动。修改仅针对**明细数据**和**数据库存储**。

## 🛠️ 详细修改点 (Proposed Changes)

### 1. 数据库存储层改造 (`server.ts`)
- **[MODIFY] server.ts**
  修改 `evaluatePenaltiesOnViolation` :
  不再将 `double_fee` / `reduce_advance_days` 强转为 `RESTRICTED`，不再将 `ban` 强转为大写。**直接将原始的 `action.type` 存入数据库**。

### 2. 状态聚合计算层改造 (`server.ts`)
- **[MODIFY] server.ts**
  修改 `checkUserPenalty` 核心聚合逻辑。
  为了计算用户的最终**访问控制等级**（供核心预约流拦截使用），我们将对从数据库读出的 `p.penalty_method` 进行精简判断：
  - 如果是 `ban` 或 `BAN` $\rightarrow$ 聚合状态设为 `BAN`
  - 如果是 `require_approval` 或 `REQUIRE_APPROVAL` $\rightarrow$ 聚合状态设为 `REQUIRE_APPROVAL`
  - 如果是 `double_fee` 或 `reduce_advance_days` 或 `RESTRICTED` $\rightarrow$ 聚合状态设为 `RESTRICTED`

  此外，在组装 `triggeredRulesDetails`（被触发的规则明细）时，保留传入原本的具体 `action.type`，让前端查询违规时能看到准确类型。

### 3. 受限名单 API 改造 (`server.ts`)
- **[MODIFY] server.ts**
  修改 `GET /api/admin/penalties/active` 。
  计算出的动态惩罚列表时，直接将 `penalty_method` 赋值为 `action.type`，取消原来的三元表达式强转。

### 4. 数据平滑清洗逻辑 (一次性迁移脚本)
- **[NEW] scripts/migrate_penalties.ts**
  编写一个独立的一次性数据清洗脚本：
  读取 `user_penalties` 表中 `penalty_method` 为大写字母（如 `RESTRICTED`, `BAN` 等）的老记录，根据其 `restrictions` JSON 字段的特征（例如，若包含 `multiplier` 则判定为 `double_fee`；若包含 `reduce_days` 则判定为 `reduce_advance_days`），将其 `UPDATE` 洗为对应的小写具体动作。迁移完成后，该脚本不会在业务运行期间产生额外开销。
