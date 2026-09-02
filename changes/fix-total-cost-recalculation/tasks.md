# 任务拆解 (Task Breakdown)

## 1. 修复后端计费逻辑 (`src/modules/reservation/service.ts`)
*   [x] **1.1 替换 `total_cost` 简单赋值语句**
    *   将现有的 `const total_cost = updates.total_cost !== undefined ? updates.total_cost : oldRes.total_cost;` 移除。
    *   引入带有条件分支的 `let total_cost = ...` 重算逻辑块。
*   [x] **1.2 引入实际时长与耗材计费规则**
    *   如果 `actual_start_time` 与 `actual_end_time` 同时存在，根据两者的差值计算 `hours`。
    *   通过 `Math.max(0, hours)` 处理潜在的负数脏数据。
    *   结合 `oldRes.price_type` (`hour` 或其它) 以及 `oldRes.price` 计算基础价格。
    *   结合 `oldRes.consumable_fee` 和 `consumable_quantity` 累加耗材费用。
*   [x] **1.3 确保向下传递正确的变量名**
    *   保证在底部的 `UPDATE reservations SET ... total_cost = ? ...` SQL 语句中能够正常取到重算后的值。

## 2. 自动化测试 (`tests/13_reservation_cost.test.ts` 或对应文件)
*   [x] **2.1 增加总计费重算的单元测试**
    *   创建一份按小时收费且带耗材费的测试仪器及订单。
    *   通过 `adminUpdate` 或 API 更新 `actual_start_time` 和 `actual_end_time`（不传 `total_cost`），断言其总价根据实际使用时长发生了变化。
    *   再写一个断言：如果显式传递了 `total_cost`，则优先使用显式传递的值，不进行重算覆盖。
