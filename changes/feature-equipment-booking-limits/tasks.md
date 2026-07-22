# 仪器预约时长限制与闲忙时段功能开发任务清单

- [x] **Step 1: 数据模型与类型更新**
  - 在 `src/types.ts` 中更新与设备可用性配置（`availability_json`）相关的 TypeScript 接口，增加 `dailyMaxDurationMinutes` (number)、`allowExceedDuration` (boolean) 和 `peakHours` (Array<{start: string, end: string}>) 字段定义。

- [x] **Step 2: 管理端表单支持 (EquipmentForm)**
  - 在 `src/pages/Admin/components/EquipmentForm.tsx` 中增加 `dailyMaxDurationMinutes` 的数字输入框。
  - 增加 `allowExceedDuration` 的切换开关 (Toggle/Checkbox)。
  - 增加 `peakHours` 的动态列表组件，允许管理员添加、删除和编辑多个起止时间段，UI 交互逻辑可参考现有的开放时段 `rules`。

- [x] **Step 3: 管理端批量表单支持 (BatchEditEquipmentForm)**
  - 在 `src/pages/Admin/components/BatchEditEquipmentForm.tsx` 中同步增加上述三个字段的批量编辑项及对应的勾选生效逻辑。

- [x] **Step 4: 后端 - 峰时交集计算辅助函数**
  - 在 `server.ts` 中编写一个辅助函数 `calculatePeakAccumulatedMinutes(start, end, peakHours)`，用于计算给定预约时间段 `[start, end]` 与设备配置的多个忙时时段 (`peakHours`) 实际重叠的分钟数。

- [x] **Step 5: 后端 - 预约创建与修改时的约束校验**
  - 在 `server.ts` 中的 `POST /api/reservations` 和 `PUT /api/reservations/:id` 路由内：
    - 新增 SQL 查询，计算用户在对应设备当天已预约（`pending`, `approved`, `active`）的总时长。
    - 校验硬性上限：`当日已用时长 + 本次时长 > dailyMaxDurationMinutes` 时，返回 400 拦截。
    - 校验软性上限：当 `peakAccumulated > maxDurationMinutes` 时，若 `allowExceedDuration` 为 `false` 则返回 400 拦截；若为 `true` 则将最终预约状态修改为 `pending`。

- [x] **Step 6: 前端 - 预约界面时间格预览与判定重构**
  - 修改 `src/pages/Booking.tsx` 中的网格交互逻辑。
  - 在选定起点后，后续时间格悬浮/渲染时，动态计算 `offset` (总时长) 和 `peakAccumulatedMinutes` (峰时累计)。
  - 根据计算结果赋予相应样式：未超标为绿色虚线区，软超标为黄色虚线区，硬超标或遇到不可约时段则断开截断渲染。

- [x] **Step 7: 前端 - 预约转审批提示文案**
  - 在 `src/pages/Booking.tsx` 底部，当系统判定当前选中的区间落入“软超标”（即 `peakAccumulated > maxDurationMinutes` 且允许超时）时，在提交按钮上方显示警告提示：“⚠️ 您的预约占用了较多忙时资源，提交后将转为待审批状态。”

- [x] **Step 8: 整体联调与测试**
  - 运行系统，测试管理端设置能否保存、回显。
  - 测试前端选择时间的边界情况（如跨忙时、闲时连续拉长）。
  - 测试后端的拦截及转审批兜底是否成功。
