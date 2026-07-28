# 规格说明书: 增加时间戳 (created_at / updated_at)

## 1. 需求背景
为系统中缺少时间戳字段的数据表（`reservations`, `equipment`, `penalty_rules`）增加 `created_at` 和 `updated_at` 字段。
在前端 UI 的适宜位置展示相关的时间信息，提升数据的可追溯性，同时优雅处理历史数据和 SQLite 时区问题。

## 2. 数据库变更设计
在 `server.ts` 启动时的数据库迁移阶段，新增以下表的列。为防止影响历史数据的真实性，在初次添加带有 `DEFAULT CURRENT_TIMESTAMP` 的列后，立即将已有数据的该列更新为 `NULL`。

- **`reservations`** 表:
  - 增加 `created_at` (DATETIME DEFAULT CURRENT_TIMESTAMP)
  - 增加 `updated_at` (DATETIME DEFAULT CURRENT_TIMESTAMP)
- **`equipment`** 表:
  - 增加 `created_at` (DATETIME DEFAULT CURRENT_TIMESTAMP)
  - 增加 `updated_at` (DATETIME DEFAULT CURRENT_TIMESTAMP)
- **`penalty_rules`** 表:
  - 增加 `created_at` (DATETIME DEFAULT CURRENT_TIMESTAMP)
  - 增加 `updated_at` (DATETIME DEFAULT CURRENT_TIMESTAMP)

## 3. API 变更设计
- `GET /api/reservations/:code`: `SELECT` 语句中增加 `r.created_at`。
- `PUT /api/reservations/update/:code`, `PUT /api/admin/reservations/:id` 以及状态流转相关的 API：相关的 `UPDATE reservations` 语句中增加 `updated_at = CURRENT_TIMESTAMP`。
- `PUT /api/admin/penalty-rules/:id`: `UPDATE` 语句中增加 `updated_at = CURRENT_TIMESTAMP`。
- `PUT /api/admin/equipment/:id` 及批量更新: `UPDATE` 语句中增加 `updated_at = CURRENT_TIMESTAMP`。

## 4. UI 交互与展示设计
前端在解析 SQLite 默认生成的 `CURRENT_TIMESTAMP` 时，必须复用项目中已有的 `+ 'Z'` 后缀模式（如 `new Date(field + 'Z')`），以正确解析 UTC 时间。对于值为 `NULL` 的历史数据，UI 进行判空保护，不显示或显示为 “—”（视具体场景而定）。

- **`reservations` (MyReservations.tsx)**: 在预约详情展开区域，增加“提交时间”展示。
- **`penalty_rules` (PenaltyRulesTab.tsx)**: 在规则列表的规则名称/描述下方，增加“最后修改”时间展示。
- **`whitelist_applications` (WhitelistAppsTab.tsx)**: 列表增加“申请时间”列。
- **`violation_records` (ViolationsAndPenaltiesTab.tsx)**: 详情 Modal 增加“记录时间”。通过计算 `created_at` 与 `violation_time` 的时间戳差值，仅当差值 > 60000 毫秒（1分钟）时认定为后期补录并显示“记录时间”。注意 `violation_time` 已包含 Z，不需要拼接。
- **`user_penalties` (ViolationsAndPenaltiesTab.tsx)**: 管理端受限名单的“封禁开始时间”下方，增加“创建于”副信息。
