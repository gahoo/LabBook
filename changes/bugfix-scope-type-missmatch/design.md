# Scope 数据类型不匹配 Bug 修复方案

## 问题分析
根据检查，用户端通过 `MultiSelectCombobox` 选择的仪器 ID，在组装并存入数据库时，可能由于数组内的元素和在进行 `checkUserPenalty` 检查时所传入的 `target_equipment_id` 类型不一致（例如 `target_equipment_id` 是 `number` 类型，但保存在数据库或者内存中获取到的 `trigger.scope` 数组内部元素类型为 `string`，反之亦然），在使用 `Array.prototype.includes` 时引发了强制类型相等性对比 (`===`) 失败，导致 `includes` 返回 `false`。最终直接导致验证逻辑被非预期的 Bypass。

## 受影响的代码位置 (`server.ts`)
在 `checkUserPenalty` 函数中有两处对 `target_equipment_id` 判断的代码片段：

1. **固定惩罚期限判断中的附加限制** (`server.ts` 约第 504 行):
   ```typescript
   if (target_equipment_id && params.restricted_equipment_ids && Array.isArray(params.restricted_equipment_ids) && params.restricted_equipment_ids.length > 0) {
     if (!params.restricted_equipment_ids.includes(target_equipment_id)) {
       continue;
     }
   }
   ```

2. **动态惩罚规则触发条件检查** (`server.ts` 约第 548 行):
   ```typescript
   if (target_equipment_id && trigger.scope && Array.isArray(trigger.scope) && trigger.scope.length > 0) {
     if (!trigger.scope.includes(target_equipment_id)) {
       continue;
     }
   }
   ```

## 修复方案
摒弃强类型的 `includes()` 进行数组搜索，改用 `some()` 方法强制进行类型统一转换。利用 `String(x) === String(y)` 实现安全兼容比对。这样既可以不需入侵现有持久层存储形式，也能立刻解决此处的隐患。

- **替换处 1:**
  ```typescript
  if (!params.restricted_equipment_ids.some((id: any) => String(id) === String(target_equipment_id))) {
  ```
- **替换处 2:**
  ```typescript
  if (!trigger.scope.some((id: any) => String(id) === String(target_equipment_id))) {
  ```
