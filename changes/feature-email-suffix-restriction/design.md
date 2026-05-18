# 邮箱后缀限制功能设计 (Email Suffix Restriction Design)

## 1. 背景与目标
在实际部署和预约场景中，设备管理员希望能够限制非本单位或无关外部人员的预约申请。相比于繁重的SSO对接，通过限制预约表单中的邮箱后缀（如仅允许 `school.edu`、`company.com`）是一种轻量级且非常有效的访问过滤方式。

## 2. 放置位置探讨
**建议将该设置放置在：“系统常规设置” (SettingsTab) 中。**
- **理由**：邮箱后缀限制属于全局的访问及合规策略，直接决定了“谁有资格发起预约”，这是一种业务规则；而“通知配置”更多地聚焦于审批通过、拒绝等后置流程“信息如何送达”。因此放在常规设置中更符合语义与管理员的操作直觉。

## 3. 设计方案

### 3.1 数据存储 (Backend Database)
利用现有针对系统级全局设定的 `settings` 表存储一个新规则：
- **Key**: `allowed_email_suffixes`
- **Value**: 逗号分隔的后缀字符串（仅填写域名，不需要@，例如：`edu.cn, abc.com`）。如果为空则代表“不限制”（为了向后兼容和最大开放性）。

### 3.2 管理端界面 (Admin UI)
- 在 `SettingsTab.tsx` 中的常规配置页面里引入“允许的邮箱后缀”设置项。
- 引导文案明确提示：“支持配置多个后缀，以逗号分隔，留空表示不限制，不需要填写@。例如：pku.edu.cn, tsinghua.edu.cn”。

### 3.3 客户端与前端校验 (Client UI Booking.tsx)
- 此页面已有针对基础选项的拉取。表单填写时，我们利用读取到的 `allowed_email_suffixes` 进行前端实时/提交时校验。
- 如果邮箱后缀不匹配，给予明确清晰的表单红色报错提示列出允许后缀范围（如：“暂不支持该邮箱，目前仅允许以下邮箱后缀：pku.edu.cn, tsinghua.edu.cn”）。并阻止提交操作。

### 3.4 后端强校验 (Server API)
- 修改 `server.ts` 中的 `app.post('/api/reservations')`。
- 获取当前系统配置中 `allowed_email_suffixes` 的值进行拦截以防止通过直接抓包刷接口绕过前端，拦截失败统一返回 `400 Bad Request`（如：`{ error: 'Email suffix not allowed' }`）。

## 4. 相关文件
- `src/pages/Admin/components/SettingsTab.tsx`
- `src/pages/Booking.tsx`
- `server.ts`
