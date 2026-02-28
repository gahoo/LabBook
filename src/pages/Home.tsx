import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Clock, DollarSign, Zap, QrCode, X, MapPin, Search, Calendar as CalendarIcon } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';

interface Equipment {
  id: number;
  name: string;
  description: string;
  image_url: string;
  location: string;
  availability_json: string;
  auto_approve: number;
  price_type: string;
  price: number;
  consumable_fee: number;
}

export default function Home() {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [qrModal, setQrModal] = useState<Equipment | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [availabilityToday, setAvailabilityToday] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      fetch('/api/equipment').then(res => res.json()),
      fetch('/api/equipment/availability/today').then(res => res.json())
    ]).then(([eqData, availData]) => {
      setEquipment(eqData);
      setAvailabilityToday(availData);
      setLoading(false);
    });
  }, []);

  const timeSteps = Array.from({ length: (22 - 8) * 2 }).map((_, i) => {
    const h = 8 + Math.floor(i / 2);
    const m = (i % 2) * 30;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  });

  const gridData = availabilityToday.map(eqData => {
    const slots = eqData.availableSlots || [];
    const resvs = eqData.reservations || [];
    const dateStr = format(new Date(), 'yyyy-MM-dd');
    
    return {
      equipment_id: eqData.equipment_id,
      equipment_name: eqData.equipment_name,
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

  const getAvailabilitySummary = (jsonStr: string) => {
    try {
      const data = JSON.parse(jsonStr);
      if (!data.rules || data.rules.length === 0) return '未设置开放时间';
      
      const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const summary = data.rules.map((r: any) => `${days[r.day]} ${r.start}-${r.end}`).join(', ');
      return summary.length > 30 ? summary.substring(0, 30) + '...' : summary;
    } catch (e) {
      return '无效的开放时间设置';
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-pulse flex space-x-4"><div className="rounded-full bg-neutral-200 h-10 w-10"></div></div></div>;
  }

  const filteredEquipment = equipment.filter(eq => 
    eq.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">实验仪器</h1>
          <p className="text-neutral-500 mt-2">预约和管理您的科研实验仪器设备。</p>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
          <input
            type="text"
            placeholder="搜索仪器名称..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white rounded-xl border border-neutral-200 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all"
          />
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
        <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-red-600" />
          今日可用时间概览 ({format(new Date(), 'yyyy-MM-dd')})
        </h3>
        <div className="overflow-x-auto">
          <div className="min-w-[800px]">
            <div className="flex border-b border-neutral-100 pb-2 mb-2">
              <div className="w-32 shrink-0"></div>
              <div className="flex-1 flex justify-between px-2 text-[10px] text-neutral-400 font-mono">
                {timeSteps.filter((_, i) => i % 2 === 0).map(t => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              {gridData.map((row, idx) => (
                <div key={idx} className="flex items-center group">
                  <div className="w-32 shrink-0 text-left px-2 py-1 truncate">
                    <p className="text-xs font-bold text-neutral-700 truncate" title={row.equipment_name}>{row.equipment_name}</p>
                  </div>
                  <div className="flex-1 flex gap-px h-6 bg-neutral-50 rounded-md overflow-hidden p-0.5">
                    {row.times.map((t, i) => {
                      const timeDate = new Date(`${format(new Date(), 'yyyy-MM-dd')}T${t.time}`);
                      const isPast = timeDate < new Date();
                      return (
                        <div 
                          key={i}
                          title={`${row.equipment_name} ${t.time}`}
                          className={clsx(
                            "flex-1 transition-all",
                            t.isBooked ? "bg-red-500" : (t.isAvailable && !isPast ? "bg-emerald-500 hover:opacity-80 cursor-pointer" : "bg-neutral-200")
                          )}
                          onClick={() => {
                            if (t.isAvailable && !t.isBooked && !isPast) {
                              navigate(`/book/${row.equipment_id}?time=${t.time}`);
                            }
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredEquipment.map(eq => (
          <div key={eq.id} className="bg-white rounded-2xl border border-neutral-200 shadow-sm hover:shadow-md transition-all flex flex-col relative group overflow-hidden">
            {eq.image_url && (
              <div className="h-48 overflow-hidden">
                <img 
                  src={eq.image_url} 
                  alt={eq.name} 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  referrerPolicy="no-referrer"
                />
              </div>
            )}
            <div className="p-6 flex-1 flex flex-col">
              <button 
                onClick={() => setQrModal(eq)}
                className="absolute top-4 right-4 p-2 bg-white/80 backdrop-blur-sm text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors opacity-0 group-hover:opacity-100 z-10"
                title="显示二维码"
              >
                <QrCode className="w-5 h-5" />
              </button>
              <div className="flex-1">
                <div className="flex justify-between items-start mb-2 pr-8">
                  <h2 className="text-lg font-semibold text-neutral-900">{eq.name}</h2>
                </div>
                {eq.location && (
                  <div className="flex items-center gap-1 text-xs text-neutral-400 mb-3">
                    <MapPin className="w-3 h-3" />
                    {eq.location}
                  </div>
                )}
                {eq.auto_approve === 1 && (
                  <div className="mb-4">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                      <Zap className="w-3 h-3" /> 自动审批
                    </span>
                  </div>
                )}
                <p className="text-sm text-neutral-600 mb-6 line-clamp-2">{eq.description}</p>
                
                <div className="space-y-2 mb-6">
                  <div className="flex items-center gap-2 text-sm text-neutral-500">
                    <Clock className="w-4 h-4" />
                    <span className="truncate">开放时间: {getAvailabilitySummary(eq.availability_json)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-neutral-500">
                    <DollarSign className="w-4 h-4" />
                    <span>
                      ¥{eq.price}/{eq.price_type === 'hour' ? '小时' : '次'}
                      {eq.consumable_fee > 0 && ` + ¥${eq.consumable_fee} 耗材费`}
                    </span>
                  </div>
                </div>
              </div>
              
              <Link 
                to={`/book/${eq.id}`}
                className="w-full inline-flex justify-center items-center px-4 py-2.5 bg-red-600 text-white text-sm font-medium rounded-xl hover:bg-red-700 transition-colors"
              >
                立即预约
              </Link>
            </div>
          </div>
        ))}

        {equipment.length === 0 && (
          <div className="col-span-full text-center py-12 text-neutral-500">
            暂无可预约仪器。请联系管理员添加。
          </div>
        )}
      </div>

      {qrModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full relative text-center shadow-xl">
            <button 
              onClick={() => setQrModal(null)}
              className="absolute top-4 right-4 p-2 text-neutral-400 hover:text-neutral-900 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold mb-2">{qrModal.name}</h3>
            <p className="text-neutral-500 text-sm mb-6">扫码直接进入预约页面</p>
            <div className="flex justify-center bg-white p-4 rounded-xl border border-neutral-100 shadow-sm inline-block mx-auto">
              <QRCodeSVG 
                value={`${window.location.origin}/book/${qrModal.id}`} 
                size={200}
                level="H"
                includeMargin={true}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
