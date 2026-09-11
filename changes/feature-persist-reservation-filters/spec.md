# 详细预约记录表记录用户筛选习惯 (Detailed Reservation Filters Persistence)

## 背景 (Background)
管理员在“详细预约记录表” (ReservationsTab.tsx 中的 detailed 子标签页) 中经常需要使用各种筛选条件（如时间范围、设备、用户、状态等）来查找特定的预约记录。当前这些筛选条件在页面刷新或重新挂载后会丢失，导致管理员需要反复重新设置筛选习惯。

## 目标 (Goals)
1. 记录用户在 `ReservationsTab.tsx` 中设置的报表/详细记录筛选条件。
2. 将这些筛选条件持久化到浏览器的 `localStorage` 中。
3. 当用户再次进入该页面时，自动读取并应用这些筛选条件。

## 需求详细说明 (Detailed Requirements)
- **目标组件**: `src/pages/Admin/components/ReservationsTab.tsx`
- **需要持久化的状态**:
  - `reportPeriod`
  - `reportFilterUser`, `reportFilterEquipment`
  - `reportFilterDurationMin`, `reportFilterDurationMax`
  - `reportFilterCostMin`, `reportFilterCostMax`
  - `reportFilterUtilizationMin`, `reportFilterUtilizationMax`
  - `reportFilterStatus`, `reportFilterNotes`
  - `reportFilterFromToday`, `reportFilterCode`
- **读取逻辑**:
  - 如果 props 中传入了 `initialDate` 或 `initialBookingCode`，则优先使用 props 的值，以保证由其他页面（如“跳转到预约”）带入的参数生效。
  - 否则，从 `localStorage` 中读取最近一次的筛选条件。
- **存储逻辑**:
  - 当上述任一筛选状态发生改变时，将其序列化后存入 `localStorage` (例如 Key 为 `admin_reservations_filters`)。
