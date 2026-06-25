# 规格说明书：修复错误信息泄漏 (Error Leak Prevention)

## 1. 业务背景
在代码审计报告的第 10 项中指出，应用层中的多个 `try-catch` 块将 `error.message` 直接返回给前端客户端。这种做法可能会在发生数据库查询失败、连接失败等系统异常时，把底层的栈追踪（Stack trace）或 SQL 错误细节暴露给外部，从而构成信息泄露的安全风险。

## 2. 方案分析与确认
由外部 AI 提供的设计方案 `implementation_plan.md` 是合理且优雅的。直接在应用层一刀切地屏蔽所有 `error.message` 会导致正常的业务提示（如“只能在预约开始前 30 分钟内上机”）失效，极大地损害用户体验。

该方案提出了**区分业务异常与系统异常**的核心思路：
1. **引入自定义错误类 `OperationRejectError`**：用于标记“用户的操作被业务规则拒绝”的场景。
2. **替换业务报错**：将涉及业务规则的 `throw new Error(...)` 替换为 `throw new OperationRejectError(...)`。
3. **拦截重构**：在用户端接口（如取消预约、上机、下机）的 `catch` 块中，通过 `instanceof OperationRejectError` 判定错误类型。如果是业务错误，则原样返回提示；否则，拦截原始 `error.message`，控制台打印错误详情，对外仅返回统一的提示语（如“服务器内部错误，请重试”）。
4. **管理端接口隔离**：针对需要管理员排错的内部接口（如模拟执行惩罚、测试 Webhook 等），仍可以在返回中暴露 `error.message`，并增加明确的前缀。

## 3. 具体修改设计
### 3.1 增加 `OperationRejectError` 声明
在 `server.ts` 顶端引入：
```typescript
class OperationRejectError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'OperationRejectError';
    this.statusCode = statusCode;
  }
}
```

### 3.2 替换和改造业务端接口 (用户路由)
涉及接口及替换内容：
*   **`POST /api/reservations/cancel`** (取消预约)
    *   3处业务规则 `throw` 替换。
    *   `catch` 拦截未知异常并返回 `500` 与 `"取消预约失败，请重试"`。
*   **`POST /api/reservations/checkin`** (上机)
    *   4处业务规则 `throw` 替换。
    *   `catch` 拦截未知异常并返回 `500` 与 `"上机失败，请重试"`。
*   **`POST /api/reservations/checkout`** (下机)
    *   2处业务规则 `throw` 替换。
    *   `catch` 拦截未知异常并返回 `500` 与 `"下机失败，请重试"`。

### 3.3 改造管理端接口 (Admin 路由)
涉及接口：
*   **`POST /api/admin/violation-records/simulate`**
    *   无 `throw` 替换，直接修改 `catch` 返回 `"模拟执行失败: " + error.message`。
*   **`POST /api/admin/notifications/test-connection`**
    *   1处 `throw` 替换，修改 `catch`。
*   **`POST /api/admin/notifications/test-event`**
    *   2处 `throw` 替换，修改 `catch`。
