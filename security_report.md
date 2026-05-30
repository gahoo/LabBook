# AI Studio App 安全调研报告与优化建议

## 1. 调研背景

本项目是一个基于 Express 和 SQLite (`better-sqlite3`) 的仪器预约管理系统。根据项目要求，系统核心设计特点之一是**免注册预约**（依托 `student_id` 和生成的预约码 `booking_code` 验证用户身份及执行权限操作）。

在此无登录态及弱会话管理的设计前提下，我们对 `server.ts` 和整体后端逻辑进行了深度的源码审计，重点排查了授权与鉴权、业务逻辑漏洞、输入校验、敏感信息泄露、防重放攻击以及资源限制等方面的安全隐患。

---

## 2. 安全漏洞与隐患分析

### 2.1 身份认证与访问控制 (Authentication & Authorization)

#### 2.1.1 弱口令与认证方式薄弱
- **发现问题**：管理员登录采用静态密码方案：`const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';`，并且验证过程是简单的明文匹配 (`authHeader === Bearer ${ADMIN_PASSWORD}`)。
- **安全风险**：
  1. 如果 `.env` 配置文件泄漏或未设置，密码回退为极弱口令 `admin123`，极易被爆破。
  2. 明文匹配可能会遭到时间侧信道攻击 (Timing Attack)，尽管由于网络延迟在此场景下攻击难度大，但这违背了密码验证的最佳实践。
  3. 所有管理员共享一个令牌，无法进行细粒度的权限控制审计（Audit Logs 无法追溯具体是哪个管理员的操作）。

#### 2.1.2 越权与身份冒用 (基于预约码及学号)
- **发现问题**：普通用户的身份认证依赖于 `booking_code` 或者是未加盐的明文 `student_id`。
  - 例如，`/api/reservations/update` 和 `/api/reservations/cancel` 接口仅需要提供 `booking_code`：
    ```typescript
    const { booking_code } = req.body;
    const reservation = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(booking_code);
    ```
  - 创建预约时生成的 `booking_code` 长度较短，仅为 8 位 16 进制字符串：`crypto.randomBytes(4).toString('hex').toUpperCase();`（熵为 32-bit，约为 42 亿种可能）。
- **安全风险**：
  1. 32-bit 的预约码在没有任何速率限制 (Rate Limiting) 的情况下，极易被恶意攻击者通过暴力破解 (Brute Force) 或字典攻击猜出，从而任意取消或修改他人的预约。
  2. 某些接口使用 `student_id` 进行关联查询（如 `/api/violations/my`，直接传入 `student_id` 即可查到违规记录），学号通常具有规律性和公开性，这意味着恶意用户可以轻易查询任意学生的违规记录或个人信息。

### 2.2 业务逻辑漏洞 (Business Logic Flaws)

#### 2.2.1 缺乏接口防刷与速率限制 (Rate Limiting & DoS)
- **发现问题**：整个 Express 应用未使用如 `express-rate-limit` 等中间件。不论是 `/api/admin/login` (管理员登录)、`/api/reservations` (提交预约)，还是依赖外部系统发送邮件和 Webhook 的接口 `/api/admin/notifications/test-connection`，都没有频次限制。
- **安全风险**：
  1. **恶意预约占坑/DoS攻击**：恶意用户可以通过脚本大量生成合法或伪造的 `student_id`，恶意占用所有的仪器可用时间段（占坑），导致正常用户无法预约。
  2. **邮件与 Webhook 轰炸**：由于系统会触发邮件或 Webhook，攻击者可通过高频调用触发相关告警，耗尽服务商 API 额度，甚至由于触发大量网络 I/O 导致自身服务拒绝服务。

#### 2.2.2 并发与竞争条件 (Race Conditions)
- **发现问题**：在 `/api/reservations` 接口中，预约时间段的冲突检查机制是通过执行 SELECT 查询后进行的判断：
  ```typescript
  const existingRaw = db.prepare(`SELECT ... WHERE ... AND start_time < ? AND end_time > ?`).all();
  // ... 逻辑判断 ...
  const stmt = db.prepare(`INSERT INTO reservations ...`);
  stmt.run(...);
  ```
- **安全风险**：
  这里没有使用事务 (`db.transaction()`) 包裹读写操作，也没有数据库级别的悲观锁或唯一性约束限制。如果在高并发下，两个请求几乎同时到达，都会查询到“无冲突”，从而成功插入两条时间段重合的预约记录，导致系统调度混乱。

