import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, DollarSign, Zap, QrCode, X, MapPin } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

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

  useEffect(() => {
    fetch('/api/equipment')
      .then(res => res.json())
      .then(data => {
        setEquipment(data);
        setLoading(false);
      });
  }, []);

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900">实验仪器</h1>
        <p className="text-neutral-500 mt-2">预约和管理您的科研实验仪器设备。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {equipment.map(eq => (
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
                className="absolute top-4 right-4 p-2 bg-white/80 backdrop-blur-sm text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors opacity-0 group-hover:opacity-100 z-10"
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
                className="w-full inline-flex justify-center items-center px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
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
