# 下一步方案及任务拆解

## 方案概述 (Spec)
基于 Fallow 的分析报告，目前项目在代码复杂度和重复率上存在较大改进空间。为了提升代码的可维护性，降低由于复杂性带来的风险，我们建议分阶段进行重构。主要包括：
1. **清理死代码与未使用依赖**：降低代码库的体积和理解负担。
2. **重构高复杂度文件**：将庞大的 React 组件和工具函数拆分为更小的单元。
3. **消除代码重复**：提取公共逻辑，减少维护成本。

## 任务清单 (Tasks)

- [ ] **Phase 1: 清理工作 (Quick Wins)**
  - [ ] 移除未使用的依赖（@google/genai, cron-parser, cronstrue, diff, qrcode, tailwind-merge, autoprefixer）
  - [ ] 调整依赖位置（@tailwindcss/vite, @vitejs/plugin-react 移至 devDependencies，tailwindcss 移至 dependencies）
  - [ ] 删除未使用的文件（scripts/ 目录下的一些迁移脚本，以及 src/lib/dateUtils.ts）
  - [ ] 移除未使用的导出项（tests/utils/fixtures.ts，src/lib/zodSchemas.ts，src/modules/notification/service.ts 等文件中的未使用导出）

- [ ] **Phase 2: 高优先级重构 (High Priority)**
  - [ ] **重构 src/utils.ts**: 这是未经测试的风险点，需要先添加测试，然后再进行重构。
  - [ ] **重构 src/modules/reservation/validation.ts**: 提取 validateReservationRules 和 validateReservationInput 到更小的函数中。
  - [ ] **重构 src/modules/violation/evaluator.ts**: 这是一个高影响力的文件，依赖它的模块很多，拆分它能显著降低系统耦合度。
  - [ ] **重构 React 组件**:
    - `src/pages/Admin/components/ViolationsAndPenaltiesTab.tsx` (121 认知复杂度)
    - `src/pages/Booking.tsx` (95 认知复杂度)
    - 策略：将庞大的 render 函数和复杂的事件处理逻辑提取为独立的 hook 或子组件。

- [ ] **Phase 3: 消除重复代码 (De-duplication)**
  - [ ] 分析 Fallow 报告中指出的重复代码组（特别是跨多个 Tab 和 Form 组件的重复），提取为共享的 hook 或高阶组件。

- [ ] **Phase 4: 建立 CI 门禁 (CI Integration)**
  - [ ] 安装 Fallow commit hook: `npx fallow hooks install --target git`
  - [ ] 将当前的指标保存为基线，防止未来的代码变差: `npx fallow dead-code --save-regression-baseline`
