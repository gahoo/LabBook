# 任务清单

- [x] **任务 1：废除旧的辅助函数与冗余逻辑**
  - 删除 `matchPenaltyRule` 与此前基于 Reservation 扫描的代码，纠正技术方向。

- [x] **任务 2：实现后端的规则模拟计算 API (`/simulate`)**
  - 新增 POST 路由 `/api/admin/penalty-rules/simulate`。
  - 读取出入参的规则配置，查阅历史 `violation_records`，输出符合该阈值规则待处罚的 `student_id` 及相关记录。

- [x] **任务 3：重构次级匹配列表抽屉组件 (ViolationsPreviewDrawer)**
  - 将原先按 Reservation 展示的维度，重构为按「用户 (Student)」展示。
  - 调用 `simulate` 接口获取受影响用户名单。
  - 修复多抽屉覆盖与布局遮挡问题。确保即使在关闭时，也不会在桌面端遮挡屏幕右侧操作区域。

- [x] **任务 4：重构针对 SQLite 的批量写入 API**
  - 建立针对下发真实惩罚 (Penalty) 而不是违规记录 (Violation Record) 的批量写入，确保原子性。

- [x] **任务 5：整合验证与提交**
  - 根据选中的用户，批量调用 Penalty 接口，实现追溯下发。
  - 清理调试日志和不必要的依赖。
