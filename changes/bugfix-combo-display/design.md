# Combo 类型规则显示不明确 Bug 修复方案

## 1. 问题分析
当规则的触发配置使用了组合类型（`violation_types`）时，该规则默认会以管理员设定的规则名称渲染，并且原本的单一字段 `violation_type` 被设为 `'combo'` 或首个选中项。这导致在违规查询页面的规则详情中可能直接渲染为“combo”，同时对于“因触发【XXX】规则受限”的弹窗提示，因未说明具体条件，缺乏警示明确性。
用户希望类似后端管理面板中那样，能够将 `[late, overdue]` 清晰地展开为“迟到或超时”，并在向用户展示的各个角落都能明确看到。

## 2. 修复点一：完善后端 `server.ts` 组装受限文本
当判定用户受惩罚（`checkUserPenalty`）时，无论是从固定惩罚表 `user_penalties` 中查出的记录，还是动态计算规则得出的结论，均向外暴露一个格式化后的带类型的完整名称。
- 在提取 `fixedPenalties` 的 SQL 中，补充联表查询 `r.trigger_config` 与 `r.violation_type`：
  ```sql
  SELECT p.*, r.name as rule_name, r.trigger_config, r.violation_type 
  FROM user_penalties p
  JOIN penalty_rules r ON p.rule_id = r.id ...
  ```
- 建立类型翻译映射方法（迟到、超时、爽约、临期取消等）。
- 当将受限规则名称推入 `triggeredRules` 列表时，不再只存 `rule.name`，而是存入完整的 `rule.name（包含：迟到 或 爽约）` 或如果未设置则不展开。

## 3. 修复点二：完善前端 `ViolationQuery.tsx`
在渲染底部“具体处罚规则说明”时，修正 `getTriggerDesc` 渲染组合类型的方式：
- 对于规则展开，从 `trigger.violation_types` 读取所有的类型如果存在数组，使用 `map` 和 `join(' 或 ')` 将 `['late', 'no-show']` 翻译成 “迟到 或 爽约”，替代原先仅仅翻译了单一 `rule.violation_type` （即 `'combo'`） 的粗放逻辑。

## 4. 预期效果
- 当用户因各类复合或单一规则被限制预约或要求加倍付费时，受限弹窗将明确展示具体诱发原因，例如：`因触发【多重组合限制（迟到 或 爽约）】规则，您的预约权限受限...`
- 在用户自助“违规与申诉查询”页面最底下的红框规则说明，能根据实际后端的JSON清晰渲染“在本月内，迟到 或 爽约，次数达到...”。
