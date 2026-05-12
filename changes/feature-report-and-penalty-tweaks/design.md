# 设计方案：报表与惩罚功能优化

## 1. 报表界面优化：仪器列防溢出换行
在 `ReportsTab.tsx` 中的“详细预约记录表”部分，目前“仪器”列未限制最大宽度。
- **改动方式**：为其所在 `<td>` 的内部 `<span>` 添加 `max-w-[150px]` (或合适的数值，如 `200px`) 以及 `whitespace-normal break-words` 类，确保当仪器名称过长时自动换行，避免撑开整个表格导致横向滚动。

## 2. 临期取消阈值单位调整为“分钟”并支持全局/独立双层设置
目前的“临期取消阈值”在系统级以“小时”为单位（对应的数据库配置键为 `violation_late_cancel_hours`）。
同时，缺少针对单个仪器的独立配置。

### 2.1 数据库结构与服务端改动 (`server.ts`)
1. 初始执行全局配置的数据迁移与兼容：
   - 检查 `settings` 表是否包含 `violation_late_cancel_minutes`。
   - 若不包含，取出旧的 `violation_late_cancel_hours` 的值，乘以 60 后插入新行 `violation_late_cancel_minutes`。
   - **迁移完成后，删除旧的 `violation_late_cancel_hours` 记录**，保持数据库整洁。
2. 拦截并处理取消预约（在取消 API 中判断是否临期）：
   - `lateCancelMinutes` 优先从当前 `equipment.availability_json` 中的 `lateCancellationMinutes` 读取。
   - 若仪器未设置此字段，则退化至查询全局配置 `violation_late_cancel_minutes`（默认 120 分钟）。
   - 将原先 `now >= startTime - lateCancelHours * 60 * 60 * 1000` 的逻辑修改为 `now >= startTime - lateCancelMinutes * 60 * 1000`。
3. 提供给前端获取或更新配置接口时，改用 `violation_late_cancel_minutes`。

### 2.2 全局参数界面 (`ViolationParamsTab.tsx`)
- 找到 `lateCancelHours` 的 state，将其重命名为 `lateCancelMinutes`。
- 修改输入框的 label 为“临期取消阈值 (分钟)”，说明文字相应调整。
- 从接口加载和保存时直接读写这个数字。

### 2.3 仪器独立配置界面 (`EquipmentForm.tsx` & `BatchEditEquipmentForm.tsx`)
- 在 `availability_json` 的解析结构中添加 `lateCancellationMinutes` 属性。
- `EquipmentForm.tsx`: 增加“临期取消阈值 (分钟)”输入框。如果是空或未设置，向用户提示“留空则使用全局默认设置”。
- `BatchEditEquipmentForm.tsx`: 增加对 `lateCancellationMinutes` 的批量修改选项（勾选后再输入修改值，或者清空以恢复全局）。

## 3. 报表统计：时长费用统计相关优化
用户需要看到“上机时长”、“预约时长”和“时长利用率”，并增加“按仪器”统计的维度，以及调整“详细预约请求”的列显示。

### 3.1 时长利用率的计算逻辑说明
对于“时长费用统计表”级别的聚合情况，**推荐采用“用总的实际上机时长 ÷ 总的预约时长”的方法进行计算**。
**理由**：
1. **宏观资源视角的准确性**：这种方法能真实反映资源的整体利用水平。例如，预约一个十小时的实验只做了一小时（利用率10%，浪费9小时），跟预约一个半小时的实验做了半小时（利用率100%，无浪费），如果平均两者的利用率得出 (10%+100%)/2 = 55%，这掩盖了长时段预约带来的巨大浪费。而用总时长算（1.5小时 / 10.5小时 = 14%），能直观凸显出该资源/该用户导致了严重的资源空置。
2. **抗干扰能力**：平均个体的利用率很容易被大量零碎、短时的预约（常常是100%利用率）拉高均值，导致实验室管理方误以为利用率很好，实际上大段时间被闲置。

### 3.2 服务端改动 (`server.ts`)
- 在时长费用统计接口 `/api/admin/reports/stats` 中：
  - 引入 `booked_hours`（预约时长）的计算逻辑：即 `end_time` - `start_time`。
  - 保留并更名实际时长变量：`actual_hours` 或 `machine_hours`（实际上机时长）。
  - **新增“按仪器”聚合**：建立 `equipmentMap`，按 `equipment_id`（或名称）对时长和费用进行聚合汇总，同样统计 `machine_hours`, `booked_hours` 和 `total_revenue`。返回前端时新增一个 `usageByEquipment` 数组。

### 3.3 报表详细预约记录优化 (`ReportsTab.tsx` / `server.ts`部分过滤)
- 拆分原本的“时长/费用”列为“时长”和“费用”两列。
- **时长列显示**：要显示实际上机时长，同时在下方（或旁边）显示这单的**时长利用率**（格式如 `85.5%`）。
- **筛选条件拆分与扩充**：
  - 将原有的 `statsFilterDurationMin` 等拆分成针对“实际上机时长”和“总费用”的筛选。
  - 新增“时长利用率”筛选输入的范围边界（如 `0 ~ 100` 或 `> 80`等比例形式）。
  - 这部分筛选目前是在前端对拉取到的 `allReservations` 做的遍历过滤（也有部分是在后端），我们需要在前端的 `paginatedReportReservations` 计算前的过滤逻辑加上：
    - 时长：`res.actual_hours >= min && res.actual_hours <= max`
    - 费用：`res.total_cost >= min && res.total_cost <= max`
    - 利用率：按每单算实际除以预约的百分比去筛选。

### 3.4 报表按不同维度展现前端改动 (`ReportsTab.tsx`)
- 在“用户”、“导师”的维度选择（可能是 Tab 或 Dropdown）旁，**加入“仪器”维度**。
- 如果选中“按仪器”，表格的列首显示为“仪器名称”，并渲染 `usageByEquipment` 的数据。
- 图表组件同理，X轴换为仪器名称显示。
- 表头部分更新：所有的“总时长”改为“上机时长”。同时新增“预约时长”和“时长利用率”表头。对于所有维度，时长利用率 = `(machine_hours / booked_hours) * 100 %`。
- 导出 (`exportToCSV`)：确保包含了上述新的统计维度数据及相关分析列。

### 3.5 统计图表与数据表的筛选联动机制完善
目前，系统中的“数据统计”表（按用户、导师、仪器级别聚合）在 `/api/admin/reports/stats` 服务端完成。在此基础上：
1. **统一前端筛选同步（联动机制缺失修复）**
   - 当前“与详细记录筛选联动”开关开启时，仅在前端重算了 `usageByTime` 供图表使用，但 `usageByPerson`、`usageBySupervisor`、`usageByEquipment` 仍直读服务端静态下发的数据。
   - **修复方案**：若开启联动开关，则在前端同步监听过滤后的 `filteredReportReservations` 数据，利用 `useMemo` 分别实时聚合成 `syncedUsageByPerson`、`syncedUsageBySupervisor`、`syncedUsageByEquipment` 并替换原本供数据表消费的数据源，以确保各个维度无论是图表还是数据表都能保持同等粒度的数据联动。
2. **UI 改进与精简**
   - 现有的开关文案“与详细记录筛选联动”占据较大可视空间，且含义直白但冗长。
   - **改进方案**：将其精简为“联动”或“条件联动”，并增加 `title` 的悬浮 Tooltip 气泡提示（如：“启用后，统计数据将根据下方的详细记录筛选条件实时重新计算”），以提升界面美观度和操作体验。
