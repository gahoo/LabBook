# 通知功能实施任务清单 (Notification System Tasks)

为了保证开发过程的高效和代码的可控性，以下是基于 `design.md` 拆分出的开发任务。每个任务粒度适中，预计 10-15 分钟内可完成。你可以逐步要求我按顺序执行这些任务。

## 阶段一：后端核心逻辑与服务层建立

- [x] **任务 1: 安装必要依赖**
  - 使用工具安装 `nodemailer` 及 `@types/nodemailer` 依赖包，用于后续的 SMTP 邮件发送支持。

- [x] **任务 2: 建立 NotificationService 基础类与模板渲染器**
  - 在 `src/` 下创建 `services/notificationService.ts`（或类似位置）。
  - 实现通用 `renderTemplate` 函数。
  - 编写获取系统 KV 设置数据的辅助查询方法。

- [x] **任务 3: 实现 Webhook 发送逻辑**
  - 在 `notificationService.ts` 中完成 `dispatchWebhook` 函数。
  - 逻辑包括：判断全局 `webhook.enabled` 和特定事件 `webhook.events.[event].enabled` 开关；提取模板并渲染；使用 `fetch` 异步发起 POST 请求带上自定义 headers。

- [x] **任务 4: 实现 SMTP 邮件发送逻辑**
  - 在 `notificationService.ts` 中完成 `dispatchEmail` 函数。
  - 逻辑包括：判断全局和事件级别的开关；读取 SMTP 配置并初始化 NodeMailer Transport；渲染标题和正文模板，并调用发送 API。

## 阶段二：后端业务挂载点集成

- [x] **任务 5: 集成“预约相关”事件**
  - 修改 `server.ts` 中创建预约 (`POST /api/bookings`)、取消预约 (`POST /api/bookings/:id/cancel`) 的接口逻辑。
  - 提取关键上下文数据（`student_id`, `booking_code`, `equipment_name`, `time`等），异步调用对应的 `NotificationService` 发送方法。

- [x] **任务 6: 集成“违规与封禁”事件**
  - 修改 `server.ts` 中处理惩罚逻辑和手动创建违规的接口。
  - 植入触发违规通知 (`violation_created`) 和封禁触发通知 (`penalty_triggered`) 的异步调用代码。

## 阶段三：前端配置转换层封装

- [x] **任务 7: 编写前端扁平 KV 与对象互转工具类**
  - 创建前端解析函数：将扁平的 KV `settings` 对象 (如 `{"webhook.events.booking_created.template": "..."}`) 转化为易于 React 开发的树状嵌套对象。
  - 创建序列化函数：将界面维护的状态树压缩拍平为 KV 格式以供 API 保存。

## 阶段五：重构与测试闭环 (Review & Refactor)

- [ ] **任务 11: 安装并集成 marked 解析器**
  - 后端安装 `marked` 及 `@types/marked`。
  - 在 `notificationService.ts` 发送邮件的逻辑里，将之前渲染变量后的 Markdown 用 `marked.parse()` 转换为 HTML 后再交给 Nodemailer 发送。

- [ ] **任务 12: 建立 notification_logs 表及写入逻辑**
  - 在 `server.ts` 或对应 DB 初始化脚本中增加 `notification_logs` 表机构。
  - 在 `notificationService.ts` 的发送外发代码处包一层记录日志的逻辑（记录通道、目标、状态及异常）。
  - 创建获取通知日志的前端查询 API 接口 (`GET /api/admin/notification-logs`)。

- [ ] **任务 13: 设置页组件重构 (Split Settings Component)**
  - 将庞大的 `SettingsTab.tsx` 重构拆分为左侧导航：General Settings, Backup, Notification Setup, Delivery Logs。
  - 将目前放在 Admin Root 层的 `NotificationsTab` 移入 `SettingsTab` 内部。
  - 创建并编写简单的 `DeliveryLogs` 列表供展示第12步搜集的投递结果。

- [ ] **任务 14: 增加多业务场景通知钩子与管理员发送逻辑**
  - 重构 `dispatchEmail`，让其可以同时检查并发送给用户 (`notify_user`) 及 管理员 (`smtp.admin_emails` -> `notify_admin`)。
  - 在 `server.ts` 中新增以下事件发信：`booking_approved`, `booking_rejected` (预约审批)，`appeal_resolved` (处理违规申诉)，`whitelist_resolved` (白名单审批)。

- [ ] **任务 15: 后端实现连通性与事件测试接口**
  - 新增 `POST /api/admin/notifications/test-connection`: 接收邮件 SMTP 及 Webhook 的当前输入配置尝试连通，返回成功/错误信息。
  - 新增 `POST /api/admin/notifications/test-event`: 接收某事具体的 Event ID 及其测试模板，生成一份 Mock Context （含如 `student_id: 'test_user'` 等）并调用通知模块单次发信逻辑，返回结果日志。

- [ ] **任务 16: 前端 UI 引入发送目标复选、测试按钮与新事件**
  - 在基础设置内加管理员邮箱输入框 `smtp.admin_emails`。
  - 展开每个 Email 事件面板时补充 `发送给用户` 和 `发送给管理员` 的多选复选框。
  - 在 Webhook 与 SMTP 面板分别增加连通性测试按钮并拦截结果。
  - 在每个事件的 Webhook 和 Email 自定义模板编辑器旁增加“用此模板试发 (Test this template)” 的动作按钮。
