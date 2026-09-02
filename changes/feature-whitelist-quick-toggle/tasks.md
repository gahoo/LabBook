# 任务拆解 (Task Breakdown)

## 1. 后端重构 (`src/modules/whitelist/service.ts`)
*   [x] **1.1 重构 `approveApplication` 接口**
    *   移除 `if (app.status !== 'pending')` 校验限制，允许覆盖操作。
    *   保持原有的将名字加入 `whitelist_data` 并通知的逻辑。
*   [x] **1.2 重构 `rejectApplication` 接口**
    *   移除 `if (appRecord.status !== 'pending')` 校验限制。
    *   新增逻辑判断：如果当前 `appRecord.status === 'approved'`，则需获取 `equipment.whitelist_data`，将该学生的姓名从中精准移除，并更新 `equipment` 表，防止物理权限残留。
*   [x] **1.3 新增 `undoApplication` 接口**
    *   允许将非 `pending` 的单据状态恢复为 `pending`。
    *   如果撤销的对象是 `approved` 状态的申请，必须像 `rejectApplication` 一样，将其从物理字段 `equipment.whitelist_data` 中清除。

## 2. 前端重构 (管理页面)
*   [x] **2.1 仪器详情页 UI 改造 (`EquipmentManagementTab.tsx`)**
    *   将原本的表格列表移除，使用 Flex 布局渲染“胶囊（Tag）”。
    *   实现控制“最近 7 天已处理”的图标切换器（🕒），且作用域独立为 `Record<number, boolean>`。
    *   选中态颜色与“功能设置”开关看齐（`bg-red-100 text-red-600`）。
    *   开启历史记录时，根据 `student_id` 对相同学生的多次申请记录进行去重，仅保留最新的一条。
*   [x] **2.2 胶囊组件交互封装 (Tri-state Capsule)**
    *   **待审批状态 (Grey)**：展示 `[✓]` 和 `[✗]`。点击调用 API 并变更本地状态。
    *   **已通过状态 (Green)**：常态仅展示 `[✓]`。Hover 浮现 `[✗]`，点击调用 `/reject` 变红。
    *   **已驳回状态 (Red)**：常态仅展示 `[✗]`。Hover 浮现 `[✓]`，点击调用 `/approve` 变绿。

## 3. 看板 Banner 优化 (`ReservationsTab.tsx`)
*   [x] **3.1 实现真实的栈式撤销 (Banner Undo Stack)**
    *   栈式撤销功能（Undo Stack）内嵌在 Banner 容器的右侧。
    *   撤销按钮保持在同一行（去图标，配置 `whitespace-nowrap shrink-0` 样式）。
    *   点击撤销调用真正的 `/undo` 接口，使胶囊重回 `pending` 并展示在面板上。
    *   只有在待办队列和撤销栈全都为空时，才隐藏 Banner，避免最后一条处理完后无法撤销的问题。

## 4. 自动化测试 (`tests/10_whitelist.test.ts`)
*   [x] **4.1 核心翻转逻辑测试**
    *   编写用例：测试将处于 `approved` 状态的申请调 `/reject`，断言状态变更为 `rejected` 且姓名被移出物理 `whitelist_data`。
*   [x] **4.2 反向翻转逻辑测试**
    *   编写用例：测试将处于 `rejected` 状态的申请调 `/approve`，断言状态变更为 `approved` 且追加至物理 `whitelist_data`。
*   [x] **4.3 撤销逻辑 (Undo) 测试**
    *   编写用例：撤销一条 `rejected` 申请，断言重回 `pending`。
    *   编写用例：撤销一条 `approved` 申请，断言重回 `pending`，且姓名被精准移出物理 `whitelist_data`。
