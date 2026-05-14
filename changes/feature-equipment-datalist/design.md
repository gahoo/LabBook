# 开发方案：为筛选器提供仪器自动补全 (Datalist)

## 问题描述
在详细预约记录表（`ReportsTab`）、所有预约记录表（`ReservationsTab`）和违规记录评估表（`ViolationsAndPenaltiesTab`）中，有多个针对“仪器”列的筛选器。目前这些筛选器是普通的文本输入框，用户必须手动输入完全一致的仪器名称才能进行筛选。使用 `datalist` 可以提供下拉提示，让用户能够快速选择已有记录中的仪器名称，改善使用体验。

## 解决方案
我们将通过以下方式实现自动补全功能：

1. 对于每个包含“仪器”筛选器的组件（`ReportsTab`、`ReservationsTab`、`ViolationsAndPenaltiesTab`），使用 `useMemo` 从当前持有的已有记录数据中提取唯一的仪器名称集合。
2. 在该组件内渲染一个 `<datalist>` 元素，里面包含这些收集到的 `<option>`，且每个相关的组件可以有独立唯一 ID 的 datalist。
3. 修改对应的所有“仪器”筛选文本输入框（包括表头的快速筛选和高级筛选栏中的输入框），增加 `list="datalist-id"` 属性。

## 改造明细
### 1. `ReportsTab.tsx`
- **数据源**：`reports.reservations`
- **提取逻辑**：`const uniqueEquipments = Array.from(new Set(reports.reservations.map(r => r.equipment_name).filter(Boolean)));`
- **Datalist ID**：`reports-equipment-list`
- **修改输入框**：
  - 高级筛选中的“仪器”输入框。
  - 表头中的“仪器”输入框。
  - 导出/汇总部分的“仪器”搜索输入框。

### 2. `ReservationsTab.tsx`
- **数据源**：`reservations`
- **提取逻辑**：`const uniqueEquipments = Array.from(new Set(reservations.map(r => r.equipment_name).filter(Boolean)));`
- **Datalist ID**：`reservations-equipment-list`
- **修改输入框**：
  - 高级筛选中的“仪器”输入框。
  - 表头中的“仪器”输入框。

### 3. `ViolationsAndPenaltiesTab.tsx`
- **数据源**：`violations`
- **提取逻辑**：`const uniqueEquipments = Array.from(new Set(violations.map(v => v.equipment_name).filter(Boolean)));`
- **Datalist ID**：`violations-equipment-list`
- **修改输入框**：
  - 高级筛选中的“仪器”输入框。
  - 表头中的“仪器”输入框（如果存在）。

## 预期效果
用户点击“仪器”搜索/筛选框时，能够展开显示当前表单中已有的仪器名称下拉列表，并支持随用户的输入自动过滤列表选项。
