# 任务拆解：无效日期参数绕过漏洞防御

- [x] 1. **加固创建预约接口 (`/api/reservations`)**：在声明并创建 `start` 和 `end` 变量之后，立即插入 `isNaN(start.getTime()) || isNaN(end.getTime())` 检查，不合法返回 400 Bad Request。
- [x] 2. **加固更新预约接口 (`/api/reservations/update`)**：同上，在对时间进行运算前，检查变量是否为有效数字时间戳。
- [x] 3. **加固管理端更新和可能的创建接口 (`/api/admin/reservations/:id` 等)**：实施深度防御，为管理端编辑时间处也增加相同的阻断逻辑。
- [x] 4. **编译与回归测试验证**：确保新增逻辑不影响正常日期的功能，更新 `TOC` 中漏洞修复的状态。
