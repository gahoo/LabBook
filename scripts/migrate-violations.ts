import Database from 'better-sqlite3';
import path from 'path';
import { isAfter } from 'date-fns';

const dbPath = path.join(process.cwd(), 'lab_equipment.db');
const db = new Database(dbPath);

console.log('开始执行历史违规数据迁移...');

// 0. 确保相关表存在 (兼容在旧数据库上直接运行迁移脚本)
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS violation_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,           
    reservation_id INTEGER,             
    violation_type TEXT NOT NULL,       
    violation_time DATETIME NOT NULL,   
    status TEXT DEFAULT 'active',       
    remark TEXT,                        
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 1. 获取动态配置的宽限期
const settingsRows = db.prepare("SELECT key, value FROM settings WHERE key IN ('violation_late_cancel_hours', 'violation_no_show_grace_minutes', 'violation_late_grace_minutes', 'violation_overtime_grace_minutes')").all() as any[];
const settingsMap = settingsRows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});

const lateCancelHours = settingsMap['violation_late_cancel_hours'] ? parseInt(settingsMap['violation_late_cancel_hours'], 10) : 24;
const noShowGraceMinutes = settingsMap['violation_no_show_grace_minutes'] ? parseInt(settingsMap['violation_no_show_grace_minutes'], 10) : 30;
const lateGraceMinutes = settingsMap['violation_late_grace_minutes'] ? parseInt(settingsMap['violation_late_grace_minutes'], 10) : 15;
const overtimeGraceMinutes = settingsMap['violation_overtime_grace_minutes'] ? parseInt(settingsMap['violation_overtime_grace_minutes'], 10) : 30;

console.log('当前系统配置:');
console.log(`- 临期取消限制: ${lateCancelHours} 小时`);
console.log(`- 爽约宽限期: ${noShowGraceMinutes} 分钟`);
console.log(`- 迟到宽限期: ${lateGraceMinutes} 分钟`);
console.log(`- 超时宽限期: ${overtimeGraceMinutes} 分钟`);

// 2. 核心判定逻辑 (与 server.ts 保持一致)
const calculateViolations = (res: any, prevRes: any): Array<{ type: string, time: string }> => {
  const violations: Array<{ type: string, time: string }> = [];
  
  if (res.status === 'cancelled') {
    if (res.actual_end_time) {
      const cancelTime = new Date(res.actual_end_time).getTime();
      const startTime = new Date(res.start_time).getTime();
      
      const lateCancelThreshold = startTime - (lateCancelHours * 60 * 60 * 1000);
      const noShowThreshold = startTime + (noShowGraceMinutes * 60 * 1000);

      if (cancelTime >= noShowThreshold) {
        violations.push({ type: 'no-show', time: res.actual_end_time });
      } else if (cancelTime >= lateCancelThreshold) {
        violations.push({ type: 'late_cancel', time: res.actual_end_time });
      }
    }
    return violations;
  }
  
  if (!res.actual_start_time) {
    const noShowThreshold = new Date(res.start_time).getTime() + (noShowGraceMinutes * 60 * 1000);
    // 只有当当前时间已经超过爽约宽限期，且状态不是 cancelled 时，才算历史爽约
    if (new Date().getTime() > noShowThreshold) {
      // 记录爽约时间为：预约开始时间 + 爽约宽限期
      const noShowTime = new Date(noShowThreshold).toISOString();
      violations.push({ type: 'no-show', time: noShowTime });
    }
    return violations;
  }
  
  const start = new Date(res.start_time);
  const end = new Date(res.end_time);
  const actualStart = new Date(res.actual_start_time);
  const actualEnd = res.actual_end_time ? new Date(res.actual_end_time) : null;

  let isDelayCausedByPrev = false;
  if (prevRes && prevRes.actual_end_time) {
    const prevActualEnd = new Date(prevRes.actual_end_time);
    if (isAfter(prevActualEnd, start)) {
      isDelayCausedByPrev = true;
    }
  }

  const lateThreshold = lateGraceMinutes * 60 * 1000;
  const overtimeThreshold = overtimeGraceMinutes * 60 * 1000;

  if (actualStart.getTime() > start.getTime() + lateThreshold && !isDelayCausedByPrev) {
    violations.push({ type: 'late', time: res.actual_start_time });
  }
  
  if (actualEnd && actualEnd.getTime() > end.getTime() + overtimeThreshold) {
    violations.push({ type: 'overdue', time: res.actual_end_time });
  }
  
  return violations;
};

// 3. 获取所有需要判定的预约记录
// 排除掉 status 为 'pending' 或 'rejected' 的记录
const reservations = db.prepare(`
  SELECT * FROM reservations 
  WHERE status IN ('approved', 'active', 'completed', 'cancelled')
  ORDER BY equipment_id, start_time ASC
`).all() as any[];

console.log(`共扫描到 ${reservations.length} 条历史预约记录，开始分析...`);

let addedCount = 0;
let skippedCount = 0;

const insertViolation = db.prepare(`
  INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time, status)
  VALUES (?, ?, ?, ?, 'active')
`);

const checkViolationExists = db.prepare(`
  SELECT id FROM violation_records 
  WHERE reservation_id = ? AND violation_type = ?
`);

db.transaction(() => {
  for (let i = 0; i < reservations.length; i++) {
    const res = reservations[i];
    const prevRes = i > 0 && reservations[i-1].equipment_id === res.equipment_id ? reservations[i-1] : null;
    
    const violations = calculateViolations(res, prevRes);
    
    for (const v of violations) {
      // 幂等性检查：如果该预约的该类型违规已经存在，则跳过
      const exists = checkViolationExists.get(res.id, v.type);
      if (exists) {
        skippedCount++;
      } else {
        insertViolation.run(res.student_id, res.id, v.type, v.time);
        addedCount++;
      }
    }
  }
})();

console.log('----------------------------------------');
console.log('迁移执行完毕！');
console.log(`- 成功新增违规记录: ${addedCount} 条`);
console.log(`- 已存在跳过记录: ${skippedCount} 条`);
console.log('----------------------------------------');
