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


export function validateOperatingHours(start: Date, end: Date, availability: any, tzOffset: number): { isValid: boolean, error?: string, isOutOfHours: boolean } {
  const allowOutOfHours = !!availability.allowOutOfHours;
 
  const startMs = start.getTime();
  const endMs = end.getTime();
  
  const localStartMs = startMs - tzOffset * 60000;
  const localEndMs = endMs - tzOffset * 60000;
 
  let currentMs = localStartMs;
 
  while (currentMs < localEndMs) {
    const currentLocal = new Date(currentMs);
    const nextMidnightLocal = new Date(currentLocal);
    nextMidnightLocal.setUTCHours(24, 0, 0, 0); 
    
    const chunkEndMs = Math.min(localEndMs, nextMidnightLocal.getTime());
    
    const dayOfWeek = currentLocal.getUTCDay();
    
    const dayRules = (availability.rules || []).filter((r: any) => r.day === dayOfWeek);
    
    if (dayRules.length === 0) {
      if (allowOutOfHours) return { isValid: true, isOutOfHours: true };
      return { isValid: false, error: '所选时间包含了仪器不开放的日期', isOutOfHours: true };
    }
    
    const startLocalMinutes = currentLocal.getUTCHours() * 60 + currentLocal.getUTCMinutes();
    
    const endDatesLocal = new Date(chunkEndMs);
    let endLocalMinutes = endDatesLocal.getUTCHours() * 60 + endDatesLocal.getUTCMinutes();
    if (endLocalMinutes === 0 && chunkEndMs > currentMs) {
       endLocalMinutes = 24 * 60;
    }
    
    const fallsWithinAnyRule = dayRules.some((rule: any) => {
      const rsMins = parseInt(rule.start.split(':')[0]) * 60 + parseInt(rule.start.split(':')[1]);
      let reMins = parseInt(rule.end.split(':')[0]) * 60 + parseInt(rule.end.split(':')[1]);
      if (reMins === 1439) reMins = 1440; // 23:59 inclusive of midnight
      return startLocalMinutes >= rsMins && endLocalMinutes <= reMins;
    });
 
    if (!fallsWithinAnyRule) {
      if (allowOutOfHours) return { isValid: true, isOutOfHours: true };
      const validRanges = dayRules.map((r: any) => `${r.start}-${r.end}`).join(', ');
      return { isValid: false, error: `部分所选时间不在仪器开放范围内 (该日开放: ${validRanges})`, isOutOfHours: true };
    }
    
    currentMs = chunkEndMs;
  }
  
  return { isValid: true, isOutOfHours: false };
}

export function calculatePeakAccumulatedMinutes(start: Date, end: Date, peakHours: any[], tzOffset: number): number {
  if (!peakHours || peakHours.length === 0) return 0;
  
  const startMs = start.getTime();
  const endMs = end.getTime();
  
  const localStartMs = startMs - tzOffset * 60000;
  const localEndMs = endMs - tzOffset * 60000;
  
  let currentMs = localStartMs;
  let accumulated = 0;
  
  while (currentMs < localEndMs) {
    const currentLocal = new Date(currentMs);
    const nextMidnightLocal = new Date(currentLocal);
    nextMidnightLocal.setUTCHours(24, 0, 0, 0); 
    
    const chunkEndMs = Math.min(localEndMs, nextMidnightLocal.getTime());
    
    const startLocalMinutes = currentLocal.getUTCHours() * 60 + currentLocal.getUTCMinutes();
    
    const endDatesLocal = new Date(chunkEndMs);
    let endLocalMinutes = endDatesLocal.getUTCHours() * 60 + endDatesLocal.getUTCMinutes();
    if (endLocalMinutes === 0 && chunkEndMs > currentMs) {
       endLocalMinutes = 24 * 60;
    }
    
    for (const peak of peakHours) {
      const psMins = parseInt(peak.start.split(':')[0]) * 60 + parseInt(peak.start.split(':')[1]);
      let peMins = parseInt(peak.end.split(':')[0]) * 60 + parseInt(peak.end.split(':')[1]);
      if (peMins === 1439) peMins = 1440;
      
      const overlapStart = Math.max(startLocalMinutes, psMins);
      const overlapEnd = Math.min(endLocalMinutes, peMins);
      
      if (overlapEnd > overlapStart) {
        accumulated += overlapEnd - overlapStart;
      }
    }
    
    currentMs = chunkEndMs;
  }
  
  return accumulated;
}
