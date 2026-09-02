# 修复预约结算金额 (total_cost) 重算逻辑遗失的问题

## 1. 需求背景 (Background)
在早期的重构提交 (`c0fc8cd`) 中，为了解耦违规判断等逻辑，我们对 `updateReservation` 的底层服务层进行了大范围重写。在此后的补救提交 (`f49f6f0`) 中，虽然成功恢复了“防代约、逾期和爽约惩罚（violation_records）状态机联动”的撤销与生成，但遗漏了最核心的**财务计费动态结算功能**。

在原设计中，如果管理员或系统更新了实际的签到时间 (`actual_start_time`) 和实际签退时间 (`actual_end_time`)，并且**未显式指定 `total_cost` 覆盖值**时，系统必须根据：
1. **实际使用时长**（针对按小时收费的设备）。
2. **实际耗材使用量**。
来重新计算订单的最终费用。当前系统中，这一逻辑完全丢失，导致仅仅机械地继承旧记录或前端的输入，导致计费异常。

## 2. 核心设计方案 (Design Specifications)

### 2.1 恢复动态计费逻辑 (Dynamic Cost Recalculation)
在 `src/modules/reservation/service.ts` 的 `adminUpdate` 逻辑内：

```javascript
let final_total_cost = updates.total_cost;
if (final_total_cost === undefined) {
  // 如果管理员未主动覆盖价格，且订单有完整的实际起止时间，则执行动态重算
  if (actual_start_time && actual_end_time) {
    const aStart = new Date(actual_start_time);
    const aEnd = new Date(actual_end_time);
    const hours = Math.max(0, (aEnd.getTime() - aStart.getTime()) / (1000 * 60 * 60));
    
    if (oldRes.price_type === 'hour') {
      final_total_cost = hours * oldRes.price;
    } else {
      final_total_cost = oldRes.price;
    }
    
    if (oldRes.consumable_fee > 0 && consumable_quantity > 0) {
      final_total_cost += oldRes.consumable_fee * consumable_quantity;
    }
  } else {
    // 否则保持原价
    final_total_cost = oldRes.total_cost;
  }
}
```

### 2.2 防护设计
- 必须尊重管理员手动传入的 `total_cost`，仅在 `updates.total_cost` 为 `undefined` 时才触发自动重算逻辑。
- 加入负数防御：通过 `Math.max(0, ...)` 防止由于实际签到晚于签退（脏数据情况）导致的负时数和负费用。
- 确保重新计算的价格不仅包括设备本身的租金，还包含可能发生了变化的 `consumable_quantity` 带来的附加耗材费。

