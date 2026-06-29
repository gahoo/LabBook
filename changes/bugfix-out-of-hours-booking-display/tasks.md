# 任务拆解与进度清单 (Tasks)

- [x] 前端：修改 `Booking.tsx` 中的时段可用性渲染逻辑，移除开启 `allowOutOfHours` 时强制将所有时段标绿的处理。
- [x] 后端：修改 `server.ts` 中的 `validateOperatingHours`，遇到非开放时段但允许时段外预约时，返回 `{ isValid: true, isOutOfHours: true }`。
- [x] 后端：修改 `server.ts` 中的预约创建接口（单次预约及周期性预约），通过 `isOutOfHours` 标识判断是否将 `status` 强制置为 `pending`。
