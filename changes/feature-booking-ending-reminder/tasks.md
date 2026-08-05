# 临近预约结束时间提醒 - 任务拆解与进度清单

- [x] 1. **配置与默认模板初始化 (`server.ts`, `src/services/notificationService.ts`)**
  - 在 `server.ts` 初始化中，新增 `booking_ending_advance_minutes` 的默认插入逻辑（默认 `15` 分钟）。
  - 在 `src/services/notificationService.ts` 的 `DEFAULT_EMAIL_TEMPLATES` 和 `DEFAULT_WEBHOOK_TEMPLATES` 中新增 `booking_ending` 事件及默认文案。

- [x] 2. **后端定时扫描逻辑 (`server.ts`)**
  - 编写 `endingReminderScan` 函数，逻辑参考 `upcomingReminderScan`，但条件改为基于 `end_time` 倒推 `advance_minutes`。
  - 编写 `startEndingReminderCron` 函数并在服务启动处调用，注册每 5 分钟执行一次的 cron 任务。
  - 在 API `/api/settings` 的 POST 接口中，支持 `booking_ending_advance_minutes` 等相关配置的保存，并在修改后重启相应的 cron 任务（`startEndingReminderCron`）。

- [x] 3. **管理端前端界面适配 (`src/pages/Admin/components/NotificationsTab.tsx`, `DeliveryLogsTab.tsx`)**
  - 在 `NotificationsTab.tsx` 的事件列表中新增 `booking_ending` (临近下机提醒)，注册其可用变量。
  - 在表单全局配置区，新增 `booking_ending_advance_minutes` 的配置项，并和现有的“上机前提前提醒时间”放置在一处。
  - 在 `DeliveryLogsTab.tsx` 中，补充 `booking_ending` 翻译，以便日志能够友好展示该事件的名称。

- [x] 4. **测试与验证**
  - 运行 `npx tsc --noEmit` 确认无类型错误。
  - 运行 `npm run build` 确保可成功构建。
