import React, { useState } from 'react';
import { X, Save, AlertCircle, Clock, EyeOff, TimerReset, FileCheck, Zap, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface BatchEditEquipmentFormProps {
  token: string | null;
  equipmentIds: number[];
  onClose: () => void;
  onSuccess: () => void;
}

const daysOfWeek = [
  { label: '周日', value: 0 },
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
];

export default function BatchEditEquipmentForm({
  token,
  equipmentIds,
  onClose,
  onSuccess
}: BatchEditEquipmentFormProps) {
  const [modifyAdvanceDays, setModifyAdvanceDays] = useState(false);
  const [advanceDays, setAdvanceDays] = useState<number>(7);

  const [modifyDuration, setModifyDuration] = useState(false);
  const [minDurationMinutes, setMinDurationMinutes] = useState<number>(30);
  const [maxDurationMinutes, setMaxDurationMinutes] = useState<number>(60);

  const [modifyRules, setModifyRules] = useState(false);
  const [rules, setRules] = useState<any[]>([]);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);

  const [modifyWhitelist, setModifyWhitelist] = useState(false);
  const [whitelistEnabled, setWhitelistEnabled] = useState(false);
  const [whitelistData, setWhitelistData] = useState('');

  const [modifyAutoApprove, setModifyAutoApprove] = useState(false);
  const [autoApprove, setAutoApprove] = useState(true);

  const [modifyAllowOutOfHours, setModifyAllowOutOfHours] = useState(false);
  const [allowOutOfHours, setAllowOutOfHours] = useState(false);

  const [modifyIsHidden, setModifyIsHidden] = useState(false);
  const [isHidden, setIsHidden] = useState(false);

  const [modifyReleaseNoshow, setModifyReleaseNoshow] = useState(false);
  const [releaseNoshow, setReleaseNoshow] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (equipmentIds.length === 0) {
      toast.error('未选择任何仪器');
      return;
    }

    const updates: any = {};
    if (modifyAdvanceDays) updates.advanceDays = advanceDays;
    if (modifyDuration) {
      updates.minDurationMinutes = minDurationMinutes;
      updates.maxDurationMinutes = maxDurationMinutes;
    }
    if (modifyRules) updates.rules = rules;
    if (modifyWhitelist) {
      updates.whitelist_enabled = whitelistEnabled;
      updates.whitelist_data = whitelistData;
    }
    if (modifyAutoApprove) updates.auto_approve = autoApprove;
    if (modifyAllowOutOfHours) updates.allowOutOfHours = allowOutOfHours;
    if (modifyIsHidden) updates.is_hidden = isHidden;
    if (modifyReleaseNoshow) updates.release_noshow_slots = releaseNoshow;

    if (Object.keys(updates).length === 0) {
      toast.error('未选择任何要修改的设置');
      return;
    }

    try {
      const res = await fetch('/api/admin/equipment-batch', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ids: equipmentIds,
          updates
        })
      });

      if (res.ok) {
        toast.success(`成功批量更新 ${equipmentIds.length} 台仪器`);
        onSuccess();
      } else {
        const data = await res.json();
        toast.error(data.error || '批量更新失败');
      }
    } catch (err) {
      toast.error('批量更新失败');
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
        <div>
          <h2 className="text-xl font-bold text-neutral-900">批量修改仪器设置</h2>
          <p className="text-sm text-neutral-500 mt-1">
            将对选中的 {equipmentIds.length} 台仪器应用以下修改。未勾选的项将保持原样。
          </p>
        </div>
        <button onClick={onClose} className="p-2 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-full transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <form id="batch-edit-form" onSubmit={handleSubmit} className="space-y-6 max-w-3xl mx-auto w-full">
          
          <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-neutral-900">开放时间设置</h3>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 cursor-pointer">
                    <input type="checkbox" checked={modifyAdvanceDays} onChange={e => setModifyAdvanceDays(e.target.checked)} className="rounded border-neutral-300 text-red-600 focus:ring-red-600" />
                    修改可提前预约天数
                  </label>
                </div>
                {modifyAdvanceDays && (
                  <input 
                    type="number" 
                    min="1" 
                    value={advanceDays} 
                    onChange={e => setAdvanceDays(Number(e.target.value))} 
                    className="w-32 px-3 py-1.5 rounded-lg border border-neutral-300 text-sm focus:ring-2 focus:ring-red-600 focus:border-red-600 transition-all bg-white" 
                  />
                )}
              </div>

              <div className="flex items-start justify-between flex-col sm:flex-row sm:items-center gap-4">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 cursor-pointer">
                    <input type="checkbox" checked={modifyDuration} onChange={e => setModifyDuration(e.target.checked)} className="rounded border-neutral-300 text-red-600 focus:ring-red-600" />
                    修改单次预约时长限制
                  </label>
                </div>
                {modifyDuration && (
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="flex-1 sm:w-32">
                      <label className="block text-[10px] text-neutral-500 mb-1">最小 (分钟)</label>
                      <input 
                        type="number" 
                        min="1" 
                        value={minDurationMinutes} 
                        onChange={e => setMinDurationMinutes(Number(e.target.value))} 
                        className="w-full px-3 py-1.5 rounded-lg border border-neutral-300 text-sm focus:ring-2 focus:ring-red-600 focus:border-red-600 transition-all bg-white" 
                      />
                    </div>
                    <div className="flex-1 sm:w-32">
                      <label className="block text-[10px] text-neutral-500 mb-1">最大 (分钟)</label>
                      <input 
                        type="number" 
                        min="1" 
                        value={maxDurationMinutes} 
                        onChange={e => setMaxDurationMinutes(Number(e.target.value))} 
                        className="w-full px-3 py-1.5 rounded-lg border border-neutral-300 text-sm focus:ring-2 focus:ring-red-600 focus:border-red-600 transition-all bg-white" 
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-start justify-between flex-col gap-4">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 cursor-pointer">
                    <input type="checkbox" checked={modifyRules} onChange={e => setModifyRules(e.target.checked)} className="rounded border-neutral-300 text-red-600 focus:ring-red-600" />
                    修改开放规则
                  </label>
                  <p className="text-xs text-neutral-500 mt-0.5 ml-6">勾选后，将用以下规则<span className="text-red-600 font-medium">覆盖</span>选中仪器的原有规则</p>
                </div>
                {modifyRules && (
                  <div className="w-full pl-6">
                    <div className="space-y-2">
                      {rules.sort((a: any, b: any) => a.day - b.day || a.start.localeCompare(b.start)).map((rule: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-neutral-200">
                          <span className="text-xs font-medium w-12">{daysOfWeek.find(d => d.value === rule.day)?.label}</span>
                          <span className="text-xs text-neutral-500">{rule.start} - {rule.end}</span>
                          <button 
                            type="button" 
                            onClick={() => setRules(rules.filter((_: any, i: number) => i !== idx))}
                            className="ml-auto text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      
                      <div className="p-3 bg-white rounded-xl border border-neutral-200 space-y-3">
                        <div className="flex flex-wrap gap-2">
                          {daysOfWeek.map(d => (
                            <button
                              key={d.value}
                              type="button"
                              onClick={() => {
                                if (selectedDays.includes(d.value)) {
                                  setSelectedDays(selectedDays.filter(v => v !== d.value));
                                } else {
                                  setSelectedDays([...selectedDays, d.value]);
                                }
                              }}
                              className={`px-2 py-1 text-xs rounded-md border transition-colors ${selectedDays.includes(d.value) ? 'bg-red-600 border-red-600 text-white' : 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:border-red-300'}`}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                          <div className="flex items-center gap-2 w-full sm:w-auto flex-1">
                            <input id="batch-new-rule-start" type="time" className="flex-1 px-2 py-1.5 text-xs border border-neutral-300 rounded bg-white" defaultValue="08:00" />
                            <span className="text-xs">至</span>
                            <input id="batch-new-rule-end" type="time" className="flex-1 px-2 py-1.5 text-xs border border-neutral-300 rounded bg-white" defaultValue="18:00" />
                          </div>
                          <button 
                            type="button"
                            onClick={() => {
                              if (selectedDays.length === 0) return toast.error('请至少选择一天');
                              const start = (document.getElementById('batch-new-rule-start') as HTMLInputElement).value;
                              const end = (document.getElementById('batch-new-rule-end') as HTMLInputElement).value;
                              if (start >= end) return toast.error('结束时间必须晚于开始时间');
                              
                              const newRules = selectedDays.map(day => ({ day, start, end }));
                              setRules([...rules, ...newRules]);
                              setSelectedDays([]);
                            }}
                            className="w-full sm:w-auto px-4 py-1.5 bg-neutral-900 text-white text-xs rounded-lg hover:bg-neutral-800"
                          >
                            批量添加
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-neutral-200 mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 cursor-pointer">
                    <input type="checkbox" checked={modifyWhitelist} onChange={e => setModifyWhitelist(e.target.checked)} className="rounded border-neutral-300 text-red-600 focus:ring-red-600" />
                    <FileCheck className="w-4 h-4 text-neutral-500" />
                    修改人员白名单
                  </label>
                  <p className="text-xs text-neutral-500 mt-0.5 ml-6">仅允许白名单内的人员预约此仪器</p>
                </div>
                {modifyWhitelist && (
                  <button
                    type="button"
                    onClick={() => setWhitelistEnabled(!whitelistEnabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${whitelistEnabled ? 'bg-red-600' : 'bg-neutral-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${whitelistEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                )}
              </div>
              
              {modifyWhitelist && whitelistEnabled && (
                <div className="pl-6">
                  <label className="block text-xs text-neutral-500 mb-1">白名单人员名单 (按姓名，逗号或换行分隔)</label>
                  <textarea
                    value={whitelistData}
                    onChange={e => setWhitelistData(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all text-sm bg-white"
                    rows={3}
                    placeholder="例如：张三, 李四, 王五"
                  />
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-neutral-200 mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 cursor-pointer">
                    <input type="checkbox" checked={modifyAutoApprove} onChange={e => setModifyAutoApprove(e.target.checked)} className="rounded border-neutral-300 text-red-600 focus:ring-red-600" />
                    <Zap className="w-4 h-4 text-neutral-500" />
                    修改自动审批预约
                  </label>
                  <p className="text-xs text-neutral-500 mt-0.5 ml-6">开启后，预约将自动通过审批</p>
                </div>
                {modifyAutoApprove && (
                  <button
                    type="button"
                    onClick={() => setAutoApprove(!autoApprove)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${autoApprove ? 'bg-red-600' : 'bg-neutral-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoApprove ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 cursor-pointer">
                    <input type="checkbox" checked={modifyAllowOutOfHours} onChange={e => setModifyAllowOutOfHours(e.target.checked)} className="rounded border-neutral-300 text-red-600 focus:ring-red-600" />
                    <Clock className="w-4 h-4 text-neutral-500" />
                    修改允许可预约时段外预约
                  </label>
                  <p className="text-xs text-neutral-500 mt-0.5 ml-6">开启后，用户可选择非开放时段，但需要管理员审批</p>
                </div>
                {modifyAllowOutOfHours && (
                  <button
                    type="button"
                    onClick={() => setAllowOutOfHours(!allowOutOfHours)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${allowOutOfHours ? 'bg-red-600' : 'bg-neutral-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${allowOutOfHours ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                )}
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 cursor-pointer">
                    <input type="checkbox" checked={modifyIsHidden} onChange={e => setModifyIsHidden(e.target.checked)} className="rounded border-neutral-300 text-red-600 focus:ring-red-600" />
                    <EyeOff className="w-4 h-4 text-neutral-500" />
                    修改隐藏状态
                  </label>
                  <p className="text-xs text-neutral-500 mt-0.5 ml-6">隐藏后，普通用户将无法在预约界面看到此仪器</p>
                </div>
                {modifyIsHidden && (
                  <button
                    type="button"
                    onClick={() => setIsHidden(!isHidden)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isHidden ? 'bg-red-600' : 'bg-neutral-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isHidden ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 cursor-pointer">
                    <input type="checkbox" checked={modifyReleaseNoshow} onChange={e => setModifyReleaseNoshow(e.target.checked)} className="rounded border-neutral-300 text-red-600 focus:ring-red-600" />
                    <TimerReset className="w-4 h-4 text-neutral-500" />
                    修改自动释放爽约时段
                  </label>
                  <p className="text-xs text-neutral-500 mt-0.5 ml-6">
                    报表中超过15分钟算迟到，超过30分钟算爽约。<br/>
                    开启此选项后，若用户爽约（超过30分钟未签到），系统将自动释放该时段给其他用户。
                  </p>
                </div>
                {modifyReleaseNoshow && (
                  <button
                    type="button"
                    onClick={() => setReleaseNoshow(!releaseNoshow)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${releaseNoshow ? 'bg-red-600' : 'bg-neutral-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${releaseNoshow ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                )}
              </div>
            </div>
          </div>

        </form>
      </div>

      <div className="px-6 py-4 bg-white border-t border-neutral-200 shrink-0 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="px-6 py-2.5 text-sm font-medium text-neutral-700 bg-white border border-neutral-300 rounded-xl hover:bg-neutral-50 transition-colors"
        >
          取消
        </button>
        <button
          type="submit"
          form="batch-edit-form"
          className="px-6 py-2.5 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          保存修改
        </button>
      </div>
    </div>
  );
}
