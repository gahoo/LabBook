# 任务拆解：哨兵逗号查询优化

- [x] 1. **精简撤销违规记录时的 LIKE 匹配条件**：在 `server.ts` 中的 `PUT /api/admin/violation-records/:id/:action` 路由里，将 `UPDATE user_penalties` 语句中关于 `contributing_violation_ids` 的 4 个 `OR` 条件简化为单一的 `contributing_violation_ids LIKE ?`，绑定参数为 `%,${id},%`。
- [x] 2. **编译与验证**：执行 `npx tsc --noEmit` 确保无语法或类型错误，并在 TOC 中更新状态。
