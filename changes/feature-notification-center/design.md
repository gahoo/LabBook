# 预约系统通知功能设计文档 (Notification System Design)

## 1. 概述 (Overview)
本项目将引入通知中心功能，支持通过 **标准 SMTP 邮件** 和 **单一自定义 Webhook** 向用户和系统管理员发送关键事件通知（如预约成功含预约码、违规通知、封禁通知等）。重点强化了通知的灵活性，无论是 Webhook 还是 Email，都支持针对不同事件配置独立的开启状态和自定义推送模板。

## 2. 核心功能需求 (Core Features)
* **自定义 Webhook 通知**: 
  * 支持配置全局唯一的 Webhook URL、自定义请求头 (Headers) 和签名密钥 (Secret)。
  * **按事件独立控制**: 每个核心事件都有独立的开关可以控制是否触发 Webhook。
  * **自定义 Payload 模板**: 每个启用的事件可以独立配置 JSON Payload 模板。用户可以使用变量（如 `{{ student_id }}`, `{{ booking_code }}`）来构造符合飞书、钉钉、企业微信等特定平台要求的格式。
* **SMTP 邮件通知 (带模板支持)**: 
  * 支持配置全局的 SMTP 凭证（包括发件人邮箱等）。
  * **按事件独立控制**: 每个事件也享有独立的邮件开关。
  * **自定义邮件模板**: 支持为不同事件分别配置“邮件标题 (Subject)”模板和“邮件内容 (HTML/Text)”模板。变量替换逻辑与 Webhook 相同。
* **目标用户推送**: 在模板中使用 `{{ student_id }}` 暂代平台间映射的 `im_id`（IM 系统中的用户唯一标识）。
* **异步分发机制**: 通知发送将采用异步非阻塞模式，避免影响主业务流程。

## 3. 数据模型设计 (KV Settings Table)
本设计方案中，**不新增专用数据表**，而是复用现有的全局 `settings` 表（`key`, `value` 结构）。
所有的通知配置将通过 **命名空间重名 (Namespaced Keys)** 的方式被打平存储在现有的全局设置中：

### 3.1 全局配置 Keys
* `smtp.enabled`: "true" / "false"
* `smtp.host`: "smtp.example.com"
* `smtp.port`: "465"
* `smtp.user`: "no-reply@..."
* `smtp.pass`: "********"
* `smtp.from_name`: "实验室预约系统"
* `smtp.from_email`: "no-reply@..."
* `smtp.admin_emails`: "admin1@example.com, admin2@example.com" (用于接收系统级通知)
* `webhook.enabled`: "true" / "false"
* `webhook.url`: "https://hook.example.com/api/send"
* `webhook.headers`: "{\"Authorization\":\"Bearer token\"}"

### 3.2 事件模板配置 Keys (以 `booking_created` 为例)
* `webhook.events.booking_created.enabled`: "true" / "false"
* `webhook.events.booking_created.template`: "{\"msgtype\": \"text\", \"text\": {\"content\": \"预约成功 {{ booking_code }}\"}}"
* `email.events.booking_created.enabled`: "true" / "false"
* `email.events.booking_created.notify_user`: "true" / "false" (是否发给触发事件的学生)
* `email.events.booking_created.notify_admin`: "true" / "false" (是否发给管理员邮箱)
* `email.events.booking_created.subject`: "预约成功通知 - {{ equipment_name }}"
* `email.events.booking_created.template`: "## 你好 {{ student_id }}\n您的预约码是: **{{ booking_code }}**"

*最新扩充的完整事件列表包括：*
* `booking_created`: 预约成功
* `booking_cancelled`: 预约取消
* `booking_approved`: 预约（需审核）通过
* `booking_rejected`: 预约（需审核）驳回
* `violation_created`: 违规记录生成
* `penalty_triggered`: 触发封禁处罚
* `appeal_resolved`: 违规申诉处理结果
* `whitelist_resolved`: 白名单申请审核结果

