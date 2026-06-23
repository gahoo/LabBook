# 时间检查机制验证与修复 (Date Validation Bypass)

## 1. 漏洞验证与根源分析
无效日期参数绕过时间检查的问题**真实存在**。主要根因在于 JavaScript 中 `new Date(invalid_string)` 构建出的所谓 `Invalid Date`。

在目前的 `POST /api/reservations` (创建) 和 `POST /api/reservations/update` (修改) 逻辑中接收到前端传来的类似于 `"foo"` 或无效的时间字符串时：
* `const start = new Date("foo")` 的结果是 `Invalid Date`。
* `start.getTime()` 为 `NaN`。
* `end <= start` 或 `start < now` 这样的比较会被直接等效为 `NaN <= NaN` 或 `NaN < number`，这就导致了在 JavaScript 语言特性下，这些判断通通返回 **`false`**。

由于返回了 `false`，不仅成功绕过了所有针对时间跨度、提前预约天数、时效的检查限制，更因为 `SQLite` 缺乏原生的时间类型约束（直接按 `TEXT` 原样插入 `"foo"`），导致包含脏数据的非法记录会被直接保存。在后续调用中，其它根据正常日期进行筛选的冲突检查SQL语句也会产生不可预知或总是放行的行为。

## 2. 修复方案
我们需要在接收到时间参数的最上层实行严格阻断（输入验证）：
对于 `start_time`、`end_time`（修改接口还可能包括 `actual_start_time`、`actual_end_time`），在进行任何业务逻辑前执行是否合法时间的校验，最简洁优雅的方法就是检查其 `.getTime()` 结果是否为 `NaN`。

```javascript
  const start = new Date(start_time);
  const end = new Date(end_time);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: '无效的时间格式' });
  }
```

针对如下三个核心接口增加严密防护：
1. `POST /api/reservations`（C 端创建）
2. `POST /api/reservations/update`（C 端修改）
3. `PUT /api/admin/reservations/:id`（管理端修改，补充防御）
4. `POST /api/admin/reservations` (如果存在管理端代预约)
