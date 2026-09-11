# 任务拆解

- [x] 后端模型扩展
  - [x] 在 `src/modules/equipment/schema.ts` 或服务层处理 `availability_json`，加入 `atLeastAdvanceMinutes` (默认为0)。
- [x] 管理员后台 UI 变更
  - [x] 修改 `src/pages/Admin/components/EquipmentForm.tsx`，在“预约限制”相关设置（如最长预约时间旁边）增加“最小提前预约时间(分钟)”输入框。
  - [x] 修改保存逻辑，将该字段正确序列化至 `availability_json`。
- [x] 后端校验逻辑
  - [x] 修改 `src/modules/reservation/service.ts` (或路由拦截器)，在创建预约时，获取仪器的 `availability_json.atLeastAdvanceMinutes`。
  - [x] 比较当前时间和预约 `startTime`，如果 `startTime - now < atLeastAdvanceMinutes`，则抛出 `400` 错误，提示“该仪器需至少提前 X 分钟预约”。
- [x] 前端 Booking 页面提示与限制
  - [x] 在 `Booking.tsx`，计算并屏蔽早于 `now + atLeastAdvanceMinutes` 的时间槽。
  - [x] 在确认预约时，前端加上前置校验并给予用户友好的提示（“需至少提前X分钟，请选择更晚的时间”）。
- [x] 首页可用时间概览联动
  - [x] 在 `src/modules/equipment/service.ts` 的 `getEquipmentAvailabilityToday` 中返回 `atLeastAdvanceMinutes`。
  - [x] 在 `src/pages/Home.tsx` 中，今日概览将早于 `now + atLeastAdvanceMinutes` 的时间槽置灰并设为不可点击。
