# 规格说明书：分页参数上限及内存溢出防护 (OOM & Pagination DoS)

## 1. 业务背景
后端系统中有若干管理端统计、日志及明细列表接口直接运用了 `db.prepare(...).all()` 来拉取全部匹配数据。这会引发以下两重隐患：
1. **自带分页的接口（如 `/api/admin/delivery-logs`）**：未约束每页大小，恶意攻击者可请求超大 `limit` 参数令服务器抓取海量数据而崩溃。
2. **无分页接口（如 `/api/admin/audit-logs`, `/api/admin/violation-records`, 报表等）**：这些接口仅含有选填的时间范围。由于不限制时间跨度，若前后端未传区间，长期运行下必然会导致内存 OOM。
*注：`/api/admin/reservations` 后续可能有重大重构，本次不作为强时间跨度限制点暂予搁置。*

## 2. 方案设计
采用“时间范围强制约束”结合“分页参数极值校验”保护 Node 进程内存，使得查询必定是有界的。

### 2.1. 限制分页接口的 `limit` 最大值
* **涉及接口**：`/api/admin/delivery-logs`
* **规则**：对查询中的 `limit` 进行极值校验，`const safeLimit = Math.min(parseInt(limit as string) || 50, 500);`。单次最多抽取 500 条。

### 2.2. 为全量查询接口增加强制时间范围拦截 (Max 1 Year)
* **涉及接口**：
  * `/api/admin/audit-logs`
  * `/api/admin/violation-records` (当没有传 `ids` 或 `reservation_id` 过滤时)
  * `/api/admin/reports` 以及相关报表 (`/api/admin/reports/violations`)
* **规则**：
  * **必须存在时间跨度**：如果没有传入开始和结束时间（StartDate / EndDate），直接返回 `400` 要求必须提供时间范围。
  * **超控限制**：计算提供的时间跨度，如果大于 366 天，返回 `400` 错误，提示 `查询时间跨度不能超过 1 年 (366 天)`。
  * 对于已有时间范围查询可选的组件，前端一般自带了默认的时间选择（例如最近 30 天）。后端增加截断和错误抛出既能预防 OOM 也可以阻断对 API 的盲目枚举。
