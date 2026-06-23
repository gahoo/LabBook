# 任务拆解：预约并发竞态条件加固

- [ ] 1. **重构预约创建流程**：在 `/api/reservations` 中，把原本独立的 `SELECT` 冲突判断和 `INSERT` 逻辑组合为 `db.transaction` 包裹的内部函数。外部采用 try-catch 进行错误处理并响应客户。
- [ ] 2. **重构预约更新流程**：在 `/api/reservations/update` 同样使用 `db.transaction` 将查询自身约束、查询冲突和 `UPDATE` 等过程包含在一个事务中，失败即从内部抛出回滚。
- [ ] 3. **编译与验证归档**：进行 `tsc --noEmit` 或全局构建检查，确保无语法与上下文变量泄露，在确认重构无误后更新状态至 TOC 目录。