#### 2.2.3 伪造与越权签到/签退 (Check-in/Check-out Bypass)
- **发现问题**：签到 `/api/reservations/checkin` 与签退 `/api/reservations/checkout` 接口仅依靠传入的 `booking_code` 进行操作。
- **安全风险**：只要拿到或爆破出他人的 `booking_code`，攻击者不仅能恶意取消，还可以恶意替人签退，或在用户不需要时故意耗费耗材(`consumable_quantity`)并结束流程，导致正常用户资产受损（如扣费异常）或面临违约处罚。

### 2.3 输入校验与注入防御 (Input Validation)

#### 2.3.1 输入验证不足 (Missing Input Validation)
- **发现问题**：系统对传入的 JSON 体如 `req.body` 的类型和格式验证极为薄弱。
  - 例如，`/api/admin/equipment-batch` 批量更新接口，允许修改内部 JSON：
    ```typescript
    if (updateData.advanceDays !== undefined) { avail.advanceDays = updateData.advanceDays; }
    ```
  - 例如，查询参数的分页控制 `/api/admin/delivery-logs`：
    ```typescript
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    ```
- **安全风险**：
  1. 如果 `page` 或 `limit` 传入非数字字符串，`parseInt` 返回 `NaN`，可能导致 SQL 查询执行错误或导致服务抛出未捕获异常而崩溃。
  2. `req.body` 参数直接更新进入数据库（未做 XSS 过滤），当管理员审核时在前端渲染该输入内容，极易导致存储型 XSS 漏洞。

#### 2.3.2 良好的安全点（SQL 防注入）
- 系统绝大多数地方严格使用了 `better-sqlite3` 的 `db.prepare("...").all(...)` 和占位符 `?` 来防止 SQL 注入。动态生成 `IN (?, ?, ?)` 的方式也是安全的。但是由于缺少前端传来参数的白名单校验，存在一定的数据库层报错被当做 500 返回的情况。

### 2.4 数据泄露与配置安全 (Information Disclosure)

#### 2.4.1 不当的数据返回范围 (Data Over-fetching)
- **发现问题**：在 `/api/admin/reservations` 或查询相关报表时，将整个 `reservations` 和 `violation_records` 连表查询直接抛给客户端。由于没有通过 DTO（数据传输对象）裁剪不必要的数据字段，在管理员或某些接口返回中可能会暴露更多未脱敏的系统字段。

#### 2.4.2 错误处理过于宽松
- **发现问题**：多个 `catch` 代码块使用了类似形式：
  ```typescript
  catch (error: any) { res.status(500).json({ error: error.message || String(error) }); }
  ```
- **安全风险**：一旦底层数据库或网络服务报错，详细的栈信息或具体的 SQL 执行错误信息可能被暴露给外部攻击者，为后续漏洞利用提供便利。

---

## 3. 针对“免注册预约”设计的针对性修复建议

为了保证用户体验不降低的同时提升系统安全性，提出以下架构层面与代码层面的改进方案。

### 3.1 增强鉴权与防爆破
1. **提升 `booking_code` 强度与增加防穷举机制**：
   - 使用更高强度的随机生成算法（如 UUID v4 的前 8 位或更长的高熵随机字符串）。
   - 在应用层或借助中间件（如 `express-rate-limit`）限制每个 IP 对 `/api/reservations/update`、`/api/reservations/cancel`、`checkin` 和 `checkout` 等操作的失败重试频率（如 1 分钟内最多错误 5 次，锁定 IP 或学号 15 分钟）。
2. **引入简单的会话凭证（可选平滑过渡）**：
   - 即便没有用户注册系统，当用户在提交预约时，前端可以要求提供“学号+手机号后四位/邮箱验证码”作为二次身份验证，而非仅仅依靠一条 `booking_code`。
3. **隔离学号查询接口**：
   - 如需查看自己的违约记录（`/api/violations/my`），应加上通过邮件发送单次查询链接或通过预约时留下的手机号进行验证码验证，防止学号被恶意枚举。

### 3.2 强化管理员安全
1. **摒弃静态明文密码**：
   - 采用 bcrypt 哈希加盐存储管理员密码（即便依然是单用户系统，也应对 `ADMIN_PASSWORD` 采用 Hash 校验）。
2. **安全对比**：
   - 使用 `crypto.timingSafeEqual` 进行密码字符串验证，防止时间侧信道攻击。
3. **基于 JWT 的会话管理**：
   - 取消长期有效且暴露在每一次请求头中的固定 Bearer Token，改用标准的 JWT 授权流程，登录后下发有时效性（如 2 小时）的 Access Token。

### 3.3 业务逻辑防范与边界限制
1. **解决数据竞争 (Race Condition)**：
   - SQLite 尽管是文件锁机制，但依然需要将检查重合时间段（`SELECT`）和插入预约数据（`INSERT`）放在一个显示的 `db.transaction()` 中执行，以防止并发问题。
