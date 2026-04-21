import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Save, ShieldAlert } from 'lucide-react';

interface ViolationParamsTabProps {
  token: string;
}

export default function ViolationParamsTab({ token }: ViolationParamsTabProps) {
  const [lateGraceMinutes, setLateGraceMinutes] = useState(15);
  const [overtimeGraceMinutes, setOvertimeGraceMinutes] = useState(15);
  const [lateCancelHours, setLateCancelHours] = useState(2);
  const [noShowGraceMinutes, setNoShowGraceMinutes] = useState(30);
  const [cronIntervalMinutes, setCronIntervalMinutes] = useState(15);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.violation_late_grace_minutes) setLateGraceMinutes(Number(data.violation_late_grace_minutes));
      if (data.violation_overtime_grace_minutes) setOvertimeGraceMinutes(Number(data.violation_overtime_grace_minutes));
      if (data.violation_late_cancel_hours) setLateCancelHours(Number(data.violation_late_cancel_hours));
      if (data.violation_no_show_grace_minutes) setNoShowGraceMinutes(Number(data.violation_no_show_grace_minutes));
      if (data.cron_no_show_scan_interval_minutes) setCronIntervalMinutes(Number(data.cron_no_show_scan_interval_minutes));
    } catch (err) {
      console.error('Failed to fetch violation params', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (noShowGraceMinutes < lateGraceMinutes) {
      toast.error('爽约宽限期不能小于迟到宽限期');
      return;
    }
    if (noShowGraceMinutes < overtimeGraceMinutes) {
      toast.error('爽约宽限期不能小于超时宽限期');
      return;
    }
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          violation_late_grace_minutes: lateGraceMinutes,
          violation_overtime_grace_minutes: overtimeGraceMinutes,
          violation_late_cancel_hours: lateCancelHours,
          violation_no_show_grace_minutes: noShowGraceMinutes,
          cron_no_show_scan_interval_minutes: cronIntervalMinutes
        })
      });

      if (res.ok) {
        toast.success('违规判定参数保存成功');
      } else {
        toast.error('保存失败');
      }
    } catch (err) {
      toast.error('保存失败');
    }
  };

  if (isLoading) {
    return <div className="text-center py-12 text-neutral-500">加载中...</div>;
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200">
      <div className="p-6 border-b border-neutral-200 flex justify-between items-center bg-red-50/30 rounded-t-2xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
            <ShieldAlert className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-neutral-900">违规判定参数设置</h2>
            <p className="text-sm text-neutral-500 mt-1">配置系统自动判定违规行为的时间阈值</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          className="px-6 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          保存参数
        </button>
      </div>

      <div className="p-6">
        <div className="max-w-2xl space-y-6">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              迟到宽限期 (分钟)
            </label>
            <input
              type="number"
              min="0"
              value={lateGraceMinutes}
              onChange={(e) => setLateGraceMinutes(Number(e.target.value))}
              className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all"
            />
            <p className="text-xs text-neutral-500 mt-1">超过预约开始时间多少分钟后上机记为迟到。</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              超时宽限期 (分钟)
            </label>
            <input
              type="number"
              min="0"
              value={overtimeGraceMinutes}
              onChange={(e) => setOvertimeGraceMinutes(Number(e.target.value))}
              className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all"
            />
            <p className="text-xs text-neutral-500 mt-1">超过预约结束时间多少分钟后下机记为超时。</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              临期取消阈值 (小时)
            </label>
            <input
              type="number"
              min="0"
              value={lateCancelHours}
              onChange={(e) => setLateCancelHours(Number(e.target.value))}
              className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all"
            />
            <p className="text-xs text-neutral-500 mt-1">距离预约开始时间不足多少小时取消记为临期取消。</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              爽约宽限期 (分钟)
            </label>
            <input
              type="number"
              min="0"
              value={noShowGraceMinutes}
              onChange={(e) => setNoShowGraceMinutes(Number(e.target.value))}
              className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all"
            />
            <p className="text-xs text-neutral-500 mt-1">超过预约开始时间多少分钟未上机记为爽约（建议大于迟到宽限期）。</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              爽约扫描频率 (分钟)
            </label>
            <input
              type="number"
              min="1"
              value={cronIntervalMinutes}
              onChange={(e) => setCronIntervalMinutes(Number(e.target.value))}
              className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all"
            />
            <p className="text-xs text-neutral-500 mt-1">系统后台扫描并标记爽约记录的频率（建议 15-30 分钟）。注意：该设置在任务下一次执行时生效，或者重启应用后立即生效。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
