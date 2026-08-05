# 临近预约结束时间提醒 (Booking Ending Reminder) 规格说明书

## 1. 业务需求
为了提醒用户及时完成实验并下机，系统需要增加“预约即将结束”的自动提醒功能。管理员可以配置在预约结束前多少分钟发送该提醒，并且可以自定义邮件/Webhook的模板。

## 2. API 与配置变更
- **新增配置项**：`booking_ending_advance_minutes`（默认值为 `15`，表示提前15分钟提醒）。
- **新增事件类型**：`booking_ending`（对应 `email.events.booking_ending.enabled` 和 `webhook.events.booking_ending.enabled` 等配置）。

## 3. 核心逻辑
- **后端定时扫描**：
  - 每 5 分钟执行一次扫描。
  - 检查系统中状态为 `approved` 且当前时间距离其 `end_time` 满足提前提醒条件（`diffMins > 0 && diffMins <= advanceMins`）的预约。
  - **幂等性**：向 `notifications` 表中查询 `event = 'booking_ending'` 且 `reference_code` 等于 `booking_code` 的记录，确保单次预约只发送一次结束提醒。
- **消息下发**：
  - 触发 `notifyEvent(db, 'booking_ending', payload, email)`。
  - Payload 中携带 `student_id`, `equipment_name`, `booking_code`, `start_time`, `end_time`, `advance_minutes` 等变量。

## 4. UI 与交互设计
- **设置面板**：在“通知与邮件设置”页面的底部（全局配置区），将“上机前自动提醒时间”与“下机前自动提醒时间”放在一起展示和设置。
- **通知事件列表**：增加 `booking_ending` 事件，支持开关配置以及邮件/Webhook模板编辑。
- **模板文案**：系统默认文案为“您预约的仪器【{{ equipment_name }}】使用时间即将在{{ end_time }}结束，请及时下机。”

## 5. 边缘情况
- **超短预约**：如果预约总时长小于提醒提前量（例如预约 10 分钟，但提前 15 分钟提醒），定时任务应该在预约开始后或达到阈值时触发。为简化逻辑，基于 `end_time` 倒推，只要进入距离结束的 `advanceMins` 窗口内且未发送过，即发送。
- **过期预约**：仅扫描距离当前时间较近的预约（如 `end_time` 在过去 24 小时以内），避免对历史陈旧预约发送提醒。
