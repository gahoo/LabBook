# 编辑仪器时人员白名单无法正常加载修复方案

## 1. 问题背景
在之前的 commit 中，为了保护隐私和数据安全，在 `GET /api/equipment` 接口中引入了针对非管理员的数据脱敏逻辑，即隐藏仪器的 `whitelist_data` 等字段。
然而，由于前端调用接口时未传递身份凭证，后端也未使用正确的 JWT 解析方式验证身份，导致管理员在编辑仪器时获取到的也是脱敏后的数据，白名单输入框因此显示为空。

## 2. 根因分析
1. **前端未携带 Auth 请求头**：`EquipmentManagementTab.tsx` 中的 `fetchEquipment()` 调用未传递 `Authorization: Bearer ${token}`。
2. **后端鉴权逻辑不匹配**：`server.ts` 中的 `GET /api/equipment` 使用了错误的硬编码密码比对方式 `req.headers.authorization === Bearer ${ADMIN_PASSWORD}`，而系统采用的是 JWT 认证。

## 3. 修复方案
1. **修复后端验证逻辑**：在 `server.ts` 的 `GET /api/equipment` 中，解析 `Authorization` 请求头并验证 JWT token 确认管理员身份。
2. **补充前端请求头**：在 `EquipmentManagementTab.tsx` 的 `fetchEquipment()` 中添加 `headers: { 'Authorization': Bearer ${token} }`。
