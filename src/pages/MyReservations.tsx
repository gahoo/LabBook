import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Play, Square, XCircle, CheckCircle2, Clock, Calendar, ChevronDown, ChevronUp, Edit3, Save, X } from 'lucide-react';
import { format, isBefore, addMinutes, parseISO } from 'date-fns';
import clsx from 'clsx';
import toast from 'react-hot-toast';

interface Reservation {
  id: number;
  equipment_id: number;
  equipment_name: string;
  student_name: string;
  student_id: string;
  supervisor: string;
  start_time: string;
  end_time: string;
  status: string;
  booking_code: string;
  actual_start_time: string | null;
  actual_end_time: string | null;
  total_cost: number | null;
  price_type: string;
  price: number;
  consumable_fee: number;
  modified_count: number;
}

export default function MyReservations() {
  const [code, setCode] = useState('');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [myReservations, setMyReservations] = useState<Reservation[]>([]);
  const [visibleCount, setVisibleCount] = useState(5);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<any>(null);
  const [availabilityData, setAvailabilityData] = useState<any[]>([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  const fetchMyReservations = useCallback(async () => {
    const codesStr = document.cookie
      .split('; ')
      .find(row => row.startsWith('lab_booking_codes='))
      ?.split('=')[1] || '';
    
    if (!codesStr) return;
    const codes = codesStr.split(',').filter(Boolean);
    
    try {
      const results = await Promise.all(
        codes.map(c => fetch(`/api/reservations/${c}`).then(r => r.ok ? r.json() : null))
      );
      const validResults = results.filter(Boolean);
      
      // Sort: active, approved, pending, completed, cancelled, then closest to now
      const sorted = validResults.sort((a, b) => {
        const statusOrder: Record<string, number> = {
          'active': 1,
          'approved': 2,
          'pending': 3,
          'rejected': 4,
          'completed': 5,
          'cancelled': 6
        };
        
        const orderA = statusOrder[a.status] || 99;
        const orderB = statusOrder[b.status] || 99;
        
        if (orderA !== orderB) return orderA - orderB;
        
        const now = Date.now();
        const diffA = Math.abs(new Date(a.start_time).getTime() - now);
        const diffB = Math.abs(new Date(b.start_time).getTime() - now);
        
        return diffA - diffB;
      });
      
      setMyReservations(sorted);
    } catch (err) {
      console.error('Failed to fetch my reservations', err);
    }
  }, []);

  useEffect(() => {
    fetchMyReservations();
  }, [fetchMyReservations]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch(`/api/reservations/${code.trim().toUpperCase()}`);
      const data = await res.json();
      
      if (res.ok) {
        setReservation(data);
        // Add to cookies if not already there
        const codesStr = document.cookie
          .split('; ')
          .find(row => row.startsWith('lab_booking_codes='))
          ?.split('=')[1] || '';
        const codes = codesStr.split(',').filter(Boolean);
        if (!codes.includes(data.booking_code)) {
          const newCodes = codesStr ? `${codesStr},${data.booking_code}` : data.booking_code;
          document.cookie = `lab_booking_codes=${newCodes}; max-age=31536000; path=/`;
          fetchMyReservations();
        }
      } else {
        setError(data.error || '未找到该预约');
        setReservation(null);
      }
    } catch (err) {
      setError('获取预约信息失败');
    } finally {
      setLoading(false);
    }
  };

  const [consumableQty, setConsumableQty] = useState<number>(1);

  const handleAction = async (resv: Reservation, action: 'checkin' | 'checkout' | 'cancel') => {
    try {
      const body: any = { booking_code: resv.booking_code };
      if (action === 'checkin' && resv.consumable_fee > 0) {
        body.consumable_quantity = consumableQty;
      }

      const res = await fetch(`/api/reservations/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      const data = await res.json();
      
      if (res.ok) {
        toast.success('操作成功');
        fetchMyReservations();
        if (reservation?.booking_code === resv.booking_code) {
          handleSearch({ preventDefault: () => {} } as React.FormEvent);
        }
      } else {
        toast.error(data.error || `操作失败`);
      }
    } catch (err) {
      toast.error(`操作失败`);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Convert local time back to UTC for server safely
      const toUTC = (localStr: string) => {
        const [datePart, timePart] = localStr.split('T');
        const [y, m, d] = datePart.split('-').map(Number);
        const [h, min] = timePart.split(':').map(Number);
        return new Date(y, m - 1, d, h, min).toISOString();
      };
      
      const res = await fetch(`/api/reservations/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservation_id: editingId,
          booking_code: myReservations.find(r => r.id === editingId)?.booking_code,
          start_time: toUTC(editData.start_time),
          end_time: toUTC(editData.end_time),
        })
      });
      if (res.ok) {
        toast.success('修改成功');
        setEditingId(null);
        fetchMyReservations();
      } else {
        const data = await res.json();
        toast.error(data.error || '修改失败');
      }
    } catch (err) {
      toast.error('修改失败');
    }
  };

  const startEdit = async (resv: Reservation) => {
    setEditingId(resv.id);
    // Convert UTC to local for datetime-local input safely
    const toLocalISO = (utcStr: string) => {
      const date = new Date(utcStr);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      const h = String(date.getHours()).padStart(2, '0');
      const min = String(date.getMinutes()).padStart(2, '0');
      return `${y}-${m}-${d}T${h}:${min}`;
    };
    
    setEditData({
      start_time: toLocalISO(resv.start_time),
      end_time: toLocalISO(resv.end_time),
    });

    setLoadingAvailability(true);
    try {
      const eqRes = await fetch(`/api/equipment`);
      const eqData = await eqRes.json();
      const eq = eqData.find((e: any) => e.id === resv.equipment_id);
      let advanceDays = 7;
      if (eq) {
        try {
          const avail = JSON.parse(eq.availability_json);
          advanceDays = avail.advanceDays || 7;
        } catch (e) {}
      }

      const today = new Date();
      const dates = Array.from({ length: advanceDays + 1 }).map((_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        return format(d, 'yyyy-MM-dd');
      });

      const results = await Promise.all(
        dates.map(d => fetch(`/api/equipment/${resv.equipment_id}/availability?date=${d}`).then(r => r.json()))
      );
      setAvailabilityData(results.map((r, i) => ({ date: dates[i], ...r })));
    } catch (err) {
      console.error('Failed to fetch availability', err);
    } finally {
      setLoadingAvailability(false);
    }
  };

  const timeSteps = Array.from({ length: (22 - 8) * 2 }).map((_, i) => {
    const h = 8 + Math.floor(i / 2);
    const m = (i % 2) * 30;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  });

  const gridData = availabilityData.map(dayData => {
    const dateStr = dayData.date;
    const slots = dayData.availableSlots || [];
    const resvs = dayData.reservations || [];
    
    return {
      date: dateStr,
      maxDurationMinutes: dayData.maxDurationMinutes,
      times: timeSteps.map(t => {
        const timeDate = new Date(`${dateStr}T${t}`);
        const isAvailable = slots.some((s: any) => {
          const start = new Date(s.start);
          const end = new Date(s.end);
          return timeDate >= start && timeDate < end;
        });
        const isBooked = resvs.some((r: any) => {
          const start = new Date(r.start_time);
          const end = new Date(r.end_time);
          // Don't count the current reservation as booked
          if (r.id === editingId) return false;
          return timeDate >= start && timeDate < end;
        });
        return { time: t, isAvailable, isBooked };
      })
    };
  });

  const daysMap: Record<string, string> = {
    'Mon': '周一', 'Tue': '周二', 'Wed': '周三', 'Thu': '周四', 'Fri': '周五', 'Sat': '周六', 'Sun': '周日'
  };

  const statusMap: Record<string, string> = {
    pending: '待审批',
    approved: '已通过',
    active: '进行中',
    completed: '已完成',
    rejected: '已驳回',
    cancelled: '已取消'
  };

  const observer = useRef<IntersectionObserver | null>(null);
  const lastElementRef = useCallback((node: HTMLDivElement) => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && visibleCount < myReservations.length) {
        setVisibleCount(prev => prev + 5);
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, visibleCount, myReservations.length]);

  return (
    <div className="max-w-3xl mx-auto space-y-12">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900">我的预约</h1>
        <p className="text-neutral-500 mt-2">查看、管理您的预约申请与上机记录。</p>
      </div>

      <div className="space-y-8">
        <form onSubmit={handleSearch} className="relative">
          <div className="relative flex items-center">
            <Search className="absolute left-4 w-5 h-5 text-neutral-400" />
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="输入预约码查找更多..."
              className="w-full pl-12 pr-32 py-4 bg-white rounded-2xl border border-neutral-200 shadow-sm focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none text-lg font-mono uppercase tracking-widest transition-all"
            />
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="absolute right-2 px-6 py-2 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {loading ? '查找中...' : '查找'}
            </button>
          </div>
          {error && <p className="text-red-500 text-sm mt-3 text-center">{error}</p>}
        </form>

        <div className="space-y-4">
          <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-widest px-2">预约列表</h3>
          {myReservations.slice(0, visibleCount).map((resv, idx) => (
            <div 
              key={resv.id} 
              ref={idx === visibleCount - 1 ? lastElementRef : null}
              className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden transition-all hover:shadow-md"
            >
              <div 
                className="p-6 cursor-pointer flex items-center justify-between"
                onClick={() => setExpandedId(expandedId === resv.id ? null : resv.id)}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center
                    ${resv.status === 'active' ? 'bg-red-100 text-red-600' : 'bg-neutral-100 text-neutral-400'}
                  `}>
                    {resv.status === 'active' ? <Play className="w-6 h-6" /> : <Calendar className="w-6 h-6" />}
                  </div>
                  <div>
                    <h4 className="font-bold text-neutral-900">{resv.equipment_name}</h4>
                    <p className="text-xs text-neutral-500 font-mono">{resv.booking_code}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right hidden sm:block">
                    <p className="text-sm font-medium text-neutral-900">{format(new Date(resv.start_time), 'MM-dd HH:mm')}</p>
                    <p className={`text-xs font-medium ${
                      resv.status === 'approved' ? 'text-emerald-600' :
                      resv.status === 'pending' ? 'text-amber-600' :
                      resv.status === 'active' ? 'text-blue-600' :
                      resv.status === 'completed' ? 'text-neutral-600' :
                      resv.status === 'rejected' ? 'text-red-600' :
                      'text-red-600'
                    }`}>
                      {statusMap[resv.status]}
                    </p>
                  </div>
                  {expandedId === resv.id ? <ChevronUp className="w-5 h-5 text-neutral-400" /> : <ChevronDown className="w-5 h-5 text-neutral-400" />}
                </div>
              </div>

              {expandedId === resv.id && (
                <div className="px-6 pb-6 pt-2 border-t border-neutral-50 space-y-6">
                  {editingId === resv.id ? (
                    <div className="space-y-6">
                      {/* Timeline */}
                      <div className="bg-white p-4 rounded-xl border border-neutral-200">
                        <h4 className="text-sm font-bold mb-4 flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-red-600" />
                          可用时间概览
                        </h4>
                        {loadingAvailability ? (
                          <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-red-600"></div></div>
                        ) : (
                          <div className="overflow-x-auto">
                            <div className="min-w-[600px]">
                              <div className="flex border-b border-neutral-100 pb-2 mb-2">
                                <div className="w-20 shrink-0"></div>
                                <div className="flex-1 flex justify-between px-2 text-[10px] text-neutral-400 font-mono">
                                  {timeSteps.filter((_, i) => i % 2 === 0).map(t => (
                                    <span key={t}>{t}</span>
                                  ))}
                                </div>
                              </div>
                              <div className="space-y-1">
                                {gridData.map((row, idx) => {
                                  const date = parseISO(row.date);
                                  const dayStr = format(date, 'EEE');
                                  return (
                                    <div key={idx} className="flex items-center group">
                                      <div className="w-20 shrink-0 text-left px-2 py-1">
                                        <p className="text-[10px] font-bold uppercase opacity-70">{daysMap[dayStr] || dayStr}</p>
                                        <p className="text-xs font-bold">{format(date, 'MM-dd')}</p>
                                      </div>
                                      <div className="flex-1 flex gap-px h-6 bg-neutral-50 rounded-md overflow-hidden p-0.5">
                                        {row.times.map((t, i) => {
                                          const timeDate = new Date(`${row.date}T${t.time}`);
                                          const isPast = timeDate < new Date();
                                          return (
                                            <div 
                                              key={i}
                                              title={`${row.date} ${t.time}`}
                                              className={clsx(
                                                "flex-1 transition-all",
                                                t.isBooked ? "bg-red-500" : (t.isAvailable && !isPast ? "bg-emerald-500 hover:opacity-80 cursor-pointer" : "bg-neutral-200")
                                              )}
                                              onClick={() => {
                                                if (t.isAvailable && !t.isBooked && !isPast) {
                                                  const maxDuration = row.maxDurationMinutes || 60;
                                                  const start = new Date(`${row.date}T${t.time}`);
                                                  const end = addMinutes(start, maxDuration);
                                                  setEditData({
                                                    ...editData,
                                                    start_time: `${row.date}T${t.time}`,
                                                    end_time: format(end, "yyyy-MM-dd'T'HH:mm")
                                                  });
                                                }
                                              }}
                                            />
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <form onSubmit={handleUpdate} className="space-y-4 bg-neutral-50 p-4 rounded-xl border border-neutral-100">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-bold text-neutral-400 mb-1">开始时间</label>
                            <input 
                              type="datetime-local" 
                              step="300"
                              value={editData.start_time} 
                              onChange={e => setEditData({...editData, start_time: e.target.value})} 
                              className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm" 
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-neutral-400 mb-1">结束时间</label>
                            <input 
                              type="datetime-local" 
                              step="300"
                              value={editData.end_time} 
                              onChange={e => setEditData({...editData, end_time: e.target.value})} 
                              className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm" 
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button type="submit" className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"><Save className="w-4 h-4" /> 保存</button>
                          <button type="button" onClick={() => setEditingId(null)} className="flex-1 py-2 border border-neutral-200 rounded-lg text-sm font-medium flex items-center justify-center gap-2"><X className="w-4 h-4" /> 取消</button>
                        </div>
                      </form>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div>
                          <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-1">预约详情</p>
                          <p className="text-sm font-medium text-neutral-900">{resv.student_name} ({resv.student_id})</p>
                          <p className="text-xs text-neutral-500">导师: {resv.supervisor}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-1">时间安排</p>
                          <p className="text-sm text-neutral-700">{format(new Date(resv.start_time), 'yyyy-MM-dd HH:mm')} - {format(new Date(resv.end_time), 'HH:mm')}</p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-1">费用估算</p>
                          <p className="text-sm font-medium text-neutral-900">¥{resv.price} / {resv.price_type === 'hour' ? '小时' : '次'}</p>
                          {resv.consumable_fee > 0 && <p className="text-xs text-neutral-500">+ ¥{resv.consumable_fee} 耗材费</p>}
                        </div>
                        {resv.total_cost !== null && (
                          <div>
                            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-1">实际费用</p>
                            <p className="text-lg font-bold text-red-600">¥{resv.total_cost.toFixed(2)}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-4 border-t border-neutral-50">
                    {(resv.status === 'pending' || resv.status === 'approved') && !editingId && (
                      <button 
                        onClick={() => startEdit(resv)} 
                        disabled={resv.modified_count >= 1}
                        className="flex-1 min-w-[120px] py-2.5 border border-neutral-200 rounded-xl text-sm font-medium hover:bg-neutral-50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Edit3 className="w-4 h-4" /> {resv.modified_count >= 1 ? '已修改过' : '修改信息'}
                      </button>
                    )}
                    {(resv.status === 'pending' || resv.status === 'approved') && !editingId && (
                      <button onClick={() => handleAction(resv, 'cancel')} className="flex-1 min-w-[120px] py-2.5 border border-red-100 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 flex items-center justify-center gap-2">
                        <XCircle className="w-4 h-4" /> 取消预约
                      </button>
                    )}
                    {resv.status === 'approved' && !editingId && (
                      <div className="flex-1 min-w-[240px] flex gap-2">
                        {resv.consumable_fee > 0 && (
                          <input 
                            type="number" 
                            min="0" 
                            value={consumableQty} 
                            onChange={e => setConsumableQty(Number(e.target.value))}
                            className="w-20 px-3 py-2 rounded-xl border border-neutral-200 text-sm"
                            placeholder="耗材数"
                          />
                        )}
                        <button onClick={() => handleAction(resv, 'checkin')} className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 flex items-center justify-center gap-2">
                          <Play className="w-4 h-4" /> 上机
                        </button>
                      </div>
                    )}
                    {resv.status === 'active' && !editingId && (
                      <button onClick={() => handleAction(resv, 'checkout')} className="flex-1 min-w-[120px] py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 flex items-center justify-center gap-2">
                        <Square className="w-4 h-4" /> 下机
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          {myReservations.length === 0 && (
            <div className="text-center py-20 bg-neutral-50 rounded-3xl border-2 border-dashed border-neutral-200">
              <Clock className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
              <p className="text-neutral-500">暂无预约记录</p>
              <p className="text-xs text-neutral-400 mt-1">预约成功后，您的记录将出现在这里。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
