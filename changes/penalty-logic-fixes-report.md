# 惩罚规则漏洞与修复报告 (Penalty Logic Fixes)

在深度代码审查后，我找到了您遇到的现象的具体原因，同时挖掘出另一个同源的深层漏洞。共有 3 处核心判定存在逻辑缺陷：

## 漏洞 1：组合类型触发条件的 SQL 查询逃逸
**故障现象**：触发条件设置为“组合类型”时，预约不会拦截且不触发惩罚。
**根本原因**：
在前端设置组合类型（如：包含逾期或爽约）时，生成保存的 `violation_type` 为特定标识符 `'combo'`，真实数组存放在 `trigger_config.violation_types` 内。但在后台**动态拦截预约验证区 (`checkUserPenalty`)** 和**惩罚名单计算区（`/api/admin/violations/summary`）**，底层 SQL 仍在使用基于单一字段的严格等于匹配：
`WHERE violation_type = ?` 并注入了 `'combo'` 参数。
这导致 SQLite 在真实表里找不到类型名字叫 `'combo'` 的违纪记录，计算违规次数永远为 0。
**修复方案**：
解析 `trigger_config.violation_types`，将其还原为占位符数组，利用 `violation_type IN (?, ?, ...)` 语法铺开校验进行数据捞取。

## 漏洞 2：未来预约惩罚取消的范围盲区
**故障现象**：触发固定封禁并勾选“同时取消未来相关待使用预约”时，大量未执行的预约没有被取消。
**根本原因**：
执行清理的核心代码被硬编码为：
`UPDATE reservations SET status = 'cancelled' WHERE student_id = ? AND status = 'pending' AND start_time > ?`
然而在“免审核”的仪器设定下或已经被审核通过准备去实验的情况下，预约的分类状态是 `'approved'`。这使得代码放跑了所有的已通过状态的闲置预约，造成漏取消。
**修复方案**：
将状态过滤条件放大到所有尚未消费的生命前期：
`status IN ('pending', 'approved')`。

## 漏洞 3：同一次预约违规（计次策略）降维失效
**故障现象**：同订单违规合并计算策略，虽在固定计算生效，但在实时拦截时不管用。
**根本原因**：
由于后台在 `evaluatePenaltiesOnViolation` 中对 `count_strategy === 'by_reservation'` 做了聚合处理（使用 `GROUP BY reservation_id`），但是在产生核心拦截动作的 `checkUserPenalty` 函数里，这部分防刷逻辑缺失了，它仍然简单粗暴地按原始记录数 (`SELECT id FROM violation_records...`) 生硬累加。这就导致了拦截功能和发牌功能判定失调。
**修复方案**：
必须要在 `checkUserPenalty` 以及 `violations/summary` 的纯计算区域，同样注入完整的 `try-group-by` 逻辑引擎，一旦发现同订单，必须以最小子 ID 将重复记录去重聚集计算。

---
## 任务清单
- [x] 修复漏洞 1：改用 JSON 数组进行 `violation_type IN (...)` 判断
- [x] 修复漏洞 2：未来预约惩罚取消操作扩大检测 `status IN ('pending', 'approved')`
- [x] 修复漏洞 3：同一预约同类型违规计次策略现在会在拦截或计分时通过 MIN() / DISTINCT 聚合去重
