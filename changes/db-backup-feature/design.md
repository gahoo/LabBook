# 需求概述 (Overview)
用户希望通过 Node.js 自身的定时任务机制（结合 SQLite 原生的 `backup()` 方法）来实现数据库定期全量本地备份。
为使得此功能灵活可控，并做到界面模块的纯粹清晰，将会新增一个专属的管理子页面（**数据备份** Tab）。
在该 Tab 中，将提供以下两个配置项：
1. **自动备份开关 (Enable Auto Backup)**：开启或关闭本地自动备份机制。
2. **自动备份执行时间 (Auto Backup Time - Cron)**：定义多久执行一次备份，以防止硬编码的定时任务不满足实际运维需求。
*注：考虑到系统安全性（防止 RCE 漏洞），不开放自定义 Shell 执行入口，而是由管理员后续在系统级别统一挂载远程同步脚本，或在系统层面另外处理。*

# 设计方案 (Design)

### 1. 数据库配置层 (`settings` 表扩展)
默认向 `settings` 表中填充以下两个新的键值对：
- `auto_backup_enabled`: 默认值为 `'false'`
- `auto_backup_cron`: 默认值为 `'0 3 * * *'` (即每天凌晨 3:00 执行备份)

### 2. Node.js 后端定期执行架构 (`server.ts`)
- **包依赖**：项目已安装了 `cron-parser`。为了纯粹的 Cron 任务调度，安装 `node-cron` 并在代码中使用 `cron.schedule`。
- **任务定义**：
  - 加载设置中的开关和 Cron 表达式。
  - 创建一个 `node-cron` 任务：如果开关为 true 且到达 cron 时间，则触发 SQLite 备份。
  - **备份策略**：使用 `better-sqlite3` 自带的 `db.backup()` 异步生成文件。文件名为 `lab_equipment_backup_YYYYMMDD_HHMMSS.db`。文件存放在项目根目录下的 `backups` 文件夹内（启动时自动创建）。
  - **动态重启任务机制**：当提供 `POST /api/admin/settings` 更新了设置后，调用 `reloadBackupTask()` 刷新 Cron。
- **清理策略（Retention）**：在每次执行备份后，读取 `/backups` 目录的文件列表，通过创建时间或文件名解析保留最近的 7 份（或最新7个）备份文件，自动使用 `fs.unlinkSync` 删去旧文件。

### 3. API 层修改 (`server.ts`)
- 确保 `GET /api/settings` 和 `POST /api/admin/settings` 以及前台配置逻辑不受影响。（当前接口应当是能动态支持任意键的持久化配置）。
- POST 更新中若包含设定的变动，触发 `reloadBackupTask`。

### 4. 前端管理后台修改
- 新增 `src/pages/Admin/components/BackupTab.tsx` 组件。
- 在 `src/pages/Admin/index.tsx` 的导航 Sidebar 中增加“数据备份”选项卡，选中时渲染该 Tab。
- UI 提供开关及输入框提交。

# 任务拆解 (Tasks)
- [x] **任务1**：处理基础库与配置（`.gitignore` 中添加 `backups`，安装 `node-cron`）。
- [x] **任务2**：编写后端（`server.ts`）的 `node-cron` 调度备份逻辑、落库方法和清理脚本；对接 `/api/admin/settings` 以动态重启定时服务。
- [x] **任务3**：增加单独的 `<BackupTab />` React 组件包含配置表单 UI，并对接上述设定的读写 API。
- [x] **任务4**：在原本的管理后台主入口加入对应的 Sidebar 路由与渲染导航。
- [x] **任务5**：进行全流程的本地短频测试。
