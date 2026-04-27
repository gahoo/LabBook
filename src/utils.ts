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
