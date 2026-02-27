import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Play, Square, XCircle, CheckCircle2, Clock, Calendar, ChevronDown, ChevronUp, Edit3, Save, X } from 'lucide-react';
import { format, isBefore, addMinutes } from 'date-fns';
import toast from 'react-hot-toast';

interface Reservation {
  id: number;
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
          'completed': 4,
          'cancelled': 5
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

  const startEdit = (resv: Reservation) => {
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
  };

  const statusMap: Record<string, string> = {
    pending: '待审批',
    approved: '已通过',
    active: '进行中',
    completed: '已完成',
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
                    <p className="text-xs text-neutral-500">{statusMap[resv.status]}</p>
                  </div>
                  {expandedId === resv.id ? <ChevronUp className="w-5 h-5 text-neutral-400" /> : <ChevronDown className="w-5 h-5 text-neutral-400" />}
                </div>
              </div>

              {expandedId === resv.id && (
                <div className="px-6 pb-6 pt-2 border-t border-neutral-50 space-y-6">
                  {editingId === resv.id ? (
                    <form onSubmit={handleUpdate} className="space-y-4 bg-neutral-50 p-4 rounded-xl border border-neutral-100">
                      <div className="grid grid-cols-2 gap-4">
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
                  ) : (
                    <div className="grid grid-cols-2 gap-6">
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
                    {(resv.status === 'pending' || resv.status === 'approved') && (
                      <button onClick={() => handleAction(resv, 'cancel')} className="flex-1 min-w-[120px] py-2.5 border border-red-100 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 flex items-center justify-center gap-2">
                        <XCircle className="w-4 h-4" /> 取消预约
                      </button>
                    )}
                    {resv.status === 'approved' && (
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
                    {resv.status === 'active' && (
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
