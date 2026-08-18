# Reservation 模块重构任务拆解

- [ ] **1. 编织极限测试网 (二次拆解)**：
  - [ ] **1.1 修复假阳性与缺失分支**：修复 REQUIRE_APPROVAL 断言陷阱、精确化晚取消自定义阈值验证；补齐非营业时间默认拒绝、时间极性非法 (`end <= start`)、首尾相接允许 (`A.end == B.start`) 等缺失分支。
  - [ ] **1.2 补全生命周期与状态机测试**：完整覆盖 `Check-in` (提前上机拦截、迟到判断) 和 `Check-out` (超时、费用与耗材结算验证)；覆盖越级/错误的状态流转拦截 (如 `pending` 直接 `checkout`)。
  - [ ] **1.3 补全修改与管理端副作用测试**：覆盖 `Update` 时的全量规则重新校验 (冲突、超长、营业时间、每日上限等)；覆盖查询接口参数校验；测试 Admin 列表筛选、审批/拒绝的副作用 (如拒绝后槽位是否正确释放) 以及物理删除功能。
- [ ] **2. 抽离 Service 层**：将预约的创建、校验、更新、取消、状态流转逻辑从 `server.ts` 抽离到 `src/modules/reservation/service.ts`。
- [ ] **3. 抽离 Routes 层**：建立 `src/modules/reservation/routes.ts`，接管 `/api/reservations` 和 `/api/admin/reservations` 相关路由。
- [ ] **4. 收尾清理**：删除 `server.ts` 中的旧代码，并运行全量测试验证。
