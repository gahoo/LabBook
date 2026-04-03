import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Plus, Edit2, Trash2, AlertCircle } from 'lucide-react';

interface PenaltyRule {
  id: number;
  name: string;
  description: string;
  trigger_type: string;
  threshold: number;
  window_type: string;
  window_value: number;
  window_unit: string;
  duration_type: string;
  duration_value: number | null;
  duration_unit: string | null;
  is_active: number;
  penalty_method: string;
}

interface PenaltyRulesTabProps {
  token: string;
}

export default function PenaltyRulesTab({ token }: PenaltyRulesTabProps) {
  const [rules, setRules] = useState<PenaltyRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<PenaltyRule | null>(null);

  const [formData, setFormData] = useState<Partial<PenaltyRule>>({
    name: '',
    description: '',
    trigger_type: 'late',
    threshold: 1,
    window_type: 'ROLLING',
    window_value: 30,
    window_unit: 'days',
    duration_type: 'FIXED',
    duration_value: 7,
    duration_unit: 'days',
    is_active: 1,
    penalty_method: 'BAN'
  });

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    try {
      const res = await fetch('/api/admin/penalty-rules', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) {
        throw new Error('Failed to fetch');
      }
      const data = await res.json();
      if (Array.isArray(data)) {
        setRules(data);
      } else {
        console.error('Failed to fetch penalty rules:', data);
        toast.error('获取惩罚规则失败');
      }
    } catch (err) {
      toast.error('获取惩罚规则失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenModal = (rule?: PenaltyRule) => {
    if (rule) {
      setEditingRule(rule);
      setFormData(rule);
    } else {
      setEditingRule(null);
      setFormData({
        name: '',
        description: '',
        trigger_type: 'late',
        threshold: 1,
        window_type: 'ROLLING',
        window_value: 30,
        window_unit: 'days',
        duration_type: 'FIXED',
        duration_value: 7,
        duration_unit: 'days',
        is_active: 1,
        penalty_method: 'BAN'
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingRule(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingRule 
        ? `/api/admin/penalty-rules/${editingRule.id}`
        : '/api/admin/penalty-rules';
      
      const method = editingRule ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      if (res.ok) {
        toast.success(editingRule ? '规则更新成功' : '规则创建成功');
        handleCloseModal();
        fetchRules();
      } else {
        toast.error('保存失败');
      }
    } catch (err) {
      toast.error('保存失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除此规则吗？')) return;
    try {
      const res = await fetch(`/api/admin/penalty-rules/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        toast.success('删除成功');
        fetchRules();
      } else {
        toast.error('删除失败');
      }
    } catch (err) {
      toast.error('删除失败');
    }
  };

  const triggerTypeMap: Record<string, string> = {
    late: '迟到',
    overdue: '超时',
    'no-show': '爽约',
    late_cancel: '晚取消'
  };

  const windowTypeMap: Record<string, string> = {
    ROLLING: '滚动窗口',
    NATURAL: '自然周期'
  };

  const unitMap: Record<string, string> = {
    days: '天',
    weeks: '周',
    months: '月'
  };

  const durationTypeMap: Record<string, string> = {
    FIXED: '固定时长',
    DYNAMIC: '动态持续'
  };

  const penaltyMethodMap: Record<string, string> = {
    BAN: '直接封禁',
    REQUIRE_APPROVAL: '需管理员审批'
  };

  if (isLoading) {
    return <div className="p-8 text-center text-neutral-500">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium text-neutral-900">惩罚规则管理</h3>
          <p className="text-sm text-neutral-500 mt-1">设置用户违规行为的自动惩罚机制</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建规则
        </button>
      </div>

      <div className="grid gap-4">
        {rules.map(rule => (
          <div key={rule.id} className={`p-5 rounded-xl border ${rule.is_active ? 'border-neutral-200 bg-white' : 'border-neutral-200 bg-neutral-50 opacity-75'}`}>
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-medium text-neutral-900">{rule.name}</h4>
                  {!rule.is_active && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-neutral-200 text-neutral-600">已停用</span>
                  )}
                </div>
                {rule.description && (
                  <p className="text-sm text-neutral-500 mt-1">{rule.description}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2 text-sm text-neutral-600">
                  <span className="px-2.5 py-1 rounded-lg bg-red-50 text-red-700 border border-red-100">
                    触发条件: {windowTypeMap[rule.window_type]} {rule.window_value} {unitMap[rule.window_unit]}内，{triggerTypeMap[rule.trigger_type]} {rule.threshold} 次
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-orange-50 text-orange-700 border border-orange-100">
                    惩罚方式: {durationTypeMap[rule.duration_type]}
                    {rule.duration_type === 'FIXED' && ` (${rule.duration_value} ${unitMap[rule.duration_unit || 'days']})`}
                    {' - '}{penaltyMethodMap[rule.penalty_method || 'BAN']}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleOpenModal(rule)}
                  className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(rule.id)}
                  className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {rules.length === 0 && (
          <div className="text-center py-12 bg-white rounded-xl border border-neutral-200">
            <AlertCircle className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
            <p className="text-neutral-500">暂无惩罚规则</p>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-neutral-200 flex justify-between items-center sticky top-0 bg-white z-10">
              <h2 className="text-xl font-bold text-neutral-900">
                {editingRule ? '编辑规则' : '新建规则'}
              </h2>
              <button onClick={handleCloseModal} className="p-2 hover:bg-neutral-100 rounded-full transition-colors">
                <Trash2 className="w-5 h-5 text-neutral-500" />
              </button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-neutral-700 mb-1">规则名称</label>
                  <input
                    required
                    type="text"
                    value={formData.name || ''}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none"
                    placeholder="例如：频繁超时封禁"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-neutral-700 mb-1">规则描述 (可选)</label>
                  <input
                    type="text"
                    value={formData.description || ''}
                    onChange={e => setFormData({...formData, description: e.target.value})}
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">违规类型</label>
                  <select
                    value={formData.trigger_type}
                    onChange={e => setFormData({...formData, trigger_type: e.target.value})}
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none bg-white"
                  >
                    <option value="late">迟到</option>
                    <option value="overdue">超时</option>
                    <option value="no-show">爽约</option>
                    <option value="late_cancel">晚取消</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">触发阈值 (次)</label>
                  <input
                    required
                    type="number"
                    min="1"
                    value={formData.threshold || 1}
                    onChange={e => setFormData({...formData, threshold: parseInt(e.target.value)})}
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">统计窗口类型</label>
                  <select
                    value={formData.window_type}
                    onChange={e => setFormData({...formData, window_type: e.target.value})}
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none bg-white"
                  >
                    <option value="ROLLING">滚动窗口 (如过去30天)</option>
                    <option value="NATURAL">自然周期 (如本自然月)</option>
                  </select>
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-neutral-700 mb-1">窗口长度</label>
                    <input
                      required
                      type="number"
                      min="1"
                      value={formData.window_value || 1}
                      onChange={e => setFormData({...formData, window_value: parseInt(e.target.value)})}
                      className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-neutral-700 mb-1">单位</label>
                    <select
                      value={formData.window_unit}
                      onChange={e => setFormData({...formData, window_unit: e.target.value})}
                      className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none bg-white"
                    >
                      <option value="days">天</option>
                      <option value="weeks">周</option>
                      <option value="months">月</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">惩罚类型</label>
                  <select
                    value={formData.duration_type}
                    onChange={e => setFormData({...formData, duration_type: e.target.value})}
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none bg-white"
                  >
                    <option value="FIXED">固定时长封禁</option>
                    <option value="DYNAMIC">动态持续限制</option>
                  </select>
                  <p className="text-xs text-neutral-500 mt-1">
                    {formData.duration_type === 'FIXED' ? '触发后封禁固定时间。' : '只要统计窗口内违规次数达标就一直限制。'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">惩罚方式</label>
                  <select
                    value={formData.penalty_method || 'BAN'}
                    onChange={e => setFormData({...formData, penalty_method: e.target.value})}
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none bg-white"
                  >
                    <option value="BAN">直接封禁 (无法预约)</option>
                    <option value="REQUIRE_APPROVAL">需管理员审批 (可预约但状态为待审批)</option>
                  </select>
                </div>

                {formData.duration_type === 'FIXED' && (
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-neutral-700 mb-1">惩罚时长</label>
                      <input
                        required
                        type="number"
                        min="1"
                        value={formData.duration_value || 1}
                        onChange={e => setFormData({...formData, duration_value: parseInt(e.target.value)})}
                        className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-neutral-700 mb-1">单位</label>
                      <select
                        value={formData.duration_unit || 'days'}
                        onChange={e => setFormData({...formData, duration_unit: e.target.value})}
                        className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none bg-white"
                      >
                        <option value="days">天</option>
                        <option value="weeks">周</option>
                        <option value="months">月</option>
                      </select>
                    </div>
                  </div>
                )}

                <div className="md:col-span-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_active === 1}
                      onChange={e => setFormData({...formData, is_active: e.target.checked ? 1 : 0})}
                      className="rounded border-neutral-300 text-red-600 focus:ring-red-600"
                    />
                    启用此规则
                  </label>
                </div>
              </div>

              <div className="pt-6 border-t border-neutral-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-6 py-2.5 rounded-xl font-medium text-neutral-700 hover:bg-neutral-100 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors"
                >
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
