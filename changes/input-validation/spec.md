# 规格说明书：输入参数类型校验与 XSS 防护加固 (Input Validation)

## 1. 业务背景
代码审计报告中指出，系统在接收请求参数时缺乏强类型和边界长度限制，容易导致：
1. **服务端 500 崩溃**：如对非字符串类型的参数调用 `.trim()` 或 `.includes()`。
2. **存储型 XSS 风险**：用户输入的脏数据在被渲染到邮件模板等 HTML 上下文中时可能引发跨站脚本攻击。

为了保持系统轻量化，我们不引入 `Zod` 或 `Joi` 等庞大的验证库，而是采用原生 JavaScript 的 `typeof`、`length` 和简单的转义函数来实现防御。

## 2. 方案设计
基于外部提供的 `implementation_plan2.md` 方案，我们在保持现有业务逻辑不变的前提下，在各个容易崩溃或引发风险的 API 前置拦截脏数据：

1. **类型与边界限制拦截**：
    *   **公开端点 `/api/reservations`**：增加对必填字符串字段（姓名、导师、邮箱等）的类型和长度检查（姓名导师上限 100，邮箱上限 200），以及 `equipment_id` 的整数校验。
    *   **公开端点 `/api/whitelist/apply`**：同样增加字符串字段类型、非空和长度检查，以及 `equipment_id` 整数校验。
    *   **公开端点 `/api/violations/my`**：修复缺失的字符串类型校验，防止 `student_id: 123` 等数字绕过真实意图。
    *   **公开端点 `/api/violations/:id/appeal`**：增加字符串类型校验，并对用户输入的 `appeal_reason` 限制最大长度（如 2000 字符）。
    *   **公开端点 `/api/reservations/update`**：增加对 `booking_code`、`start_time`、`end_time` 的字符串类型校验。
    *   **管理端点 `/api/admin/penalty-rules/simulate`**：修复 `end_date.includes` 前缺乏字符串类型判断的问题。

2. **邮件模板的 XSS 实体转义**：
    *   修改 `src/services/notificationService.ts` 中的 `renderTemplate` 函数。
    *   对于通过 `{{ }}` 注入的动态用户数据，在进行替换前进行 HTML 实体转义（`<`, `>`, `&`, `"`, `'`），防止其破坏由管理员配置的 Markdown 结构或注入恶意脚本。
