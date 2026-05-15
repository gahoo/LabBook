import React, { useState, useEffect } from 'react';
import { X, AlertCircle, RefreshCw, Users, CheckSquare, Clock } from 'lucide-react';
import { format } from 'date-fns';

interface ViolationsPreviewDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  startDate: string;
  endDate: string;
  token: string;
  formData: any;
  selectedIds: any[];
  onConfirmSelection: (items: any[]) => void;
}

export default function ViolationsPreviewDrawer({
  isOpen,
  onClose,
  startDate,
  endDate,
  token,
  formData,
  selectedIds,
  onConfirmSelection
}: ViolationsPreviewDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [simulationResults, setSimulationResults] = useState<any[]>([]);
  const [localSelectedItems, setLocalSelectedItems] = useState<Map<string, any>>(new Map());
  
  useEffect(() => {
    if (isOpen) {
      const map = new Map();
      selectedIds.forEach(item => map.set(item.student_id, item));
      setLocalSelectedItems(map);
      fetchData();
    }
  }, [isOpen]); // We only trigger on open to avoid unnecessary re-fetches when formData changes slightly inside the drawer

  const fetchData = async () => {
    if (!formData.trigger.violation_types || formData.trigger.violation_types.length === 0) {
      setSimulationResults([]);
      return;
    }
    
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/penalty-rules/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          trigger: formData.trigger,
          action: formData.action,
          start_date: startDate,
          end_date: endDate
        })
      });
      
      if (res.ok) {
        const data = await res.json();
        setSimulationResults(data);
      } else {
        setSimulationResults([]);
      }
    } catch (err) {
      console.error('Failed to simulate penalties', err);
      setSimulationResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const map = new Map(localSelectedItems);
      simulationResults.forEach(r => map.set(r.student_id, r));
      setLocalSelectedItems(map);
    } else {
      setLocalSelectedItems(new Map());
    }
  };

  const handleToggle = (res: any) => {
    const next = new Map(localSelectedItems);
    if (next.has(res.student_id)) next.delete(res.student_id);
    else next.set(res.student_id, res);
    setLocalSelectedItems(next);
  };

  const violationTypeMap: Record<string, string> = {
    late: '迟到',
    overdue: '超时',
    'no-show': '爽约',
    late_cancel: '临期取消',
    hygiene_issue: '卫生不达标',
    improper_operation: '违规操作',
    proxy_booking: '代预约',
    other_manual: '其他违规'
  };

  const isDynamic = formData?.action?.duration_type === 'dynamic';
  const isAllSelected = !isDynamic && simulationResults.length > 0 && simulationResults.every(r => localSelectedItems.has(r.student_id));

  return (
    <>
      <div 
        className={`fixed inset-0 bg-black/40 z-[60] transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      />
      <div 
        className={`fixed top-0 right-0 h-full w-full sm:w-[500px] md:w-[600px] border-l border-neutral-200 bg-white z-[70] shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 bg-red-50/50">
          <div>
            <h2 className="text-lg font-bold text-red-900 flex items-center gap-2">
              <Users className="w-5 h-5" />
              {isDynamic ? '当前受限用户预览' : '挑选要追溯惩罚的用户'}
            </h2>
            <p className="text-xs text-red-700 mt-1">根据当前规则配置模拟出符合条件的人员</p>
          </div>
          <button type="button" onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-2 text-red-400 hover:bg-red-100 hover:text-red-600 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isDynamic && (
          <div className="px-6 py-3 bg-amber-50 text-amber-800 text-sm border-b border-amber-200 flex gap-2 items-start shadow-inner">
            <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="leading-relaxed">
              由于该规则的惩罚时长为“动态判定”，您不需要通过勾选生成历史惩罚记录。在此展示的匹配用户，将在保存启用了该规则后被自动实时限制。
            </p>
          </div>
        )}

        <div className="px-6 py-3 border-b border-neutral-100 bg-white flex justify-between items-center text-sm">
          <label className={`flex items-center gap-2 text-neutral-700 ${isDynamic ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
            <input 
              type="checkbox" 
              checked={isAllSelected}
              onChange={handleSelectAll}
              disabled={isDynamic}
              className="rounded text-red-600 focus:ring-red-500 disabled:opacity-50"
            />
            全选 ({simulationResults.length} 人)
          </label>
          <button onClick={fetchData} className="text-red-600 hover:text-red-700 flex items-center gap-1.5 font-medium">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            重新扫描
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-neutral-50/50">
          {loading ? (
            <div className="flex justify-center items-center h-48 text-neutral-500">
              <RefreshCw className="w-6 h-6 animate-spin mr-2" />
              正在计算符合规则的人员...
            </div>
          ) : simulationResults.length === 0 ? (
            <div className="text-center py-16 text-neutral-500">
              <AlertCircle className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
              该时间段内未发现符合惩罚条件的用户
            </div>
          ) : (
            <div className="space-y-3">
              {simulationResults.map(res => (
                <label 
                  key={res.student_id} 
                  className={`block border rounded-xl p-4 transition-colors ${localSelectedItems.has(res.student_id) ? 'bg-red-50/50 border-red-200 shadow-sm' : 'bg-white border-neutral-200'} ${isDynamic ? '' : 'cursor-pointer hover:border-red-300'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="pt-1">
                      <input 
                        type="checkbox"
                        checked={localSelectedItems.has(res.student_id)}
                        onChange={() => handleToggle(res)}
                        disabled={isDynamic}
                        className="rounded text-red-600 focus:ring-red-500 w-4 h-4 disabled:opacity-50 disabled:bg-neutral-100"
                      />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                        <div className="font-medium text-neutral-900">{res.student_name}</div>
                        <div className="text-xs font-mono text-neutral-500">{res.student_id}</div>
                      </div>
                      <div className="text-sm font-medium text-red-600 mt-1 flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4" />
                        {formData.trigger.metric === 'count' 
                          ? `累计违规 ${res.metric_value} 次` 
                          : `累计违规时长 ${res.metric_value} 分钟`}
                      </div>
                      <div className="mt-2 space-y-1">
                        {res.violations?.map((v: any) => (
                          <div key={v.id} className="text-xs text-neutral-500 flex items-center justify-between bg-neutral-50 p-1.5 rounded">
                            <span className="truncate max-w-[150px]">{v.equipment_name || '未知设备'}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-neutral-400">{format(new Date(v.violation_time), 'MM-dd HH:mm')}</span>
                              <span className="px-1.5 py-0.5 rounded bg-neutral-200/50 text-neutral-600">
                                {violationTypeMap[v.violation_type] || v.violation_type}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-neutral-100 bg-white">
          <button
            onClick={() => onConfirmSelection(isDynamic ? [] : Array.from(localSelectedItems.values()))}
            className="w-full py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors flex justify-center items-center gap-2"
          >
            <CheckSquare className="w-5 h-5" />
            {isDynamic ? '了解并返回' : `确认选择 (${localSelectedItems.size} 人) 并返回`}
          </button>
        </div>
      </div>
    </>
  );
}
