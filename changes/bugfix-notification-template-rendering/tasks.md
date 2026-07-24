# 任务清单

- [x] 1. **预约取消 (`booking_cancelled`)**：修改 `server.ts` 中 `POST /api/reservations/cancel` 接口的 SQL 查询，使用 LEFT JOIN 获取 `equipment.name`，并在 `notifyEvent` Payload 中补充 `equipment_name`。
- [x] 2. **独立录入违规 (`violation_created`)**：修改 `server.ts` 中 `POST /api/admin/violations` 接口，对于存在 `booking_code` 的记录去关联查出设备名，没有则补齐 `'无关联设备'`，在 `notifyEvent` 中提供 `equipment_name` 字段。
- [x] 3. **处罚触发 (`penalty_triggered`)**：修改 `server.ts` 中 `evaluatePenaltiesOnViolation` 逻辑，在派发事件的 Payload 字典中增加 `reason: '违反规则：' + rule.name` 字段。
- [x] 4. **上机前提醒 (`booking_upcoming`)**：修改 `server.ts` 中 `startUpcomingReminderCron` 定时器扫描逻辑，在 `notifyEvent` Payload 字典中增加 `advance_minutes: advanceMins` 字段。
- [x] 5. **验证**：执行 `npm run build` 和 Linter 检查通过，结束并向用户汇总说明。
