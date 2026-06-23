# 任务拆解：公开预约查询隐私字段脱敏

- [x] 1. **改造 Batch 查询 SQL**：在 `server.ts` 中的 `POST /api/reservations/batch` 接口，将 `SELECT r.*` 修改为不含 `r.phone` 和 `r.email` 字段的具体字段列表（Projection）。
- [x] 2. **改造 Code 查询 SQL**：在 `server.ts` 的 `GET /api/reservations/:code` 接口中执行同样的 SQL 将 `SELECT r.*` 转换为明文安全字段列表。
- [x] 3. **编译测试与归档**：使用 `tsc --noEmit` 与构建进行快速验证，确保无 ts 类型和语法的强破坏，并在完成后将其推入总变更栈中。
