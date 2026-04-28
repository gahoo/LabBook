import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { Save, Upload, X, Settings, ShieldAlert } from 'lucide-react';
import BackupTab from './BackupTab';
import NotificationsTab from './NotificationsTab';
import DeliveryLogsTab from './DeliveryLogsTab';

interface SettingsTabProps {
  token: string;
}

export default function SettingsTab({ token }: SettingsTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<'system' | 'backup' | 'notifications' | 'delivery_logs'>('system');
  const [appName, setAppName] = useState('LabBook');
  const [defaultRoute, setDefaultRoute] = useState('/');
  const [appLogo, setAppLogo] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.app_name) setAppName(data.app_name);
      if (data.default_route) setDefaultRoute(data.default_route);
      if (data.app_logo) setAppLogo(data.app_logo);
    } catch (err) {
      console.error('Failed to fetch settings', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 200 * 1024) { // 200KB limit
        toast.error('Logo 图片大小不能超过 200KB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setAppLogo(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          app_name: appName,
          default_route: defaultRoute,
          app_logo: appLogo
        })
      });

      if (res.ok) {
        toast.success('设置保存成功，刷新页面后生效');
        document.title = appName;
        if (appLogo) {
          const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
          if (link) {
            link.href = appLogo;
          } else {
            const newLink = document.createElement('link');
            newLink.rel = 'icon';
            newLink.href = appLogo;
            document.head.appendChild(newLink);
          }
        }
      } else {
        toast.error('保存失败');
      }
    } catch (err) {
      toast.error('保存失败');
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-neutral-500">加载中...</div>;
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
      <div className="flex border-b border-neutral-200 bg-neutral-50 px-2 overflow-x-auto">
        <button
          onClick={() => setActiveSubTab('system')}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeSubTab === 'system' ? 'border-red-600 text-red-600' : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'}`}
        >
          系统常规设置
        </button>
        <button
          onClick={() => setActiveSubTab('backup')}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeSubTab === 'backup' ? 'border-red-600 text-red-600' : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'}`}
        >
          数据备份
        </button>
        <button
          onClick={() => setActiveSubTab('notifications')}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeSubTab === 'notifications' ? 'border-red-600 text-red-600' : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'}`}
        >
          通知配置
        </button>
        <button
          onClick={() => setActiveSubTab('delivery_logs')}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeSubTab === 'delivery_logs' ? 'border-red-600 text-red-600' : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'}`}
        >
          消息队列日志
        </button>
      </div>

      {activeSubTab === 'system' && (
        <div className="p-6">
          <div className="space-y-6 max-w-2xl">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                应用名称
              </label>
              <input
                type="text"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all"
                placeholder="例如：LabBook"
              />
              <p className="text-xs text-neutral-500 mt-2">
                显示在页面左上角和浏览器标签页标题中。
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                应用 Logo
              </label>
              <div className="flex items-center gap-4">
                {appLogo ? (
                  <div className="relative w-16 h-16 rounded-lg border border-neutral-200 overflow-hidden bg-neutral-50 flex items-center justify-center">
                    <img src={appLogo} alt="App Logo" className="max-w-full max-h-full object-contain" />
                    <button
                      onClick={() => setAppLogo('')}
                      className="absolute top-1 right-1 p-1 bg-white/80 rounded-full text-neutral-500 hover:text-red-600 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-lg border border-neutral-200 bg-neutral-50 flex items-center justify-center text-neutral-400">
                    <span className="text-xs">无</span>
                  </div>
                )}
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleLogoUpload}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-neutral-300 text-neutral-700 rounded-xl text-sm font-medium hover:bg-neutral-50 transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    上传 Logo
                  </button>
                  <p className="text-xs text-neutral-500 mt-2">
                    建议尺寸 128x128，大小不超过 200KB。上传后将替换左上角的默认图标。
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                根路由
              </label>
              <input
                type="text"
                value={defaultRoute}
                onChange={(e) => setDefaultRoute(e.target.value)}
                className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all"
                placeholder="例如：/labbook"
              />
              <p className="text-xs text-neutral-500 mt-2">
                应用的根路径（如：/ 或 /labbook）。修改后所有页面路径都会加上此作为前缀。
              </p>
            </div>

            <div className="pt-4">
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-6 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors"
              >
                <Save className="w-4 h-4" />
                保存设置
              </button>
            </div>
          </div>
        </div>
      )}

      {activeSubTab === 'backup' && (
        <BackupTab token={token} />
      )}

      {activeSubTab === 'notifications' && (
        <NotificationsTab token={token} />
      )}

      {activeSubTab === 'delivery_logs' && (
        <DeliveryLogsTab token={token} />
      )}
    </div>
  );
}
