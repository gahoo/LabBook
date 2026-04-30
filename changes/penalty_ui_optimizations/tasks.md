# 前端交互优化任务分解 (针对减少天数和计费惩罚)

以下任务为实现 `design.md` 中设计的实施步骤拆解：

## 任务 1：优化后端预约的时间限制校验并引入精确的防线 (server.ts)

**目标：** 对超出最大预约时间的拦截提供精准返回，确保前端能以统一接口感知“是否是由惩罚引起”。
**实现细节：**
- 在 `POST /api/reservations` 接口（及 `POST /api/reservations/update` 接口如有需要）的时间校验处：
- 区分判断：
  - **设备原始限制日 (`originalMaxDate`)**：基于仪器自身的 `max_advance_days` 计算。
  - **基于惩罚后的限制日 (`penalizedMaxDate`)**：在原始限制基础上扣除 `penaltyCheck.restrictions.reduce_days` 计算。
- 如果请求的 `start_time` 超过了 `originalMaxDate`，可继续返回 `400 Bad Request`（常规超限）。
- 如果请求的 `start_time` 介于两者之间（即刚好超过了被惩罚缩减后的日期），此时返回 **`403 Forbidden`** 并附加 `structured_penalty: penaltyCheck` 数据，使其行为逻辑与 BAN 的拦截格式保持一致。

## 任务 2：前端复用并兼容拦截弹窗的内容 (src/pages/Booking.tsx)

**目标：** 在前端遇到该 403 回包被唤起现有 `Drawer` 弹窗时，使显示文案适配不同类型的惩罚拦截。
**实现细节：**
- 前端本来就能根据 403 和 `structured_penalty` 弹出拦截窗。
- 需要根据 `structured_penalty.restrictions` 里的字段微调 Drawer 头部的表现语：
  - 如果是因为缩减天数引起的拦截，红色的标题/文字应从硬核的“账号受限，预约失败”适当调整或兼容显示为：“账号受限，最长可提前预约天数已被缩减”等字眼。
  - 维持展示下方的违规列表。

## 任务 3：后端在预约成功时透传最新的惩罚状态 (server.ts)

**目标：** 在用户虽未被拦截但携带有特殊惩罚（如倍率）完成预订时，将惩罚信息发给前端。
**实现细节：**
- 在 `POST /api/reservations` 中，对于校验全通过并且成功写入数据库的合法预约。
- 响应对象从 `{ success: true, booking_code: newCode }` 变更为能容纳后续信息的 `{ success: true, booking_code: newCode, structured_penalty: penaltyCheck }`。由于其已集成于统一的 `penaltyCheck` 对象，因此直接放入回包。

## 任务 4：前端在预约成功页展示计费倍率警告 (src/pages/Booking.tsx)

**目标：** 给予刚刚生成预定的用户明确的费率变动警示。
**实现细节：**
- 当用户预定成功并在前端进入成功页（显示二维码、记录等环节）时，通过拿到的回包（例如 `bookingCodeDelivery.structured_penalty`）判断是否有生效的加点费。
- 若 `structured_penalty.restrictions.fee_multiplier > 1.0`（说明存在未解除的双倍 / 多倍扣费），则在此页面的“预约码”下方，增加一块文本说明（样式可参考现存的“履约提醒”）。
- 文案明确告知：“由于您存在的违规记录，此笔预约及后续预订将受到惩罚性计费处理（当前倍率：X 倍）。预计于【截止时间】后恢复”。
- 提供简要的导致该结果的违规事件以儆效尤。
