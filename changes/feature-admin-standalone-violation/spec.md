# 管理员独立添加违规记录功能设计方案 (Spec)

## 1. 背景与目标
目前系统仅支持基于现有预约单生成违规记录。为了满足实际管理场景（如代预约的被代约人违规、与具体仪器无关的独立违规等），需要在不改变现有数据库结构和验证引擎的前提下，提供一个供管理员手动录入独立违规记录的全局入口。

## 2. 设计与交互约定

### 2.1 违规类型限制
仅支持人工违规类型（白名单）：
- `hygiene_issue`：卫生不达标
- `improper_operation`：违规操作
- `proxy_booking`：代预约
- `other_manual`：其他违规

### 2.2 交互简化（依反馈调整）
- 考虑到当前无独立的预约码精准查询接口，采用**后端集中校验**的轻量方案。
- 前端表单**取消失焦校验与预览摘要**。管理员填写表单后直接提交，如遇预约码不存在或与学号不匹配，由后端返回具体 400 错误，前端展示错误提示。

### 2.3 惩罚引擎与降级表现
- `reservation_id` 保持可空。若无预约关联，记录只计入“无范围限制”的全局惩罚规则。
- 管理员列表渲染时，无预约记录的姓名展示采用降级方案：`student_name ?? student_id`。

---

## 3. API 接口设计

**`POST /api/admin/violations`**

**请求体 (Request Body):**
```json
{
  "student_id": "2021012345",
  "booking_code": "ABC123", // 选填
  "violation_type": "proxy_booking",
  "violation_time": "2026-07-17T10:00:00.000Z",
  "admin_note": "经同学举报，确认代预约行为" // 选填
}
```

**后端校验逻辑:**
1. 校验 `violation_type` 必须在人工违规白名单内，否则返回 `400 Bad Request`。
2. 若传入 `booking_code`：
   - 根据预约码查询预约单。若不存在，返回 `400 { error: "预约码不存在" }`。
   - 校验预约单的 `student_id` 是否与请求传入的 `student_id` 一致。如果不一致，返回 `400 { error: "预约码与学号不匹配" }`。
   - 提取该预约的 `id` 作为 `reservation_id`。
3. 若无 `booking_code`，`reservation_id` 设为 `null`。
4. 将 `admin_note` 包装存入 `remark` JSON 字段。
5. 插入 `violation_records` 表。
6. 触发 `evaluatePenaltiesOnViolation(student_id)` 评估违规。
7. 发送 `violation_created` 系统通知。

---

## 4. 前端组件设计

- **位置**: `ViolationsAndPenaltiesTab.tsx` 页面顶部。
- **入口**: 新增“+ 手动录入违规”按钮。
- **Modal 表单字段**:
  1. **违规学号 (Student ID)**: 文本输入框（必填）。
  2. **关联预约码 (Booking Code)**: 文本输入框（选填，帮助文本提示：“选填，输入预约码以关联特定仪器的惩罚规则”）。
  3. **违规类型 (Violation Type)**: 下拉选择框（必填，仅含 4 种人工类型）。
  4. **违规时间 (Violation Time)**: 带有时间选择器的 DateTime 控件（必填，默认当前时间）。
  5. **违规说明 (Admin Note)**: 文本域（选填）。
- **错误处理**: 捕获接口 400 异常，利用 Toast 或内联错误提示展示如“预约码与学号不匹配”的错误文案。
