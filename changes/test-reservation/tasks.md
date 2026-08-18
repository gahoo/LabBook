# Reservation 模块重构任务拆解

- [ ] **1. 编织极限测试网**：编写 `tests/03_reservations.test.ts`，覆盖上述 6 大维度约 60 个测试用例。
- [ ] **2. 抽离 Service 层**：将预约的创建、校验、更新、取消、状态流转逻辑从 `server.ts` 抽离到 `src/modules/reservation/service.ts`。
- [ ] **3. 抽离 Routes 层**：建立 `src/modules/reservation/routes.ts`，接管 `/api/reservations` 和 `/api/admin/reservations` 相关路由。
- [ ] **4. 收尾清理**：删除 `server.ts` 中的旧代码，并运行全量测试验证。
