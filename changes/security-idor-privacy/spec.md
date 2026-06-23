# 隐私泄露修复：精简公开接口数据返回 (IDOR Privacy Patch)

## 1. 背景与目标
根据综合安全审计报告，公开预约查询接口（如使用 `booking_code` 查询预约）存在敏感隐私数据（如手机号、邮箱）泄露的风险。任何用户如果从某些途径获得了一个预约码（甚至通过暴力枚举猜出），就能获取到该被查询者的电话和邮箱。
我们的目标是消除这层风险，因为在前端页面上用户即使需要查看自己的预约，也是不需要展示甚至编辑电话、邮箱信息的（预约时已经输入过，不可二次编辑）。

## 2. 方案讨论与设计
* **是否需要将 C端接口改成管理端一样的 GET 请求？**
不需要。目前 `POST /api/reservations/batch` 的设计初衷是为了在前端页面 `MyReservations` 中，把缓存在 LocalStorage 中的多个 `booking_code` 数组一次性传给服务端进行查询，防止过多零碎的 GET 请求。而且保留 C端专用路由和管理端（依赖 `adminAuth`）专用路由，具有清晰的边界，能够很大程度上减少权限误认甚至越权的风险。
* **哪些可以不处理/明文保留？**
学生需要靠学号和姓名来核对当前这个预约确实是属于他本人的，因此 `student_name`， `student_id` 可以进行明文完整下发。
同时如讨论所认为的，导师信息 (`supervisor`) 一般具有较广的公开属性及学业属性关联，不属于强敏感个人隐私，故不需要删除或打掩码。

## 3. 具体修改项 (遵循纵深防御的 SQL 显式列举原则)
废弃图省事的在 JS 内存中 `delete copy.email` 的做法，将其上升至 SQL 查询层面解决数据边界问题。即不从数据库向此上下文传递多余且危险的属性，避免意外的控制台日志等造成次生泄露。

对 `server.ts` 中的以下两个 C端暴露的数据接口实施 SQL 字段剪裁（将 `SELECT r.*` 替换为明确的安全字段列表）：
* `POST /api/reservations/batch` (`L1994`)
* `GET /api/reservations/:code` (`L2022`)

替换目标 SQL 为：
```sql
SELECT 
  r.id, r.equipment_id, r.student_name, r.student_id, r.supervisor, 
  r.start_time, r.end_time, r.status, r.booking_code, r.actual_start_time, 
  r.actual_end_time, r.total_cost, r.consumable_quantity, r.modified_count,
  e.name as equipment_name, e.price_type, e.price, e.consumable_fee, e.release_noshow_slots 
FROM reservations r
```
这将在根源阻断 `phone` 和 `email` 这两个敏感数据列落入该接口的响应管线。
