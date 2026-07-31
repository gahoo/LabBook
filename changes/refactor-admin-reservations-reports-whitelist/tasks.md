# 任务拆解与进度清单

## 前端准备 & API 重构阶段

- [ ] 1. **清理废弃接口与组件**
  - [ ] 后端 (`server.ts`): 删除 `GET /api/admin/reports`, `PUT /api/admin/reports/reservations/:id`, `DELETE /api/admin/reports/reservations/:id`, `GET /api/admin/reports/violations` 等相关路由。
  - [ ] 前端: 删除 `src/pages/Admin/components/ReportsTab.tsx` 和 `src/pages/Admin/components/WhitelistAppsTab.tsx`。
- [ ] 2. **增强列表与重构更新接口**
  - [ ] 后端 (`server.ts`): 增强 `GET /api/admin/reservations` 返回 `reportStatus` 和 `total_cost`，支持日期过滤。
  - [ ] 后端 (`server.ts`): 合并并增强 `PUT /api/admin/reservations/:id`，支持状态流转以及当实际上机时间改变时系统违规的计算。
- [ ] 3. **新增聚合统计接口**
  - [ ] 后端 (`server.ts`): 新增 `GET /api/admin/reservations/stats` 接口生成统计数据（时长、人员、导师、仪器等维度聚合）。
- [ ] 4. **规范化违规 API 路由**
  - [ ] 后端 (`server.ts`): 将原有 `violation-records` 路径统一替换为 `violations`（例如 `revoke`, `restore`, `reject-appeal`）。
  - [ ] 后端 (`server.ts`): 新增 `PUT /api/admin/violations/:id` 用于修改人工违规（修改类型和备注）。

## 前端组件重构阶段

- [ ] 5. **顶层导航与白名单入口改造**
  - [ ] 前端 (`src/pages/Admin/index.tsx`): 移除 ReportsTab 和 WhitelistAppsTab，在仪器管理 Tab 上实现待审批白名单的小红点逻辑。
  - [ ] 前端 (`src/pages/Admin/components/EquipmentManagementTab.tsx`): 在仪器卡片/详情下嵌入轻量级白名单待审批列表（支持审批和驳回）。
- [ ] 6. **构建统一预约看板骨架**
  - [ ] 前端: 创建 `UnifiedReservationsTab.tsx` 替代 `ReservationsTab.tsx`，包含三个子 Tab（预约记录、时长费用统计、统计图表）。
  - [ ] 前端: 在看板顶部实现“白名单快捷审批 Banner”（内联显示 3-5 条申请并支持原地处理）。
- [ ] 7. **编辑抽屉深度拆分**
  - [ ] 前端: 重构或新建 `ReservationEditDrawer.tsx`，将其物理划分为 3 个 Tab。
  - [ ] Tab 1 (预约信息): 独立保存基本预约数据（姓名、时间、状态等）。
  - [ ] Tab 2 (上机信息): 独立保存实际上机信息、耗材等，触发系统违规及费用重算。
  - [ ] Tab 3 (违规记录): 对接新的 RESTful 违规接口，实现人工违规的增删改以及展示系统违规。
- [ ] 8. **列表与图表对接联调**
  - [ ] 前端: 在 `UnifiedReservationsTab` 内实现全新的主表格并接入 `GET /api/admin/reservations`，实现双层状态展示及 Hover 信息弹窗。
  - [ ] 前端: 接入 `GET /api/admin/reservations/stats` 渲染图表组件，完善“只看未到期”等过滤栏逻辑。
