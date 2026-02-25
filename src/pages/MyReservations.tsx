import React, { useState } from 'react';
import { Search, Play, Square, XCircle, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

interface Reservation {
  id: number;
  equipment_name: string;
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
}

export default function MyReservations() {
  const [code, setCode] = useState('');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  const handleAction = async (action: 'checkin' | 'checkout' | 'cancel') => {
    if (!reservation) return;
    
    try {
      const res = await fetch(`/api/reservations/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_code: reservation.booking_code })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        toast.success('操作成功');
        // Refresh reservation
        handleSearch({ preventDefault: () => {} } as React.FormEvent);
      } else {
        toast.error(data.error || `操作失败`);
      }
    } catch (err) {
      toast.error(`操作失败`);
    }
  };

  const statusMap: Record<string, string> = {
    pending: '待审批',
    approved: '已通过',
    active: '进行中',
    completed: '已完成',
    cancelled: '已取消'
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900">管理预约</h1>
        <p className="text-neutral-500 mt-2">输入您的预约码以上机、下机或取消预约。</p>
      </div>

      <form onSubmit={handleSearch} className="mb-8 relative">
        <div className="relative flex items-center">
          <Search className="absolute left-4 w-5 h-5 text-neutral-400" />
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="输入预约码 (例如: A1B2C3D4)"
            className="w-full pl-12 pr-32 py-4 bg-white rounded-2xl border border-neutral-200 shadow-sm focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none text-lg font-mono uppercase tracking-widest transition-all"
          />
          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="absolute right-2 px-6 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {loading ? '搜索中...' : '查找'}
          </button>
        </div>
        {error && <p className="text-red-500 text-sm mt-3 text-center">{error}</p>}
      </form>

      {reservation && (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          <div className="p-6 border-b border-neutral-100 bg-neutral-50/50">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold text-neutral-900">{reservation.equipment_name}</h2>
                <p className="text-sm text-neutral-500 mt-1 font-mono">{reservation.booking_code}</p>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider
                ${reservation.status === 'pending' ? 'bg-amber-100 text-amber-800' : ''}
                ${reservation.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : ''}
                ${reservation.status === 'active' ? 'bg-indigo-100 text-indigo-800' : ''}
                ${reservation.status === 'completed' ? 'bg-neutral-100 text-neutral-800' : ''}
                ${reservation.status === 'cancelled' ? 'bg-red-100 text-red-800' : ''}
              `}>
                {statusMap[reservation.status] || reservation.status}
              </span>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold mb-1">预约时间</p>
                <p className="text-sm font-medium text-neutral-900">
                  {format(new Date(reservation.start_time), 'yyyy年MM月dd日')}
                </p>
                <p className="text-sm text-neutral-600">
                  {format(new Date(reservation.start_time), 'HH:mm')} - {format(new Date(reservation.end_time), 'HH:mm')}
                </p>
              </div>
              <div>
                <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold mb-1">价格</p>
                <p className="text-sm font-medium text-neutral-900">
                  ¥{reservation.price} / {reservation.price_type === 'hour' ? '小时' : '次'}
                </p>
                {reservation.consumable_fee > 0 && (
                  <p className="text-sm text-neutral-600">+ ¥{reservation.consumable_fee} 耗材费</p>
                )}
              </div>
            </div>

            {(reservation.actual_start_time || reservation.actual_end_time) && (
              <div className="bg-neutral-50 rounded-xl p-4 border border-neutral-100 grid grid-cols-2 gap-4">
                {reservation.actual_start_time && (
                  <div>
                    <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold mb-1">上机时间</p>
                    <p className="text-sm font-medium text-neutral-900">
                      {format(new Date(reservation.actual_start_time), 'HH:mm:ss')}
                    </p>
                  </div>
                )}
                {reservation.actual_end_time && (
                  <div>
                    <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold mb-1">下机时间</p>
                    <p className="text-sm font-medium text-neutral-900">
                      {format(new Date(reservation.actual_end_time), 'HH:mm:ss')}
                    </p>
                  </div>
                )}
              </div>
            )}

            {reservation.total_cost !== null && (
              <div className="flex justify-between items-center py-4 border-t border-neutral-100">
                <span className="text-sm font-medium text-neutral-500">总费用</span>
                <span className="text-2xl font-bold text-neutral-900">¥{reservation.total_cost.toFixed(2)}</span>
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-neutral-100">
              {(reservation.status === 'pending' || reservation.status === 'approved') && (
                <button
                  onClick={() => handleAction('cancel')}
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-white border border-red-200 text-red-600 rounded-xl font-medium hover:bg-red-50 transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  取消预约
                </button>
              )}

              {reservation.status === 'approved' && (
                <button
                  onClick={() => handleAction('checkin')}
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors"
                >
                  <Play className="w-4 h-4" />
                  上机 (开始)
                </button>
              )}

              {reservation.status === 'active' && (
                <button
                  onClick={() => handleAction('checkout')}
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-amber-500 text-white rounded-xl font-medium hover:bg-amber-600 transition-colors"
                >
                  <Square className="w-4 h-4" />
                  下机 (结束)
                </button>
              )}

              {reservation.status === 'completed' && (
                <div className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-neutral-100 text-neutral-500 rounded-xl font-medium cursor-not-allowed">
                  <CheckCircle2 className="w-4 h-4" />
                  已完成
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
