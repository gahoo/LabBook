# 规格说明书: 修复“受限名单”页面 RESTRICTED 无对应中文的问题

## 问题分析
在 `ViolationsAndPenaltiesTab.tsx` 的 `getPenaltyMethodLabel` 函数中，没有对 `restricted` 类型进行处理，导致在“当前受限名单”等页面，如果惩罚类型为 `RESTRICTED`，界面上会直接显示英文而不是对应的中文。而在后端 `server.ts` 中，`RESTRICTED` 是一个会频繁出现的合法惩罚状态。

## 修复方案
在 `getPenaltyMethodLabel` 函数的 `switch (lowerMethod)` 语句中，增加对应的中文映射：
`case 'restricted': return '使用受限';`

该变更是纯前端 UI 展示层面的修复，不涉及业务逻辑和后端的改动，也不会产生副作用。
