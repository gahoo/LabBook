# 需求概述 (Overview)
用户倾向于方案A，即在“违规惩罚” (Violations And Penalties) 页面中增加一个独立的子 Tab “违规判定参数” (Violation Parameters)，并将原先位于“设置” (Settings) 页面中的迟到、超时、爽约宽限期等配置项整体迁移至此处。
这不仅能提高前端界面的清爽度，还能实现“违规检测条件配置”与“违规惩罚动作配置”的高内聚管理。

# 设计方案 (Design)

1. **统一后端接口复用**：
   - 现有的 `GET /api/settings` 和 `POST /api/admin/settings` 在后端实现上支持按字段更新（`value !== undefined` 时才会更新对应 Key）。
   - 将这部分逻辑分成两处独立调用：`SettingsTab` 只更新基础信息；新的 `ViolationParamsTab` 只更新违规判定参数，后端接口和表结构无需改变。

2. **新建子模块 `ViolationParamsTab.tsx`**：
   - 组件放置在 `/src/pages/Admin/components/ViolationParamsTab.tsx`，接受 `token` 属性。
   - 组件内管理相关的状态：`lateGraceMinutes`, `overtimeGraceMinutes`, `lateCancelHours`, `noShowGraceMinutes`, `cronIntervalMinutes`。
   - `useEffect` 中调用 `GET /api/settings` 读取。
   - `handleSave` 调用 `POST /api/admin/settings` 保存上述这些字段。
   - 保留之前的表单输入界面，以及逻辑校验（如“爽约宽限期必须 ≥ 迟到宽限期/超时宽限期”）。

3. **改造 `ViolationsAndPenaltiesTab.tsx`**：
   - 顶部 Sub Tab 导航区进行更新：状态值支持 `'records' | 'stats' | 'active_penalties' | 'violation_params' | 'rules'`。
   - UI 展示名称更新为：`违规明细 | 违规统计 | 生效中的惩罚 | 违规判定规则 | 惩罚动作设置`（让语义更清晰区分“判断你违规”和“判断后怎么罚”）。
   - 在页面下半部分，当 `activeSubTab === 'violation_params'` 时渲染我们刚写的 `<ViolationParamsTab />`。

4. **精简 `SettingsTab.tsx`**：
   - 移除在设计方案(2)中移走的 5 个 state 及相关 useEffect 回显代码。
   - 移除 HTML JSX 中的表单 UI 块（违规判定与宽限期设置）。
   - 移除 `handleSave` 内这 5 个字段的 payload 拼装代码。

# 涉及文件
- **新增**: `src/pages/Admin/components/ViolationParamsTab.tsx`
- **修改**: `src/pages/Admin/components/SettingsTab.tsx`
- **修改**: `src/pages/Admin/components/ViolationsAndPenaltiesTab.tsx`
