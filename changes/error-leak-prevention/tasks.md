# 任务拆解：修复错误信息泄漏

- [x] 1. **定义异常类**：在 `server.ts` 顶部声明 `OperationRejectError`。
- [x] 2. **改造用户端接口 - 取消预约 (`/api/reservations/cancel`)**：将业务 `throw new Error` 替换为 `OperationRejectError`，并修改其外层的 `catch` 块进行信息隔离。
- [x] 3. **改造用户端接口 - 上机 (`/api/reservations/checkin`)**：将业务 `throw new Error` 替换为 `OperationRejectError`，并修改其外层的 `catch` 块进行信息隔离。
- [x] 4. **改造用户端接口 - 下机 (`/api/reservations/checkout`)**：将业务 `throw new Error` 替换为 `OperationRejectError`，并修改其外层的 `catch` 块进行信息隔离。
- [x] 5. **改造管理端接口**：处理 `/api/admin/violation-records/simulate`、`/api/admin/notifications/test-connection` 和 `/api/admin/notifications/test-event` 的 `throw` 及 `catch` 逻辑，在暴露堆栈的同时增加前缀标明系统级别错误。
- [x] 6. **编译验证与收尾**：执行 `npx tsc --noEmit` 保证无语法错误，并在 `changes/TOC.md` 中标记完成。
