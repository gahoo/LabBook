# 任务列表：组合触发条件 (features-combo-trigger)

- [x] 1. 后端 `server.ts`：修改 `evaluatePenaltiesOnViolation`，支持解析 `violation_types` 数组，兼容旧的 `violation_type`。
- [x] 2. 后端 `server.ts`：修改 SQL 查询，使用 `IN (?, ?, ...)` 来匹配多个违规类型。
- [x] 3. 后端 `server.ts`：实现 `count_strategy`，支持 `by_record`（按记录数）和 `by_reservation`（按预约去重）两种统计策略。
- [x] 4. 前端 `ViolationsAndPenaltiesTab.tsx`：将违规类型选择器改为多选（Checkbox 组）。
- [x] 5. 前端 `ViolationsAndPenaltiesTab.tsx`：当勾选多个违规类型时，显示统计策略选择器（合并计算或分别计算）。
- [x] 6. 前端 `ViolationsAndPenaltiesTab.tsx`：动态更新阈值设定的文案提示。
- [x] 7. 前端 `PenaltyRulesTab.tsx`：将违规类型选择器 UI 改造为 `MultiSelectCombobox` 样式。
