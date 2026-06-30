# 任务拆解与进度清单: 修复 RESTRICTED 标签无中文的问题

- [x] 在 `src/pages/Admin/components/ViolationsAndPenaltiesTab.tsx` 中更新 `getPenaltyMethodLabel` 函数，增加 `case 'restricted': return '使用受限';` 的处理。
