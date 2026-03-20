import React, { useState } from 'react';
import { X, Save, AlertCircle, Clock, EyeOff, TimerReset } from 'lucide-react';
import toast from 'react-hot-toast';

interface BatchEditEquipmentFormProps {
  token: string | null;
  equipmentIds: number[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function BatchEditEquipmentForm({
  token,
  equipmentIds,
  onClose,
  onSuccess
}: BatchEditEquipmentFormProps) {
  const [modifyAdvanceDays, setModifyAdvanceDays] = useState(false);
  const [advanceDays, setAdvanceDays] = useState<number>(7);

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
              <h3 className="text-sm font-bold text-neutral-900">状态与规则设置</h3>
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
            </div>

            <div className="pt-4 border-t border-neutral-200 mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 cursor-pointer">
                    <input type="checkbox" checked={modifyAllowOutOfHours} onChange={e => setModifyAllowOutOfHours(e.target.checked)} className="rounded border-neutral-300 text-red-600 focus:ring-red-600" />
                    <Clock className="w-4 h-4 text-neutral-500" />
                    修改非工作时间预约
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
                    修改释放爽约时段
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
