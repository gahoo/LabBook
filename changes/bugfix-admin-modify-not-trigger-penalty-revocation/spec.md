# 变更规格说明：管理员修改预约时间时未触发关联处罚撤销的问题

## 问题描述
在后台管理员编辑预约记录的实际开始/结束时间时（`app.put('/api/admin/reports/reservations/:id')`）：
1. 如果编辑后的实际时间符合正常范围（例如原本超时的记录修改为未超时），系统会自动将该预约关联的违规记录状态修改为 `revoked`（备注为 `Administratively revoked`）。
2. **代码漏洞**：此处的路由处理器在更新违规记录状态为 `revoked` 后，未更新 `user_penalties` 表中对应处罚记录的状态。这导致虽然用户的违规记录已被系统撤销，但由于其产生的处罚仍在 `user_penalties` 表中处于 `active` 状态，因而计费逻辑或限制逻辑依然对用户应用了处罚。

## 解决方案
修改 `server.ts` 中的 `app.put('/api/admin/reports/reservations/:id')` 路由：
1. 在路由处理逻辑开始时，声明一个 `const revokedViolationIds: number[] = [];` 数组。
2. 在处理 `no-show`、`late`、`overdue` 以及移除手动违规记录（`manual_violations`）时，如果将违规记录的状态更新为了 `revoked`，则将其 ID 存入 `revokedViolationIds` 数组。
3. 在保存完预约数据之后，调用 `evaluatePenaltiesOnViolation` 之前，检查 `revokedViolationIds`：
   如果 `revokedViolationIds.length > 0`，则查询该用户当前所有的活跃处罚记录（`status = 'active'`）。
   如果某个活跃处罚记录的 `contributing_violation_ids` 中包含了被撤销的违规 ID，则将该处罚记录的状态更新为 `revoked`，并添加备注 `Administratively revoked`。

## 影响范围
- 后端 API: `PUT /api/admin/reports/reservations/:id`
- 数据库表: `user_penalties`
