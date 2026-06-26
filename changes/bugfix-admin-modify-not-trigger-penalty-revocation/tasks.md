# 任务清单

- [x] 在 `server.ts` 中的 `PUT /api/admin/reports/reservations/:id` 路由开头声明 `revokedViolationIds` 数组。
- [x] 在该路由中，在撤销违规的地方（`no-show`, `late`, `overdue`, 手动违规），收集对应的被撤销的 violation id 存入 `revokedViolationIds`。
- [x] 在更新预约之后，调用 `evaluatePenaltiesOnViolation` 之前，添加查询和撤销关联 `user_penalties` 的逻辑。
- [x] 验证 TypeScript 编译是否通过（`npm run lint` 和 `npm run build`）。
