# 仪器预约时长限制与闲忙时段功能开发方案 (Spec)

## 1. 需求背景与核心设计决策

为了更精细地管理仪器预约时长，防止资源被个别用户垄断，同时在低峰期提高仪器利用率，本次新增以下约束能力：
1. **单日预约总时长上限**：限制单个用户单日累计预约某台仪器的总时长。
2. **闲时/忙时差异化单次时长限制**：忙时受较短的时长限制，闲时可享受更长的时间（受限于日总上限）。
3. **超出限额转审批**：当用户预约超出“软性”约束时，转为“待审批（pending）”状态，交由管理员裁定。

### 核心设计决策
* **统一闲忙时段设置**：全周统一设定忙时时段（`peakHours`），未被划入的开放时间即为闲时。
* **追踪峰时累计占用量**：通过计算预约区间与所有忙时时段的实际重叠分钟数（`peakAccumulated`），结合日总时长，统一判定预约状态，取代“起讫点在哪个时段”的僵硬判定。
* **双轨限制**：`dailyMaxDurationMinutes` 为**绝对硬性上限**（不走审批通道，超过直接拒绝）；`maxDurationMinutes` 为**忙时累计软性上限**（超过可由开关控制是否转审批）。
* **前端近似日额度预览，后端真实校验兜底**：前端时间格不强依赖复杂的实时跨天日额度查询进行渲染，通过规则作基本推演（绿色/黄色虚线区），后端的事务提交时执行准确的总额度合并校验。

---

## 2. 数据结构变更

仪器的 `availability_json` 字段扩展以下属性：

```json
{
  "maxDurationMinutes": 60,            // 忙时累计占用软性上限（现有字段复用）
  "dailyMaxDurationMinutes": 240,      // 单日预约总时长硬性上限
  "allowExceedDuration": true,         // 是否允许突破 maxDurationMinutes（开启则转审批，关闭则禁止）
  "peakHours": [                       // 忙时时段配置（数组为空则全天不区分闲忙时，意味着无忙时限制）
    { "start": "08:00", "end": "20:00" }
  ]
}
```

---

## 3. 核心判定逻辑（前端预览与后端校验通用算法）

对于任意预约时间区间 `[start, end]`：

1. 计算**总预约时长**：`offset = end - start`（分钟）
2. 计算**峰时累计占用量**：`peakAccumulated = sum( intersection([start, end], peakHours_segments) )`（分钟）

**判断规则：**
1. **日额度硬性拦截**：若 `offset > dailyMaxDurationMinutes`（后端还会加上当天已预约时长），则直接阻断（前端不可选变灰，后端返回 400）。
2. **忙时限制判定**：
   * 若 `peakAccumulated > maxDurationMinutes`：
     * 开启 `allowExceedDuration`：标记为**待审批**（前端黄色虚线区，后端转 pending 状态）。
     * 未开启 `allowExceedDuration`：直接阻断（前端变灰无预览，后端返回 400）。
   * 若 `peakAccumulated <= maxDurationMinutes`：正常通过（前端绿色虚线区，后端通过）。

---

## 4. 前端修改详细方案 (src/pages)

### 4.1 预约界面时间格预览 (`src/pages/Booking.tsx`)

**核心变更点：**
重构 `handleTimeGridClick`（选择终点的渲染逻辑），在第一步点击（选定起点）后，基于前文的**“追踪峰时累计占用量”**模型，对后续的 `slot` 渲染不同的颜色与边框。

**渲染循环算法改进：**
* 维护两个累加状态：`offset` 和 `peakAccumulatedMinutes`。
* 遍历后续的每一个时间槽：
  1. 检查是否已被预约或不开放。如果遇到，则终止后续渲染。
  2. 根据当前槽是否落在 `peakHours` 内，决定是否增加 `peakAccumulatedMinutes`（步长通常为 slot 的时间跨度，如 30 分钟）。
  3. 执行判定：
     * 如果 `offset >= dailyMaxDurationMinutes`，停止渲染或置灰。
     * 如果 `peakAccumulatedMinutes > maxDurationMinutes`：
       * `allowExceedDuration === true` ➡️ **黄色虚线区**（`bg-amber-50`，黄色虚线框）。
       * `allowExceedDuration === false` ➡️ 停止渲染或置灰。
     * 否则 ➡️ **绿色虚线区**（`bg-emerald-50`，绿色虚线框）。

**交互提示：**
如果在点击“确认提交”按钮时，结束时间落在黄色区，显示提示：
> ⚠️ 您的预约占用了较多忙时资源，提交后将转为**待审批**状态。

### 4.2 管理端仪器配置表单 (`src/pages/Admin/components/EquipmentForm.tsx` & `BatchEditEquipmentForm.tsx`)

* 新增 `dailyMaxDurationMinutes` 字段，设定单日硬性上限。
* 新增 `allowExceedDuration` Toggle 切换开关，控制超时审批。
* 新增 `peakHours` 动态配置列表组件，交互形式参考现有的 `rules`（支持添加多条起止时段）。

---

## 5. 后端修改详细方案 (server.ts)

### 5.1 预约提交接口 (`POST /api/reservations` 及 `PUT /api/reservations/:id`)

**Step 1: 获取当日已用总时长 (SQL 聚合)**
使用 `start_time` 的日期维度进行查询，汇总用户在该仪器上当日已经审批或进行中的时间：
```sql
SELECT COALESCE(SUM(
  (strftime('%s', end_time) - strftime('%s', start_time)) / 60
), 0) AS total_minutes
FROM reservations
WHERE equipment_id = ?
  AND student_id = ?
  AND DATE(start_time, '+' || ? || ' minutes') = DATE(?, '+' || ? || ' minutes')
  AND status IN ('pending', 'approved', 'active')
```

**Step 2: 计算峰时累计占用 (`peakAccumulated`) 与当前时长 (`duration`)**
需要实现一个辅助函数，将传入的 `[start_time, end_time]` 区间按天拆分（或循环累加）来提取落入 `peakHours` 设置中的有效分钟数。

**Step 3: 约束判断与状态扭转**
* `totalDailyDuration = 已用时长 + duration`
* 触发 400 Bad Request（硬阻断）条件：
  * `totalDailyDuration > dailyMaxDurationMinutes` (超出日绝对总额度)
  * `peakAccumulated > maxDurationMinutes` 且 `allowExceedDuration == false` (不允许突破忙时上限)
* 触发 Pending（待审批）条件：
  * `peakAccumulated > maxDurationMinutes` 且 `allowExceedDuration == true`
* (原有的 `allowOutOfHours` 审批判定依然保留并兼容)。

### 5.2 设备管理接口
在对应的 `POST` 和 `PUT /api/admin/equipment` 接口中，确保请求体验证包含新的字段结构，且正确落表保存。

---

## 6. 验证点
* 检查在单一、多个互不相交的 `peakHours` 设置下，跨越这些时段的预约是否准确计算了 `peakAccumulated`。
* 检查前端从闲时开始拖拽至忙时的边界变化颜色。
* 检查已有多次零散预约后，由于 `dailyMaxDurationMinutes` 引起的后端正确拒阻。
