# 规格说明书: 修复违规类型组合无法正确显示周期类型，并支持自然周

## 问题分析
1. 在 `ViolationQuery.tsx` 的 `getTriggerDesc` 函数中，用于格式化自然周期显示的 `pMap` 对象缺少了 `quarter`（自然季度）和 `academic_year`（学年）。这导致当违规规则使用这两个周期类型时，查询页面上无法正确显示周期名称，只能显示为兜底的 "在每个周期内"。
2. 后端逻辑（`server.ts`）中已经支持了 `week`（自然周）类型的周期计算，但前端管理页面的 `PenaltyRulesTab.tsx` 中并未开放 `week` 选项。

## 修复方案
1. 在 `PenaltyRulesTab.tsx` 的规则管理配置中，将 `week`（自然周）添加到 `periodTypeMap` 及 TS 类型中，使管理员可以配置“自然周”维度的惩罚规则。
2. 将 `ViolationQuery.tsx` 中的 `pMap` 补充完整，使其包含：`week`, `month`, `quarter`, `semester`, `academic_year`, `year`，实现与管理端和后端的对齐。

具体更改 `pMap` / `periodTypeMap` 的值为：
```typescript
{
  week: '自然周',
  month: '自然月',
  quarter: '自然季度',
  semester: '学期',
  academic_year: '学年',
  year: '自然年'
}
```
这样既补全了展示遗漏的问题，又释放了系统本就支持的“自然周”管理能力。
