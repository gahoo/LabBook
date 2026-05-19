# 日历集成与预通知功能设计 (Calendar & Reminder Design)

## 1. 背景与目标
为了帮助用户和管理员更好地管理上机时间，避免遗忘预约，系统将引入以下两大功能：
1. **上机前提醒 (Upcoming Reminder)**: 在预约时间即将到达前，通过既有的邮件/Webhook通知系统，自动向用户发送提醒。
2. **日历集成 (Calendar Integration)**: 生成标准的 iCalendar (.ics) 格式文件或提供日历订阅链接，使用户能够将预约直接同步到个人设备（如 Apple Calendar, Outlook, Google Calendar）中。

## 2. 设计方案

### 2.1 方案一：上机前预通知 (Upcoming Reminder)
- **触发机制**：利用现有引入了 `node-cron` 的调度器。增加一个独立的高频 Cron 任务（固定每 5 分钟执行一次轮询，对管理员隐藏此技术细节）。若管理员未在任何渠道（Email 或 Webhook）开启该事件，则 Cron 任务内部直接跳过执行或停止调度，避免无效轮询损耗性能。
- **控制管理 UI**：作为一项新的通知事件（`booking_upcoming`）融入现有的“事件通知管理”中。管理员开启此事件后，可配置“提前提醒时间 (如 30 分钟)”。
- **查询与状态管理（零侵入式设计）**：
  - 不需要修改 `reservations` 表增加诸如 `pre_notified` 这样的状态字段。
  - Cron 执行时，查询距离开始时间不足设定阈值且状态为已通过即 `status = 'approved'` 的当前预约。
  - **幂等性检查**：查询 `notifications` 表中是否已存在 `event = 'booking_upcoming'` 且关联当前预约号，仅触发一次。

### 2.2 方案二：单次预约添加到日历 (单次ICS下载)
- **触发位置**：预约成功后的成功提示页面，以及“我的预约”列表中的操作按钮。
- **技术实现**：完全在前端生成 `.ics` 格式文本，通过 `new Blob([icsContent], { type: 'text/calendar; charset=utf-8' })` 将文本转换为文件。浏览器会正确识别并触发下载。

### 2.3 方案三：日历订阅链接 (Webcal Subscription)
日历订阅功能为使用者提供实时更新的只读预约查看能力，一旦订阅，未来的变动自动同步。

#### 2.3.1 个人日历订阅与安全分发
- **获取方式可控**：在系统全局配置（Settings）中，管理员可设置个人日历订阅功能为 **[关闭 (Disabled)]**、**[通过邮件安全发送]** 或 **[在界面直接展示]**。若选择关闭，则不在客户端呈现任何订阅入口。
- **加密机制 (防遍历枚举)**：为确保公网访问的接口不泄漏隐私，通过 `calendar_sync_secret` 使用 AES-256-CBC 对 `student_id` 进行可逆加密作为 URL 的 Token (如 `webcal://{host}/api/calendar/user/{token}.ics`)。
- **API 端点**：
  - 获取订阅链接：`GET /api/calendar/user/url?protocol=webcal` (通过参数决定返回 `webcal://` 还是 `https://` 的链接)。
  - 触发发送邮件：`POST /api/calendar/user/mail` (复用全局 Markdown 邮件模板，内置 iOS/Android 添加指引)。
- **使用体验**：对于【在界面直接展示】模式，按钮优先执行直接跳转（支持的浏览器可直接调起默认日历客户端），同时辅以“复制链接”功能防止唤起失败；对于【邮件发送】模式，只展示一个发送按钮，点击即投递。

#### 2.3.2 仪器日历订阅 (供管理员或全局概览)
- **生成规则**：虽然仪器预约时间在 Booking 刻度上是公开的，但由于提供给管理员的日历通常需要包含预约者的真实姓名、学号、导师及联系方式等隐私敏感数据，因此**仪器日历接口同样需要进行安全加密**。
- **加密机制**：使用与个人订阅相同的 AES-256-CBC 算法和 `calendar_sync_secret`，将 `equipment_id` (或带前缀如 `eq_123`) 进行加密得到 Token。利用其长哈希特性作为防遍历的 Capability URL。
- **API 端点**：`GET /api/calendar/equipment/:token.ics`
- **使用体验**：在管理端“仪器管理”列表的“操作”列中，引入日历图标按钮，点击后自动复制订阅链接。

### 2.4 日历日程信息清单 (iCalendar Event Payload)
针对不同维度的提取，日程包含的字段应当有所区分保护隐私：

- **基础通用字段**：
  - `DTSTART` / `DTEND`: 预约起止时间 (UTC)。
  - `UID`: 使用预约码 (Booking Code) 作为唯一标识，保证全局唯一且同步时稳定对应。
  - `STATUS`: 取消的预约应标为 `CANCELLED`，以确保日历客户端能正确划除或删除取消的日程。默认可标为 `CONFIRMED`。
  - `VALARM`: 设置默认的客户端提醒（如提前 30 分钟）。

- **单次下载 (One-time Download)**：
  - 仅允许对状态为“已通过”的单次预约生成日历。
  - `SUMMARY`: [仪器预约] {仪器名称}
  - `LOCATION`: {仪器存放地点}
  - `DESCRIPTION`: 包含使用提示等。

- **个人日历订阅视图 (User Sync View)**：
  - 包含用户相关的有效与以及近期取消的日程，并在取消时标记 `STATUS:CANCELLED`。
  - 其余信息与单次下载基本一致。

- **仪器日历订阅视图 (Admin View)**：
  - `SUMMARY`: {预约者姓名} - {仪器名称}
  - `LOCATION`: {仪器存放地点}
  - `DESCRIPTION`: 简化明了，仅保留关键信息：
    - 预约人: {Student Name} ({Student ID})
    - 电话: {Phone}

## 3. 对其他系统的影响
- 前端需要编写跨组件复用的 iCalendar 生成工具，或者在后端生成供使用。
- 系统后台 `settings` 新增全局配置项：`calendar_sync_secret`、`reminder_advance_minutes` (默认30分钟等)。

## 4. 相关文件预期变动
- `/server.ts` : 增加生成 ICS 的 API 路由，新增一个专门检测临近上机的 Cron 定时器并与现有的队列联动。
- `/src/pages/MyReservations.tsx` : UI 增加单次下载、发送日历订阅按钮。
- `/src/pages/Booking.tsx` : 提交成功后增加单次下载按钮。
- `/src/pages/Admin/components/EquipmentManagementTab.tsx` : 增加仪器订阅链接入口。
