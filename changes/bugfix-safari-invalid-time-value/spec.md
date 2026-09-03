# 修复 iOS Safari 展开预约详情报 Invalid time value 的方案

## 1. 问题背景与现象
- **环境**：旧版 iOS Safari / WebKit（如 `Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) AppleWebKit/605.1.15 ... Version/15.4`）。
- **现象**：在 `/my-reservations` 页面中，卡片列表可正常加载，但用户点击卡片展开预约详情时，前端控制台抛出未捕获异常：
  ```text
  [Error] RangeError: Invalid time value
      reportError (date-fns.js:2382)
      ...
  ```
  导致 React 组件渲染中断，页面出错或无法正常展开详情。

## 2. 根因分析
1. **数据源存储格式**：后端 SQLite 数据库对于 `created_at`（以及 `updated_at`、`next_retry_time` 等）字段默认采用 `CURRENT_TIMESTAMP` 生成，其输出为标准 SQLite UTC 格式，即空格分隔字符串：`"YYYY-MM-DD HH:MM:SS"`（如 `"2026-09-02 00:51:36"`）。
2. **前端脆弱拼接**：前端在展示提交时间时，为了将其作为 UTC 时间解析，采用硬编码字符串拼接 `resv.created_at + 'Z'`（详见 `src/pages/MyReservations.tsx:L1136`），得到 `"2026-09-02 00:51:36Z"`。
3. **WebKit 解析严格性差异**：
   - Chrome (V8) 和部分现代桌面浏览器对非标准日期字符串容错较高，允许空格后直接加 `Z`；
   - 旧版 Safari (WebKit) 对 ISO 8601 解析非常严苛：凡带有时区标识（`Z` 或偏移量）的日期字符串，**日期与时间之间必须以 `T` 分隔**。遇到空格带 `Z` 的格式，Safari 的 `new Date()` 直接返回 `Invalid Date`（`NaN`）。
4. **date-fns 抛错**：`date-fns` 的 `format()` 校验到 `Invalid Date` 后，直接抛出 `RangeError: Invalid time value`。
5. **同类隐患排查**：除 `MyReservations.tsx` 外，管理后台还有 5 处组件使用了相同的 `+ 'Z'` 字符串拼接（`AuditLogsTab.tsx`、`DeliveryLogsTab.tsx`、`ReservationEditDrawer.tsx`、`ViolationsAndPenaltiesTab.tsx` 等）。

## 3. 方案设计（B为主 + A兜底）

综合权衡全量数据库 DDL 迁移、业务写操作侵入与维护成本，决定采用 **「B为主（后端 SELECT 出口转换） + A兜底（前端高容错安全解析）」** 的组合架构方案。

### 3.1 后端（B为主: SELECT 出口标准化）
数据库底层写操作及数据存储继续保留原生的 SQLite 机制（`CURRENT_TIMESTAMP` 等），不进行昂贵且存在锁表风险的批量 DDL/DML 数据迁移。仅在面向前端 API 查询输出层（SELECT），利用 SQLite 内置函数进行格式规范化投影：
```sql
strftime('%Y-%m-%dT%H:%M:%fZ', r.created_at) AS created_at
```
输出标准 ISO 8601 格式字符串（带毫秒与 `Z` 标识），如 `"2026-09-02T00:51:36.000Z"`。

**涉及接口与方法**：
- `ReservationService.getBatch` (`src/modules/reservation/service.ts`)
- `GET /api/reservations/:code` (`src/modules/reservation/routes.ts`)
- `getAdminList` (`src/modules/reservation/stats.ts`)
- `getAuditLogs` (`src/modules/audit/service.ts`)
- `listApplications` (`src/modules/whitelist/service.ts`)
- `GET /api/admin/notifications` (`src/modules/notification/routes.ts`)

### 3.2 前端（A兜底: 容错解析防 double-Z 崩溃）
为了防止：
1. 后端输出标准 `...Z` 后，前端如果存在未修改或浏览器缓存的旧代码拼接导致 `...ZZ`；
2. 历史遗留接口或第三方调用返回旧格式。

在前端封装通用解析函数 `parseUTCDate`：
```ts
export function parseUTCDate(dateStr?: string | null): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  let s = dateStr.trim();
  // 1. 将日期时间之间的空格替换为 'T'
  if (s.includes(' ')) {
    s = s.replace(' ', 'T');
  }
  // 2. 自适应补齐时区 Z（只有末尾缺少时区标识时才补齐，避免生成 ZZ）
  if (!s.endsWith('Z') && !/[+-]\d{2}(:\d{2})?$/.test(s)) {
    s += 'Z';
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
```
并将前端所有直接消费 `created_at` 的 6 个组件替换为该函数，遇到无效日期安全返回空或原值，避免抛出未捕获异常崩溃。

## 4. 影响面与发布顺序保障
- **GitNexus 架构风险评估**：整体评级 **LOW**，无受影响的核心业务执行流，仅涉及读接口投影和展示层格式化。
- **发布顺序**：必须遵循 **“前端宽容解析先行，后端格式化跟随”** 的原则，避免因后端先行返回 `Z` 导致旧版前端拼接出双重 `ZZ`。
