import fs from 'fs';
import path from 'path';

const docsDir = path.join(process.cwd(), 'docs', 'api');

// Clean up existing directory to start fresh
if (fs.existsSync(docsDir)) {
  fs.rmSync(docsDir, { recursive: true, force: true });
}
fs.mkdirSync(docsDir, { recursive: true });

const apis = [
  { method: 'GET', path: '/api/public/penalty-rules', desc: '获取公开生效的惩罚规则', req: '无特殊参数', res: '返回惩罚规则列表 (JSON Array)', ex_req: 'GET /api/public/penalty-rules', ex_res: '[{"id": 1, "name": "迟到3次"}]' },
  { method: 'GET', path: '/api/admin/penalty-rules', desc: '管理员获取所有惩罚规则', req: 'Header: { Authorization: "Bearer <token>" }', res: '返回所有惩罚规则列表', ex_req: 'GET /api/admin/penalty-rules', ex_res: '[{"id": 1, "name": "迟到3次", "is_active": 1}]' },
  { method: 'POST', path: '/api/admin/penalty-rules', desc: '管理员新增惩罚规则', req: 'JSON: { name, description, violation_type, trigger_config, action_config, is_active }', res: '返回新建ID', ex_req: 'POST /api/admin/penalty-rules\\n{"name": "test"}', ex_res: '{"id": 1}' },
  { method: 'PUT', path: '/api/admin/penalty-rules/:id', desc: '管理员更新惩罚规则', req: 'Params: id. JSON: 修改的字段', res: '更新成功状态', ex_req: 'PUT /api/admin/penalty-rules/1', ex_res: '{"success": true}' },
  { method: 'DELETE', path: '/api/admin/penalty-rules/:id', desc: '管理员删除惩罚规则', req: 'Params: id.', res: '删除成功状态', ex_req: 'DELETE /api/admin/penalty-rules/1', ex_res: '{"success": true}' },
  
  { method: 'GET', path: '/api/settings', desc: '获取公开系统设置', req: '无', res: '系统全局配置参数', ex_req: 'GET /api/settings', ex_res: '{"allow_late_minutes": 15}' },
  { method: 'POST', path: '/api/admin/settings', desc: '管理员更新系统设置', req: 'JSON: settings 对象', res: '成功状态', ex_req: 'POST /api/admin/settings\\n{"allow_late_minutes": 20}', ex_res: '{"success": true}' },
  
  { method: 'GET', path: '/api/equipment', desc: '获取所有仪器列表', req: '无', res: '所有仪器的列表', ex_req: 'GET /api/equipment', ex_res: '[{"id": 2, "name": "显微镜"}]' },
  { method: 'POST', path: '/api/admin/equipment', desc: '新增仪器', req: 'JSON: { name, location, type... }', res: '新建的仪器ID', ex_req: 'POST /api/admin/equipment', ex_res: '{"id": 2}' },
  { method: 'PUT', path: '/api/admin/equipment/:id', desc: '更新仪器信息', req: 'Params: id. JSON: 更新内容', res: '成功状态', ex_req: 'PUT /api/admin/equipment/1', ex_res: '{"success": true}' },
  { method: 'DELETE', path: '/api/admin/equipment/:id', desc: '删除仪器', req: 'Params: id', res: '成功状态', ex_req: 'DELETE /api/admin/equipment/1', ex_res: '{"success": true}' },
  { method: 'PUT', path: '/api/admin/equipment-batch', desc: '批量更新仪器状态', req: 'JSON: { ids: [1,2], updates: { status: "maintenance" } }', res: '成功状态', ex_req: 'PUT /api/admin/equipment-batch', ex_res: '{"success": true}' },
  
  { method: 'POST', path: '/api/admin/login', desc: '管理员登录', req: 'JSON: { password }', res: 'Token 字符串', ex_req: 'POST /api/admin/login\\n{"password":"123"}', ex_res: '{"token": "xyz..."}' },
  
  { method: 'GET', path: '/api/equipment/availability/today', desc: '获取今日各种仪器的可用性状态', req: '无', res: '可用性指标', ex_req: 'GET /api/equipment/availability/today', ex_res: '{"1": {"id": 1, "free": true}}' },
  { method: 'GET', path: '/api/equipment/:id/availability', desc: '获取某仪器指定日期段的可用时段', req: 'Params: id. Query: date (YYYY-MM-DD)', res: '时间槽信息', ex_req: 'GET /api/equipment/1/availability?date=2026-04-20', ex_res: '{"slots": [...]}' },
  { method: 'GET', path: '/api/equipment/:id/reservations', desc: '获取某仪器最近所有的预约', req: 'Params: id', res: '预约列表', ex_req: 'GET /api/equipment/1/reservations', ex_res: '[{"id": 1, "start_time": "..."}]' },
  
  { method: 'POST', path: '/api/reservations', desc: '用户发起预约', req: 'JSON: { equipment_id, start_time, end_time, student_id, student_name }', res: '成功并且返回预约单号 booking_code', ex_req: 'POST /api/reservations', ex_res: '{"success": true, "booking_code": "ABCD"}' },
  { method: 'GET', path: '/api/reservations/:code', desc: '通过预约码获取预约详情', req: 'Params: code (预约单号booking_code)', res: '预约详细信息及设备信息', ex_req: 'GET /api/reservations/ABCD', ex_res: '{"id": 1, "status": "active"}' },
  { method: 'POST', path: '/api/reservations/cancel', desc: '用户取消自己的预约', req: 'JSON: { booking_code, student_id }', res: '成功状态', ex_req: 'POST /api/reservations/cancel', ex_res: '{"success": true}' },
  { method: 'POST', path: '/api/reservations/update', desc: '用户修改自己的预约时间', req: 'JSON: { booking_code, student_id, new_start_time, new_end_time }', res: '成功状态', ex_req: 'POST /api/reservations/update', ex_res: '{"success": true}' },
  { method: 'POST', path: '/api/reservations/checkin', desc: '用户扫码/签到上机', req: 'JSON: { booking_code, student_id }', res: '成功状态', ex_req: 'POST /api/reservations/checkin', ex_res: '{"success": true}' },
  { method: 'POST', path: '/api/reservations/checkout', desc: '用户扫码/签退下机', req: 'JSON: { booking_code, student_id }', res: '成功状态', ex_req: 'POST /api/reservations/checkout', ex_res: '{"success": true}' },
  
  { method: 'POST', path: '/api/whitelist/apply', desc: '用户申请预约某种限制仪器(白名单)', req: 'JSON: { equipment_id, student_id, student_name, reason }', res: '成功状态', ex_req: 'POST /api/whitelist/apply', ex_res: '{"success": true}' },
  { method: 'GET', path: '/api/admin/whitelist/applications', desc: '获取所有白名单申请记录', req: 'Header Authorization', res: '记录列表', ex_req: 'GET /api/admin/whitelist/applications', ex_res: '[...]' },
  { method: 'POST', path: '/api/admin/whitelist/applications/:id/approve', desc: '管理员通过白名单申请', req: 'Params: id', res: '成功状态', ex_req: 'POST /api/admin/whitelist/applications/1/approve', ex_res: '{"success": true}' },
  { method: 'POST', path: '/api/admin/whitelist/applications/:id/reject', desc: '管理员驳回白名单申请', req: 'Params: id', res: '成功状态', ex_req: 'POST /api/admin/whitelist/applications/1/reject', ex_res: '{"success": true}' },
  
  { method: 'GET', path: '/api/user/active-penalties', desc: '查询当前用户是否在处罚期间及处罚详情', req: 'Query: student_id', res: '连带规则详情的解封时间对象', ex_req: 'GET /api/user/active-penalties?student_id=2020101', ex_res: '{"isPenalized": true, "reason": "..."}' },
  { method: 'POST', path: '/api/violations/my', desc: '用户获取自身的违规记录与当前触发的规则列表', req: 'JSON: { student_id, student_name }', res: '历史记录与 userPenaltyDetails 详情', ex_req: 'POST /api/violations/my', ex_res: '{"violations": [...], "userPenaltyDetails": {...}}' },
  { method: 'POST', path: '/api/violations/:id/appeal', desc: '用户对某个违规发起申诉', req: 'Params: id. JSON: { student_id, student_name, appeal_reason }', res: '成功状态', ex_req: 'POST /api/violations/1/appeal', ex_res: '{"success": true}' },
  
  { method: 'GET', path: '/api/admin/reservations', desc: '获取所有预约单以供管理', req: 'Header Auth', res: '所有预约的详细清单', ex_req: 'GET /api/admin/reservations', ex_res: '[...]' },
  { method: 'PUT', path: '/api/admin/reservations/:id', desc: '管理员直接更改某个预约单的状态和信息', req: 'Params: id. JSON: fields', res: '成功状态', ex_req: 'PUT /api/admin/reservations/1', ex_res: '{"success": true}' },
  { method: 'DELETE', path: '/api/admin/reservations/:id', desc: '管理员强制删除预约 (硬删)', req: 'Params: id', res: '成功状态', ex_req: 'DELETE /api/admin/reservations/1', ex_res: '{"success": true}' },
  
  { method: 'PUT', path: '/api/admin/reports/reservations/:id', desc: '管理员修改历史报表中的某一预约记录', req: 'Params: id. JSON: fields', res: '成功状态', ex_req: 'PUT /api/admin/reports/reservations/1', ex_res: '{"success": true}' },
  { method: 'DELETE', path: '/api/admin/reports/reservations/:id', desc: '管理员从报表中抹去指定历史预约记录', req: 'Params: id', res: '成功状态', ex_req: 'DELETE /api/admin/reports/reservations/1', ex_res: '{"success": true}' },
  
  { method: 'GET', path: '/api/admin/violation-records', desc: '获取所有违规记录的汇总表格', req: 'Header Auth', res: '带有多表JOIN分析的违规账单', ex_req: 'GET /api/admin/violation-records', ex_res: '[...]' },
  { method: 'POST', path: '/api/admin/violation-records/:id/revoke', desc: '管理员主动撤销/免除某个违规记录', req: 'Params: id. JSON: { admin_note }', res: '成功状态', ex_req: 'POST /api/admin/violation-records/1/revoke', ex_res: '{"success": true}' },
  { method: 'POST', path: '/api/admin/violation-records/:id/restore', desc: '管理员恢复之前被撤销的违规记录', req: 'Params: id', res: '成功状态', ex_req: 'POST /api/admin/violation-records/1/restore', ex_res: '{"success": true}' },
  { method: 'POST', path: '/api/admin/violation-records/:id/reject-appeal', desc: '管理员驳回该违规单的申诉请求', req: 'Params: id. JSON: { reply, admin_note }', res: '成功状态', ex_req: 'POST /api/admin/violation-records/1/reject-appeal', ex_res: '{"success": true}' },
  
  { method: 'GET', path: '/api/admin/penalties/active', desc: '拉取所有目前因违规达到阈值而活跃产生的动态限制', req: 'Header Auth', res: '携带 contributing_ids(证据链) 的受限记录', ex_req: 'GET /api/admin/penalties/active', ex_res: '[{"contributing_ids": "1,2", "penalty_method": "BAN"}]' },
  { method: 'GET', path: '/api/admin/reports/violations', desc: '报表模块: 按日期与人员聚合展示违规数据', req: 'Header Auth, query parameter', res: '聚合统计数据', ex_req: 'GET /api/admin/reports/violations', ex_res: '[...]' },
  { method: 'GET', path: '/api/admin/reports', desc: '报表主数据：统计各个仪器的每日使用时间与营收等信息', req: 'Header Auth, query parameter', res: '报表图表所需节点信息', ex_req: 'GET /api/admin/reports', ex_res: '{ "records": [...] }' },
  { method: 'GET', path: '/api/admin/audit-logs', desc: '查询所有的系统审计日志(谁在几点做了什么)', req: 'Header Auth', res: '操作日志列表', ex_req: 'GET /api/admin/audit-logs', ex_res: '[{"action": "admin_login"}]' }
];

