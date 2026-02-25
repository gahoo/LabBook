import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, addDays, startOfToday } from 'date-fns';
import { Calendar as CalendarIcon, Clock, CheckCircle2, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';

interface Equipment {
  id: number;
  name: string;
  price_type: string;
  price: number;
  consumable_fee: number;
}

interface Slot {
  start: string;
  end: string;
}

export default function Booking() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  
  const [formData, setFormData] = useState({
    student_id: '',
    student_name: '',
    supervisor: '',
    phone: '',
    email: ''
  });

  const [bookingCode, setBookingCode] = useState<string | null>(null);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/equipment')
      .then(res => res.json())
      .then(data => {
        const eq = data.find((e: any) => e.id === Number(id));
        if (eq) setEquipment(eq);
      });

    // Load user info from cookie
    const cookieValue = document.cookie
      .split('; ')
      .find(row => row.startsWith('lab_user_info='))
      ?.split('=')[1];
      
    if (cookieValue) {
      try {
        const decoded = JSON.parse(atob(cookieValue));
        setFormData(decoded);
      } catch (e) {
        console.error('Failed to parse cookie', e);
      }
    }
  }, [id]);

  useEffect(() => {
    if (!id || !selectedDate) return;
    setLoadingSlots(true);
    fetch(`/api/equipment/${id}/availability?date=${format(selectedDate, 'yyyy-MM-dd')}`)
      .then(res => res.json())
      .then(data => {
        setAvailableSlots(data);
        setLoadingSlots(false);
        setSelectedSlot(null);
      });
  }, [id, selectedDate]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot) return toast.error('请选择一个时间段');

    // Save to cookie
    const encoded = btoa(JSON.stringify(formData));
    document.cookie = `lab_user_info=${encoded}; max-age=31536000; path=/`;

    const res = await fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipment_id: id,
        ...formData,
        start_time: selectedSlot.start,
        end_time: selectedSlot.end
      })
    });

    const data = await res.json();
    if (data.error) {
      toast.error(data.error);
    } else {
      setBookingCode(data.booking_code);
      setBookingStatus(data.status);
    }
  };

  const statusMap: Record<string, string> = {
    pending: '待审批',
    approved: '已通过'
  };

  if (bookingCode) {
    return (
      <div className="max-w-md mx-auto mt-12 bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 text-center">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-bold text-neutral-900 mb-2">预约成功！</h2>
        <p className="text-neutral-500 mb-8">您的预约状态为 {statusMap[bookingStatus || ''] || bookingStatus}。</p>
        
        <div className="bg-neutral-50 rounded-xl p-6 mb-8 border border-neutral-200">
          <p className="text-sm text-neutral-500 mb-2 uppercase tracking-wider font-semibold">您的预约码</p>
          <p className="text-4xl font-mono font-bold text-indigo-600 tracking-widest">{bookingCode}</p>
          <p className="text-xs text-neutral-400 mt-4">请妥善保存此预约码！您需要使用它进行上机、下机或取消预约。</p>
        </div>

        <button 
          onClick={() => navigate('/my-reservations')}
          className="w-full py-3 bg-neutral-900 text-white rounded-xl font-medium hover:bg-neutral-800 transition-colors"
        >
          前往我的预约
        </button>
      </div>
    );
  }

  const daysMap: Record<string, string> = {
    Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六', Sun: '周日'
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900">预约仪器</h1>
        {equipment && <p className="text-neutral-500 mt-2">正在预约：{equipment.name}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-indigo-600" />
              选择日期
            </h3>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {[0, 1, 2, 3, 4, 5, 6].map(offset => {
                const date = addDays(startOfToday(), offset);
                const isSelected = format(date, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
                const dayStr = format(date, 'EEE');
                return (
                  <button
                    key={offset}
                    onClick={() => setSelectedDate(date)}
                    className={clsx(
                      "flex flex-col items-center justify-center min-w-[4rem] p-3 rounded-xl border transition-colors",
                      isSelected ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-neutral-200 text-neutral-600 hover:border-indigo-300"
                    )}
                  >
                    <span className="text-xs font-medium uppercase">{daysMap[dayStr] || dayStr}</span>
                    <span className="text-lg font-bold">{format(date, 'd')}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-indigo-600" />
              可选时间段
            </h3>
            
            {loadingSlots ? (
              <div className="text-center py-8 text-neutral-400">加载中...</div>
            ) : availableSlots.length === 0 ? (
              <div className="text-center py-8 text-neutral-400 bg-neutral-50 rounded-xl">该日期无可用时间段。</div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {availableSlots.map((slot, i) => {
                  const isSelected = selectedSlot?.start === slot.start;
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedSlot(slot)}
                      className={clsx(
                        "py-2.5 px-4 rounded-xl border text-sm font-medium transition-all",
                        isSelected 
                          ? "bg-indigo-50 border-indigo-600 text-indigo-700 ring-1 ring-indigo-600" 
                          : "bg-white border-neutral-200 text-neutral-700 hover:border-indigo-300"
                      )}
                    >
                      {format(new Date(slot.start), 'HH:mm')} - {format(new Date(slot.end), 'HH:mm')}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200 h-fit">
          <h3 className="text-lg font-semibold mb-6">您的信息</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">姓名</label>
              <input required type="text" name="student_name" value={formData.student_name} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all" placeholder="张三" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">学号</label>
              <input required type="text" name="student_id" value={formData.student_id} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all" placeholder="20230001" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">导师</label>
              <input required type="text" name="supervisor" value={formData.supervisor} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all" placeholder="李四教授" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">电话号码</label>
              <input required type="tel" name="phone" value={formData.phone} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all" placeholder="13800138000" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">邮箱</label>
              <input required type="email" name="email" value={formData.email} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all" placeholder="zhangsan@university.edu" />
            </div>

            <div className="pt-4">
              <button 
                type="submit" 
                disabled={!selectedSlot}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                确认预约
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