2. **增加全站的速率限制 (Rate Limiter)**：
   - 在所有对外暴露的公共 `/api/` 添加 IP 频率限制。特别是创建预约接口，防止批量恶意占坑和触发大量外部 Webhook 报警。
3. **实施严格的输入校验 (Input Validation)**：
   - 引入 `Zod` 或 `Joi` 等校验库，对 `req.body` 和 `req.query` 的所有字段进行格式（字符串长度、正则、Email格式、日期合法性等）和类型强校验，杜绝由非法类型引发的服务崩溃。

### 3.4 隐藏系统拓扑与脱敏
1. **统一错误拦截层**：
   - 不向客户端（非调试环境）暴露底层的 Error message。捕捉异常后，统一返回类似 `{ error: "服务器内部错误，请联系管理员" }` 的格式，仅在后台记录详细日志。

---

**总结**
由于系统采取了去中心化的免注册设计模式，安全防御的重心应当转移到**防自动化攻击（Rate Limit）**、**凭据的复杂性与保密性（高熵预约码）**以及**多因素维度的身份确权（学号+预约码+可能的手机验证码结合）**上。按照上述建议落实，即可在维持轻量化设计的同时达到较好的安全水平。

## 4. API层的专项安全审查 (API-Specific Security Review)

除上述逻辑漏洞外，从 HTTP 和 API 的设计层面出发，本系统还存在以下安全隐患：

### 4.1 缺乏 IDOR (不安全的直接对象引用) 防护
- **发现问题**：如 `/api/violations/my` 接口允许通过 `req.body.student_id` 获取该学号下的所有违约记录；`/api/reservations/:code` 允许通过 `booking_code` 随意读取预约详情。
- **安全风险**：如果 `student_id` 存在枚举性，或者 `booking_code` 生成规律被破解，任何人都可以遍历获取其他用户的姓名、联系方式(`phone`、`email`)等个人敏感信息 (PII)。
- **修复建议**：必须对查询者进行身份校验，或者将凭证转化为高强度的 Token（例如前文建议的增强 `booking_code` 长度，或者结合手机短信进行短效鉴权）。

### 4.2 API 分页机制与资源耗尽 (Pagination & Resource Exhaustion)
- **发现问题**：
  1. 在 `/api/admin/delivery-logs` 等接口中，存在 `page` 和 `limit` 参数。但服务端未对 `limit` 设置最大值限制。
  2. 诸如 `/api/admin/audit-logs` 或 `/api/admin/reports` 根本没有分页设计，直接执行 `.all()` 捞取所有数据返回。
- **安全风险**：攻击者或者粗心的请求可以传递极其巨大的 `limit`，或在没有分页的接口上积累海量数据导致 Node.js 进程 OOM (Out Of Memory)，引发服务拒绝服务 (DoS)。
- **修复建议**：
  - 对所有支持分页的接口设定最大限制（如 `Math.min(parseInt(limit), 100)`）。
  - 对没有分页的接口必须加上分页设计或强制的时间范围查询阈值（如最多查1个月）。

### 4.3 负载限制与参数污染 (Payload Size & HTTP Parameter Pollution)
- **发现问题**：
  1. Express 初始化为 `app.use(express.json());`，没有明确设定 `limit` 属性（默认可能是 100kb，但对于某些大文本输入如 `availability_json` 或白名单文件可能需要明确控制边界）。
  2. 未使用 `hpp` (HTTP Parameter Pollution) 等中间件，若客户端通过 `req.query.id=1&req.query.id=2` 传递数组，可能会导致非预期的数据库查询逻辑异常（虽然部分代码如 `.split(',')` 强制按字符串处理一定程度规避了问题）。
- **修复建议**：设定明确的 payload 限制：`app.use(express.json({ limit: '1mb' }));`。并防范参数污染。

### 4.4 CORS 与 CSRF 防护缺失
- **发现问题**：代码中未见配置 CORS 和 CSRF Token 的相关中间件（如 `cors` 模块配置或 `csurf`）。
- **安全风险**：虽然应用可能是同源部署（Frontend 与 Backend 一体），但如果不显式限制 CORS，外部站点可能会伪造 API 请求（特别是无需身份认证即可提交预约等 POST 接口），或者如果存在基于 Cookie 的管理员会话（当前使用 Bearer token 规避了 CSRF，但不代表无风险）。
- **修复建议**：明确配置严格的 CORS 策略只允许受信任的 Origin 进行调用；针对无需登录的接口增加行为验证码（CAPTCHA 或 Turnstile）防止机器发包或跨站攻击。
