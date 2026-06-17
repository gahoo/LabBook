# 性能和安全性优化方案

## 1. “我的预约”页面批量查询及全局状态优化

### 背景与问题
1. **过多孤立的查询**：之前页面通过遍历 Cookie 中的 `booking_code`，使用 `Promise.all` 给每个 code 发起了一次 `GET /api/reservations/:code` 请求。
2. **Cookie 及 URL 过长问题**：随着用户长期使用，Cookie 累积的 `booking_code` 会越来越多。如果使用 `GET` 请求传递 `?codes=[很多个code]`，可能会触发浏览器的 URL 长度限制（一般为 2000 个字符）。同样的，Cookie 也会受到大小限制。
3. **多余的 `/api/settings` 请求**：部分组件或者 useEffect 可能会在渲染时反复抓取设置数据。

### 优化方案
*   **开辟专属的批量 POST 接口**：新增后端路由 `POST /api/reservations/batch`，使用 request body 传递 JSON 格式的 `{ codes: ["A", "B", ...] }`。这样就彻底绕过了 GET 请求 URL 的长度限制，同时也保留了原本针对单一预约的 `GET /api/reservations/:code` 作为底层兜底。
*   **前端聚合与存储上限控制**：
    *   在前端读取/更新 Cookie 之前，对 `lab_booking_codes` 数组进行截断（例如最多只保留最近的 50 个预约码），并且在适当的时候自动清理已经过期很久的记录。
    *   使用上述 `POST` 接口请求这些 codes。
*   **Settings 优化**：将 `fetch('/api/settings')` 放在稳定的作用域内，确保在其生命周期中只发生一次。

## 2. 仪器预约可用性范围查询

### 背景与问题
预约界面目前针对如一周（7天）的可用性展示，循环并发了 7 次 `GET /api/equipment/:id/availability?date=YYYY-MM-DD` 请求。

### 优化方案
*   **扩展后端接口**：将接口兼容或升级为 `GET /api/equipment/:id/availability?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`。
*   **后端处理合并**：后端一次性计算给定范围内的所有可用时段。原有的基于单个日期（`date=`）查询仍可保留以防破坏兼容性，但在提供范围参数时则返回按天分组的数组。
*   **前端聚合请求**：`Booking.tsx` 将只需针对选中的一整周或日历页面可见的范围，发起唯一一次请求即可。

## 3. 避免未授权状态下的 `whitelist_data` 泄露

### 背景与问题
目前的 `GET /api/equipment` 直接返回了 `SELECT * FROM equipment` 的结果，其中包含了 `whitelist_data`。任何人都可以通过开发者工具查阅。

### 优化方案
*   **脱敏输出**：在 `server.ts` 的 `GET /api/equipment` 路由里添加过滤逻辑：如果是未通过 `adminAuth` 鉴权的普通用户，在发送回客户端前强制 `delete eq.whitelist_data`。

## 4. `availability/today` 的信息过度暴露

### 背景与问题
`GET /api/equipment/availability/today` 返回的数据可能包含了完整的仪器配置和人员表单信息。

### 优化方案
*   **裁剪字段结构**：后端查询该仪器今天全部可用 slots 时整合出包含 `{ date, slots: [...] }` 的纯粹集合，剥离底层的人员和预约隐私数据，完全剔除原始 `reservations`。
