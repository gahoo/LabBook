# 任务拆解

- [x] `src/pages/Admin/components/ReservationsTab.tsx`
  - [x] 增加从 `localStorage` 读取初始状态的逻辑。处理好 props 覆盖：如果存在 `initialDate` 或 `initialBookingCode`，应优先使用。
  - [x] 增加 `useEffect` 监听所有筛选条件的变化，并在变化时更新 `localStorage`。
  - [x] 对于 `reportStartDate` 和 `reportEndDate`，由于其通常依赖于 `reportPeriod` (如 'day', 'week', 'month') 来动态计算，如果是绝对时间（如 'custom'），则考虑是否保存或重置。这里主要保存基础文本和多选过滤条件。
- [ ] 测试验证
  - [ ] 修改筛选条件，刷新页面，检查是否恢复了筛选条件。
  - [ ] 从其他页面点击跳转（带 `initialBookingCode` 等），检查是否正确覆盖了缓存的筛选条件。
