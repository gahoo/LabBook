import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { Plus, Edit2, Trash2, AlertCircle, X, Search } from 'lucide-react';

interface TriggerConfig {
  metric: 'count' | 'duration';
  threshold: number;
  window_type: 'rolling_days' | 'natural_period' | 'current_month';
  period_days?: number;
  period_type?: 'month' | 'quarter' | 'semester' | 'academic_year' | 'year';
  scope?: number[];
  violation_types?: string[];
  count_strategy?: 'by_record' | 'by_reservation';
}

interface ActionConfig {
  type: 'ban' | 'require_approval' | 'double_fee' | 'reduce_advance_days';
  duration_type?: 'dynamic' | 'fixed';
  duration_days?: number;
  params?: {
    multiplier?: number;
    reduce_days?: number;
    min_retain_days?: number;
    cancel_future_reservations?: boolean;
  };
}

interface PenaltyRule {
  id: number;
  name: string;
  description: string;
  violation_type: string;
  trigger_config: string; // JSON string
  action_config: string; // JSON string
  is_active: number;
}

interface Equipment {
  id: number;
  name: string;
}

interface PenaltyRulesTabProps {
  token: string;
}

function MultiSelectCombobox({ 
  options, 
  selectedIds, 
  onChange, 
  placeholder = "搜索并选择..." 
}: { 
  options: { id: string | number, name: string }[], 
  selectedIds: (string | number)[], 
  onChange: (ids: any[]) => void,
  placeholder?: string
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = options.filter(opt => 
    opt.name.toLowerCase().includes(query.toLowerCase()) && !selectedIds.includes(opt.id)
  );

  const selectedOptions = options.filter(opt => selectedIds.includes(opt.id));

  const handleSelect = (id: string | number) => {
    onChange([...selectedIds, id]);
    setQuery('');
  };

  const handleRemove = (id: string | number) => {
    onChange(selectedIds.filter(selectedId => selectedId !== id));
  };

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div className="flex flex-wrap gap-2 p-2 min-h-[42px] bg-white border border-neutral-300 rounded-xl focus-within:ring-2 focus-within:ring-red-600 focus-within:border-transparent">
        {selectedOptions.map(opt => (
          <span key={opt.id} className="flex items-center gap-1 px-2.5 py-1 bg-neutral-100 text-neutral-800 text-sm rounded-lg border border-neutral-200">
            {opt.name}
            <button 
              type="button" 
              onClick={() => handleRemove(opt.id)}
              className="text-neutral-400 hover:text-red-500 focus:outline-none"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        ))}
        <div className="flex-1 min-w-[120px] flex items-center">
          <input
            type="text"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder={selectedOptions.length === 0 ? placeholder : ""}
            className="w-full bg-transparent outline-none text-sm text-neutral-700 placeholder:text-neutral-400"
          />
        </div>
      </div>
      
      {isOpen && filteredOptions.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-neutral-200 rounded-xl shadow-lg max-h-60 overflow-auto py-1">
          {filteredOptions.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelect(opt.id)}
              className="w-full text-left px-4 py-2 text-sm text-neutral-700 hover:bg-red-50 hover:text-red-700 transition-colors"
            >
              {opt.name}
            </button>
          ))}
        </div>
      )}
      {isOpen && query && filteredOptions.length === 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-neutral-200 rounded-xl shadow-lg py-3 px-4 text-sm text-neutral-500 text-center">
          未找到匹配的仪器
        </div>
      )}
    </div>
  );
}

