# 通知模板渲染缺失变量修复方案

## 1. 问题背景
系统内多处在派发邮件/系统通知（`notifyEvent`）时，由于后端传递的 Payload（数据字典）中缺失了对应模板中定义的占位符（如 `{{ equipment_name }}`、`{{ reason }}`、`{{ advance_minutes }}`），导致部分变量被原样输出（未渲染）。

涉及以下四个场景：
1. **预约取消 (`booking_cancelled`)**：缺失 `equipment_name` 变量。
2. **管理员独立录入违规 (`violation_created`)**：缺失 `equipment_name` 变量。
3. **处罚触发 (`penalty_triggered`)**：缺失 `reason` 变量。
4. **上机前提醒 (`booking_upcoming`)**：缺失 `advance_minutes` 变量。

## 2. 根因分析
- **渲染机制限制**：`notificationService.ts` 中的 `renderTemplate` 对于上下文中为 `undefined` 的键值，会直接保留原占位符，不作空字符串替换。
- **参数漏传**：触发事件处未能组织完整的 Payload。
  - `booking_cancelled`：仅查询了 `reservations` 表，未关联查出 `equipment.name`。
  - `violation_created`：独立录入时由于不一定有 `reservation`，未提供默认占位值，或有关联时未查询出关联设备名。
  - `penalty_triggered`：传递了 `rule_name` 但模板中定义为 `reason`。
  - `booking_upcoming`：定时扫描发送时，未将计算所得的提前分钟数放入 Payload 中。

## 3. 修复方案
1. **预约取消 (`POST /api/reservations/cancel`)**：
   将 `SELECT * FROM reservations WHERE booking_code = ?` 修改为 `SELECT r.*, e.name as equipment_name FROM reservations r LEFT JOIN equipment e ON r.equipment_id = e.id ...`。并在 `notifyEvent` 的参数中追加 `equipment_name`。
2. **独立录入违规 (`POST /api/admin/violations`)**：
   若关联了 `booking_code`，从数据库中连表查出 `equipment.name` 作为 `equipment_name`。若无关联，则传递 `'无关联设备'` 作为后备值。
3. **处罚触发 (`evaluatePenaltiesOnViolation`)**：
   在派发 `penalty_triggered` 事件时，在字典中补充 `reason: '违反规则：' + rule.name` 以供 `{{ reason }}` 消费。
4. **上机前提醒 (`startUpcomingReminderCron`)**：
   在 `notifyEvent` Payload 中补充 `advance_minutes: advanceMins`。
