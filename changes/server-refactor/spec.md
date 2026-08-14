# Server.ts 垂直切片与解耦重构 规格说明书

## 背景
`server.ts` 超过 4300 行，业务逻辑、路由、数据库定义和定时任务高度耦合。为提升可维护性，将采用“测试驱动开发（TDD）”原则进行**垂直切片（Vertical Slicing）**式的渐进重构。

## 核心重构原则
1. **测试与重构交织（Tracer Bullets）**：
   - 绝不提前写完所有测试。
   - 每进入一个重构步骤前，先针对**该步骤涉及的公共接口（HTTP Seams）**编写对应的 API 黑盒特征测试。
   - 通过接口的可观测行为（Observable Behavior）进行断言，不直接断言私有内部状态。
2. **零逻辑变更（原样迁移）**：第一阶段绝对不改变现有的业务逻辑和校验规则，仅做物理文件的移动和结构解耦。
3. **领域垂直切片**：按照业务域（Auth, Reservation, Violation等）划分目录，每个目录包含自身的 `routes.ts` 与 `service.ts`。
4. **共享资源抽离**：纯工具集沉淀至 `src/lib/`，中间件沉淀至 `src/middleware/`。

## 目标目录结构
```
server.ts                        ← 仅保留入口：注册中间件、路由总线及环境判断
src/
  config.ts                      ← 全局配置及环境变量
  db/
    connection.ts                ← Database 实例
    schema.ts                    ← 最终表结构
    migrations.ts                ← 迁移脚本
  lib/
    errors.ts                    ← 自定义错误类
    crypto.ts                    ← 令牌加解密
    validators.ts                ← 公共校验逻辑
  middleware/
    auth.ts                      ← 鉴权中间件
    rateLimiter.ts               ← 限流器
  modules/
    auth/routes.ts               
    equipment/routes.ts & service.ts                 
    reservation/routes.ts & service.ts                 
    violation/routes.ts & service.ts & scanner.ts
    notification/routes.ts & scanner.ts           
    calendar/routes.ts           
    whitelist/routes.ts          
    settings/routes.ts           
    audit/routes.ts              
    scheduler/service.ts
    backup/service.ts
```

## 测试接缝（Seams）与 Mock 策略
- **接缝**：以 Express 路由（`supertest`）为第一接缝。对于极为复杂的逻辑（如 `checkUserPenalty`），在重构导出为独立模块后，可作为第二接缝补充白盒单元测试。
- **Mock**：绝对不 mock SQLite 驱动。使用内存数据库运行真实 SQL。通过 Vitest 的 `vi.useFakeTimers()` 进行时间穿梭，验证超期、宽限期等强时间相关逻辑。
