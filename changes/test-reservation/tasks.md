# Reservation 模块重构任务拆解

- [x] **1. 编织极限测试网 (二次拆解)**：
  - [x] **1.1 修复假阳性与缺失分支**
  - [x] **1.2 补全生命周期与状态机测试**
  - [x] **1.3 补全修改与管理端副作用测试**
  - [x] **1.4 TDD安全网极致强化 (初步)**
  - [ ] **1.5 TDD安全网最终硬化 (The Last Mile)**:
    - [x] 费用“精确计算”绝对断言 (包含小时向上取整、按次计费、耗材费叠加)。
    - [x] 补齐 Happy Path 成功签到路径断言 (状态落库、`actual_start_time` 写入)。
    - [x] 补全 Cancel 操作对 `completed` 终态的拦截。
    - [x] 补齐 Update 操作的失败分支 (冲突、超时长、过去时间、非法状态、事务回滚验证)。
    - [x] 恢复 `release_noshow_slots` 临界点释放测试。
    - [x] 补充 Admin 列表筛选、统计空结果边界、非法输入兜底测试 (404 未知 Code, 异常参数)。
- [ ] **2. 抽离 Service 层**：将预约的创建、校验、更新、取消、状态流转逻辑从 `server.ts` 抽离到 `src/modules/reservation/service.ts`。
- [ ] **3. 抽离 Routes 层**：建立 `src/modules/reservation/routes.ts`，接管 `/api/reservations` 和 `/api/admin/reservations` 相关路由。
- [ ] **4. 收尾清理**：删除 `server.ts` 中的旧代码，并运行全量测试验证。