export default function PenaltyRulesTab({ token }: PenaltyRulesTabProps) {
  const [rules, setRules] = useState<PenaltyRule[]>([]);
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<PenaltyRule | null>(null);

  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    violation_type: string;
    trigger: TriggerConfig;
    action: ActionConfig;
    is_active: number;
  }>({
    name: '',
    description: '',
    violation_type: 'late',
    trigger: { metric: 'count', threshold: 1, window_type: 'rolling_days', period_days: 30, scope: [], violation_types: ['late'], count_strategy: 'by_record' },
    action: { type: 'ban', duration_type: 'dynamic', params: { cancel_future_reservations: false } },
    is_active: 1
  });

  useEffect(() => {
    fetchRules();
    fetchEquipments();
  }, []);

  const fetchEquipments = async () => {
    try {
      const res = await fetch('/api/equipment');
      if (res.ok) {
        const data = await res.json();
        setEquipments(data);
      }
    } catch (err) {
      console.error('Failed to fetch equipments', err);
    }
  };

  const fetchRules = async () => {
    try {
      const res = await fetch('/api/admin/penalty-rules', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      if (Array.isArray(data)) {
        setRules(data);
      } else {
        toast.error('获取惩罚规则失败');
      }
    } catch (err) {
      toast.error('获取惩罚规则失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenDrawer = (rule?: PenaltyRule) => {
    if (rule) {
      const parsedTrigger = JSON.parse(rule.trigger_config);
      if (!parsedTrigger.violation_types) {
        parsedTrigger.violation_types = [rule.violation_type];
      }
      if (!parsedTrigger.count_strategy) {
        parsedTrigger.count_strategy = 'by_record';
      }
      setEditingRule(rule);
      setFormData({
        name: rule.name,
        description: rule.description,
        violation_type: rule.violation_type,
        trigger: parsedTrigger,
        action: JSON.parse(rule.action_config),
        is_active: rule.is_active
      });
    } else {
      setEditingRule(null);
      setFormData({
        name: '',
        description: '',
        violation_type: 'late',
        trigger: { metric: 'count', threshold: 1, window_type: 'rolling_days', period_days: 30, violation_types: ['late'], count_strategy: 'by_record' },
        action: { type: 'ban', duration_type: 'dynamic' },
        is_active: 1
      });
    }
    setIsDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setEditingRule(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingRule 
        ? `/api/admin/penalty-rules/${editingRule.id}`
        : '/api/admin/penalty-rules';
      
      const method = editingRule ? 'PUT' : 'POST';

      const payload = {
        name: formData.name,
        description: formData.description,
        violation_type: formData.violation_type,
        trigger_config: formData.trigger,
        action_config: formData.action,
        is_active: formData.is_active
      };

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        toast.success(editingRule ? '规则更新成功' : '规则创建成功');
        handleCloseDrawer();
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
        headers: { 'Authorization': `Bearer ${token}` }
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

  const violationTypeMap: Record<string, string> = {
    late: '迟到',
    overdue: '超时',
    'no-show': '爽约',
    late_cancel: '临期取消'
  };

  const actionTypeMap: Record<string, string> = {
    ban: '完全封禁',
    require_approval: '需管理员审批',
    double_fee: '费用加倍',
    reduce_advance_days: '减少提前预约天数'
  };

  const periodTypeMap: Record<string, string> = {
    month: '自然月',
    quarter: '自然季度',
    semester: '学期',
    academic_year: '学年',
    year: '自然年'
  };

  if (isLoading) {
    return <div className="p-8 text-center text-neutral-500">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium text-neutral-900">惩罚规则管理</h3>
          <p className="text-sm text-neutral-500 mt-1">设置用户违规行为的自动惩罚机制（阶梯式规则）</p>
        </div>
        <button
          onClick={() => handleOpenDrawer()}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建规则
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead className="hidden md:table-header-group bg-neutral-50 border-b border-neutral-200 text-neutral-600">
              <tr>
                <th className="px-6 py-4 font-medium">规则名称</th>
                <th className="px-6 py-4 font-medium">触发条件</th>
                <th className="px-6 py-4 font-medium">惩罚动作</th>
                <th className="px-6 py-4 font-medium">状态</th>
                <th className="px-6 py-4 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group divide-y divide-neutral-100 md:divide-y-0 p-4 md:p-0">
              {rules.map(rule => {
                const trigger = JSON.parse(rule.trigger_config) as TriggerConfig;
                const action = JSON.parse(rule.action_config) as ActionConfig;
                return (
                  <tr key={rule.id} className="block md:table-row hover:bg-neutral-50 transition-colors border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none">
                    <td className="px-4 py-3 md:px-6 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-start md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs mt-0.5">规则名称</span>
                        <div className="text-right md:text-left">
                          <div className="font-medium text-neutral-900">{rule.name}</div>
                          {rule.description && <div className="text-neutral-500 text-xs mt-1">{rule.description}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:px-6 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">触发条件</span>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-red-50 text-red-700 border border-red-100 text-right md:text-left">
                          {trigger.window_type === 'natural_period' || trigger.window_type === 'current_month' ? `本${periodTypeMap[trigger.period_type || 'month']}内，` : `过去 ${trigger.period_days} 天内，`}
                          {(trigger.violation_types || [rule.violation_type]).map(t => violationTypeMap[t]).join(' 或 ')}
                          {trigger.metric === 'count' ? `达到 ${trigger.threshold} 次` : `累计 ${trigger.threshold} 分钟`}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:px-6 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">惩罚动作</span>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-orange-50 text-orange-700 border border-orange-100 text-right md:text-left">
                          {actionTypeMap[action.type]}
                          {action.duration_type === 'fixed' && action.duration_days ? ` (${action.duration_days} 天)` : ' (动态计算)'}
                          {action.type === 'double_fee' && ` (${action.params?.multiplier} 倍)`}
                          {action.type === 'reduce_advance_days' && ` (减少 ${action.params?.reduce_days} 天，保底 ${action.params?.min_retain_days} 天)`}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:px-6 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">状态</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="sr-only peer" 
                            checked={rule.is_active === 1}
                            onChange={async (e) => {
                              const newStatus = e.target.checked ? 1 : 0;
                              try {
                                await fetch(`/api/admin/penalty-rules/${rule.id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                  body: JSON.stringify({ ...rule, trigger_config: trigger, action_config: action, is_active: newStatus })
                                });
                                fetchRules();
                              } catch (err) {}
                            }}
                          />
                          <div className="w-9 h-5 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600"></div>
                        </label>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:px-6 md:py-4 block md:table-cell text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleOpenDrawer(rule)} className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(rule.id)} className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rules.length === 0 && (
                <tr className="block md:table-row">
                  <td colSpan={5} className="px-6 py-12 text-center text-neutral-500 block md:table-cell">
                    <AlertCircle className="w-8 h-8 text-neutral-300 mx-auto mb-3" />
                    暂无惩罚规则
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer Overlay */}
      <div 
        className={`fixed inset-0 bg-black/50 z-50 transition-opacity duration-300 ${isDrawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={handleCloseDrawer}
      />
      
      {/* Drawer Panel */}
      <div 
        className={`fixed top-0 right-0 h-full w-full sm:w-[500px] md:w-[600px] bg-white z-50 shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out ${isDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
              <h2 className="text-lg font-bold text-neutral-900">
                {editingRule ? '编辑规则' : '新建规则'}
              </h2>
              <button onClick={handleCloseDrawer} className="p-2 text-neutral-400 hover:bg-neutral-100 rounded-full transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              <form id="rule-form" onSubmit={handleSave} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">规则名称</label>
                  <input
                    required
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none"
                    placeholder="例如：爽约1次警告"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">规则描述 (可选)</label>
                  <textarea
                    value={formData.description}
                    onChange={e => setFormData({...formData, description: e.target.value})}
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none resize-none h-20"
                    placeholder="描述该规则的作用..."
                  />
                </div>

                <div className="p-4 bg-neutral-50 rounded-xl space-y-4 border border-neutral-100">
                  <h4 className="font-medium text-neutral-900 flex items-center gap-2">
                    <span className="w-1.5 h-4 bg-red-500 rounded-full"></span>
                    触发条件 (If)
                  </h4>
                  
                  <div>
                    <label className="block text-sm text-neutral-600 mb-2">违规类型组合 (可多选)</label>
                    <MultiSelectCombobox
                      options={Object.entries(violationTypeMap).map(([k, v]) => ({ id: k, name: v }))}
                      selectedIds={formData.trigger.violation_types || []}
                      onChange={(ids) => {
                        let newTypes = ids as string[];
                        if (newTypes.length === 0) newTypes = ['late']; // Prevent empty
                        
                        const newFormData = {...formData};
                        newFormData.trigger = {...newFormData.trigger, violation_types: newTypes};
                        newFormData.violation_type = newTypes.length > 1 ? 'combo' : newTypes[0];
                        
                        if (newFormData.trigger.metric === 'duration' && newTypes.some(t => !['late', 'overdue'].includes(t))) {
                          newFormData.trigger.metric = 'count';
                        }
                        setFormData(newFormData);
                      }}
                      placeholder="搜索并选择违规类型..."
                    />
                  </div>

                  {(formData.trigger.violation_types?.length || 0) > 1 && formData.trigger.metric === 'count' && (
                    <div>
                      <label className="block text-sm text-neutral-600 mb-1">同一次预约触发多种违规时如何计算？</label>
                      <select
                        value={formData.trigger.count_strategy || 'by_record'}
                        onChange={e => setFormData({...formData, trigger: {...formData.trigger, count_strategy: e.target.value as any}})}
                        className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none bg-white"
                      >
                        <option value="by_record">分别计算（例如：迟到且超时算2次违规）</option>
                        <option value="by_reservation">合并计算（同一次预约最多算1次违规）</option>
                      </select>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-sm text-neutral-600 mb-1">统计维度</label>
                      <select
                        value={formData.trigger.metric}
                        onChange={e => setFormData({...formData, trigger: {...formData.trigger, metric: e.target.value as 'count'|'duration'}})}
                        className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none bg-white"
                      >
                        <option value="count">次数</option>
                        {(formData.trigger.violation_types || []).every(t => ['late', 'overdue'].includes(t)) && (
                          <option value="duration">累计时长(分钟)</option>
                        )}
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm text-neutral-600 mb-1">触发阈值</label>
                      <input
                        required
                        type="number"
                        min="1"
                        value={formData.trigger.threshold}
                        onChange={e => setFormData({...formData, trigger: {...formData.trigger, threshold: parseInt(e.target.value)}})}
                        className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-sm text-neutral-600 mb-1">统计周期类型</label>
                      <select
                        value={formData.trigger.window_type === 'current_month' ? 'natural_period' : formData.trigger.window_type}
                        onChange={e => setFormData({...formData, trigger: {...formData.trigger, window_type: e.target.value as 'rolling_days'|'natural_period'}})}
                        className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none bg-white"
                      >
                        <option value="rolling_days">过去 N 天</option>
                        <option value="natural_period">自然周期</option>
                      </select>
                    </div>
                    {formData.trigger.window_type === 'rolling_days' && (
                      <div className="flex-1">
                        <label className="block text-sm text-neutral-600 mb-1">天数 (N)</label>
                        <input
                          required
                          type="number"
                          min="1"
                          value={formData.trigger.period_days || 30}
                          onChange={e => setFormData({...formData, trigger: {...formData.trigger, period_days: parseInt(e.target.value)}})}
                          className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none"
                        />
                      </div>
                    )}
                    {(formData.trigger.window_type === 'natural_period' || formData.trigger.window_type === 'current_month') && (
                      <div className="flex-1">
                        <label className="block text-sm text-neutral-600 mb-1">周期类型</label>
                        <select
                          value={formData.trigger.period_type || 'month'}
                          onChange={e => setFormData({...formData, trigger: {...formData.trigger, period_type: e.target.value as any}})}
                          className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none bg-white"
                        >
                          {Object.entries(periodTypeMap).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm text-neutral-600 mb-1">作用范围 (不选则为全部仪器)</label>
                    <MultiSelectCombobox
                      options={equipments}
                      selectedIds={formData.trigger.scope || []}
                      onChange={(ids) => setFormData({...formData, trigger: {...formData.trigger, scope: ids}})}
                      placeholder="搜索并选择受限仪器..."
                    />
                  </div>
                </div>

                <div className="p-4 bg-orange-50/50 rounded-xl space-y-4 border border-orange-100">
                  <h4 className="font-medium text-orange-900 flex items-center gap-2">
                    <span className="w-1.5 h-4 bg-orange-500 rounded-full"></span>
                    惩罚动作 (Then)
                  </h4>

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-sm text-neutral-600 mb-1">惩罚类型</label>
                      <select
                        value={formData.action.type}
                        onChange={e => setFormData({...formData, action: { type: e.target.value as any, params: {}, duration_type: formData.action.duration_type, duration_days: formData.action.duration_days }})}
                        className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-orange-500 outline-none bg-white"
                      >
                        {Object.entries(actionTypeMap).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm text-neutral-600 mb-1">惩罚时长类型</label>
                      <select
                        value={formData.action.duration_type || 'dynamic'}
                        onChange={e => setFormData({...formData, action: {...formData.action, duration_type: e.target.value as 'dynamic'|'fixed'}})}
                        className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-orange-500 outline-none bg-white"
                      >
                        <option value="dynamic">动态计算 (持续至不满足条件)</option>
                        <option value="fixed">固定时长</option>
                      </select>
                    </div>
                    {formData.action.duration_type === 'fixed' && (
                      <div className="flex-1">
                        <label className="block text-sm text-neutral-600 mb-1">惩罚时长 (天)</label>
                        <input
                          required
                          type="number"
                          min="1"
                          value={formData.action.duration_days || ''}
                          onChange={e => setFormData({...formData, action: {...formData.action, duration_days: e.target.value ? parseInt(e.target.value) : undefined}})}
                          className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-orange-500 outline-none"
                        />
                      </div>
                    )}
                  </div>

                  {formData.action.type === 'double_fee' && (
                    <div>
                      <label className="block text-sm text-neutral-600 mb-1">费用倍率 (例如 2.0)</label>
                      <input
                        required
                        type="number"
                        step="0.1"
                        min="1.1"
                        value={formData.action.params?.multiplier || 2.0}
                        onChange={e => setFormData({...formData, action: { ...formData.action, params: { multiplier: parseFloat(e.target.value) } }})}
                        className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-orange-500 outline-none"
                      />
                    </div>
                  )}

                  {formData.action.type === 'ban' && (
                    <div>
                      <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.action.params?.cancel_future_reservations || false}
                          onChange={e => setFormData({
                            ...formData,
                            action: {
                              ...formData.action,
                              params: {
                                ...formData.action.params,
                                cancel_future_reservations: e.target.checked
                              }
                            }
                          })}
                          className="rounded text-orange-500 focus:ring-orange-500"
                        />
                        同时取消该用户未来所有相关的待使用预约
                      </label>
                    </div>
                  )}

                  {formData.action.type === 'reduce_advance_days' && (
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="block text-sm text-neutral-600 mb-1">减少天数</label>
                        <input
                          required
                          type="number"
                          min="1"
                          value={formData.action.params?.reduce_days || 1}
                          onChange={e => setFormData({...formData, action: { ...formData.action, params: { ...formData.action.params, reduce_days: parseInt(e.target.value) } }})}
                          className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-orange-500 outline-none"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-sm text-neutral-600 mb-1">保底天数</label>
                        <input
                          required
                          type="number"
                          min="0"
                          value={formData.action.params?.min_retain_days ?? 1}
                          onChange={e => setFormData({...formData, action: { ...formData.action, params: { ...formData.action.params, min_retain_days: parseInt(e.target.value) } }})}
                          className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-orange-500 outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </form>
            </div>

            <div className="p-6 border-t border-neutral-100 bg-neutral-50 flex gap-3">
              <button
                type="button"
                onClick={handleCloseDrawer}
                className="flex-1 py-2.5 rounded-xl font-medium text-neutral-700 bg-white border border-neutral-200 hover:bg-neutral-50 transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                form="rule-form"
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors"
              >
                保存规则
              </button>
            </div>
          </div>
    </div>
  );
}
