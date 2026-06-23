# 任务拆解：速率限制保护加固

- [x] 1. **安装依赖**：安装 npm 包 `express-rate-limit`（由于只是用于中间件定义，其也包含了 ts 声明）。
- [x] 2. **配置网关解析代理设置**：在 `server.ts` app 初始化阶段增加 `app.set('trust proxy', 1 /* number of proxies between user and server */)`，确保通过 NGINX 时能读取到真实的 `X-Forwarded-For` 用户 IP，否则限流不仅无效，还可能导致合法用户群体被相互阻塞。
- [x] 3. **实例化限制器中间件**：在 `server.ts` 中声明 `authLimiter`, `mailLimiter`, `actionLimiter` 这几个不同的限流等级实例。
- [x] 4. **注入限流阻断逻辑**：将上述实例作为中间件层插入到 `server.ts` 对应的路由定义中。
- [x] 5. **编写测试脚本**：在 `changes/security-rate-limit/` 下创建一个 Node.js 测试脚本，模拟并发请求验证防御效果。
- [x] 6. **编译与验证归档**：使用测试脚本验证，并完成 Build 构建确保无语法错误，完成后推入 TOC 中。
