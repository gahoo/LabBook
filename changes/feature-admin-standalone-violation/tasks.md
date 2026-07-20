# 任务拆解与进度清单 (Tasks)

- [x] **1. 后端：实现新增违规记录接口**
  - 在 `server.ts` 中实现 `POST /api/admin/violations` 路由。
  - 增加白名单验证，拦截非人工违规类型的录入请求。
  - 实现 `booking_code` 验证逻辑（查询预约、比对 `student_id`，失配时抛出 400 错误）。
  - 执行 `violation_records` 的 `INSERT` 逻辑。
  - 触发 `evaluatePenaltiesOnViolation` 和系统通知服务（`sendNotification`）。
  
- [x] **2. 前端：开发违规录入表单组件 (Modal)**
  - 创建独立的表单 Modal 组件（可置于 `Admin/components` 下或直接写在 `ViolationsAndPenaltiesTab.tsx` 内部）。
  - 实现表单字段收集（学号、预约码、违规类型、时间、说明）。
  - 接入 `POST /api/admin/violations` 接口。
  - 完善接口错误回显机制（如捕获 400 错误并在表单中提示）。

- [x] **3. 前端：更新违规记录列表视图**
  - 在 `ViolationsAndPenaltiesTab.tsx` 顶部添加“+ 手动录入违规”操作按钮，绑定 Modal 的弹出。
  - 提交成功后关闭 Modal 并刷新列表。
  - 检查并在列表的列渲染中确保 `student_name` 降级显示（即当姓名为 `null` 时回退展示 `student_id`）。

- [x] **4. 收尾：文档更新**
  - 在 `changes/TOC.md` 中登记该功能并标记为已完成。
