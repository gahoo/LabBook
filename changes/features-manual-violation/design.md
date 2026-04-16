# 管理员手动标记违规功能设计方案 (Features: Manual Violation Flagging)

## 1. 需求背景
目前系统仅支持基于时间的自动违规判定（迟到、超时、爽约、临期取消）。在实际实验室管理中，经常发生“行为违规”（如卫生不达标、违规操作、代预约等），这些情况恶劣程度不同，且必须由管理员人工判定。
为了完善惩罚体系，需要允许管理员手动对某次预约标记一条或多条违规，并将其无缝接入现有的规则引擎中，实现自动化的阶梯惩罚。

## 2. 核心设计原则
*   **类型细分**：引入具体的行为违规类型，以便规则引擎可以针对不同恶劣程度的违规配置不同的惩罚阈值。
*   **操作提效 (动态列表)**：UI 入口集成在“报表 (Reports)”的编辑预约弹窗中。采用“动态添加块”的交互方式，允许管理员为同一次预约添加多条不同类型的手动违规记录。
*   **强绑定预约**：所有的手动违规必须关联到一个具体的 `reservation_id`，保证证据链完整，且兼容现有的底层统计逻辑。
*   **结构化备注复用**：复用现有的 `remark` JSON 结构，将管理员填写的违规详情存入 `admin_note` 字段。
*   **状态统一**：统一使用 `revoked` 作为违规记录的撤销/失效状态，废弃 `invalid`。

## 3. 数据结构调整

### 3.1 扩展违规类型字典
在前后端的类型映射中，增加以下人工违规类型：
*   `hygiene_issue`：卫生不达标
*   `improper_operation`：违规操作（涵盖仪器损坏等情况）
*   `proxy_booking`：代预约
*   `other_manual`：其他违规

### 3.2 备注字段 (Remark) 复用现有 JSON 结构
`violation_records` 表的 `remark` 字段已经支持 JSON 格式（包含 `admin_note`, `appeal_reason`, `appeal_reply` 等）。
对于手动添加的违规，管理员填写的说明将直接存入 `admin_note`：
```json
{
  "admin_note": "未清理实验台面废液"
}
```

## 4. 前端 UI 交互设计 (`ReportsTab.tsx`)

在管理员编辑预约的 Drawer 中，增加一个“⚠️ 异常与违规标记”区域，采用动态列表交互：

1.  **初始状态**：显示一个 `[ + 新增违规记录 ]` 的按钮。
2.  **添加违规块 (Block)**：点击按钮后，出现一个独立的违规卡片，包含：
    *   **违规类型**：下拉单选框（卫生不达标、违规操作、代预约、其他）。
    *   **违规说明 (Remark)**：文本域 (Textarea)，必填。对应后端的 `admin_note`。
    *   **删除按钮**：点击可移除该违规块。
3.  **多重违规**：管理员可以多次点击新增按钮，添加多个独立的违规块。
4.  **数据回显**：打开 Drawer 时，拉取该预约已有的手动违规记录，并解析 `remark` JSON 渲染为对应的违规块。

## 5. 后端逻辑适配 (`server.ts`)

修改 `PUT /api/admin/reports/reservations/:id` 接口：

### 5.1 接收新参数
接收一个对象数组 `manual_violations`，例如：
```json
[
  { "id": 12, "type": "hygiene_issue", "remark": "未清理..." }, 
  { "id": null, "type": "improper_operation", "remark": "操作失误..." }
]
```

### 5.2 违规记录处理逻辑 (Diff & Sync)
在处理完迟到、超时等自动逻辑后，处理手动违规数组：

1.  **查询现有的手动违规记录**：
    查找该 `reservation_id` 下，类型属于 `['hygiene_issue', 'improper_operation', 'proxy_booking', 'other_manual']` 且 `status = 'active'` 的记录。
2.  **比对与同步 (Sync)**：
    *   **新增 (INSERT)**：前端传来的项中没有 `id` 的，执行 `INSERT`。将 `remark` 包装为 `{"admin_note": "..."}` 存入。
    *   **更新 (UPDATE)**：前端传来的项中有 `id` 的，执行 `UPDATE`，更新 `violation_type`，并合并更新 `remark` JSON 中的 `admin_note`。
    *   **删除/撤销 (REVOKE)**：数据库中存在，但前端传来的数组中不存在的 `id`，执行 `UPDATE` 将其 `status` 置为 `revoked`，并在 `admin_note` 中追加撤销标记。
    *   如果发生了任何 INSERT/UPDATE/REVOKE，标记 `violationChanged = true`。

### 5.3 统一 status 状态
*   将代码中现有的 `status = 'invalid'` 全部替换为 `status = 'revoked'`，保持状态机的一致性。

### 5.4 触发规则引擎
现有的 `if (violationChanged) { evaluatePenaltiesOnViolation(oldRes.student_id); }` 逻辑保持不变，它会自动接管并处理新增或撤销的手动违规。
