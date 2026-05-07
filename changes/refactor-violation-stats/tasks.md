# 违规统计重构任务拆解

## 任务 1：重构后端统计聚合 API (`server.ts`)
**目标路径**：`app.get('/api/admin/reports/violations')`
**操作步骤**：
1. **参数解析**：提取 query 参数 `dimension` (枚举值为 `user` (默认), `supervisor`, `equipment`)。
2. **基数查询 (Reservations)**：
   - 增加对 `reservations` 表同一时间段 (`start_time >= ? AND start_time <= ?`) 的全量查询或预先完成基于不同维度的 `GROUP BY` 及 `COUNT(1) as total`。
3. **内存聚合重构**：
   - 将原有的 `personMap` 重构为泛型的 `statsMap`。依据 `dimension` 的不同取值，提取 `violations` 中的 `student_id`, `supervisor` 或 `equipment_id` 作为 Map 的键。
   - 在累加违规次数的 `switch` 逻辑中，增加 `duration_minutes` 的捕捉。比如 `v_type === 'late'` 时：`stats.total_late_minutes += (v.duration_minutes || 0)`。
   - 对所有的固定手动违规类型（如 `equipment_damage`, `uncleaned_workspace` 等），在对象中维护对等的独立计数器，而不是将其统一合并。
   - 对违规相关信息做子级计数聚合以便找寻 `top_equipment` 或 `top_student`。
4. **属性合并与侧写植入**：
   - 遍历 `statsMap` ，将提前查询到的 reservation 基数按照对应的 key 塞入 `total_reservations` 字段并计算计算违规率 `violation_rate`。
   - 如果是 user 维度，查询 `user_penalties` 若有符合该用户现在有活跃惩罚的时间判断，标记 `active_penalty = true`。
5. **排序输出**：继续沿用原有的基于总违规次数 `total_violations` 和违规率的综合排序返回前端。

## 任务 2：前端增加维度切换组件和状态 (`src/pages/Admin/components/ViolationsAndPenaltiesTab.tsx`)
**操作步骤**：
1. 提取或增加 React state `statsDimension: 'user' | 'supervisor' | 'equipment'`，默认赋初值为 `user`。
2. 在图表/表格上方的控制栏（比如日期选择器旁边）追加一个“按钮组 (Segmented Control / Button Group)”，包含 [按用户] / [按导师] / [按设备]。点击时变更 `statsDimension`。
3. **改造自适应筛选器与双轴过滤**：
   - 搜索框改造为多维度匹配（根据 `dimension`）。
   - 将原针对迟到、超时的过滤筛选器进行拆分或扩展，增加对 `total_late_minutes` 和 `total_overtime_minutes` 的阈值输入判定。
4. 修正 API 请求：把 `statsDimension` 作为 query 参数 `&dimension=` 加在现有的 fetch URL 后面。并在其变更时触发重新 fetch。

## 任务 3：优化前端表格与图表结构 (`src/pages/Admin/components/ViolationsAndPenaltiesTab.tsx`)
**操作步骤**：
1. **动态第一列**：根据不同维度渲染第一列表头为 `用户名/学号`、`导师名称` 或 `设备名称`。并提取对应的 `name` 属性（由后端统一组装为 `name` 字段）。
2. **重塑现有列显示**：
   - 迟到：展示格式修改为 `{s.late_count} 次 ({s.total_late_minutes} 分钟)`。
   - 超时：展示格式修改为 `{s.overtime_count} 次 ({s.total_overtime_minutes} 分钟)`。
3. **增加新列**：
   - **平铺手动违规列**：将每种固定的“其他违规类型”渲染为单独的列（如：未清理桌面、未关电源、仪器损毁等），展示对应计数值。
   - “总预约量” 列：展示 `{s.total_reservations}`。
   - “违规率”列：展示百分比即可计算得到 `((s.total_violations / total_reservations) * 100).toFixed(1)%`。
   - **动态辅助列**：若当前维度为 User，渲染 “主要出事仪器” 及用红色 Badge 标识出其 `active_penalty`（例如：[受限中] 枚举出）。若是 Supervisor 呈现最常违规的学生等。

## 潜在挑战及注意点
1. **性能与内存防御 (避免 N+1 数据库雪崩)**：
   **核心红线约束**：我们在渲染 200 个使用者的受罚状态时，**绝不容许**在 Node.js 的循环体内容中发起类似于 `user_penalties.get(userId)` 的微小查询。如果循环 200 次，等于并发压给 SQLite 200 个单条查询。
   **规避做法**：进入代码前，使用一次性查询 `SELECT * FROM user_penalties WHERE status = 'active'` 取出全量激活态黑名单（约几个查询操作），将其转换为 JS `Map / Object`。当循环统计用户侧写时，直接使用 `penaltyMap.has(user.id)` 执行内存级别碰撞匹配。这保证了哪怕系统跑了十万条预约并发，查询损耗永远保持极限性能 (`O(1)`)。
2. **界面留白与拥挤度**：新增数列必定极大增加表格水平宽度。可以考虑合并单元格的内容（比如迟到和其分钟数放同一个单元格，主副标题字号对比）。避免界面在 1080P 以下笔记本出现灾难性的水平滚动而难以对照表头。
