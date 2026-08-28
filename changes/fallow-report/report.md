# Fallow 深度分析报告

## 一、 代码健康度与复杂性 (Health & Complexity)

### 整体指标
- **总维护性指数 (MI)**: 89.8 (良好)
- **分析文件数**: 90
- **复杂函数数量**: 170
- **发现问题总数**: 170 (超出阈值)

### 重构目标优先级 (Top Refactoring Targets)
- **src/utils.ts**
  - 优先级评分: 23.6 (未测试风险最高)
  - 建议: 包含3个缺少测试覆盖路径的复杂函数，需在修改前添加测试。
- **src/modules/reservation/validation.ts**
  - 优先级评分: 22.3
  - 建议: 提取 validateReservationRules (认知复杂度: 45) 和 validateReservationInput (认知复杂度: 34) 为更小的函数。
- **src/modules/reservation/stats.ts**
  - 优先级评分: 22.1
  - 建议: 移除 2 个未使用的导出项，减少暴露面积 (50% 的死代码)。
- **src/modules/violation/evaluator.ts**
  - 优先级评分: 28.7
  - 建议: 拆分高影响文件 (502 LOC)，有 7 个依赖项放大了每次修改的影响。
- **src/pages/Admin/components/EquipmentManagementTab.tsx**
  - 优先级评分: 12.1
  - 建议: 提取 EquipmentManagementTab (认知复杂度: 64) 和 filteredEquipmentList (认知复杂度: 48) 为更小的函数。

## 二、 代码重复 (Duplication)

### 整体指标
- **重复代码行数**: 3670
- **重复率**: 18.0%
- **克隆组数量**: 75

### 主要克隆组 (Top Clone Groups)
- **跨 Form/Tab 组件的代码复制**:
  - src/pages/Admin/components/BatchEditEquipmentForm.tsx
  - src/pages/Admin/components/EquipmentForm.tsx
  - src/pages/Admin/components/ReservationsTab.tsx
  等多处存在大段 (超过 500 行) 的重复逻辑。

## 三、 死代码与未使用依赖 (Dead Code & Dependencies)

### 整体指标
- **未使用的文件数**: 5
- **未使用的导出项数**: 13 (包括1个类型定义)
- **未使用的依赖项数**: 10 (包含 dependencies, devDependencies 等)

### 未使用依赖详情
- **未使用 dependencies**: @google/genai, cron-parser, cronstrue, diff, qrcode, tailwind-merge
- **未使用 devDependencies**: autoprefixer
- **生产环境使用了 dev 依赖**: tailwindcss
- **应该转为 dev 的生产依赖**: @tailwindcss/vite, @vitejs/plugin-react

### 建议删除的文件
- scripts/generateDocs.ts
- scripts/migrate-timestamps.ts
- scripts/migrate-violations.ts
- scripts/migrate_penalties.ts
- src/lib/dateUtils.ts

### 建议移除的导出项
- tests/utils/fixtures.ts (3个)
- src/lib/zodSchemas.ts (2个)
- src/modules/notification/service.ts (2个)
- src/modules/reservation/stats.ts (2个)
- src/modules/reservation/validation.ts (2个)
- src/modules/calendar/service.ts (1个)
- tests/utils/db-helper.ts (1个)
