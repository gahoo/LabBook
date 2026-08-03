import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { X, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  reservation: any;
  token: string | null;
  onUpdate: () => void;
}

export default function ReservationEditDrawer({ isOpen, onClose, reservation, token, onUpdate }: Props) {
  const [activeTab, setActiveTab] = useState<'info' | 'execution' | 'violations'>('info');
  const [formData, setFormData] = useState<any>({});
  const [manualViolations, setManualViolations] = useState<any[]>([]);
  const [systemViolations, setSystemViolations] = useState<any[]>([]);

  useEffect(() => {
    if (reservation) {
      setFormData({ ...reservation });
      fetchViolations();
    }
  }, [reservation, isOpen]);

  const fetchViolations = async () => {
    if (!reservation || !token) return;
    try {
      const res = await fetch(`/api/admin/violations?reservation_id=${reservation.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const active = data.filter((v: any) => v.status === 'active');
        const sys = active.filter((v: any) => ['late', 'overdue', 'no-show'].includes(v.violation_type));
        const man = active.filter((v: any) => !['late', 'overdue', 'no-show'].includes(v.violation_type)).map((v: any) => {
          let remarkObj = { admin_note: v.remark };
          try {
            const parsed = JSON.parse(v.remark);
            if (parsed.admin_note) remarkObj = parsed;
          } catch (e) {}
          return {
            id: v.id,
            type: v.violation_type,
            remark: remarkObj.admin_note || ''
          };
        });
        setSystemViolations(sys);
        setManualViolations(man);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdate = async (type: 'info' | 'execution') => {
    if (!token || !reservation) return;
    try {
      
      const payload: any = {};
      
      const toUTC = (localStr: string) => {
        if (!localStr) return null;
        return new Date(localStr).toISOString();
      };

      if (type === 'info') {
        payload.student_name = formData.student_name;
        payload.student_id = formData.student_id;
        payload.supervisor = formData.supervisor;
        payload.phone = formData.phone;
        payload.email = formData.email;
        payload.start_time = toUTC(formData.start_time);
        payload.end_time = toUTC(formData.end_time);
        payload.status = formData.status;
      } else if (type === 'execution') {
        payload.actual_start_time = toUTC(formData.actual_start_time);
        payload.actual_end_time = toUTC(formData.actual_end_time);
        payload.consumable_quantity = formData.consumable_quantity;
        payload.notes = formData.notes;
      }


      const res = await fetch(`/api/admin/reservations/${reservation.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        toast.success('保存成功');
        onUpdate();
        if (type === 'info') onClose(); // optionally close, let's just close
        if (type === 'execution') fetchViolations();
      } else {
        const error = await res.json();
        toast.error(error.error || '保存失败');
      }
    } catch (e: any) {
      toast.error(e.message || '保存失败');
    }
  };

  const handleSaveViolations = async () => {
    if (!token || !reservation) return;
    try {
      for (const mv of manualViolations) {
        if (!mv.id) {
          // create
          const res = await fetch('/api/admin/violations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
              student_id: reservation.student_id,
              booking_code: reservation.booking_code,
              violation_type: mv.type,
              violation_time: new Date().toISOString(),
              admin_note: mv.remark
            })
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || '保存失败');
          }
        } else {
          // update
          const res = await fetch(`/api/admin/violations/${mv.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
              violation_type: mv.type,
              remark: mv.remark
            })
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || '保存失败');
          }
        }
      }
      toast.success('违规记录保存成功');
      onUpdate();
      onClose();
    } catch (e) {
      toast.error('保存失败');
    }
  };

  const handleRevokeViolation = async (id: number) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/violations/${id}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ admin_note: '后台手动撤销' })
      });
      if (res.ok) {
        toast.success('已撤销违规');
        fetchViolations();
        onUpdate();
      } else {
        toast.error('撤销失败');
      }
    } catch (e) {
      toast.error('撤销失败');
    }
  };

  if (!reservation) return null;

  return (
    <>
      <div 
        className={`fixed inset-0 bg-black/50 z-50 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <div 
        className={`fixed top-0 right-0 h-full w-full sm:w-[500px] md:w-[600px] bg-white z-50 shadow-2xl transform transition-transform duration-300 ease-in-out overflow-y-auto ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-neutral-900">编辑预约记录</h2>
          <button 
            onClick={onClose}
            className="p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="border-b border-neutral-200 bg-white sticky top-[65px] z-10 px-4">
          <div className="flex gap-6">
            <button
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'info' ? 'border-red-600 text-red-600' : 'border-transparent text-neutral-500 hover:text-neutral-700'}`}
              onClick={() => setActiveTab('info')}
            >
              预约信息
            </button>
            <button
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'execution' ? 'border-red-600 text-red-600' : 'border-transparent text-neutral-500 hover:text-neutral-700'}`}
              onClick={() => setActiveTab('execution')}
            >
              上机信息
            </button>
            <button
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'violations' ? 'border-red-600 text-red-600' : 'border-transparent text-neutral-500 hover:text-neutral-700'}`}
              onClick={() => setActiveTab('violations')}
            >
              违规记录
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6 pb-24">
          {activeTab === 'info' && (
            <form onSubmit={e => { e.preventDefault(); handleUpdate('info'); }} className="space-y-4">
              <div className="bg-neutral-50 p-4 rounded-xl mb-6 space-y-1.5">
                <p className="text-sm text-neutral-500">预约码: <span className="font-mono text-neutral-900">{formData.booking_code}</span></p>
                {formData.created_at && (
                  <p className="text-sm text-neutral-500">提交时间: <span className="text-neutral-900">{format(new Date(formData.created_at + (formData.created_at.includes('Z') ? '' : 'Z')), 'yyyy-MM-dd HH:mm:ss')}</span></p>
                )}
                <p className="text-sm text-neutral-500">仪器: <span className="text-neutral-900">{formData.equipment_name}</span></p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">姓名</label>
                  <input type="text" value={formData.student_name || ''} onChange={e => setFormData({...formData, student_name: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-neutral-300" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">学号</label>
                  <input type="text" value={formData.student_id || ''} onChange={e => setFormData({...formData, student_id: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-neutral-300" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">导师</label>
                  <input type="text" value={formData.supervisor || ''} onChange={e => setFormData({...formData, supervisor: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-neutral-300" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">联系电话</label>
                  <input type="text" value={formData.phone || ''} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-neutral-300" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-neutral-500 mb-1">邮箱</label>
                  <input type="email" value={formData.email || ''} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-neutral-300" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">预约开始时间</label>
                  <input type="datetime-local" step="300" value={formData.start_time || ''} onChange={e => setFormData({...formData, start_time: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-neutral-300" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">预约结束时间</label>
                  <input type="datetime-local" step="300" value={formData.end_time || ''} onChange={e => setFormData({...formData, end_time: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-neutral-300" required />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-neutral-500 mb-1">状态</label>
                  <select value={formData.status || ''} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-neutral-300 bg-white">
                    <option value="pending">待审批</option>
                    <option value="approved">已通过</option>
                    <option value="active">进行中</option>
                    <option value="completed">已完成</option>
                    <option value="cancelled">已取消</option>
                    <option value="rejected">已驳回</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-4 mt-8 pt-4">
                <button type="button" onClick={onClose} className="flex-1 py-3 border border-neutral-300 rounded-xl font-medium hover:bg-neutral-50">取消</button>
                <button type="submit" className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700">保存修改</button>
              </div>
            </form>
          )}

          {activeTab === 'execution' && (
            <form onSubmit={e => { e.preventDefault(); handleUpdate('execution'); }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">实际上机时间</label>
                  <input 
                    type="datetime-local" 
                    step="300"
                    value={formData.actual_start_time || ''} 
                    onChange={e => setFormData({...formData, actual_start_time: e.target.value})} 
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">实际下机时间</label>
                  <input 
                    type="datetime-local" 
                    step="300"
                    value={formData.actual_end_time || ''} 
                    onChange={e => setFormData({...formData, actual_end_time: e.target.value})} 
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300" 
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">耗材数量</label>
                <input 
                  type="number" 
                  min="0"
                  value={formData.consumable_quantity || 0} 
                  onChange={e => setFormData({...formData, consumable_quantity: Number(e.target.value)})} 
                  className="w-full px-4 py-2 rounded-xl border border-neutral-300" 
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">备注</label>
                <textarea 
                  rows={3}
                  value={formData.notes || ''} 
                  onChange={e => setFormData({...formData, notes: e.target.value})} 
                  className="w-full px-4 py-2 rounded-xl border border-neutral-300 resize-none"
                  placeholder="添加备注信息..."
                />
              </div>

              <div className="flex gap-4 mt-8 pt-4">
                <button type="button" onClick={onClose} className="flex-1 py-3 border border-neutral-300 rounded-xl font-medium hover:bg-neutral-50">取消</button>
                <button type="submit" className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700">保存执行记录</button>
              </div>
            </form>
          )}

          {activeTab === 'violations' && (
            <div className="space-y-6">
              {systemViolations.length > 0 && (
                <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4">
                  <h3 className="text-sm font-bold text-neutral-800 mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-neutral-500" /> 系统检测违规
                  </h3>
                  <div className="space-y-2">
                    {systemViolations.map((sv, i) => (
                      <div key={i} className="text-sm text-neutral-900 bg-white border border-neutral-200 px-3 py-2 rounded-lg flex items-center justify-between shadow-sm">
                        <div>
                          <span className="font-medium mr-2">
                            {sv.violation_type === 'late' ? '迟到' : sv.violation_type === 'overdue' ? '超时' : '爽约'}
                          </span>
                          <span className="text-neutral-500 text-xs">
                            (发生于 {format(new Date(sv.violation_time + (sv.violation_time.includes('Z') ? '' : 'Z')), 'yyyy-MM-dd HH:mm')})
                          </span>
                        </div>
                        {sv.duration_minutes && <span className="text-xs font-mono">{sv.duration_minutes} 分钟</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-neutral-900">人工违规标记</h3>
                  <button
                    type="button"
                    onClick={() => setManualViolations([...manualViolations, { id: null, type: 'hygiene_issue', remark: '' }])}
                    className="text-sm text-red-600 hover:text-red-700 font-medium flex items-center gap-1 bg-red-50 px-3 py-1.5 rounded-lg"
                  >
                    + 新增违规记录
                  </button>
                </div>
                
                <div className="space-y-4">
                  {manualViolations.map((mv, index) => (
                    <div key={index} className="p-4 bg-red-50/50 border border-red-100 rounded-xl relative">
                      <button
                        type="button"
                        onClick={() => {
                          if (mv.id) {
                            handleRevokeViolation(mv.id);
                          } else {
                            const newMvs = [...manualViolations];
                            newMvs.splice(index, 1);
                            setManualViolations(newMvs);
                          }
                        }}
                        className="absolute top-4 right-4 text-neutral-400 hover:text-red-600 transition-colors"
                        title="撤销/删除此违规"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      
                      <div className="space-y-3 pr-8">
                        <div>
                          <label className="block text-xs font-medium text-neutral-600 mb-1">违规类型</label>
                          <select
                            value={mv.type}
                            onChange={e => {
                              const newMvs = [...manualViolations];
                              newMvs[index].type = e.target.value;
                              setManualViolations(newMvs);
                            }}
                            className="w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-sm"
                          >
                            <option value="hygiene_issue">卫生不达标</option>
                            <option value="improper_operation">违规操作</option>
                            <option value="proxy_booking">代预约</option>
                            <option value="other_manual">其他违规</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-neutral-600 mb-1">违规说明 <span className="text-red-500">*</span></label>
                          <textarea
                            rows={2}
                            value={mv.remark}
                            onChange={e => {
                              const newMvs = [...manualViolations];
                              newMvs[index].remark = e.target.value;
                              setManualViolations(newMvs);
                            }}
                            placeholder="请详细描述违规情况..."
                            className="w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-sm resize-none"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  {manualViolations.length === 0 && (
                    <div className="text-center py-6 bg-neutral-50 rounded-xl border border-neutral-200 border-dashed">
                      <p className="text-sm text-neutral-500">暂无手动标记的违规记录</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-4 mt-8 pt-4">
                <button type="button" onClick={onClose} className="flex-1 py-3 border border-neutral-300 rounded-xl font-medium hover:bg-neutral-50">取消</button>
                <button type="button" onClick={handleSaveViolations} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700">保存违规记录</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
