# Reservation 模块重构任务拆解

- [x] **1. 编织极限测试网 (二次拆解)**：
  - [x] **1.1 修复假阳性与缺失分支**
  - [x] **1.2 补全生命周期与状态机测试**
  - [x] **1.3 补全修改与管理端副作用测试**
  - [x] **1.4 TDD安全网极致强化 (Refine)**:
    - 修复了 Helper 中的入参错误（确保价格正确落表）。
    - 强化费用断言机制，精确计算按小时和按次计算的结算金额。
    - 增加真正的 Promise.all 并发抢占抢锁测试。
    - 增加 `403` 隐藏仪器校验、无效 Checkin、未找到记录等非法状态的严谨防护。
- [ ] **2. 抽离 Service 层**：将预约的创建、校验、更新、取消、状态流转逻辑从 `server.ts` 抽离到 `src/modules/reservation/service.ts`。
- [ ] **3. 抽离 Routes 层**：建立 `src/modules/reservation/routes.ts`，接管 `/api/reservations` 和 `/api/admin/reservations` 相关路由。
- [ ] **4. 收尾清理**：删除 `server.ts` 中的旧代码，并运行全量测试验证。
