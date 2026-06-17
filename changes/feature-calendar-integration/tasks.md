# 日历集成与预通知任务清单

- [x] **任务 1：核心 ICS 组装逻辑实现**
  - 在前端/后端编写工具函数（如 `utils/ics.ts`），支持将 `reservations` 数组转化为 `.ics` 文本格式。
  - 核心需支持处理 UTC 转换，并确保输出正确的 `DTSTART`、`DTEND` 及使用 `booking_code` 作为 `UID`。
  - 支持 `STATUS:CANCELLED`，确保日历客户端能处理退订事件。
  - 能够根据身份模式（用户级别 vs 仪器级别）输出不同详细度的 `SUMMARY` 和 `DESCRIPTION`。

- [x] **任务 2：服务端设置与邮件模板体系**
  - 后台设置扩展：在 `settings` 中保障 `calendar_sync_secret` 生成。
  - 管理端 UI：在“常规设置”的邮件与Webhook事件中新增 `booking_upcoming` (上机前提醒) 的勾选与预置分钟数输入（如 30 分钟）。
  - 管理端 UI：新增“个人日历订阅功能”开关/模式选项（关闭 / 界面展示 / 发送邮件）。
  - 邮件系统：预置一个支持 Markdown 的新邮件场景模板 `calendar_subscription` (提供客户端挂载教程)。

- [x] **任务 3：终端用户日历获取与请求实现**
  - 后端接口：`GET /api/calendar/user/url?protocol=webcal`（根据配置及请求协议，获取加密生成并组装完整的 URL 地址）。
  - 后端接口：`POST /api/calendar/user/mail`（获取加密 Token 组装 URL，并由邮件引擎通过通知队列统一向绑定的邮箱分发）。
  - 客户端 UI `MyReservations.tsx`：拉取该全局功能配置判断。如果关闭则无UI；如果准许界面展示，给予直接调起打开和复制链接两种途径；如果只准发送邮件，仅提供发起请求的按钮及成功 toast 提示。
  - 客户端 UI 单次下载：我的预约表格、详情或是预约成功页中补充“单次导出 ICS”，完全由前端生成 Blob 下载。

- [x] **任务 4：对外日历接口 (Gateway API) 与仪器同步**
  - 路由 `GET /api/calendar/user/:token.ics`：解密 token 判断 `student_id` 真实性，拼装并提供 Content-Type 匹配的 ICS 文件流，仅含其自身的有效和近期取消预约。
  - 路由 `GET /api/calendar/equipment/:token.ics`：解密 token 匹配得 `equipment_id`，查询其下所有有效/取消预约，按 Admin View 格式输出。
  - 移除独立 API：管理端直接提取，在返回列表 `/api/equipment` (若 admin 环境下) 数据体中自动附带 `calendar_token` 字段。客户端列表直接调用。

- [x] **任务 5：基于通知队列实现上机前提醒 (Upcoming Reminder)**
  - 在 `server.ts` 中的 `node-cron` 定时任务块区域，补充一条间隔 5 min 触发的高频轮询。
  - 定时任务入口处，首先检查系统设置中 `email.events.booking_upcoming.enabled` 或 `webhook.events.booking_upcoming.enabled` 是否有任一开启，若均未开启则直接 return 跳过。
  - 检索 `start_time` 满足接近阈值，且 **`status = 'approved'`** （必须为审核通过）的预约记录。
  - 比对 `notifications` 队列表中无对应 `reference_code` 且 `event = 'booking_upcoming'` 的数据，才触发新消息体下沉排队。
