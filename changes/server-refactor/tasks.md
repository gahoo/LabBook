# Server.ts 垂直重构任务拆解与进度清单 (TDD驱动)

> **实施约束**：以下所有步骤，必须遵循 **[写特征测试] -> [拆解抽离代码] -> [跑通测试确认无误]** 的严格循环。

## 分步实施计划

- [x] **步骤 1：提取 `src/config.ts`**  
  将 `dotenv` 引入与环境变量获取抽出。

- [x] **步骤 2：提取 `src/db/connection.ts` + `schema.ts` + `migrations.ts`**  
  分离 Database 实例化、DDL 和数据迁移语句。

- [x] **步骤 3：提取 `src/lib/errors.ts` + `crypto.ts`**  
  分离公共 Error 类与加解密工具函数。

- [x] **步骤 4：提取 `src/middleware/auth.ts` + `rateLimiter.ts`**  
  *Tracer Bullet Test*: 编写 `01_auth.test.ts`（测登录接口与 401 拦截）。
  *Refactor*: 抽离 `adminAuth` 与限流器实例。

- [x] **步骤 5：提取 `src/modules/notification/`**  
  *Tracer Bullet Test*: 编写 `08_notification.test.ts`（验证投递日志路由，Webhook拦截是否生效）。
  *Refactor*: 抽离相关的通知测试与重试路由。

- [x] **步骤 6：提取 `src/modules/violation/`（核心复杂逻辑）**  
  *Tracer Bullet Test*: 编写 `04_violation_and_penalty.test.ts`（模拟违规上报、通过接口获取违规封禁状态）。
  *Refactor*: 剥离 `checkUserPenalty`、规则计算及申诉处理路由。

- [x] **步骤 7：提取 `src/modules/scheduler/service.ts`**  
  *Tracer Bullet Test*: 测试中利用虚拟时钟触发定时任务（如验证扫码未到的爽约扫描）。
  *Refactor*: 转移 `node-cron` 调度逻辑与备份任务。

- [x] **步骤 7.5：Scheduler 领域逻辑归位 (Domain Realignment)**
  *Refactor*: 纠正步骤 7 中的模块化坏味道。将 Scheduler 瘦身为纯粹的 Cron 编排层。将业务工作流（如 `executeBackup`, `upcomingReminderScan`, `scanForNoShows`）分别剥离并归位至 `backup/`, `notification/` 和 `violation/` 模块，确保高内聚和无循环依赖。

- [x] **步骤 8.1：编写测试 `07_settings_and_audit.test.ts`**
  已完成 tracer bullet 测试。
- [ ] **步骤 8.2：提取 `src/modules/settings/` 与 `src/modules/audit/`**  
  *Refactor*: 抽离系统设置及审计日志相关路由，**并建立 `service.ts` 封装核心逻辑**（如 `updateSettings` 触发的 Cron 重载，以及全局可用的 `recordAuditLog` 写入函数）。迁移路由：`/api/settings`, `/api/admin/settings`, `POST /api/admin/settings`, `/api/admin/audit-logs`。

- [ ] **步骤 8.3：清理残留违规路由**  
  *Refactor*: 将 `server.ts` 中遗漏的 `GET /api/admin/penalties/active`，**以及在设置路由区段的 `GET /api/admin/settings/violation-params`**，统一归位至 `violation` 模块（保持 URL 不变以防前端中断）。

- [ ] **步骤 9：提取边缘模块 `calendar` + `whitelist` + `auth`**  
  *Tracer Bullet Test*: 补齐日历 ICS 订阅流与白名单审批流程测试。
  *Refactor*: 分别建立独立路由并挂载。

- [ ] **步骤 10：提取 `src/modules/equipment/` + `lib/validators.ts`**  
  *Tracer Bullet Test*: 编写 `02_equipment.test.ts`（设备可用性算法时间冲突验证）。
  *Refactor*: 剥离设备 CRUD 逻辑及公共验证器。

- [ ] **步骤 11：提取 `src/modules/reservation/`**  
  *Tracer Bullet Test*: 编写 `03_reservation_lifecycle.test.ts`（重点测试越权拦截与状态流转）。
  *Refactor*: 抽离预约新建、修改、签到等最大块逻辑，优化克隆重复代码。

- [ ] **步骤 12：终极收尾与瘦身 `server.ts`**  
  清理所有残留函数，`server.ts` 仅做总线注册。执行全量 `npm run test`，验证圈复杂度显著下降。
