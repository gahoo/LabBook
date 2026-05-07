# 违规统计重构方案 (Violation Stats Refactoring)

## 回应反馈与思路概述

1. **迟到/超时时长**：当前数据库 `violation_records` 其实已经记录了 `duration_minutes`。我们只需在聚合时，对 `late` 和 `overtime` 进行 `sum` 操作并返回至前端，前端可以渲染成类似 `3次 (共 45分钟)` 的直观效果。
2. **“其他违规”归拢**：后端手动添加的违规可能带来各种自定义文字，作为独立列不仅会无限制撑宽表格破坏排版，且不利于排序。将其统一归纳为“其他违规(手动)”的数量列，是保持表格扩展性最好的方案，具体的说明可以通过 hover 或点击下钻查看。
3. **顶部的维度切换器**：非常标准的仪表盘做法，在表格/图表上方设置 `[按用户] | [按导师] | [按仪器]` 的圆角切换按钮（Segmented Control），直观且操作成本低。
4. **基数指标（总预约量与违规率）**：这是一个极其高价值的北极星指标。实现逻辑上，我们不在 SQL 层做极为复杂的各种 JOIN，而是在 Node.js 内存里：
   - 查出同期的 `violations` 列表。
   - 查出同期的 `reservations` 进行 `GROUP BY` 并求 `COUNT`。
   - 将两者在 JS 循环中用 Hash Map 合并。这兼顾了性能（由于都是本地单表时间段查询）并降低了业务逻辑关联耦合。

## 1. 维度切换与自适应双轴筛选架构 (Dimension Toggles & Adaptive Dual-Axis Filters)
- 引入控制状态 `dimension: 'user' | 'supervisor' | 'equipment'`。
- **筛选器自适应与双轴过滤**：
  - 统计图表/表格上方的文本搜索框、总违规次数字段筛选必须跟随维度进行多态响应。例如，在 Supervisor 维度下，输入框的占位符应变为“搜索导师...”。
  - 对于“迟到”和“超时”这种既有次数此时又有“时长”概念的字段，过滤组件将从单一的“次数大于”扩展为**双轴控制**：“迟到次数 ≥ X 次” 以及 “迟到总时长 ≥ Y 分钟”，赋予管理员更为精准的管控抓手。
- 请求后端接口 `/api/admin/reports/violations?dimension=...` 获取对应维度的聚合报告。

## 2. 后端数据结构增强 (Enhanced Metrics)
针对所有的聚合对象，其返回结构将被统一并扩展：
- `key`: 聚合键（student_id / supervisor_name / equipment_id）
- `name`: 展示名称（学生名 / 导师名 / 仪器名）
- 现有违规计数列保持不变：`late_count`, `overtime_count`, `no_show_count`, `cancelled_count`。
- **新增累计指标**：`total_late_minutes`, `total_overtime_minutes`。
- **扩展手动违规项**：鉴于归拢项会导致过滤复杂度上升且无法精准定位特定违规类型，我们将采用**展开式（平铺）计算**。对于系统现有的、固定的手动违规枚举类型（如：损毁仪器、未清理等），直接设为独立的统计字段，并在前端表格上体现为独立的列。
- **新增基数指标**：`total_reservations` (同期总预约量) 和 `violation_rate` (违规率 = 总违规 / 总预约)。

## 3. 辅助侧写字段 (Contextual Columns)
为不同的统计维度提供“侧写”，帮助管理员一眼把握关键信息。

- **按用户统计 (User Dimension)** 特有：
  - `top_equipment`: 该用户最常违规的仪器，通过拼接或提取次数最多的仪器实现（例如 “TEM (3次)”）。
  - `active_penalty`: 布尔值或字符串，表明当前是否有生效中的限制（从 `user_penalties` 表中查得）。
- **按导师统计 (Supervisor Dimension)** 特有：
  - `top_student`: 违规次数最多的组内学生。
- **按仪器统计 (Equipment Dimension)**：
  - 聚焦在“这台仪器经常遇到哪类违规”（自带，无需额外字段）。

## 4. 图表兼容
现有的 Recharts 图表可以与表格做相同的适配。只要后端的返回字段名统一（比如用户对象的 `.name`、导师的 `.name`、仪器的 `.name`），前端的 BarChart 就能无缝渲染出前 N 名违规人/导师/设备。
