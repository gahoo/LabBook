import { z } from 'zod';

export const CreateEquipmentSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  type: z.string().min(1, '类型不能为空'),
  location: z.string().min(1, '位置不能为空'),
  description: z.string().optional(),
  status: z.enum(['available', 'maintenance', 'in_use', 'offline']).optional().default('available'),
  min_duration_minutes: z.number().min(1, '最小预约时长必须大于0'),
  max_duration_minutes: z.number().min(1, '最大预约时长必须大于0'),
  advance_reservation_days: z.number().min(0, '提前预约天数不能为负数'),
  hourly_rate: z.number().min(0, '每小时费率不能为负数'),
  manager: z.string().optional(),
  contact_phone: z.string().optional(),
});

export const UpdateEquipmentSchema = CreateEquipmentSchema.partial();

export const CreateReservationSchema = z.object({
  equipment_id: z.string().or(z.number()),
  student_name: z.string().min(1, '学生姓名不能为空'),
  student_id: z.string().min(1, '学号/工号不能为空'),
  supervisor: z.string().optional(),
  start_time: z.string().min(1, '开始时间不能为空'),
  end_time: z.string().min(1, '结束时间不能为空'),
  tz_offset: z.number().optional().default(0)
});
