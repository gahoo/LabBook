import React, { useState } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
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
  const [formData, setFormData] = useState({
    advanceDays: '',
    allowOutOfHours: 'unchanged', // 'unchanged', 'true', 'false'
    is_hidden: 'unchanged', // 'unchanged', 'true', 'false'
    release_noshow_slots: 'unchanged' // 'unchanged', 'true', 'false'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (equipmentIds.length === 0) {
      toast.error('未选择任何仪器');
      return;
    }

    const updates: any = {};
    if (formData.advanceDays !== '') {
      updates.advanceDays = Number(formData.advanceDays);
    }
    if (formData.allowOutOfHours !== 'unchanged') {
      updates.allowOutOfHours = formData.allowOutOfHours === 'true';
    }
    if (formData.is_hidden !== 'unchanged') {
      updates.is_hidden = formData.is_hidden === 'true';
    }
    if (formData.release_noshow_slots !== 'unchanged') {
      updates.release_noshow_slots = formData.release_noshow_slots === 'true';
    }

    if (Object.keys(updates).length === 0) {
      toast.error('未修改任何设置');
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
    <div className="flex flex-col h-full bg-neutral-50">
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-200 shrink-0">
        <div>
          <h2 className="text-xl font-bold text-neutral-900">批量修改仪器设置</h2>
          <p className="text-sm text-neutral-500 mt-1">
            将对选中的 {equipmentIds.length} 台仪器应用以下修改。留空的项将保持原样。
          </p>
        </div>
        <button onClick={onClose} className="p-2 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-full transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <form id="batch-edit-form" onSubmit={handleSubmit} className="space-y-8 max-w-3xl mx-auto">
          
          <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-neutral-100 bg-neutral-50/50">
              <h3 className="font-semibold text-neutral-900">预约规则设置</h3>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">可提前预约天数</label>
                <input 
                  type="number" 
                  min="1" 
                  placeholder="保持原样"
                  value={formData.advanceDays} 
                  onChange={e => setFormData({...formData, advanceDays: e.target.value})} 
                  className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 bg-white text-neutral-900 focus:ring-2 focus:ring-black focus:border-black transition-all" 
                />
                <p className="text-xs text-neutral-500 mt-1">留空则不修改此项</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">允许非工作时间预约</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="allowOutOfHours" value="unchanged" checked={formData.allowOutOfHours === 'unchanged'} onChange={e => setFormData({...formData, allowOutOfHours: e.target.value})} className="text-black focus:ring-black" />
                    <span className="text-sm">保持原样</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="allowOutOfHours" value="true" checked={formData.allowOutOfHours === 'true'} onChange={e => setFormData({...formData, allowOutOfHours: e.target.value})} className="text-black focus:ring-black" />
                    <span className="text-sm">允许</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="allowOutOfHours" value="false" checked={formData.allowOutOfHours === 'false'} onChange={e => setFormData({...formData, allowOutOfHours: e.target.value})} className="text-black focus:ring-black" />
                    <span className="text-sm">不允许</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-neutral-100 bg-neutral-50/50">
              <h3 className="font-semibold text-neutral-900">状态与控制</h3>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">隐藏仪器</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="is_hidden" value="unchanged" checked={formData.is_hidden === 'unchanged'} onChange={e => setFormData({...formData, is_hidden: e.target.value})} className="text-black focus:ring-black" />
                    <span className="text-sm">保持原样</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="is_hidden" value="true" checked={formData.is_hidden === 'true'} onChange={e => setFormData({...formData, is_hidden: e.target.value})} className="text-black focus:ring-black" />
                    <span className="text-sm">隐藏</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="is_hidden" value="false" checked={formData.is_hidden === 'false'} onChange={e => setFormData({...formData, is_hidden: e.target.value})} className="text-black focus:ring-black" />
                    <span className="text-sm">显示</span>
                  </label>
                </div>
                <p className="text-xs text-neutral-500 mt-1">隐藏后，普通用户将无法在预约界面看到此仪器。</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">释放爽约时段</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="release_noshow_slots" value="unchanged" checked={formData.release_noshow_slots === 'unchanged'} onChange={e => setFormData({...formData, release_noshow_slots: e.target.value})} className="text-black focus:ring-black" />
                    <span className="text-sm">保持原样</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="release_noshow_slots" value="true" checked={formData.release_noshow_slots === 'true'} onChange={e => setFormData({...formData, release_noshow_slots: e.target.value})} className="text-black focus:ring-black" />
                    <span className="text-sm">开启 (15分钟)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="release_noshow_slots" value="false" checked={formData.release_noshow_slots === 'false'} onChange={e => setFormData({...formData, release_noshow_slots: e.target.value})} className="text-black focus:ring-black" />
                    <span className="text-sm">关闭 (30分钟)</span>
                  </label>
                </div>
                <p className="text-xs text-neutral-500 mt-1">开启后，若用户迟到15分钟未签到，该预约时段将被释放给其他用户。</p>
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
          className="px-6 py-2.5 text-sm font-medium text-white bg-black rounded-xl hover:bg-neutral-800 transition-colors flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          保存修改
        </button>
      </div>
    </div>
  );
}
