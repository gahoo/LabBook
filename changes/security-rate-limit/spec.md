# 速率限制保护中间件引入 (Rate Limiting)

## 1. 背景与目标
安全审计报告指出，对于含有暴力枚举和大量信息探测可能性的接口，当前应用缺少请求频次限制：
1. `booking_code` 由 8 位 16 进制字符组成，如果攻击者高频发起穷举测试（几万次/秒），极有可能撞库出一个真实的他人预约。
2. `/api/admin/login` 等验证口如果没有保护，管理员密码极易遭受本地脚本爆破。
3. 触发邮件下发的 C 端接口（如日历订阅邮件）如果缺乏限制，极易引发邮件轰炸，给服务器及第三方邮件服务带来不必要的负担，甚至导致发件箱被封禁。

为此，我们将实施轻量级的内存机制速率限制（Rate Limiting）以增强系统的韧性和抗压性。通过 `express-rate-limit` 基于请求的独立 IP 进行拦截，该方案完全在 Node.js 内存中维护计数，不需要额外部署 Redis 等组件，非常轻量且几无额外性能负担。

## 2. 方案选型与设计
* **引包选型**：使用 Node 生态中最标准的中间件 `express-rate-limit`，选择其默认 In-memory store。
* **阈值设计**：

  | 限制器分类 | 目标路由 | 限制阈值 | 设计目的 |
  | :--- | :--- | :--- | :--- |
  | **authLimiter** | `POST /api/admin/login` | 15 分钟限制 20 次 | 防止管理员密码遭到暴力破解。 |
  | **mailLimiter** | `POST /api/calendar/user/mail` | 15 分钟限制 10 次 | 控制发送邮件类接口，防止恶意请求导致邮件轰炸和资费消耗。 |
  | **actionLimiter** | `POST /api/reservations`<br/>`POST /api/reservations/update`<br/>`POST /api/reservations/cancel` | 15 分钟限制 60 次 | 防止利用自动化脚本瞬时并发抢占设备名额、囤积或大批量废弃预约。 |

## 3. 具体修改项
* 运行 `npm install express-rate-limit`（由于该包现版自带类型声明，无需单独安装 `@types/express-rate-limit`）。
* 在 `server.ts` 顶层统一导入 `rateLimit` 函数。
* 增加代理信任配置：`app.set('trust proxy', process.env.TRUST_PROXY || 1);`，防止在云端部署时拦截器将反向代理或负载均衡的主机 IP 当作攻击源导致全体用户被错误限流。本地部署且无反向代理时可通过环境变量覆写为 0。
* 创建并配置对应的限制器实例，按规划的分类包裹在特定的 C 端/管理端相关路由之前。
