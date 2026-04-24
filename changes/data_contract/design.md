# 数据契约设计

## 目标
当前 `/api/violations/my` 接口在 `server.ts` 中固定返回 `{ violations: [...], userPenaltyDetails: ... }` 格式的对象。但在前端页面（如 `Booking.tsx` 和 `ViolationQuery.tsx`）中，对返回值的处理存在模糊逻辑：`vData.violations || vData`，并且 `bannedViolations` 被声明为了 `any[]`。这导致当有非预期情况发生时，例如直接被赋值为一个完整的对象，会导致 `.map is not a function` 异常。

为了杜绝这种问题，我们需要引入前后端共享的强类型数据契约（Data Contracts）。

## 变更计划

1. **新建契约文件：`src/types.ts` (如尚无全局定义) 或 `src/types/index.ts`**
   声明以下类型接口：
   ```typescript
   export interface ViolationRecord {
     id: number;
     student_id: string;
     student_name: string;
     reservation_id: number;
     status: string;
     violation_type: string;
     violation_time: string;
     remark: string | null;
     booking_code?: string;
     equipment_name?: string;
     duration_minutes?: number;
   }

   export interface UserPenaltyDetails {
     isPenalized: boolean;
     penaltyMethod: 'NONE' | 'RESTRICTED' | 'REQUIRE_APPROVAL' | 'BAN';
     reason: string;
     restrictions: {
       reduce_days: number;
       min_retain_days: number;
       fee_multiplier: number;
     };
     violation_ids: number[];
     triggered_rules_details: Array<{
       rule_id: number;
       rule_name: string;
       contributing_ids: number[];
     }>;
   }

   export interface MyViolationsResponse {
     violations: ViolationRecord[];
     userPenaltyDetails: UserPenaltyDetails | null;
   }
   ```

2. **前端页面组件类型安全强化**
   - **`src/pages/Booking.tsx`**：
     导入强类型：`import { ViolationRecord, MyViolationsResponse } from '../types';`
     修改 state：`const [bannedViolations, setBannedViolations] = useState<ViolationRecord[]>([]);`
     修改接口调用处理，去除 `vData.violations || vData` 这样的弱约束逻辑：
     ```typescript
     const vData = await vRes.json() as MyViolationsResponse;
     setBannedViolations(vData.violations); // 明确提取 `violations` 数组
     ```
   - **`src/pages/ViolationQuery.tsx`**：
     同样导入类型，修改赋值：
     ```typescript
     const data = await res.json() as MyViolationsResponse;
     setViolations(data.violations); 
     setPenaltyDetails(data.userPenaltyDetails);
     ```

3. **后端（可选增强约束）/ `server.ts`**
   - 可以在后端确保通过返回值的强类型包装，例如向外界导出同源的类型接口。此时由于应用在单仓结构上，我们可以直接通过引用 `src/types.ts` 定义辅助服务端约束（此处考虑保持简单，重点在前端强约束和契约文件化）。

## 预期效果
通过明确返回体为 `MyViolationsResponse` 并在 `setBannedViolations` 时只剥离 `.violations` 字段赋给数组状态，从根本上解决由容错写法导致的不稳定数据形态，并彻底避免 `bannedViolations.map is not a function` 错误。
