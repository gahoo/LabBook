# 任务清单

- [x] **任务 1：为 ReportsTab 添加仪器 datalist 及绑定**
  - 使用 `useMemo` 从 `reports?.reservations` 或现有的记录数组中提取并去重获取 `uniqueEquipments`。
  - 在组件中添加带有明确 ID 的 `<datalist>`。
  - 找到所有的 `placeholder="搜索仪器..."` 对应的 `<input>`，并为其添加 `list="datalist-id"` 属性。

- [x] **任务 2：为 ReservationsTab 添加仪器 datalist 及绑定**
  - 使用 `useMemo` 从 `reservations` 中获取并去重获得 `uniqueEquipments`。
  - 添加相应的 `<datalist>`。
  - 找到所有关联的“仪器名称”筛选输入框，并为其添加 `list="datalist-id"` 属性。

- [x] **任务 3：为 ViolationsAndPenaltiesTab 添加仪器 datalist 及绑定**
  - 使用 `useMemo` 从 `violations` 中获取并去重获得 `uniqueEquipments`。
  - 添加相应的 `<datalist>`。
  - 找到所有关联的“仪器名称”筛选输入框，并为其添加 `list="datalist-id"` 属性。

- [x] **任务 4：更新 changes/TOC.md**
  - 记录本次变更 `feature-equipment-datalist`。
