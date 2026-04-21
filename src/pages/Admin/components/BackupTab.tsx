import React, { useState, useEffect } from 'react';
import { Save, ShieldCheck, Clock, CheckCircle2, History } from 'lucide-react';
import toast from 'react-hot-toast';

interface BackupTabProps {
  token: string | null;
}

export default function BackupTab({ token }: BackupTabProps) {
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [autoBackupCron, setAutoBackupCron] = useState('0 3 * * *');
  const [autoBackupRetention, setAutoBackupRetention] = useState('7');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      
      if (data.auto_backup_enabled) setAutoBackupEnabled(data.auto_backup_enabled === 'true');
      if (data.auto_backup_cron) setAutoBackupCron(data.auto_backup_cron);
      if (data.auto_backup_retention) setAutoBackupRetention(data.auto_backup_retention);
    } catch (err) {
      console.error('Failed to fetch settings', err);
    } finally {
      setIsLoading(false);
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
          auto_backup_enabled: autoBackupEnabled.toString(),
          auto_backup_cron: autoBackupCron,
          auto_backup_retention: autoBackupRetention
        })
      });

      if (res.ok) {
        toast.success('备份设置已保存且后台任务已更新');
      } else {
        toast.error('保存失败');
      }
    } catch (err) {
      toast.error('请求失败');
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-neutral-500">正在加载设置...</div>;
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-neutral-900 mb-2 flex items-center gap-2">
        <ShieldCheck className="w-6 h-6 text-emerald-600" />
        数据安全与备份
      </h2>
      <p className="text-neutral-500 mb-8">
        系统支持每天自动生成整个 SQLite 数据库的本地文件备份。这能为您提供一个强有力的数据底座，防止意外崩溃导致数据清零。
      </p>

      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-xl border border-neutral-200">
          <div>
            <h3 className="font-semibold text-neutral-900 flex items-center gap-2">
              启用自动定时备份
            </h3>
            <p className="text-sm text-neutral-500 mt-1">开启后，系统将在后台依据既定时间自动进行完整落盘备份，并清理达到限制数的旧数据。</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              className="sr-only peer" 
              checked={autoBackupEnabled}
              onChange={(e) => setAutoBackupEnabled(e.target.checked)}
            />
            <div className="w-11 h-6 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
          </label>
        </div>

        {autoBackupEnabled && (
          <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-xl space-y-4 transition-all">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                备份执行时间 (Cron 表达式)
              </label>
              <input
                type="text"
                value={autoBackupCron}
                onChange={(e) => setAutoBackupCron(e.target.value)}
                placeholder="例如: 0 3 * * *"
                className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-emerald-600 focus:border-transparent outline-none transition-all"
              />
              <p className="text-xs text-neutral-500 mt-2">
                标准 Cron 规则。当前默认值为 <code className="bg-neutral-100 px-1 py-0.5 rounded">0 3 * * *</code> 表示每天凌晨 3 点。<br/>更改并保存后，后端的定时器将热更新，无需重启服务。
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2 flex items-center gap-2">
                <History className="w-4 h-4" />
                保留备份份数
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={autoBackupRetention}
                  onChange={(e) => setAutoBackupRetention(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-emerald-600 focus:border-transparent outline-none transition-all"
                />
                <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                  <span className="text-neutral-500">份</span>
                </div>
              </div>
              <p className="text-xs text-neutral-500 mt-2">
                旧文件清理策略：超过此数量的历史备份将被立刻移除，防止打满磁盘。建议值：7 到 30。
              </p>
            </div>
            
            <div className="flex items-start gap-3 mt-4 text-emerald-800 bg-emerald-100/50 p-3 rounded-lg">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-sm">
                <span className="font-semibold block mb-1">自动保存与清理机制</span>
                备份将存储于服务器/容器本地的 <code className="bg-emerald-200/50 px-1 py-0.5 rounded text-emerald-900 border border-emerald-200">/backups</code> 目录中。<br/>系统在此目录中始终保留最近的 {autoBackupRetention || 7} 份备份文件，超出限制的老旧文件将在每次成功备份后被自动清理。
              </div>
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-neutral-200">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors"
          >
            <Save className="w-4 h-4" />
            保存备份设置
          </button>
        </div>
      </div>
    </div>
  );
}
