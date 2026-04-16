# 管理员手动修改时间不触发违规及统计错误的修复方案

## 1. 问题确认与现状分析

经过对后端代码（`PUT /api/admin/reports/reservations/:id`）的核查，您提到的两个问题**确实存在**，且属于比较严重的逻辑漏洞。

### 问题一：超时统计与费用计算存在“硬编码”和“双重标准”
在管理员手动修改记录的接口中，有一段遗留的旧代码：
```typescript
const overtimeThreshold = 30 * 60 * 1000; // 错误1：硬编码了30分钟，没有读取系统设置的宽限期
const scheduledEnd = new Date(oldRes.end_time);
if (end.getTime() > scheduledEnd.getTime() + overtimeThreshold) {
  total_cost *= 2; // 错误2：硬编码了费用翻倍惩罚
}
```
**分析**：
1. 它没有读取系统设置中的 `violation_overtime_grace_minutes`，而是写死了 30 分钟。
2. 它直接把 `total_cost` 乘以了 2。而在用户自己正常下机的接口（`/api/reservations/checkout`）中，这个硬编码的翻倍逻辑早就被移除了，因为现在的惩罚（包括费用翻倍）应该交由**动态规则引擎（Penalty Rules）**来统一处理。这导致了管理员修改和用户自己下机的计费标准不一致。

### 问题二：完全没有触发违规记录和惩罚引擎
当管理员手动保存实际上机/下机时间时，系统仅仅执行了 `UPDATE reservations` 更新了主表的时间和状态，并写了一条审计日志。
**它完全没有做以下事情：**
1. 没有判断新的上机时间是否迟到。
2. 没有判断新的下机时间是否超时，也没有计算超时的具体时长（`duration_minutes`）。
3. **最致命的是**：没有向 `violation_records` 表插入任何违规记录，也没有调用 `evaluatePenaltiesOnViolation(student_id)` 触发规则引擎。
**后果**：如果用户忘记下机（或者迟到），只要让管理员帮忙手动补上时间，该用户就能完美逃避所有的违规记录和阶梯惩罚。

---

## 2. 修复方案设计

为了彻底解决上述问题，需要对 `server.ts` 中的 `PUT /api/admin/reports/reservations/:id` 接口进行重构。

### 步骤一：移除遗留的硬编码计费逻辑
*   删除 `overtimeThreshold = 30 * 60 * 1000` 和 `total_cost *= 2` 的代码。
*   管理员修改时间后的基础费用，只根据“实际使用时长（或按次） + 耗材费”进行计算。惩罚性的费用增加应由规则引擎后续处理。

### 步骤二：引入违规判定逻辑 (Late & Overdue)
在更新完 `reservations` 表之后，追加违规判定逻辑：
1.  **读取系统宽限期**：从 `settings` 表读取 `violation_late_grace_minutes` 和 `violation_overtime_grace_minutes`。
2.  **判定迟到 (Late)**：
    *   如果传入了 `actual_start_time`，计算与 `start_time` 的差值。
    *   如果差值大于迟到宽限期，检查 `violation_records` 表中是否已经存在该预约的 `late` 记录。
    *   如果不存在，则 `INSERT` 一条 `late` 违规记录，并计算迟到时长。
3.  **判定超时 (Overdue)**：
    *   如果传入了 `actual_end_time`，计算与 `end_time` 的差值。
    *   如果差值大于超时宽限期，检查 `violation_records` 表中是否已经存在该预约的 `overdue` 记录。
    *   如果不存在，则 `INSERT` 一条 `overdue` 违规记录，并精确计算 `duration_minutes`（超时分钟数）。

### 步骤三：处理“爽约 (No-Show)”状态的撤销（关联修复）
正如您之前提到的场景，如果这条记录原本因为没上机被系统判定为 `cancelled` 和 `no-show`，现在管理员补填了上机时间：
*   不仅要将主表状态更新为 `completed`。
*   还需要将 `violation_records` 表中该预约对应的 `no-show` 记录的状态更新为 `invalid` 或直接删除，以撤销错误的爽约惩罚。

### 步骤四：触发规则引擎
在完成上述所有的违规记录插入或修改后，检查是否有任何违规状态发生变化。如果有，调用 `evaluatePenaltiesOnViolation(student_id)`，让规则引擎重新评估该用户是否需要被封号或执行其他惩罚。
