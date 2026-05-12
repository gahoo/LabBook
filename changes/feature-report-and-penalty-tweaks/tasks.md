# 任务清单：报表与惩罚功能优化

- [ ] **任务 1：报表详细记录表仪器列折行**
  - 所属文件：`src/pages/Admin/components/ReportsTab.tsx`
  - 操作说明：找到“详细预约记录表”，给“仪器”列对应的显示元素添加 `max-w-[150px] whitespace-normal break-words` 样式。

- [ ] **任务 2：设置参数调整 (小时改分钟)**
  - 所属文件：`src/pages/Admin/components/ViolationParamsTab.tsx`
  - 操作说明：修改“临期取消阈值”为“分钟”显示；加载和保存参数时改用新的配置键 `violation_late_cancel_minutes`。

- [ ] **任务 3：服务端：设置结构迁移及取消逻辑修改**
  - 所属文件：`server.ts`
  - 操作说明：
    - 数据库初始化及启动时，检查并执行 `violation_late_cancel_hours` 到 `violation_late_cancel_minutes` 的平滑迁移。
    - **迁移后执行 SQL 删除旧的 `violation_late_cancel_hours` 设置记录**。
    - 取消预约判断时，先获取 `equipment.availability_json` 的 `lateCancellationMinutes`，如无则使用全局 `violation_late_cancel_minutes`。
    - 服务端返回和保存设置时处理 `violation_late_cancel_minutes` 项。

- [ ] **任务 4：仪器单独配置临期取消阈值**
  - 所属文件：`src/pages/Admin/components/EquipmentForm.tsx`, `src/pages/Admin/components/BatchEditEquipmentForm.tsx`
  - 操作说明：
    - `EquipmentForm.tsx` 增加 `lateCancellationMinutes` 属性的设置（留空默认使用全局）。
    - `BatchEditEquipmentForm.tsx` 增加该字段的批量编辑选项和逻辑。

- [x] **任务 5：服务端聚合和输出“按仪器统计”及新增指标**
  - 所属文件：`server.ts`
  - 操作说明：在 `/api/admin/reports/stats` 中：
    - 除了 `personMap` 和 `supervisorMap` 外，新增按 `equipmentMap`进行时长的聚合汇总。
    - 计算 `machine_hours`（实际上机）与 `booked_hours`（预约时长），并按要求返回 `usageByEquipment`。

- [x] **任务 6：前端报表：详细预约记录拆分列与筛选器**
  - 所属文件：`src/pages/Admin/components/ReportsTab.tsx`
  - 操作说明：
    - 将“时长/费用”列拆分为单独的两列“时长”和“费用”。
    - 在“时长”单元格区域，展示上机时长，并在旁边算出该单的“利用率”（实际上机/预约）。
    - 增加独立过滤字段控制：`实际上机时长`、`费用` 和新的 `时长利用率` 的最大最小值筛选，并将它们应用在前端的数据过滤器中。

- [x] **任务 7：前端报表：图表、表格扩充“按仪器”及利用率**
  - 所属文件：`src/pages/Admin/components/ReportsTab.tsx`
  - 操作说明：
    - 将统计图表和数据统计表的维度选择器增加“按仪器”选项（配合用户和导师）。
    - 表头更换“总时长”为“上机时长”，并新增“预约时长”和“时长利用率”。
    - 公式统一使用：`上机总时长 / 预约总时长 * 100%` 进行渲染处理。
    - 导出数据（`exportToCSV`）一并加入新增的这些参数指标与分类。

- [x] **任务 8：补全数据统计维度的筛选联动与 UI 优化**
  - 所属文件：`src/pages/Admin/components/ReportsTab.tsx`
  - 操作说明：
    - 精简切换开头的 UI 文本为“联动”，并添加原生 `title` 属性悬浮气泡提示（“启用后，统计数据将根据下方的详细记录筛选条件实时重新计算”）。
    - 结合状态 `syncWithFilters`，如果在开启状态，则利用 `useMemo` 实现在前端通过 `filteredReportReservations` 分别进行用户、导师、仪器的分组聚合。
    - 替换下方列表（包括 `filteredUsageByPerson` 等）的数据依赖，实现全面、多维数据过滤和统计联动。
