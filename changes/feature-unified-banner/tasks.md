# 任务拆解 (Tasks)

- [x] 后端接口微调与支持 (Backend Support)
  - [x] 确保 `GET /api/admin/violations` 支持全量获取 `appealStatus=appealing` 的待审申诉（不受限狭窄日期范围）。
  - [x] 确保预约快捷通过与快捷驳回（及状态翻转撤销）顺畅触发邮件/通知通知链路。
  - [x] 增加申诉撤销（`undoAppeal`）端点 `POST /api/admin/violations/:id/undo-appeal`。
- [x] 通用组件开发 (`src/pages/Admin/components/UnifiedApprovalBanner.tsx`)
  - [x] 组件基础框架：聚合拉取三大待办数据源（预约、白名单、申诉）。
  - [x] 实现 Tab 感知与自动优先切换逻辑（根据 `activeTab` 智能优先高亮对应类别，无待办时自动兜底）。
  - [x] 渲染三大类别的胶囊（Pill/Capsule）与浮层卡片（Tooltip/Popover）。
  - [x] 实现统一的审核动作处理器（通过、驳回）。
  - [x] 实现跨类别的全局撤销操作栈（Undo Stack）。
- [x] 页面装配与重构 (`src/pages/Admin/index.tsx` & `ReservationsTab.tsx`)
  - [x] 在 `Admin/index.tsx` 页面顶部引入并挂载 `UnifiedApprovalBanner`。
  - [x] 清理 `ReservationsTab.tsx` 顶部原本内联的白名单 Banner 代码。
  - [x] 在待办审批完成后，派发 `admin-approval-resolved` 事件，通知各子 Tab 刷新下方对应表格列表。
- [x] 验证与测试 (Verification)
  - [x] 验证无待办时 Banner 自动隐去（0 像素）。
  - [x] 验证不同 Tab 切换时优先高亮对应分类，以及手动点击分类切换。
  - [x] 验证待审预约、白名单、违规申诉的“通过”、“驳回”及“撤销”全流程。
  - [x] 运行测试套件与 `gitnexus_detect_changes()` 验证无回归。
- [x] 视图密度切换（极简模式）与移动端适配优化 (Density Toggle & Mobile Optimization)
  - [x] 实现客户端 Cookie 读写工具函数（`getCookie`, `setCookie`）。
  - [x] 在 `UnifiedApprovalBanner` 胶囊流最左侧增加双态视图切换按钮（带分割线、Tooltip 及 Cookie 同步）。
  - [x] 实现极简模式胶囊样式：仅展示“姓名 + 审批按钮”，并确保悬停/点击依然呈现完整气泡详情。
  - [x] 移动端顶栏精简：隐藏“待办事项”标题、隐藏非活动 Tab 文字（保留图标与角标数字）。
  - [x] 移动端触控优化：胶囊尺寸与按钮热区适当放大，优化移动端浮层交互。
  - [x] 验证与构建：`npm run build`、测试套件运行、桌面/移动端响应式与 Cookie 记忆验证。
- [x] Tab 顺序镜像与初次载入动态隐藏 (Tab Order & Initial-Load Auto-Hide)
  - [x] 调整待办 Tab 渲染顺序、胶囊流顺序及降级优先级为：白名单 $\rightarrow$ 待审预约 $\rightarrow$ 违规申诉。
  - [x] 实现初次载入动态隐藏机制（`initialVisibleCategories`）：初次进入页面数量为 0 的 Tab 初始隐藏，会话中审批为 0 的 Tab 不消失，保留撤销与空状态。
  - [x] 保持撤销栈跨主 Tab 留存，确保随时可撤销（吃“后悔药”）。
  - [x] 验证与构建：`npm run build`、测试运行、主 Tab 切换与撤销交互验证。


