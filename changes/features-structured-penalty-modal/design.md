# 结构化预约拦截弹窗 (Structured Penalty Modal) 设计方案

## 1. 背景与目标

当前预约系统在用户因违规被限制（BAN 或需审批等）时，直接通过简单的字符串拼接将所有触发的规则、受限原因、关联违规记录和解封时间混在一起展示。当用户同时触发同一类型的多级阶梯规则（例如“迟到一次”、“迟到二次”）时，提示信息会显得非常杂乱，缺乏直观性。目前的提示框虽然已经弃用了 `alert`，但其内部显示的长串文本体验依然欠佳。

**目标：**
- **后端调整**：提供结构化的详细拦截信息，而不只是一个字符串。
- **前端过滤**：对同类、同惩罚级别的多级阶梯进行合并或过滤，仅向用户展示“同类型同惩罚方式中最严重的那一条”规则。
- **全新 UI 呈现**：用一张结构化的排版来显示拦截原因，区分基础信息（如姓名、学号、解封时间）和规则列表列表、以及触发的违规记录，提升用户体验。
- **互相独立**：此前端过滤仅用于“拦截提示”。用户自己的“违规与申诉查询”页面依然全量显示，让用户清晰知道各个阶梯分别是什么。

## 2. 后端数据结构重构 (`server.ts`)

为了前端能够有足够的数据过滤，后端需要在返回 403 错误（与 `checkUserPenalty` 结果）时，除了原本的错误文本外，附带一个 `structured_penalty` 对象。

```typescript
// checkUserPenalty 返回的新增结构
res.status(403).json({
  error: penaltyCheck.reason, // 保留原有简单文本兼容
  structured_penalty: {
    student_id: string,
    student_name: string,
    unban_time: string | null, // 格式化的解封时间或时长
    penalty_method: 'BAN' | 'REQUIRE_APPROVAL' | 'RESTRICTED',
    triggered_rules: [
      {
        rule_name: string,
        violation_types: string[], // 比如 ['late', 'no-show']
        penalty_method: string,    // 'BAN', 'REQUIRE_APPROVAL', etc.
        duration_days: number,     // 用于前端比对严重程度 (BAN的情况下比天数)
      }
    ],
    // 违规记录详情也会附带，以便于UI中结构化展示
    violation_records: [
      {
        id: number,
        type: string,
        time: string,
        equipment_name: string
      }
    ]
  }
});
```

*说明*：后端在 `checkUserPenalty` 以及触发返回给前端报错时，组装好含有原始业务属性的 `triggered_rules` 数组和对应的违规记录 `violation_records` 数组。

## 3. 前端过滤与计算策略 (`Dashboard.tsx` 及相关入口)

当拦截弹窗接收到 `structured_penalty` 时，执行过滤计算。

**“同类中最严重规则”的分组过滤算法：**
1. **分组维度**：将规则按照 `violation_types` (排序后合并的字符串，或者组合名) 与 `penalty_method` 进行**联合分组**。
   - 这意味着“迟到引起的BAN”与“迟到引起的审批”会被分到不同的组，全部保留并展示出来给用户看。
2. 在同一个分组内，按照严重程度进行排序并只取第一条展示在受限卡片中。
   - 比较维度：如果是 BAN，则比较 `duration_days` (天数长的更严重，只留天数最长的那条)。
3. 最后将所有分组中筛选出的最严重规则组合在一起进行渲染，确保多重限制、多重惩罚都能清晰表达，而不显得荣誉。

## 4. UI 设计与展示

弃用拥挤的文案排版，引入结构化的模态层（目前已是一个 Modal，进一步优化其内部呈现）。

**UI 布局：**
1. **Header (顶部区域)：** 警告 Icon 加上标题，如“预约受限详单”。
2. **User Info (个人信息区)：** 浅色背景的卡片或网格，分别展示：
   - 姓名：`[Student Name]`
   - 学号：`[Student ID]`
   - 当前状态：如 `不可预约 / 需审批`
   - 解封时间：`[Y-M-D H:m] 或 未知` (高亮显示，如果为封禁)
3. **Rules List (规则列表区)：** 小标题“限制原因：”。基于前述**过滤算法**得出精简且直观的受限规则列表。展示规则名称、具体的惩罚力度。
4. **Violations (违规记录区)：** 小标题“关联违规记录：”。循环渲染导致本次受限的近期具体违规流水明细（时间、机台名称、类型等），如同现在的系统结构一样，让用户明白为何被处罚。
5. **Footer (底部操作区)：**
   - “去申诉与查询” (主要按钮)：点击后导航至 `/violations/my` 或对应页面。
   - “关闭” (次要按钮)：关闭模态框。

## 5. 对历史兼容及其他页面的影响
- “我的违规”查询页面 (`ViolationQuery.tsx`) 直接使用原始返回，不受上述组去重/过滤算法影响，照常渲染全部明细。
- 只有触发预约失败、或者通过入口检测当前受限状态弹出的新提示框，才会应用上述的分组过滤与重排呈现。
