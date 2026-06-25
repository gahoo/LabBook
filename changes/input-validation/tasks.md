# 任务拆解：输入参数类型校验与 XSS 防护加固

- [x] 1. **增强 `/api/reservations` 校验**：在 `server.ts` 中针对预约创建接口，拦截非法类型和超长参数（限制姓名 100、邮箱 200）。
- [x] 2. **增强 `/api/whitelist/apply` 校验**：在 `server.ts` 中针对白名单申请接口，拦截非法类型和超长参数（限制姓名 100）。
- [x] 3. **增强 `/api/violations/my` 校验**：在 `server.ts` 中修改鉴权查询接口，确保入参为非空字符串。
- [x] 4. **增强 `/api/violations/:id/appeal` 校验**：在 `server.ts` 中修改申诉接口，确保入参为字符串且理由长度不超过 2000。
- [x] 5. **增强 `/api/reservations/update` 校验**：在 `server.ts` 中针对更新预约接口，确保关键参数为字符串类型。
- [x] 6. **增强 `/api/admin/penalty-rules/simulate` 校验**：在 `server.ts` 中修改模拟接口，防御非法对象和非字符串日期。
- [x] 7. **添加模板 XSS 转义**：在 `src/services/notificationService.ts` 中引入 `escapeHtml` 辅助函数，保护模板注入。
- [x] 8. **编译验证与归档**：执行 `npx tsc --noEmit` 保证无语法错误，并在 `changes/TOC.md` 中标记完成。
