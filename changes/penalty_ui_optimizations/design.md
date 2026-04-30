# 设计方案：针对“减少提前预约天数”和“计费倍率”惩罚的前端交互优化

## 1. “减少提前预约天数” 导致日历不可用的拦截机制

**需求描述：**
如果用户受到“减少提前预约天数”的惩罚并试图预订超出他们被缩减后可用范围的时间，需要复用现有的拦截 Drawer。

**拟定设计：**
1. **精准的后端拦截（`server.ts`）：**
   在 `POST /api/reservations` 中，处理预约日期的校验。
   - 分别计算基于设备的原始限制 `originalMaxDate` 和扣除惩罚天数后的限制 `penalizedMaxDate`（从 `penaltyCheck.restrictions.reduce_days` 提取）。
   - 如果用户预约的 `start_time` 超过了 `penalizedMaxDate` 但仍在 `originalMaxDate` 范围内，说明**完全是因为违规惩罚拦住了该预约**。
   - 请求将被拦截并返回 `HTTP 403 Forbidden`，附加该用户的 `structured_penalty`（包含对应拦截的违规记录集合及聚合后的 `restrictions` 限制数据）。

2. **复用前端拦截层（`src/pages/Booking.tsx`）：**
   前端通过监听 HTTP 403 及返回的 `structured_penalty` 唤醒原有的 Drawer 弹窗。
   - 只要判断到 `structured_penalty.restrictions.reduce_days > 0`（无需解析 action_type），前端便在 Drawer 中适配性地展示泛化的提示语（例如：“账号受限，您的最长可提前预约天数被缩减了 X 天”）。通过这个机制，可做到零新增大组件完全复用现有框架。

## 2. “惩罚性计费 (Fee Multiplier)”在预约成功后的醒目提醒

**需求描述：**
当由于违规原因导致用户的特定计费倍率惩罚（原代码中的 double_fee）生效时，即便完成预约，也要在预约成功页面中看到醒目的警告横幅，告知其后续计费变化。

**拟定设计：**
1. **在预约回包中体现处分动作（`server.ts`）：**
   在处理并验证成功预订的逻辑处（正常生成预订，返回 HTTP 200 前），后端不仅返回成功信息，还将 `checkUserPenalty` 检查结果返回的 `structured_penalty` 对象一并附加到成功的 JSON 响应中。无论底层配的是什么具体的规则，聚合的限制状态尽在 `restrictions.fee_multiplier` 中体现。

2. **前端成功页警告渲染（`src/pages/Booking.tsx`）：**
   - 如果前端收到成功响应，且发现其中包含 `structured_penalty.restrictions`，前端**不需要检查底层的 action_type**，仅仅判断 `fee_multiplier > 1.0` 即可。
   - 若大于 1.0，则在预约成功面的“预约码”下方，增加一段类似“履约提醒”样式的文本说明区块，文案如：“由于您存在的违规记录，此笔预约及后续预订将受到特殊费率惩罚处理。当前计费倍率为 X 倍，预计于【截止时间】后恢复”。

