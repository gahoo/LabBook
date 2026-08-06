# 测试基建 (Test Infrastructure Setup) 规格说明书

## 背景
在进行 `server.ts` 垂直切片重构前，必须具备自动化测试能力。但为了避免陷入“水平切片（Horizontal Slicing）”的反模式，本阶段**绝不提前编写所有业务 API 的测试**，而是专注于搭建纯粹的、无副作用的**测试基础设施**。

## 目标
1. **测试引擎与工具链**：引入 `vitest` 与 `supertest`。
2. **纯粹的隔离环境**：
   - 使用内存数据库（`:memory:`）或独立的测试临时库，保证快速且不污染真实数据。
   - 彻底旁路或隔离会导致测试阻塞的外部副作用：禁用后台 Cron 定时任务、禁用启动时的端口监听。
3. **系统边界 Mock 机制**：
   - 拦截网络出口：Mock `nodemailer` 和全局 `fetch`（阻断 Webhook）。
   - 时间操纵：引入 Vitest 的虚拟时钟（Fake Timers），以便后续在不等待真实时间的情况下测试“自然月过期”、“15分钟爽约”等时间敏感逻辑。
4. **单点探路（Tracer Bullet）**：
   - 本阶段仅编写一个最基础的健康检查测试（如 `00_setup_health.test.ts`），证明“测试框架可以脱机启动 Express 应用、访问 API 并操作内存数据库”即可。

## 文件结构设计
```
tests/
  setup.ts                   ← 全局钩子：环境变量注入、虚拟时钟初始化、全局 Mock
  utils/
    db-helper.ts             ← 提供内存库初始化、数据快速 Seeding 的工具函数
    auth-helper.ts           ← 提供快速签署有效 Admin JWT 的工具
  00_setup_health.test.ts    ← 探路测试，验证基建连通性
vitest.config.ts             ← 测试运行器配置
```
