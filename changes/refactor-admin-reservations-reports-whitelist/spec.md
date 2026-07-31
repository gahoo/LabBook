# 后台预约、报表与白名单模块重构蓝图

## 1. 架构背景与重构动机

在当前的系统中：
1. **“预约管理”与“报表”高度重叠**：两者都依赖 `reservations` 表。预约管理侧重于元数据（时间、人员）和基础状态审批；而报表侧重于实际上机时间、费用、以及衍生的报表状态（迟到、超时、爽约等）。由于它们在 UI 上完全割裂，导致了大量的重复代码，且后端 API（`GET /api/admin/reports`）存在严重的性能冗余。
2. **“白名单申请”缺乏业务关联感**：作为顶级 Tab 存在，但其实质是“仪器权限的审批”。管理员在日常高频的预约管理中无法直观看到排队等待审批的白名单，处理链路存在摩擦。

**重构核心目标**：精简顶层 Tab，合并预约与报表的数据流，将编辑操作的副作用进行严格的物理隔离（分离基础信息、上机信息与违规处罚），并实现白名单申请的**零阻力审批**。

---

## 2. 界面结构重组与交互细节

### 2.1 顶层导航栏 (`src/pages/Admin/index.tsx`)
- **[变更]** 从顶部 Tab 中彻底移除 `ReportsTab` 和 `WhitelistAppsTab`。
- **[变更]** 顶层 Tab 变为：`仪器管理 | 预约管理(新) | 违规惩罚 | 审计日志 | 设置`。
- **[交互]** 在“仪器管理”的 Tab 上，当有 `pending` 状态的白名单申请时，显示小红点徽标。

### 2.2 白名单功能：双端呈现
- **管理端 (`EquipmentManagementTab.tsx`)**：
  - 弃用原来沉重的全局白名单表格。
  - 在每个仪器的卡片或详情下方，直接渲染该仪器的轻量级待审批卡片。
  - 卡片要素：申请人姓名、信息 Icon（Hover 弹出联系方式和导师）、✅通过、❌驳回。
- **快捷审批端 (`UnifiedReservationsTab.tsx` 顶部)**：
  - 在预约管理看板的顶部，注入一个条件渲染的**快捷审批 Banner**。
  - 如果有待审批申请，Banner 高亮显示，并内联前 3-5 条申请卡片（带通过/拒绝按钮）。（**注意：已根据要求彻底移除“全部同意”按钮**）
  - 点击 Banner 上的审批按钮直接调用 API 刷新状态，不跳转页面。处理完后自动拉取并递补展示新的申请。

### 2.3 统一的预约看板 (`UnifiedReservationsTab.tsx`)
- 整合原 ReservationsTab 和 ReportsTab，保留三个二级 SubTab：
  1. `📋 预约记录` (默认的列表视图)
  2. `📊 时长费用统计` (四维度统计表)
  3. `📈 统计图表` (可视化图表)
- **主表格列融合**：
  - 预约码、仪器。
  - **用户/导师**：将联系方式（手机/邮箱）收纳进此列的 Popup。
  - 预约时间、实际上机时间、时长利用率、总费用。
  - **状态**：双层复合显示。上层显示审批状态，下层显示报表状态（正常、迟到、超时等）。
  - 耗材数量、操作。
- **快捷过滤**：将原预约管理的“隐藏已过期预约”改造成“只看未到期”按钮。点击后等价于将统计区间设为 `今天 → 未来 30 天`。

---

## 3. 编辑抽屉拆分与逻辑隔离

重构后的 `ReservationEditDrawer.tsx` 分为三个独立的 Tab，每个 Tab 拥有独立的保存按钮和 API 调用。

### Tab 1: 预约信息 (数据修正)
- **字段**：只读（预约码、提交时间）。可编辑（姓名、学号、导师、联系方式、预约起止时间、状态）。
- **后端对应**：调用合并后的 `PUT /api/admin/reservations/:id`。

### Tab 2: 上机信息 (执行记录)
- **字段**：可编辑（实际上机/下机时间、耗材数量、备注）。
- **后端对应**：调用合并后的 `PUT /api/admin/reservations/:id`。
- **副作用**：实际上机时间变化时，系统自动检测迟到/超时（插入或撤销违规），并重算费用。

### Tab 3: 违规记录 (行政处罚)
- **展示**：顶部只读展示系统检测出的违规，下方提供人工违规的新增、编辑、删除。
- **新增**：复用 `POST /api/admin/violations` 接口。
- **编辑**：新增 `PUT /api/admin/violations/:id`。
- **撤销/删除**：复用并重命名为 `POST /api/admin/violations/:id/revoke`。

---

## 4. 后端 API 改造指南 (`server.ts`)

### 4.1 数据拉取接口拆分
- **`GET /api/admin/reservations`（列表接口）**：
  - 返回 `reportStatus` 和 `total_cost`。
  - 支持 `startDate` 和 `endDate`。
  - 不做聚合统计。
- **`GET /api/admin/reservations/stats`（重度统计接口）**：
  - 供统计图表使用。
  - 生成 `usageByTime`, `usageByPerson`, `usageBySupervisor`, `usageByEquipment`。

### 4.2 更新接口合并与违规 API 规范化
- **`PUT /api/admin/reservations/:id`**：
  - 合并原逻辑，处理实际上机时间的变更及违规判定。
- **统一违规接口到 `/api/admin/violations`**：
  - `GET /api/admin/violations`
  - `POST /api/admin/violations`
  - `PUT /api/admin/violations/:id` (新增)
  - `POST /api/admin/violations/:id/revoke` (重命名)
  - `POST /api/admin/violations/:id/restore` (重命名)
  - `POST /api/admin/violations/:id/reject-appeal` (重命名)

### 4.3 彻底下线的废弃代码
- `GET /api/admin/reports`
- `PUT /api/admin/reports/reservations/:id`
- `DELETE /api/admin/reports/reservations/:id`
