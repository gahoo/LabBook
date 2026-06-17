# 性能和安全性优化任务清单

- [x] **任务 1：升级批量预约单查询 (`POST /api/reservations/batch`)**
  - 后端：在 `server.ts` 中新增 `POST /api/reservations/batch` 路由，接收 `{[codes]}` 请求体。
  - 后端：保留原先提供单个或者少量数据的 `GET /api/reservations/:code` 的请求能力。
  - 前端：修改 `MyReservations.tsx`，将批量获取替换为使用 `POST` 访问 `/api/reservations/batch`。
  - 前端修复 (长度熔断)：在存取 Cookie 新的预约码之前，对 Cookie `lab_booking_codes` 中的字符进行裁剪，可仅留存距离最近的 50 或 100 笔预约，防止长年累积的数据超过 4KB 被截断而不可用。

- [ ] **任务 2：前端 Settings 并发请求优化**
  - 前端检查 `Booking.tsx` 和 `MyReservations.tsx` 中的 `/api/settings` fetch 逻辑。
  - 确保整个挂载生命周期只进行 1 次网络请求，移除不必要的、冗余的内部循环或不必要的子组件内部触发的 settings API 请求。

- [x] **任务 3：升级预约可用性时间范围查询 (`start_date` & `end_date`)**
  - 后端：修改 `GET /api/equipment/:id/availability` 路由，不再扩大化 reservations 的重叠面，而是精确地以 `dStrStartMs` ~ `dStrEndMs` 本地一天的范围切割范围查询结果，根除预约在数组里跨日期出现并重复报错的问题。
  - 前端：修改 `Booking.tsx`，废弃原本残余的用于提取当天边界参数发送 `date=` 单次拉取的效应。直接与已经获取并缓存一周的 `allAvailability` 同步绑定，不再发出双重网络请求，节减性能消耗。

- [x] **任务 4：修复仪器列表敏感字段 (白名单等) 泄露漏洞**
  - 后端：在并无 Admin Token 等权限校验情况下的基础 `GET /api/equipment` 路由里，遍历查出的仪器列表数据并通过 `delete item.whitelist_data` 擦除敏感字段后再发往前端。
  - 如果可能，同样将未启用的 / 隐藏的仪器一并妥善处理。

- [x] **任务 5：裁剪 `/api/equipment/availability/today` 暴露过多数据的隐患**
  - 后端定位今日可用性总览的返回逻辑。
  - 精简底层数据映射（Map），清除或掩码处理其中携带的原始 `reservations` 或用户信息，仅对外返回时间点、可用槽位 (slot) 或布尔值结构。
