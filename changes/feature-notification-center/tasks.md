# 通知功能实施任务清单 (Notification System Tasks)

为了保证开发过程的高效和代码的可控性，以下是基于 `design.md` 拆分出的开发任务。每个任务粒度适中，预计 10-15 分钟内可完成。你可以逐步要求我按顺序执行这些任务。

## 阶段一：后端核心逻辑与服务层建立

- [ ] **任务 1: 安装必要依赖**
  - 使用工具安装 `nodemailer` 及 `@types/nodemailer` 依赖包，用于后续的 SMTP 邮件发送支持。

- [ ] **任务 2: 建立 NotificationService 基础类与模板渲染器**
  - 在 `src/` 下创建 `services/notificationService.ts`（或类似位置）。
  - 实现通用 `renderTemplate` 函数。
  - 编写获取系统 KV 设置数据的辅助查询方法。

- [ ] **任务 3: 实现 Webhook 发送逻辑**
  - 在 `notificationService.ts` 中完成 `dispatchWebhook` 函数。
  - 逻辑包括：判断全局 `webhook.enabled` 和特定事件 `webhook.events.[event].enabled` 开关；提取模板并渲染；使用 `fetch` 异步发起 POST 请求带上自定义 headers。

- [ ] **任务 4: 实现 SMTP 邮件发送逻辑**
  - 在 `notificationService.ts` 中完成 `dispatchEmail` 函数。
  - 逻辑包括：判断全局和事件级别的开关；读取 SMTP 配置并初始化 NodeMailer Transport；渲染标题和正文模板，并调用发送 API。

## 阶段二：后端业务挂载点集成

- [ ] **任务 5: 集成“预约相关”事件**
  - 修改 `server.ts` 中创建预约 (`POST /api/bookings`)、取消预约 (`POST /api/bookings/:id/cancel`) 的接口逻辑。
  - 提取关键上下文数据（`student_id`, `booking_code`, `equipment_name`, `time`等），异步调用对应的 `NotificationService` 发送方法。

- [ ] **任务 6: 集成“违规与封禁”事件**
  - 修改 `server.ts` 中处理惩罚逻辑和手动创建违规的接口。
  - 植入触发违规通知 (`violation_created`) 和封禁触发通知 (`penalty_triggered`) 的异步调用代码。

## 阶段三：前端配置转换层封装

- [ ] **任务 7: 编写前端扁平 KV 与对象互转工具类**
  - 创建前端解析函数：将扁平的 KV `settings` 对象 (如 `{"webhook.events.booking_created.template": "..."}`) 转化为易于 React 开发的树状嵌套对象。
  - 创建序列化函数：将界面维护的状态树压缩拍平为 KV 格式以供 API 保存。

## 阶段四：前端 UI 构建

- [ ] **任务 8: Admin 页面增加“通知设置”入口与基础门面配置区**
  - 在管理界面的顶部（或侧边栏）添加 `Notifications` 标签。
  - 创建新的 `NotificationsTab.tsx` 组件。
  - 绘制 SMTP 网关基础配置区（包含 Host, Port 等信息）以及 Webhook 网关基础配置区。

- [ ] **任务 9: 绘制事件模板高级配置面板 (Webhook & Email)**
  - 在 `NotificationsTab` 下方绘制“按事件配置”的手风琴列表组件。
  - 为每个事件（预约、违规等）包含两列/两块配置区：分别填写 Webhook Template 和 Email Template 以及它们独立的独立开关。
  - 引入可用的 `{{ variable }}` 提示占位空间。

- [ ] **任务 10: 联调，保存逻辑与测试发送功能**
  - 将 UI 表单绑定到任务 7 创建的状态对象上。
  - 完成底部的 `Save Config` 调用后端更新 settings 接口。
  - （可选）加入“测试 Webhook/Email” 按钮的辅助测试 API。
