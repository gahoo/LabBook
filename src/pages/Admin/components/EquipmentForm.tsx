import React, { useState } from 'react';
import { Image as ImageIcon, MapPin, Trash2, Upload, Clock, FileCheck, Zap, EyeOff, TimerReset } from 'lucide-react';
import toast from 'react-hot-toast';

interface EquipmentFormProps {
  token: string | null;
  editingEquipment: any;
  setEditingEquipment: (eq: any) => void;
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

export default function EquipmentForm({
  token,
  editingEquipment,
  setEditingEquipment,
  onSuccess
}: EquipmentFormProps) {
  const [formData, setFormData] = useState(() => {
    if (editingEquipment) {
      let avail = { advanceDays: 7, maxDurationMinutes: 60, minDurationMinutes: 30, rules: [], allowOutOfHours: false };
      try {
        if (editingEquipment.availability_json) avail = JSON.parse(editingEquipment.availability_json);
      } catch (e) {}
      
      return {
        name: editingEquipment.name,
        description: editingEquipment.description || '',
        image_url: editingEquipment.image_url || '',
        location: editingEquipment.location || '',
        auto_approve: editingEquipment.auto_approve,
        allow_out_of_hours: avail.allowOutOfHours || false,
        price_type: editingEquipment.price_type,
        price: editingEquipment.price,
        consumable_fee: editingEquipment.consumable_fee || 0,
        whitelist_enabled: editingEquipment.whitelist_enabled,
        whitelist_data: editingEquipment.whitelist_data || '',
        is_hidden: editingEquipment.is_hidden || false,
        release_noshow_slots: editingEquipment.release_noshow_slots || false,
        advanceDays: avail.advanceDays || 7,
        maxDurationMinutes: avail.maxDurationMinutes || 60,
        minDurationMinutes: avail.minDurationMinutes || 30,
        rules: avail.rules || []
      };
    }
    return {
      name: '',
      description: '',
      image_url: '',
      location: '',
      auto_approve: true,
      allow_out_of_hours: false,
      price_type: 'hour',
      price: 0,
      consumable_fee: 0,
      whitelist_enabled: false,
      whitelist_data: '',
      is_hidden: false,
      release_noshow_slots: false,
      advanceDays: 7,
      maxDurationMinutes: 60,
      minDurationMinutes: 30,
      rules: [] as any[]
    };
  });
  const [selectedDays, setSelectedDays] = useState<number[]>([]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Max dimension 800px
        const maxDim = 800;
        if (width > height) {
          if (width > maxDim) {
            height *= maxDim / width;
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width *= maxDim / height;
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        // Compress until < 60KB
        let quality = 0.9;
        let base64 = canvas.toDataURL('image/jpeg', quality);
        while (base64.length > 60 * 1024 && quality > 0.1) {
          quality -= 0.1;
          base64 = canvas.toDataURL('image/jpeg', quality);
        }

        setFormData({ ...formData, image_url: base64 });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const availability_json = JSON.stringify({
      rules: formData.rules,
      advanceDays: formData.advanceDays,
      maxDurationMinutes: formData.maxDurationMinutes,
      minDurationMinutes: formData.minDurationMinutes,
      allowOutOfHours: formData.allow_out_of_hours
    });

    try {
      const url = editingEquipment ? `/api/admin/equipment/${editingEquipment.id}` : '/api/admin/equipment';
      const method = editingEquipment ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ ...formData, availability_json })
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(editingEquipment ? '仪器更新成功！' : '仪器添加成功！');
        setFormData({
          name: '',
          description: '',
          image_url: '',
          location: '',
          auto_approve: true,
          allow_out_of_hours: false,
          price_type: 'hour',
          price: 0,
          consumable_fee: 0,
          whitelist_enabled: false,
          whitelist_data: '',
          is_hidden: false,
          release_noshow_slots: false,
          advanceDays: 7,
          maxDurationMinutes: 60,
          minDurationMinutes: 30,
          rules: []
        });
        setEditingEquipment(null);
        onSuccess();
      }
    } catch (err) {
      toast.error('保存仪器失败');
    }
  };

