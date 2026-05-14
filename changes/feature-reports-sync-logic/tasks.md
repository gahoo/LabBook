# 任务清单

- [x] **任务 1：拆分状态与基础代码准备**
  - 在 `ReportsTab.tsx` 中移除旧的 `syncWithFilters` 状态。
  - 新增 `syncChartWithFilters` 和 `syncStatsWithFilters` 两个布尔值状态，默认为 false。

- [x] **任务 2：为时长/费用统计表构建独立的数据源与过滤逻辑**
  - 使用 `useMemo` 构建 `statsBaseData`（通过 `syncStatsWithFilters` 判断是直接用原数据，还是用 `filteredReportReservations` 进行聚合聚合）。
  - 把下方的次级过滤器(`statsFilterUser`, `statsFilterEquipment` 等) 仅应用在 `statsBaseData` 上，生成 `filteredStatsData` 提供给表格渲染。

- [x] **任务 3：为统计图表构建独立的数据源**
  - 使用 `useMemo` 构建 `chartBaseData`（通过 `syncChartWithFilters` 判断逻辑）。
  - 对于图表所需的数据（如折线图按时间线，柱状图按用户/仪器），使其完全读取 `chartBaseData` 而不再经过那些过滤器。

- [x] **任务 4：UI 界面更新**
  - 维持图表右上角的联动按钮不变，但将绑定的状态改为 `syncChartWithFilters`。
  - 在时长/费用统计表的上方操作区（例如在导出按钮或切换维度标签组旁边），增加一个与其功能相同的联动开关控件，并绑定 `syncStatsWithFilters`。

- [x] **任务 5：更新 changes/TOC.md**
  - 将 `feature-reports-sync-logic` 变更记录到目录中。

