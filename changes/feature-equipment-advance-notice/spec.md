# 限制仪器临时预约时间 (Minimum Advance Notice for Booking)

## 背景 (Background)
目前系统允许用户预约即将开始的时段。但某些仪器可能需要较长的准备时间（例如预热、开机准备、管理员配置等），因此希望能在仪器维度设置“至少提前多久进行预约”（例如至少提前2小时预约）。

## 目标 (Goals)
1. 在仪器配置（`availability_json`）中新增 `atLeastAdvanceMinutes` (提前预约的分钟数) 参数。
2. 在管理员后台的仪器编辑表单中，允许设置这个参数（通常以小时/分钟为单位显示）。
3. 前端和后端在创建预约时，校验预约的开始时间是否晚于当前时间 + `atLeastAdvanceMinutes`。

## 需求详细说明 (Detailed Requirements)
- **数据结构**: 在 `equipment.availability_json` 中新增 `atLeastAdvanceMinutes` 字段，默认值为 0 (不限制)。
- **管理员后台**: `EquipmentForm.tsx` 中新增一个设置项：“最小提前预约时间（分钟）”。
- **预约页面**: 在 `Booking.tsx` 中，用户选择时间时，如果在 `atLeastAdvanceMinutes` 的限制范围内，则禁止选择并给出提示。
- **后端校验**: `src/modules/reservation/service.ts` 或对应接口，在处理新建预约时，校验 `startTime` > `now + atLeastAdvanceMinutes`。
