import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, addDays, startOfToday, parseISO, addMinutes, isBefore, isAfter, startOfDay, endOfDay } from 'date-fns';
import { Calendar as CalendarIcon, Clock, CheckCircle2, ChevronRight, Info, MapPin, Lock } from 'lucide-react';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';

interface Equipment {
  id: number;
  name: string;
  description: string;
  image_url: string;
  location: string;
  price_type: string;
  price: number;
  consumable_fee: number;
  availability_json: string;
  whitelist_enabled: boolean;
}

interface Slot {
  start: string;
  end: string;
}

interface Reservation {
  start_time: string;
  end_time: string;
  student_name?: string;
  status: string;
}

export default function Booking() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [availableRanges, setAvailableRanges] = useState<Slot[]>([]);
  const [existingReservations, setExistingReservations] = useState<Reservation[]>([]);
  const [maxDuration, setMaxDuration] = useState(60);
  const [minDuration, setMinDuration] = useState(30);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [advanceDays, setAdvanceDays] = useState(7);
  
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');

  const [formData, setFormData] = useState({
    student_id: '',
    student_name: '',
    supervisor: '',
    phone: '',
    email: ''
  });

  const [bookingCode, setBookingCode] = useState<string | null>(null);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);
  const [needsWhitelist, setNeedsWhitelist] = useState(false);
  const [applyingWhitelist, setApplyingWhitelist] = useState(false);

  useEffect(() => {
    fetch('/api/equipment')
      .then(res => res.json())
      .then(data => {
        const eq = data.find((e: any) => e.id === Number(id));
        if (eq) {
          setEquipment(eq);
          try {
            const avail = JSON.parse(eq.availability_json);
            setAdvanceDays(avail.advanceDays || 7);
          } catch (e) {}
        }
      });

    const cookieValue = document.cookie
      .split('; ')
      .find(row => row.startsWith('lab_user_info='))
      ?.split('=')[1];
      
    if (cookieValue) {
      try {
        const decoded = JSON.parse(decodeURIComponent(cookieValue));
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
        setAvailableRanges(data.availableSlots || []);
        setExistingReservations(data.reservations || []);
        setMaxDuration(data.maxDurationMinutes || 60);
        setMinDuration(data.minDurationMinutes || 30);
        setLoadingSlots(false);
      });
  }, [id, selectedDate]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleStartTimeChange = (val: string) => {
    setStartTime(val);
    if (val) {
      const [h, m] = val.split(':').map(Number);
      const start = new Date();
      start.setHours(h, m, 0, 0);
      const end = addMinutes(start, maxDuration);
      setEndTime(format(end, 'HH:mm'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startTime || !endTime) return toast.error('请选择预约时间');

    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const start = new Date(`${dateStr}T${startTime}`);
    const end = new Date(`${dateStr}T${endTime}`);

    if (isBefore(end, start)) return toast.error('结束时间必须晚于开始时间');
    
    const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    if (durationMinutes > maxDuration) return toast.error(`预约时长不能超过 ${maxDuration} 分钟`);
    if (durationMinutes < minDuration) return toast.error(`预约时长不能少于 ${minDuration} 分钟`);

    // Check if within available ranges
    const inRange = availableRanges.some(range => {
      const rStart = new Date(range.start);
      const rEnd = new Date(range.end);
      return (start >= rStart && end <= rEnd);
    });
    if (!inRange) return toast.error('所选时间不在仪器开放范围内');

    // Check conflicts
    const conflict = existingReservations.some(res => {
      const rStart = new Date(res.start_time);
      const rEnd = new Date(res.end_time);
      return (start < rEnd && end > rStart);
    });
    if (conflict) return toast.error('所选时间段已有其他预约');

    // Safe cookie storage for non-Latin1 characters
    const encoded = encodeURIComponent(JSON.stringify(formData));
    document.cookie = `lab_user_info=${encoded}; max-age=31536000; path=/`;

    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_id: id,
          ...formData,
          start_time: start.toISOString(),
          end_time: end.toISOString()
        })
      });

      const data = await res.json();
      if (data.needs_whitelist_application) {
        setNeedsWhitelist(true);
        toast.error('您不在白名单中，请先申请使用权限');
      } else if (data.error) {
        toast.error(data.error);
      } else {
        setBookingCode(data.booking_code);
        setBookingStatus(data.status);
        
        // Save booking code to cookies
        const existingCodes = document.cookie
          .split('; ')
          .find(row => row.startsWith('lab_booking_codes='))
          ?.split('=')[1] || '';
        const newCodes = existingCodes ? `${existingCodes},${data.booking_code}` : data.booking_code;
        document.cookie = `lab_booking_codes=${newCodes}; max-age=31536000; path=/`;
      }
    } catch (err) {
      toast.error('预约失败，请重试');
    }
  };

  const handleApplyWhitelist = async (e: React.FormEvent) => {
    e.preventDefault();
    setApplyingWhitelist(true);
    try {
      const res = await fetch('/api/whitelist/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_id: id,
          ...formData
        })
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('申请已提交，请等待管理员审核');
        setNeedsWhitelist(false);
      } else {
        toast.error(data.error || '申请失败');
      }
    } catch (err) {
      toast.error('申请失败');
    } finally {
      setApplyingWhitelist(false);
    }
  };

  const daysMap: Record<string, string> = {
    Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六', Sun: '周日'
  };

  const [allAvailability, setAllAvailability] = useState<any[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);

  useEffect(() => {
    if (!id || !equipment) return;
    setLoadingAll(true);
    const fetchAll = async () => {
      const dates = Array.from({ length: advanceDays + 1 }).map((_, i) => format(addDays(startOfToday(), i), 'yyyy-MM-dd'));
      const results = await Promise.all(dates.map(d => fetch(`/api/equipment/${id}/availability?date=${d}`).then(r => r.json())));
      setAllAvailability(results.map((r, i) => ({ date: dates[i], ...r })));
      setLoadingAll(false);
    };
    fetchAll();
  }, [id, equipment, advanceDays]);

  // Transform allAvailability into a format for a multi-day heat-map grid
  // X-axis: Time (08:00 to 22:00, 30min steps)
  const timeSteps = Array.from({ length: (22 - 8) * 2 }).map((_, i) => {
    const h = 8 + Math.floor(i / 2);
    const m = (i % 2) * 30;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  });

  const gridData = allAvailability.map(dayData => {
    const dateStr = dayData.date;
    const slots = dayData.availableSlots || [];
    const resvs = dayData.reservations || [];
    
    return {
      date: dateStr,
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
          return timeDate >= start && timeDate < end;
        });
        return { time: t, isAvailable, isBooked };
      })
    };
  });

  if (bookingCode) {
    return (
      <div className="max-w-md mx-auto mt-12 bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 text-center">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-bold text-neutral-900 mb-2">预约成功！</h2>
        <p className="text-neutral-500 mb-8">您的预约状态为 {bookingStatus === 'approved' ? '已通过' : '待审批'}。</p>
        
        <div className="bg-neutral-50 rounded-xl p-6 mb-8 border border-neutral-200">
          <p className="text-sm text-neutral-500 mb-2 uppercase tracking-wider font-semibold">您的预约码</p>
          <p className="text-4xl font-mono font-bold text-red-600 tracking-widest">{bookingCode}</p>
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

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8 flex flex-col md:flex-row gap-6 items-start">
        {equipment?.image_url && (
          <img 
            src={equipment.image_url} 
            alt={equipment.name} 
            className="w-full md:w-48 h-32 object-cover rounded-2xl shadow-sm border border-neutral-200"
            referrerPolicy="no-referrer"
          />
        )}
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">预约仪器</h1>
          {equipment && (
            <div className="mt-2 space-y-1">
              <p className="text-lg font-medium text-neutral-700">{equipment.name}</p>
              <div className="flex flex-wrap gap-4 text-sm text-neutral-500">
                <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {equipment.location || '未知地点'}</span>
                <span className="flex items-center gap-1"><Info className="w-4 h-4" /> {equipment.description}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3 space-y-6">
          {needsWhitelist ? (
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                  <Lock className="w-5 h-5 text-amber-600" />
                </div>
                <h3 className="text-xl font-bold">申请使用权限</h3>
              </div>
              <p className="text-neutral-600 mb-8">此仪器已开启白名单限制，您需要提交申请并获得管理员批准后方可预约使用。</p>
              
              <form onSubmit={handleApplyWhitelist} className="space-y-6 max-w-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">姓名</label>
                    <input required type="text" name="student_name" value={formData.student_name} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">学号</label>
                    <input required type="text" name="student_id" value={formData.student_id} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">电话</label>
                    <input required type="tel" name="phone" value={formData.phone} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">邮箱</label>
                    <input required type="email" name="email" value={formData.email} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">导师</label>
                  <input required type="text" name="supervisor" value={formData.supervisor} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300" />
                </div>
                <div className="flex gap-4">
                  <button type="button" onClick={() => setNeedsWhitelist(false)} className="flex-1 py-3 border border-neutral-300 rounded-xl font-medium">取消</button>
                  <button type="submit" disabled={applyingWhitelist} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium disabled:opacity-50">
                    {applyingWhitelist ? '提交中...' : '提交申请'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <>
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
                <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                  <CalendarIcon className="w-5 h-5 text-red-600" />
                  全周期预约概览 (X轴: 时间, Y轴: 日期)
                </h3>
            
            {loadingAll ? (
              <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div></div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[800px]">
                  {/* Time Header */}
                  <div className="flex border-b border-neutral-100 pb-2 mb-2">
                    <div className="w-24 shrink-0"></div>
                    <div className="flex-1 flex justify-between px-2 text-[10px] text-neutral-400 font-mono">
                      {timeSteps.filter((_, i) => i % 2 === 0).map(t => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                  </div>
                  
                  {/* Date Rows */}
                  <div className="space-y-1">
                    {gridData.map((row, idx) => {
                      const date = parseISO(row.date);
                      const isSelected = format(date, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
                      const dayStr = format(date, 'EEE');
                      
                      return (
                        <div key={idx} className="flex items-center group">
                              <button 
                                onClick={() => setSelectedDate(date)}
                                className={clsx(
                                  "w-24 shrink-0 text-left px-2 py-1 rounded-lg transition-colors",
                                  isSelected ? "bg-red-600 text-white" : "hover:bg-neutral-50"
                                )}
                              >
                                <p className="text-[10px] font-bold uppercase opacity-70">{daysMap[dayStr] || dayStr}</p>
                                <p className="text-xs font-bold">{format(date, 'MM-dd')}</p>
                              </button>
                              
                              <div className="flex-1 flex gap-px h-8 bg-neutral-50 rounded-md overflow-hidden p-0.5">
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
                                          setSelectedDate(date);
                                          handleStartTimeChange(t.time);
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

            <div className="flex gap-6 mt-6 text-xs text-neutral-500 justify-center border-t border-neutral-50 pt-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-emerald-500 rounded-sm"></div>
                <span>可预约 (点击色块快速选择)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500 rounded-sm"></div>
                <span>已被预约</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-neutral-200 rounded-sm"></div>
                <span>未开放</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
            <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
              <Clock className="w-5 h-5 text-red-600" />
              设置预约时间 ({format(selectedDate, 'yyyy-MM-dd')})
            </h3>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">开始时间</label>
                <input 
                  type="time" 
                  step="300"
                  value={startTime} 
                  onChange={e => handleStartTimeChange(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all font-mono text-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">结束时间</label>
                <input 
                  type="time" 
                  step="300"
                  value={endTime} 
                  onChange={e => setEndTime(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all font-mono text-lg"
                />
              </div>
            </div>
            <div className="mt-6 p-4 bg-red-50 rounded-2xl border border-red-100 flex items-start gap-3">
              <Info className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="text-xs text-red-800 space-y-1.5">
                <p>• 最小预约时长：<span className="font-bold">{minDuration} 分钟</span></p>
                <p>• 最大预约时长：<span className="font-bold">{maxDuration} 分钟</span></p>
                <p>• 步进单位：<span className="font-bold">5 分钟</span></p>
              </div>
            </div>
            </div>
          </>
        )}
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200 h-fit sticky top-8">
          <h3 className="text-lg font-semibold mb-6">您的信息</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">姓名</label>
              <input required type="text" name="student_name" value={formData.student_name} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" placeholder="张三" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">学号</label>
              <input required type="text" name="student_id" value={formData.student_id} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" placeholder="20230001" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">导师</label>
              <input required type="text" name="supervisor" value={formData.supervisor} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" placeholder="李四教授" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">电话号码</label>
              <input required type="tel" name="phone" value={formData.phone} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" placeholder="13800138000" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">邮箱</label>
              <input required type="email" name="email" value={formData.email} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" placeholder="zhangsan@university.edu" />
            </div>

            <div className="pt-6">
              <button 
                type="submit" 
                disabled={!startTime || !endTime}
                className="w-full flex items-center justify-center gap-2 py-4 px-4 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg hover:shadow-red-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                确认预约
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
