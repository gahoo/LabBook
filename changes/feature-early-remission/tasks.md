# 任务拆解与进度清单 (Tasks)

- [x] 后端：创建 `penalty_waivers` 表结构，并运行对应的数据库升级脚本。
- [x] 后端：修改 `checkUserPenalty` 核心逻辑：
    - 在动态惩罚和固定惩罚判断触发时，将触发的违规 ID 排序并生成哨兵逗号快照（如 `,101,102,105,`）。
    - 检查 `penalty_waivers` 表中是否存在该快照，如果存在，则跳过本次拦截。
- [x] 后端：在处理固定惩罚插入的逻辑（如 cron/更新违规状态处）中，补充快照匹配逻辑：如果匹配到已豁免快照，不插入新的 `user_penalties`。
- [x] 后端：新增 API 接口 `POST /api/admin/penalties/waive`，用于接收豁免请求。记录快照并（如果是固定惩罚）将 `user_penalties` 记录置为 `waived` 状态。
- [x] 前端：受限名单表格 (`ViolationsAndPenaltiesTab.tsx`) 中新增【提前解封/豁免】按钮。
- [x] 前端：实现豁免弹窗，二次确认，并展示警告提示“解除后若产生新的关联违规记录，惩罚将立刻重新触发”。调用 waive API 刷新列表。
