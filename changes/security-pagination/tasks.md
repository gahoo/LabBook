# 任务拆解：分页与内存溢出防御

- [x] 1. **修复自带分页的接口上限**：在 `/api/admin/delivery-logs` 中限制 `limit` 参数的最大值，例如 `Math.min(parseInt(limit as string) || 50, 500)`。
- [x] 2. **修补依情况全量捞取接口 (`violation-records`, `audit-logs`, `reports/violations`, `reports`)**：对这些包含可选 `startDate` (或 `start_date`) 和 `endDate` (或 `end_date`) 的接口增加校验。如果没有提供必需的时间或提供范围超过 366 天，则抛出 400 错误。
- [x] 3. **编译与验证归档**：使用 `tsc --noEmit` 确定没有引入新类型的语法错误，确认完成后更新至 TOC。