  return (
    <div className="w-full">
      <form onSubmit={handleAddSubmit} className="space-y-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">仪器名称</label>
            <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" placeholder="例如：扫描电子显微镜" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">仪器描述</label>
            <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" rows={3} placeholder="简要介绍仪器的功能和用途..." />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1 flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-neutral-400" />
                设备图片 (小于 60KB)
              </label>
              <div className="flex items-center gap-2">
                {formData.image_url && <img src={formData.image_url} alt="preview" className="w-10 h-10 object-cover rounded border" />}
                <label className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-neutral-300 hover:border-red-500 cursor-pointer transition-all text-neutral-500 text-sm">
                  <Upload className="w-4 h-4" />
                  上传图片
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-neutral-400" />
                所在位置
              </label>
              <input type="text" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" placeholder="例如：实验楼 302" />
            </div>
          </div>
          
          <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-neutral-900">开放时间设置</h3>
            </div>
            
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">可提前预约天数</label>
                  <input type="number" min="1" value={formData.advanceDays} onChange={e => setFormData({...formData, advanceDays: Number(e.target.value)})} className="w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">单次最小预约时长 (分钟)</label>
                  <input type="number" min="1" value={formData.minDurationMinutes} onChange={e => setFormData({...formData, minDurationMinutes: Number(e.target.value)})} className="w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">单次最大预约时长 (分钟)</label>
                  <input type="number" min="1" value={formData.maxDurationMinutes} onChange={e => setFormData({...formData, maxDurationMinutes: Number(e.target.value)})} className="w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-xs text-neutral-500 mb-2">开放规则</label>
                <div className="space-y-2">
                  {formData.rules.sort((a: any, b: any) => a.day - b.day || a.start.localeCompare(b.start)).map((rule: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-neutral-200">
                      <span className="text-xs font-medium w-12">{daysOfWeek.find(d => d.value === rule.day)?.label}</span>
                      <span className="text-xs text-neutral-500">{rule.start} - {rule.end}</span>
                      <button 
                        type="button" 
                        onClick={() => setFormData({...formData, rules: formData.rules.filter((_: any, i: number) => i !== idx)})}
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
                        <input id="new-rule-start" type="time" className="flex-1 px-2 py-1.5 text-xs border border-neutral-300 rounded bg-white" defaultValue="08:00" />
                        <span className="text-xs">至</span>
                        <input id="new-rule-end" type="time" className="flex-1 px-2 py-1.5 text-xs border border-neutral-300 rounded bg-white" defaultValue="18:00" />
                      </div>
                      <button 
                        type="button"
                        onClick={() => {
                          if (selectedDays.length === 0) return toast.error('请至少选择一天');
                          const start = (document.getElementById('new-rule-start') as HTMLInputElement).value;
                          const end = (document.getElementById('new-rule-end') as HTMLInputElement).value;
                          if (start >= end) return toast.error('结束时间必须晚于开始时间');
                          
                          const newRules = selectedDays.map(day => ({ day, start, end }));
                          setFormData({...formData, rules: [...formData.rules, ...newRules]});
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
            </div>

            <div className="pt-4 border-t border-neutral-200 mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-neutral-700 flex items-center gap-1.5">
                    <FileCheck className="w-4 h-4 text-neutral-500" />
                    人员白名单
                  </h3>
                  <p className="text-xs text-neutral-500 mt-0.5">仅允许白名单内的人员预约此仪器</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData({...formData, whitelist_enabled: !formData.whitelist_enabled})}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${formData.whitelist_enabled ? 'bg-red-600' : 'bg-neutral-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.whitelist_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              
              {formData.whitelist_enabled && (
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">白名单人员名单 (按姓名，逗号或换行分隔)</label>
                  <textarea
                    value={formData.whitelist_data}
                    onChange={e => setFormData({...formData, whitelist_data: e.target.value})}
                    className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all text-sm"
                    rows={3}
                    placeholder="例如：张三, 李四, 王五"
                  />
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-neutral-200 mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-neutral-700 flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-neutral-500" />
                    自动审批预约
                  </h3>
                  <p className="text-xs text-neutral-500 mt-0.5">开启后，预约将自动通过审批</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData({...formData, auto_approve: !formData.auto_approve})}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${formData.auto_approve ? 'bg-red-600' : 'bg-neutral-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.auto_approve ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-neutral-700 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-neutral-500" />
                    允许可预约时段外预约
                  </h3>
                  <p className="text-xs text-neutral-500 mt-0.5">开启后，用户可选择非开放时段，但需要管理员审批</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData({...formData, allow_out_of_hours: !formData.allow_out_of_hours})}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${formData.allow_out_of_hours ? 'bg-red-600' : 'bg-neutral-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.allow_out_of_hours ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-neutral-700 flex items-center gap-1.5">
                    <EyeOff className="w-4 h-4 text-neutral-500" />
                    隐藏仪器
                  </h3>
                  <p className="text-xs text-neutral-500 mt-0.5">开启后，该仪器将在用户端隐藏，且无法被预约</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData({...formData, is_hidden: !formData.is_hidden})}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${formData.is_hidden ? 'bg-red-600' : 'bg-neutral-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_hidden ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-neutral-700 flex items-center gap-1.5">
                    <TimerReset className="w-4 h-4 text-neutral-500" />
                    自动释放爽约时段
                  </h3>
                  <p className="text-xs text-neutral-500 mt-0.5">开启后，若预约爽约(超过开始时间30分钟未上机)，该时段将自动释放给其他人预约</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData({...formData, release_noshow_slots: !formData.release_noshow_slots})}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${formData.release_noshow_slots ? 'bg-red-600' : 'bg-neutral-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.release_noshow_slots ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">计费方式</label>
              <select value={formData.price_type} onChange={e => setFormData({...formData, price_type: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all bg-white">
                <option value="hour">按小时</option>
                <option value="use">按次</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">价格 (¥)</label>
              <input required type="number" min="0" step="0.01" value={formData.price} onChange={e => setFormData({...formData, price: Number(e.target.value)})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">耗材费 (¥/个, 可选)</label>
            <input type="number" min="0" step="0.01" value={formData.consumable_fee} onChange={e => setFormData({...formData, consumable_fee: Number(e.target.value)})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" />
          </div>
        </div>

        <button type="submit" className="w-full py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors">
          {editingEquipment ? '更新仪器' : '保存仪器'}
        </button>
      </form>
    </div>
  );
}
