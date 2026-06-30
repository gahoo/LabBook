# 任务拆解与进度清单: 修复规则切换自然周期时 `period_type` 丢失的问题

- [x] 在 `src/pages/Admin/components/PenaltyRulesTab.tsx` 中修改 `window_type` 的 `onChange` 处理逻辑：当选中 `natural_period`（或 `current_month`）时，如果 `formData.trigger.period_type` 未定义，则为其赋予默认值 `'month'`。
