# 规格说明书 (Specification)

## 需求背景
开启“允许时段外预约”功能后，前端时段选择器错误地将所有时间段（包括非开放时间段）显示为绿色（即可预约时段）。这导致用户无法直观地区分仪器的正常开放时段与非开放时段。并且，时段外预约无论仪器是否开启了自动审批，都需要进入“待审批”状态。

## 变更目标
1. 修正前端显示逻辑：非开放时间段在时段选择器中恢复显示为非绿色，以便用户清楚仪器的正常开放时段。
2. 保留功能：尽管时段选择器上非开放时段不会标绿，但用户仍可以通过下方的日期时间选择控件（datetime picker）自定义设置时段外的预约时间。
3. 调整后端校验与状态逻辑：确保允许时段外预约时，时段外的预约在提交后，其状态必须变更为 `pending`（待审批），不论仪器是否开启了 `auto_approve`。

## 影响范围
- 前端：`/src/pages/Booking.tsx` 
- 后端：`/server.ts`

## 核心实现
1. 前端 `/src/pages/Booking.tsx`:
   - 移除 `isAvailable` 在 `allowOutOfHours` 为 `true` 时的强制覆盖为 `true` 的逻辑。
2. 后端 `/server.ts`:
   - 调整 `validateOperatingHours` 方法：当 `allowOutOfHours` 为 `true`，遇到不在开放时间段的情况时，仍返回 `isValid: true`，但标记 `isOutOfHours: true`。
   - 在预约创建（包括单次和批量/周期预约）的逻辑中，如果 `isOutOfHours` 为 `true`，即使仪器开启了 `auto_approve`，新预约的状态也将强制置为 `pending`。
