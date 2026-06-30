# 任务拆解与进度清单: 惩罚规则作用范围展示展示

- [x] 在 `src/pages/ViolationQuery.tsx` 中增加对 `/api/equipment` 的调用，并在 `getTriggerDesc` 中，若 `trigger.scope` 存在且非空，在返回值中追加“使用仪器A、仪器B时”的描述。
- [x] 在 `src/pages/Admin/components/PenaltyRulesTab.tsx` 中，针对规则列表的“触发条件”列进行结构改造：将原本的单行文本包裹为 flex 容器。
- [x] 在 `src/pages/Admin/components/PenaltyRulesTab.tsx` 中，如果 `trigger.scope` 有值，则在触发条件标签旁边渲染一个 Info 图标，并使用 absolute 浮出层（hover触发）展示映射后的特定仪器名称列表。
