export const getViolationTypeLabel = (type: string | undefined | null): string => {
  if (!type) return '未知违规';
  switch (type.toLowerCase()) {
    case 'late': return '迟到';
    case 'overdue': 
    case 'overtime': return '超时';
    case 'no-show': 
    case 'noshow': return '爽约';
    case 'late_cancel': 
    case 'cancel_late': return '临期取消';
    case 'hygiene_issue': return '卫生不达标';
    case 'improper_operation': return '违规操作';
    case 'proxy_booking': return '代预约';
    case 'other_manual': return '其他违规';
    default: return type;
  }
};

export function unflattenObj(data: Record<string, any>): any {
  const result: any = {};
  for (const key in data) {
    const keys = key.split('.');
    let current = result;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (i === keys.length - 1) {
        current[k] = data[key];
      } else {
        current[k] = current[k] || {};
        current = current[k];
      }
    }
  }
  return result;
}

export function flattenObj(data: any, prefix = ''): Record<string, any> {
  let result: Record<string, any> = {};
  for (const key in data) {
    if (typeof data[key] === 'object' && data[key] !== null && !Array.isArray(data[key])) {
      result = { ...result, ...flattenObj(data[key], `${prefix}${key}.`) };
    } else {
      result[`${prefix}${key}`] = data[key] === undefined ? '' : String(data[key]);
    }
  }
  return result;
}
