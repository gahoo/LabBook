# 任务列表：管理员手动修改时间不触发违规及统计错误的修复

- [x] 1. 移除 `PUT /api/admin/reports/reservations/:id` 中遗留的硬编码计费逻辑（30分钟宽限期及费用强制翻倍）。
- [x] 2. 引入违规判定逻辑 (Late & Overdue)，读取系统宽限期，并动态插入或更新违规记录。
- [x] 3. 处理“爽约 (No-Show)”状态的撤销，当管理员补填上机时间且原状态为 cancelled 时，将主表状态更新为 completed/active，并撤销 no-show 违规记录。
- [x] 4. 在违规状态发生变化时，调用 `evaluatePenaltiesOnViolation(student_id)` 触发规则引擎。
- [x] 5. 完善逻辑：如果管理员修改的时间使得原本迟到/超时的记录不再迟到/超时，则自动撤销（置为 invalid）对应的违规记录。
