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

- [ ] **任务 12: 建立 notifications 持续化队列表及预渲染入队**
  - 在 `server.ts` 或 DB 初始化处增加 `notifications` 队列表构（加入 `reference_code` 及保存发送镜像内容的 `payload` 等字段）。
  - 重构现有的 `dispatchWebhook` 与 `dispatchEmail`，让业务流转为：获取设定 → 立刻合并数据完成模板渲染（生成不可变的富文本/JSON快照） → 将目的地 `target` 即镜像载入数据库标记为 `pending`。
  - 成功落库后触发内存函数启动投递消费（任务17）。

- [ ] **任务 13: 设置页组件重构 (Split Settings Component)**
  - 将庞大的 `SettingsTab.tsx` 保持现有的风格横向选项卡拆分为：General, Backup, Notifications, Delivery Logs。
  - 将目前放在 Admin Root 层的 `NotificationsTab` 移入 `SettingsTab` 内部。
  - 创建 `DeliveryLogs` 列表供展示队列明细，增加“只看失败”、“发送成功”、“待发送” 的横向过滤以及根据 `reference_code` 相关信息搜索的能力。

- [ ] **任务 14: 增加多业务场景通知钩子与多目标管理员选项**
  - 在生成队伍记录的过程中支持 `notify_user` 和通过 `smtp.admin_emails` 生成投递给 `notify_admin` 管理员的多条任务记录。
  - 在 `server.ts` 中新增以下事件推队：`booking_approved`, `booking_rejected` (预约审批)，`appeal_resolved` (处理违规申诉)，`whitelist_resolved` (白名单审批)。

- [ ] **任务 15: 后端实现连通性与事件模拟测试接口**
  - 新增 `POST /api/admin/notifications/test-connection`: 接收邮件 SMTP 及 Webhook 的当前输入配置尝试连通，返回成功/错误信息。
  - 新增 `POST /api/admin/notifications/test-event`: 接收具体 Event ID 及其测试模板，生成一份 Mock Context，直接走网关发送并抛回实时日志（测试接口不走消息队列）。

- [ ] **任务 16: 前端 UI 更新设置选项板与操作动作**
  - 基础设置网关内加上“全局流控：发信最小间隔（秒）”，以及管理员邮箱集合 `smtp.admin_emails`。
  - 事件手风琴下补充 `[ ] 发生对象` 和 `[ ] 系统管理员` 复选框。
  - 提供上述提及的各类“连通性试发”和“模板试发”触接按钮。

- [ ] **任务 17: 开发持久化抗灾的内置队列 Processor**
  - 在 `notificationService.ts` 下添加 `processNotificationQueue` 作为异步 Worker。
  - 一旦被唤醒则检查全局 `isProcessing` 锁防止复发拉取；逐条提取 `next_retry_time <= now` 且状态待处理的任务。
  - 成功则变更 DB 状态；异常则利用指数退避算法更新 `retry_count` 及 `next_retry_time` 放入 `retrying` 池内等待下次兜底唤起。
  - 每发处理一个条目无论成败均执行 `await sleep(interval)` 防止网关限流。
  - 修改 `server.ts` 结合定时任务模块，每 1 分钟无条件调用一次拉取漏扫任务作为安全兜底网。
