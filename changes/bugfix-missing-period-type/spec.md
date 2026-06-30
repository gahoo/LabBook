# 规格说明书: 修复规则切换自然周期时 `period_type` 丢失的问题

## 问题分析
当前在管理端（`PenaltyRulesTab.tsx`）编辑或创建惩罚规则时，当管理员将“统计周期类型”从“过去 N 天”切换为“自然周期”：
1. 切换的 `onChange` 回调中，清除了 `period_days`，但**没有对 `period_type` 赋初始默认值**（此时它可能仍是 `undefined`）。
2. 在渲染“自然周期类型”的下拉菜单时，代码使用了 `<select value={formData.trigger.period_type || 'month'}>`。这导致界面上**看起来**默认选中了“自然月”。
3. 如果管理员认为“自然月”刚好符合需求，不主动点击下拉菜单切换选项，下拉框的 `onChange` 事件就不会触发。
4. 最终点击“保存”提交表单时，`formData.trigger.period_type` 仍然是 `undefined`，被序列化存入数据库，导致后端或前端查询页面解析不出具体的周期类型，只能显示为兜底的“在每个周期内”。

## 修复方案
在切换“统计周期类型”（`window_type`）时，如果目标类型是 `natural_period` 或 `current_month`，且当前的 `period_type` 为空，主动为其赋予默认值（如 `'month'`）。保证界面显示的默认值与表单状态中的实际数据一致。