### 3.3 通知日志表 (Notification Logs Table)
独立数据表 `notification_logs` 收敛发送状态：
* `id`: INTEGER PK
* `event`: TEXT (如 'booking_created')
* `channel`: TEXT ('email' 或 'webhook')
* `target`: TEXT (目标邮箱地址 或 Webhook URL)
* `status`: TEXT ('success' 或 'failed')
* `error_message`: TEXT (失败堆栈，方便排查)
* `created_at`: DATETIME

## 4. 后端架构 (Backend Architecture)

### 4.1 模板渲染引擎 (Template Render)
实现统一的变量替换函数 `renderTemplate`，即可用于 Webhook JSON，又可用于邮件标题和正文的渲染。

### 4.2 通知分发服务 (Notification Service)
1. 在核心业务处抛出事件。
2. 从 `settings` 表加载所有通知相关的配置。
3. **处理 Webhook**: 检查 `webhook.enabled` 和对应事件项。如果为 true，渲染 Payload 并发起异步 POST 请求。记录一条 `notification_logs` (不管成功或失败)。
4. **处理 Email**: 如果 `smtp.enabled` 及该事件邮箱开启，使用 `marked` 解析 Markdown 为 HTML。根据 `notify_user` 判断投递给发生动作的学生，根据 `notify_admin` 取全局配置中的 `smtp.admin_emails` 分发给管理员，分别执行 `nodemailer.sendMail`。对应产生 `notification_logs` 记录。

## 5. 前端界面与设置交互设计 (Frontend & Settings UI)

### 5.1 设置面板组件拆分 (SettingsTab Refactoring)
为了避免 `SettingsTab.tsx` 过于臃肿，现将整个设置菜单改造成 **“左侧导航字典结构 (Sub-navigation Sidebar/Pills)”**：
1. **常规设置 (General Settings)**：包含预约规则、容错规则等。
2. **备份设置 (Backup Settings)**：自动备份相关的 Cron 与保留策略。
3. **通知配置 (Notification Setup)**：承担下方所有的配置功能。
4. **投递日志 (Delivery Logs)**：按时间倒序展示系统所有发往外界被成功或拦下的日志表格，辅助网络排查。

### 5.2 基础通信网关配置区 (Gateways)
* **SMTP 邮件网关**: Host, Port, Auth, 发件人，以及全局的 **系统管理员邮箱（支持多填）**。支持【连通性测试按钮】。
* **Webhook 网关**: URL, Headers。支持【连通性测试按钮】。

### 5.3 事件与通知模板管理区 (Event Handlers)
* 扩展支持 8 个主要事件触发体系。
* 每项事件展开后，**邮件配置区** 内新增接收目标选项 `[✓] 用户本人`，`[ ] 系统管理员` 的复选框。
* Webhook 与 Email 皆配有基于此上下文的【试发测试按钮】。

## 6. 新增后端测试 API 及 Markdown 支持
为了支持界面上的测试按钮需求以及 Markdown 解析需求，后端增加以下基建设施：
1. 引入并安装 `marked` 库，在 `dispatchEmail` 发送邮件之前，先进行变量替换，再调用 `marked.parse(renderedMarkdown)` 将其转换成友好的 HTML。
2. 增加 `/api/admin/notifications/test-connection` 接口：接收 SMTP 或 Webhook 对象，尝试发送一封 “Hello World” 测试连接。
3. 增加 `/api/admin/notifications/test-event` 接口：接收特定的 `event_id` 及临时填写的 Template，在后端注入一套假数据上下文（Mock Data）后触发投递并返回执行结果给前端。
1. **统一占位符映射与 IM 接入**: 在用户表中新增真实的 `im_id`，并作为上下文变量传输，提供原生对接企微/飞书能力的准备。
2. **多目标/多通道演进**: 本基于事件的命名空间 KV 方案可以很方便横向扩充，如增加 `sms.events.xxx`, 或者按多组 Webhook 拆分 `webhook.robot1.events.xxx`，向后的重构摩擦力非常小。
