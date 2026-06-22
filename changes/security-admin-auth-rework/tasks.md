# 任务拆解：管理员鉴权机制重构

- [x] 1. **依赖安装**：安装 `jsonwebtoken` 以及类型包 `@types/jsonwebtoken`。
- [x] 2. **服务端依赖补充**：`server.ts` 导入 `crypto` 和 `jsonwebtoken` 模块。
- [x] 3. **清理弱密码与初始增强**：在 `server.ts` 中替换原本属于 `admin123` 的回退逻辑，添加动态生成强密码和 JWT Secret 的逻辑，并在启动函数中增加醒目的终端打印。
- [x] 4. **重构登录签发接口**：修改 `server.ts` 中的 `/api/admin/login` 接口，校验通过后利用 `jwt.sign` 签发具有 24h 时效的 JWT Token 并下发。
- [x] 5. **重构权限校验中间件**：修改 `server.ts` 中的 `adminAuth`，剥离原先的直接判等逻辑，改为 `jwt.verify`。
- [x] 6. **前端验证衔接**：审查 `Administration` 包含其子组件以及 API 请求封装段的前端代码逻辑，确保登录行为准确提取 JWT 的响应结果进行前端归档持久化，以完成整个使用闭环。
- [x] 7. **动态控制JWT过期时间**：在系统常规设置中增加 `jwt_expires_in_hours` 配置项（默认 168 小时），管理界面可动态更新，服务端登录签发时根据该配置生成对应寿命的 token。