function getGroupingKey(path: string) {
  // If the path ends with an action after :id, group by the :id path
  // e.g. /api/admin/whitelist/applications/:id/approve -> /api/admin/whitelist/applications/:id
  if (path.includes('/:id/')) {
    return path.split('/:id/')[0] + '/:id';
  }
  // Group all reservations actions to /api/reservations
  if (path.match('^/api/reservations/(cancel|update|checkin|checkout)$')) {
    return '/api/reservations';
  }
  return path;
}

// Group by endpoint (path)
const groupedByPath: Record<string, typeof apis> = {};
for (const api of apis) {
  const groupKey = getGroupingKey(api.path);
  if (!groupedByPath[groupKey]) {
    groupedByPath[groupKey] = [];
  }
  groupedByPath[groupKey].push(api);
}

const indexEntries: { groupKey: string, fileName: string, methods: string[], desc: string }[] = [];

// Generate files
for (const [groupKey, methods] of Object.entries(groupedByPath)) {
  let safeName = groupKey.replace('/api/', '').split('/').join('_').split(':').join('');
  if (!safeName) safeName = 'index';
  
  const fileName = `${safeName}.md`;
  
  let fileContent = `# API Endpoint Group: ${groupKey}\n\n`;
  fileContent += `This document contains information for all HTTP methods and actions related to the \`${groupKey}\` endpoint.\n\n`;
  fileContent += `---\n\n`;

  for (const api of methods) {
    fileContent += `## ${api.method} ${api.path === groupKey ? '' : api.path.replace(groupKey, '')}\n\n`;
    fileContent += `**实际路径:** \`${api.path}\`\n\n`;
    fileContent += `**用途 (Purpose):** ${api.desc}\n\n`;
    fileContent += `### 输入要求 (Expected Input)\n${api.req}\n\n`;
    fileContent += `### 输出结果 (Expected Output)\n${api.res}\n\n`;
    fileContent += `### 简单示例 (Example)\n\n`;
    fileContent += `**发起请求 (Request):**\n\`\`\`bash\n${api.ex_req}\n\`\`\`\n\n`;
    fileContent += `**响应返回 (Response):**\n\`\`\`json\n${api.ex_res}\n\`\`\`\n\n`;
    fileContent += `---\n\n`;
  }

  fs.writeFileSync(path.join(docsDir, fileName), fileContent, 'utf-8');

  indexEntries.push({
    groupKey,
    fileName,
    methods: methods.map(m => m.method),
    desc: methods[0].desc // use the first one as primary description
  });
}

indexEntries.sort((a, b) => a.groupKey.localeCompare(b.groupKey));

let indexContent = `# API 文档索引 (API Documentation Index)\n\n`;
indexContent += `本项目提供了如下分组合并的 API 文档列表，点击链接可查看具体接口说明。\n\n`;
indexContent += `| 接口分组 (Endpoint Group) | 支持的方法 | 简述 (Description) | 文档链接 |\n`;
indexContent += `| --- | --- | --- | --- |\n`;

for (const entry of indexEntries) {
  const uniqueMethods = Array.from(new Set(entry.methods)).join(', ');
  indexContent += `| \`${entry.groupKey}\` | ${uniqueMethods} | ${entry.desc} | [${entry.fileName}](./${entry.fileName}) |\n`;
}

fs.writeFileSync(path.join(docsDir, 'index.md'), indexContent, 'utf-8');

console.log('Successfully generated ' + Object.keys(groupedByPath).length + ' API doc files + 1 index in docs/api/');
