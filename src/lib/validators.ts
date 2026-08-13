export function validateTimeRange(req: any, res: any, startDateKey: string = 'startDate', endDateKey: string = 'endDate'): boolean {
  const startDate = req.query[startDateKey];
  const endDate = req.query[endDateKey];

  if (!startDate || !endDate) {
    res.status(400).json({ error: '必须提供开始和结束时间范围' });
    return false;
  }
  const startObj = new Date(startDate as string);
  const endObj = new Date(endDate as string);
  if (isNaN(startObj.getTime()) || isNaN(endObj.getTime())) {
    res.status(400).json({ error: '时间参数不合法' });
    return false;
  }
  const diff = endObj.getTime() - startObj.getTime();
  if (diff < 0) {
    res.status(400).json({ error: '结束时间不能早于开始时间' });
    return false;
  }
  if (diff > 366 * 24 * 60 * 60 * 1000) {
    res.status(400).json({ error: '查询时间跨度不能超过 1 年 (366 天)' });
    return false;
  }
  return true;
}
