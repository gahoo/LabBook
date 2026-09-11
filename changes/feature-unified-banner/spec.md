# 全局统一审批与待办看板 (Unified Approval Banner)

## 背景 (Background)
管理后台目前存在多类需要管理员人工审核的业务：
1. **待审批预约 (Pending Reservations)**：非开放时段预约、忙时超长预约、未启用自动审批仪器的预约。目前管理员只能在“预约记录”巨大表格中筛选并弹窗修改，链路繁琐且极易遗漏强时效性的预约。
2. **白名单准入申请 (Whitelist Applications)**：目前在 `ReservationsTab.tsx` 顶部硬编码了一个内联横幅，但与预约管理业务不够契合。
3. **违规申诉处理 (Violation Appeals)**：用户被扣分或封禁后提交的申诉，目前淹没在违规记录列表中，缺乏主动提醒。

三者本质上是管理员进入系统后最关心的**三大核心日常待办（Inbox）**。若每个页面各写一个独立 Banner，不仅代码大量重复，还会导致页面堆叠拥挤。因此，需将 Banner 抽象为全局通用的待办看板组件。

## 目标 (Goals)
1. **统一收敛**：抽离通用的 `UnifiedApprovalBanner` 组件，在 `src/pages/Admin/index.tsx` 顶层统一承载三大待办。
2. **Tab 智能感知优先**：
   - 切换到 `reservations`（预约管理）时，优先高亮展示“待审预约”；
   - 切换到 `equipment`（仪器管理）时，优先高亮展示“白名单申请”；
   - 切换到 `violations`（违规惩罚）时，优先高亮展示“违规申诉”；
   - 若当前 Tab 对应的类型无待办，自动平滑显示其他有待办的项目；
   - 支持管理员手动点击切换不同分类。
3. **无待办即静默**：若三大类型待办总数为 0，Banner 完全隐藏，0 像素占用。
4. **统一极速交互**：统一胶囊药丸（Capsule/Pill）排布、Hover 浮层详情、一键通过、一键驳回，并支持全局撤销（Undo Stack）。

## 详细设计 (Detailed Specifications)

### 1. 挂载位置
- 位于 `src/pages/Admin/index.tsx` 的 Header（管理后台标题及 Tab 导航栏）下方、具体子 Tab 内容展示区上方。

### 2. 交互与布局
- **外框**：琥珀色警示卡片（`bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6`）。
- **左侧切换栏**：
  - `待审预约 ({count})` (带 Clock 图标)
  - `白名单申请 ({count})` (带 ShieldCheck 图标)
  - `违规申诉 ({count})` (带 Scale / AlertTriangle 图标)
  - 支持点击切换当前展示的胶囊流。
- **右侧胶囊流**：
  - **待审预约胶囊**：
    - 主显文本：`申请人 · 仪器名 · 预约时段`
    - 标记 Tag：`时段外`、`超长`、`人工审`
    - Tooltip 浮层：展示学号、导师、精确时间、预估费用、耗材数、预约备注
    - 动作：通过（更新为 approved 并发通知）、驳回（标记为 rejected 并发通知）
  - **白名单胶囊**：
    - 主显文本：`申请人姓名`
    - Tooltip 浮层：仪器名称、学号、导师、申请理由
    - 动作：通过、驳回（复用现有白名单审批 API）
  - **违规申诉胶囊**：
    - 主显文本：`申诉人 · 违规类型 · 扣分/惩罚`
    - Tooltip 浮层：申诉理由、违规发生时间、设备名称、原违规原因
    - 动作：通过（撤销违规）、驳回（可快速填写或选择理由）
- **右上角统一撤销 (Undo)**：
  - 维护统一的撤销动作栈，误点后可秒级撤销恢复为待办。

### 3. API 支撑与对齐
1. **预约待审**：
   - 列表：`GET /api/admin/reservations?status=pending`
   - 快速审批：`PUT /api/admin/reservations/:id`（status: approved / rejected）或专用审批端点
2. **白名单待审**：
   - 列表：`GET /api/admin/whitelist/applications?status=pending`
   - 审批与撤销：现有的 `/approve`、`/reject`、`/undo` 保持不变
3. **申诉待审**：
   - 列表：`GET /api/admin/violations?appealStatus=appealing&startDate=2000-01-01&endDate=2099-12-31`（或专属快捷查询端点）
   - 审批：现有的 `POST /api/admin/violations/:id/revoke`（通过并撤销违规）与 `POST /api/admin/violations/:id/reject-appeal`（驳回申诉）

### 4. 冗余清理
- 移除 `ReservationsTab.tsx` 顶部原本内联的白名单 Banner，避免重复渲染与数据请求。
