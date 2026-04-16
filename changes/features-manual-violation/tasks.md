# 任务列表：管理员手动标记违规 (features-manual-violation)

- [x] 1. 后端 `server.ts`：全局替换 `status = 'invalid'` 为 `status = 'revoked'`，统一状态机。
- [x] 2. 后端 `server.ts`：在 `PUT /api/admin/reports/reservations/:id` 接口中接收 `manual_violations` 数组参数。
- [x] 3. 后端 `server.ts`：实现手动违规记录的 Diff & Sync 逻辑（新增 INSERT、更新 UPDATE、删除 REVOKE）。
- [x] 4. 后端 `server.ts`：复用 `remark` JSON 结构，将手动违规的备注存入 `admin_note` 字段。
- [x] 5. 前端 `ReportsTab.tsx`：在编辑预约的 Drawer 中增加“新增违规记录”按钮及动态列表 UI（类型下拉框、备注文本域、删除按钮）。
- [x] 6. 前端 `ReportsTab.tsx`：在打开编辑 Drawer 时，拉取并回显已存在的手动违规记录，解析 `admin_note`。
- [x] 7. 前端 `ViolationsAndPenaltiesTab.tsx` & `PenaltyRulesTab.tsx`：更新违规类型字典，支持展示和配置新增的 4 种人工违规类型（卫生不达标、违规操作、代预约、其他）。
- [x] 8. 前端 `ViolationsAndPenaltiesTab.tsx`：在违规明细表格中解析并展示 JSON 格式的 `remark` 中的 `admin_note`。
