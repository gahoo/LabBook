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
* `webhook.enabled`: "true" / "false"
* `webhook.url`: "https://hook.example.com/api/send"
* `webhook.headers`: "{\"Authorization\":\"Bearer token\"}"

### 3.2 事件模板配置 Keys (以 `booking_created` 为例)
* `webhook.events.booking_created.enabled`: "true" / "false"
* `webhook.events.booking_created.template`: "{\"msgtype\": \"text\", \"text\": {\"content\": \"预约成功 {{ booking_code }}\"}}"
* `email.events.booking_created.enabled`: "true" / "false"
* `email.events.booking_created.subject`: "预约成功通知 - {{ equipment_name }}"
* `email.events.booking_created.template`: "<h1>你好 {{ student_id }}</h1><p>您的预约码是: {{ booking_code }}</p>"

*其他支持的事件如：违规记录生成 (`violation_created`)、账号封禁触发 (`penalty_triggered`)等依此类推。*

## 4. 后端架构 (Backend Architecture)

### 4.1 模板渲染引擎 (Template Render)
实现统一的变量替换函数 `renderTemplate`，即可用于 Webhook JSON，又可用于邮件标题和正文的渲染：
```typescript
function renderTemplate(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{\s*(.*?)\s*\}\}/g, (match, key) => {
    return data[key] !== undefined ? String(data[key]) : match;
  });
}
```

### 4.2 通知分发服务 (Notification Service)
1. 在核心业务处抛出事件。
2. 从 `settings` 表加载所有通知相关的配置。
3. **处理 Webhook**: 检查 `webhook.enabled` 和对应事件项（如 `webhook.events.booking_created.enabled`）。如果全部为 true，则提取 Webhook URL、Headers 及该事件的模板。使用上下文 `data` 对象渲染 JSON Payload 模板，发起异步 API POST 请求。
4. **处理 Email**: 如果 `smtp.enabled` 及对应事件项的邮件通知已开启且触发对象拥有合理邮箱，则提取 Subject 和 HTML 模板完成渲染，投递给 NodeMailer 异步发出。

## 5. 前端界面设计 (Frontend / Admin UI)

由于数据存储层采用了平铺的基于 dot-notation 的 KV 结构，如果直接在前端操作这些平铺的字符串字典，不仅不易维护状态，而且无法用现代基于对象绑定的前端组件库（如 React Hook Form / 状态对象）。

### 5.1 数据转换与状态管理层
此时需要在前端做一层隔离与转换：
* **加载与组装 (Loading & Parse)**: 
  系统访问现有的 `GET /api/settings` 接口，提取 `smtp.`, `webhook.`, `email.` 前缀的数据。遍历这些键，利用 `.` 分隔符将其组装成一棵高层级的 JS 对象（如 `settingsObj.webhook.events.booking_created.template`）赋予 React 内部状态，方便数据结构理解和双层级组件渲染。
* **修改与扁平化拆解 (Stringify & Save)**:
  用户在界面完成复杂设置点击保存后，前端首先将当前的树形对象（或者各局部状态）遍历分解，重新转换成打平的带层级点命名键值对 `{"smtp.enabled": "true", "webhook.events.booking_created.template": "..."}`。然后使用保存配置接口写入后端数据库。

### 5.2 界面布局视图
在管理后台新增名为 **"通知设置" (Notifications Tab)** 页面模块。页面分两大部分：

* **基础通信设置区**:
  * **邮件网关**: Host、Port、认证信息及发件人配置。总控开关。
  * **Webhook 网关**: URL 地址、Headers （KV配置）、总控开关。
* **事件与通知模板管理区 (Accordion/Tabs 组件)**:
  * 按业务列出可用事件列表（预约通知、违规判定、系统处罚）。
  * 展开某一事件详情后，分为两列或子区块：
    * **左侧 / 顶部 (Webhook 面板)**: 独立启用开关、支持 `{{ 变量 }}` 语法的 JSON 编辑器，并在外侧注明明面当前事件上下文可用的填充变量。
    * **右侧 / 底部 (邮件通知 面板)**: 独立启用开关、Subject 输入框、HTML 邮件内容编辑器（同样给出可用变量名指引）。

## 6. 后续演进计划
1. **统一占位符映射与 IM 接入**: 在用户表中新增真实的 `im_id`，并作为上下文变量传输，提供原生对接企微/飞书能力的准备。
2. **多目标/多通道演进**: 本基于事件的命名空间 KV 方案可以很方便横向扩充，如增加 `sms.events.xxx`, 或者按多组 Webhook 拆分 `webhook.robot1.events.xxx`，向后的重构摩擦力非常小。
