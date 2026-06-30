# 任务拆解与进度清单: 修复违规类型组合无法正确显示周期类型，并支持自然周

- [x] 在 `src/pages/Admin/components/PenaltyRulesTab.tsx` 中，将 `week: '自然周'` 添加到 `periodTypeMap`，并更新 `period_type` 的 TypeScript 类型以支持 `week`。
- [x] 在 `src/pages/ViolationQuery.tsx` 中，更新 `getTriggerDesc` 函数内部的 `pMap` 变量，补充 `quarter` 和 `academic_year`，并保留 `week`。
