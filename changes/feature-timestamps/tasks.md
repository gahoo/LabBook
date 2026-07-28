# 任务拆解: 增加时间戳 (created_at / updated_at)

## 阶段 1: 数据库与 API 后端改造
- [x] 修改 `server.ts`，在启动阶段添加 `reservations` 表的 `created_at` 和 `updated_at` 字段迁移脚本（使用 `ALTER TABLE` 后接 `UPDATE ... SET created_at = NULL, updated_at = NULL` 处理历史数据，确保放在 `try/catch` 块中）。
- [x] 修改 `server.ts`，添加 `equipment` 表的 `created_at` 和 `updated_at` 字段迁移脚本及历史数据 `NULL` 化处理。
- [x] 修改 `server.ts`，添加 `penalty_rules` 表的 `created_at` 和 `updated_at` 字段迁移脚本及历史数据 `NULL` 化处理。
- [x] 修改 `server.ts`，更新 `GET /api/reservations/:code` 接口，在返回的 SELECT 字段中加入 `created_at`。
- [x] 修改 `server.ts`，更新所有涉及 `UPDATE reservations` 的相关接口（如修改、取消、状态流转），在 UPDATE 语句中写入 `updated_at = CURRENT_TIMESTAMP`。
- [x] 修改 `server.ts`，更新 `PUT /api/admin/penalty-rules/:id` 接口，在 UPDATE 语句中写入 `updated_at = CURRENT_TIMESTAMP`。
- [x] 修改 `server.ts`，更新 `PUT /api/admin/equipment/:id` 及 `PUT /api/admin/equipment-batch` 接口，在 UPDATE 语句中写入 `updated_at = CURRENT_TIMESTAMP`。

## 阶段 2: 前端类型与组件数据绑定
- [x] 修改 `MyReservations.tsx`：
  - 更新 `Reservation` 接口定义，增加 `created_at?: string`。
  - 在详情展开区渲染“提交时间”，使用 `new Date(created_at + 'Z')` 解析并格式化。
- [x] 修改 `PenaltyRulesTab.tsx`：
  - 更新 `PenaltyRule` 接口定义，增加 `updated_at?: string`。
  - 在规则列表项中渲染“最后修改”时间，使用 `new Date(updated_at + 'Z')`。
- [x] 修改 `WhitelistAppsTab.tsx`：
  - 在表格中添加“申请时间”列头。
  - 在对应数据单元格中渲染 `created_at`，做好判空处理及 `+ 'Z'` 时区解析。
- [x] 修改 `ViolationsAndPenaltiesTab.tsx`：
  - 在违规记录详情 Modal 中，增加记录时间的逻辑：比较 `new Date(created_at + 'Z').getTime()` 和 `new Date(violation_time).getTime()`，绝对差值大于 60s 时显示“记录时间”。
  - 在受限名单列表中，为封禁开始时间下方添加 `created_at` 渲染（判空 + `+ 'Z'`）。

## 阶段 3: 全局检查与收尾
- [x] 执行 `npx tsc --noEmit` 和 `npm run build` 进行初步验证，确保没有引入语法或架构错误。
- [x] 确保 `changes/TOC.md` 中添加或更新此功能的记录。
- [x] 修改 `ReportsTab.tsx`，在详细预约记录的编辑侧边栏中渲染预约记录的 `created_at`。
