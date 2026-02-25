import React, { useState, useEffect } from 'react';
import { PlusCircle, BarChart3, Users, CalendarDays, DollarSign, List, Trash2, Lock, Settings2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import cronstrue from 'cronstrue';
import 'cronstrue/locales/zh_CN';

export default function Admin() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('admin_token'));
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [activeTab, setActiveTab] = useState<'add' | 'reports' | 'reservations' | 'equipment'>('add');
  const [reports, setReports] = useState<any>(null);
  const [reportPeriod, setReportPeriod] = useState('day');
  const [reportFilterName, setReportFilterName] = useState('');
  const [reportFilterSupervisor, setReportFilterSupervisor] = useState('');
  const [loadingReports, setLoadingReports] = useState(false);
  const [reservations, setReservations] = useState<any[]>([]);
  const [equipmentList, setEquipmentList] = useState<any[]>([]);
  const [editingEquipment, setEditingEquipment] = useState<any>(null);

  // Add/Edit Equipment Form State
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    auto_approve: true,
    price_type: 'hour',
    price: 0,
    consumable_fee: 0,
    whitelist_enabled: false,
    whitelist_data: '',
    advanceDays: 7,
    maxDurationMinutes: 60,
    minDurationMinutes: 30,
    rules: [] as { day: number, start: string, end: string }[]
  });

  const [selectedDays, setSelectedDays] = useState<number[]>([]);

  const daysOfWeek = [
    { label: '周日', value: 0 },
    { label: '周一', value: 1 },
    { label: '周二', value: 2 },
    { label: '周三', value: 3 },
    { label: '周四', value: 4 },
    { label: '周五', value: 5 },
    { label: '周六', value: 6 },
  ];

  useEffect(() => {
    if (token) {
      fetchReservations();
      fetchEquipment();
    }
  }, [token]);

  const fetchEquipment = async () => {
    try {
      const res = await fetch('/api/equipment');
      const data = await res.json();
      setEquipmentList(data);
    } catch (err) {
      toast.error('获取仪器列表失败');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (res.ok) {
        setToken(data.token);
        localStorage.setItem('admin_token', data.token);
        setLoginError('');
      } else {
        setLoginError(data.error || '登录失败');
      }
    } catch (err) {
      setLoginError('登录失败');
    }
  };

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('admin_token');
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const availability_json = JSON.stringify({
      rules: formData.rules,
      advanceDays: formData.advanceDays,
      maxDurationMinutes: formData.maxDurationMinutes
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
          auto_approve: true,
          price_type: 'hour',
          price: 0,
          consumable_fee: 0,
          whitelist_enabled: false,
          whitelist_data: '',
          advanceDays: 7,
          maxDurationMinutes: 60,
          minDurationMinutes: 30,
          rules: []
        });
        setEditingEquipment(null);
        setActiveTab('equipment');
        fetchEquipment();
      }
    } catch (err) {
      toast.error('保存仪器失败');
    }
  };

  const startEdit = (eq: any) => {
    let availability = { rules: [], advanceDays: 7, maxDurationMinutes: 60, minDurationMinutes: 30 };
    try {
      availability = JSON.parse(eq.availability_json || '{}');
    } catch (e) {}

    setEditingEquipment(eq);
    setFormData({
      name: eq.name,
      description: eq.description,
      auto_approve: eq.auto_approve === 1,
      price_type: eq.price_type,
      price: eq.price,
      consumable_fee: eq.consumable_fee,
      whitelist_enabled: eq.whitelist_enabled === 1,
      whitelist_data: eq.whitelist_data || '',
      advanceDays: availability.advanceDays || 7,
      maxDurationMinutes: availability.maxDurationMinutes || 60,
      minDurationMinutes: availability.minDurationMinutes || 30,
      rules: availability.rules || []
    });
    setActiveTab('add');
  };

  const deleteEquipment = async (id: number) => {
    if (!confirm('确定要删除该仪器吗？')) return;
    try {
      const res = await fetch(`/api/admin/equipment/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('删除成功');
        fetchEquipment();
      }
    } catch (err) {
      toast.error('删除失败');
    }
  };

  const fetchReports = async () => {
    setLoadingReports(true);
    try {
      const query = new URLSearchParams({
        period: reportPeriod,
        ...(reportFilterName && { student_name: reportFilterName }),
        ...(reportFilterSupervisor && { supervisor: reportFilterSupervisor })
      });
      const res = await fetch(`/api/admin/reports?${query.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return handleLogout();
      const data = await res.json();
      setReports(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingReports(false);
    }
  };

  const fetchReservations = async () => {
    try {
      const res = await fetch('/api/admin/reservations', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return handleLogout();
      const data = await res.json();
      setReservations(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteReservation = async (id: number) => {
    if (!confirm('确定要删除此预约吗？')) return;
    try {
      const res = await fetch(`/api/admin/reservations/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('删除成功');
        fetchReservations();
      } else {
        toast.error('删除失败');
      }
    } catch (err) {
      toast.error('删除失败');
    }
  };

  useEffect(() => {
    if (!token) return;
    if (activeTab === 'reports') {
      fetchReports();
    } else if (activeTab === 'reservations') {
      fetchReservations();
    }
  }, [activeTab, reportPeriod, token]);

  if (!token) {
    return (
      <div className="max-w-md mx-auto mt-20 bg-white p-8 rounded-2xl shadow-sm border border-neutral-200">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
            <Lock className="w-6 h-6 text-indigo-600" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center mb-8">管理后台登录</h2>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">密码</label>
            <input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all" 
              placeholder="请输入管理员密码" 
            />
          </div>
          {loginError && <p className="text-red-500 text-sm">{loginError}</p>}
          <button type="submit" className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors">
            登录
          </button>
        </form>
      </div>
    );
  }

  const statusMap: Record<string, string> = {
    pending: '待审批',
    approved: '已通过',
    active: '进行中',
    completed: '已完成',
    cancelled: '已取消'
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">管理后台</h1>
          <p className="text-neutral-500 mt-2">管理仪器设备并查看使用报表。</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-2 bg-neutral-100 p-1 rounded-xl">
            <button
              onClick={() => { setActiveTab('add'); setEditingEquipment(null); setFormData({ name: '', description: '', auto_approve: true, price_type: 'hour', price: 0, consumable_fee: 0, whitelist_enabled: false, whitelist_data: '', advanceDays: 7, maxDurationMinutes: 60, rules: [] }); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'add' ? 'bg-white text-indigo-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <PlusCircle className="w-4 h-4" />
              {editingEquipment ? '编辑仪器' : '添加仪器'}
            </button>
            <button
              onClick={() => setActiveTab('equipment')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'equipment' ? 'bg-white text-indigo-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <List className="w-4 h-4" />
              仪器管理
            </button>
            <button
              onClick={() => setActiveTab('reservations')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'reservations' ? 'bg-white text-indigo-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <CalendarDays className="w-4 h-4" />
              预约管理
            </button>
            <button
              onClick={() => setActiveTab('reports')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'reports' ? 'bg-white text-indigo-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <BarChart3 className="w-4 h-4" />
              报表
            </button>
          </div>
          <button onClick={handleLogout} className="text-sm text-neutral-500 hover:text-neutral-900 underline">退出</button>
        </div>
      </div>

      {activeTab === 'add' && (
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 max-w-2xl mx-auto">
          <h2 className="text-xl font-bold mb-6">{editingEquipment ? '编辑仪器' : '添加新仪器'}</h2>
          <form onSubmit={handleAddSubmit} className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">仪器名称</label>
                <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all" placeholder="例如：扫描电子显微镜" />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">仪器描述</label>
                <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all" rows={3} placeholder="简要介绍仪器的功能和用途..." />
              </div>
              
              <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-neutral-900">开放时间设置</h3>
                </div>
                
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
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
                      {formData.rules.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)).map((rule, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-neutral-200">
                          <span className="text-xs font-medium w-12">{daysOfWeek.find(d => d.value === rule.day)?.label}</span>
                          <span className="text-xs text-neutral-500">{rule.start} - {rule.end}</span>
                          <button 
                            type="button" 
                            onClick={() => setFormData({...formData, rules: formData.rules.filter((_, i) => i !== idx)})}
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
                              className={`px-2 py-1 text-xs rounded-md border transition-colors ${selectedDays.includes(d.value) ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:border-indigo-300'}`}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <input id="new-rule-start" type="time" className="flex-1 px-2 py-1.5 text-xs border border-neutral-300 rounded bg-white" defaultValue="08:00" />
                          <span className="text-xs">至</span>
                          <input id="new-rule-end" type="time" className="flex-1 px-2 py-1.5 text-xs border border-neutral-300 rounded bg-white" defaultValue="18:00" />
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
                            className="px-4 py-1.5 bg-neutral-900 text-white text-xs rounded-lg hover:bg-neutral-800"
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
                      <h3 className="text-sm font-medium text-neutral-700">人员白名单</h3>
                      <p className="text-xs text-neutral-500">仅允许白名单内的人员预约此仪器</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFormData({...formData, whitelist_enabled: !formData.whitelist_enabled})}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${formData.whitelist_enabled ? 'bg-indigo-600' : 'bg-neutral-200'}`}
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
                        className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all text-sm"
                        rows={3}
                        placeholder="例如：张三, 李四, 王五"
                      />
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-neutral-200 mt-4">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="auto_approve" checked={formData.auto_approve} onChange={e => setFormData({...formData, auto_approve: e.target.checked})} className="w-4 h-4 text-indigo-600 rounded border-neutral-300 focus:ring-indigo-600" />
                    <label htmlFor="auto_approve" className="text-sm font-medium text-neutral-700">自动审批预约</label>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">计费方式</label>
                  <select value={formData.price_type} onChange={e => setFormData({...formData, price_type: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all bg-white">
                    <option value="hour">按小时</option>
                    <option value="use">按次</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">价格 (¥)</label>
                  <input required type="number" min="0" step="0.01" value={formData.price} onChange={e => setFormData({...formData, price: Number(e.target.value)})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all" />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">耗材费 (¥, 可选)</label>
                <input type="number" min="0" step="0.01" value={formData.consumable_fee} onChange={e => setFormData({...formData, consumable_fee: Number(e.target.value)})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all" />
              </div>
            </div>

            <button type="submit" className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors">
              {editingEquipment ? '更新仪器' : '保存仪器'}
            </button>
          </form>
        </div>
      )}

      {activeTab === 'equipment' && (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200">
                <tr>
                  <th className="px-6 py-4 font-medium">仪器名称</th>
                  <th className="px-6 py-4 font-medium">计费</th>
                  <th className="px-6 py-4 font-medium">白名单</th>
                  <th className="px-6 py-4 font-medium">自动审批</th>
                  <th className="px-6 py-4 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {equipmentList.map(eq => (
                  <tr key={eq.id} className="hover:bg-neutral-50/50">
                    <td className="px-6 py-4 font-medium">{eq.name}</td>
                    <td className="px-6 py-4">¥{eq.price}/{eq.price_type === 'hour' ? '小时' : '次'}</td>
                    <td className="px-6 py-4">
                      {eq.whitelist_enabled ? (
                        <span className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs">已开启</span>
                      ) : (
                        <span className="px-2 py-1 bg-neutral-100 text-neutral-500 rounded-full text-xs">未开启</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {eq.auto_approve ? (
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs">是</span>
                      ) : (
                        <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs">否</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button onClick={() => startEdit(eq)} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                        <Settings2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteEquipment(eq.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {equipmentList.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-neutral-500">暂无仪器记录</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'reservations' && (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200">
                <tr>
                  <th className="px-6 py-4 font-medium">预约码</th>
                  <th className="px-6 py-4 font-medium">仪器</th>
                  <th className="px-6 py-4 font-medium">用户</th>
                  <th className="px-6 py-4 font-medium">时间</th>
                  <th className="px-6 py-4 font-medium">状态</th>
                  <th className="px-6 py-4 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {reservations.map(res => (
                  <tr key={res.id} className="hover:bg-neutral-50/50">
                    <td className="px-6 py-4 font-mono text-xs">{res.booking_code}</td>
                    <td className="px-6 py-4 font-medium text-neutral-900">{res.equipment_name}</td>
                    <td className="px-6 py-4">
                      <p className="font-medium text-neutral-900">{res.student_name}</p>
                      <p className="text-xs text-neutral-500">{res.supervisor}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-neutral-900">{format(new Date(res.start_time), 'MM-dd HH:mm')}</p>
                      <p className="text-xs text-neutral-500">至 {format(new Date(res.end_time), 'HH:mm')}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium
                        ${res.status === 'pending' ? 'bg-amber-100 text-amber-800' : ''}
                        ${res.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : ''}
                        ${res.status === 'active' ? 'bg-indigo-100 text-indigo-800' : ''}
                        ${res.status === 'completed' ? 'bg-neutral-100 text-neutral-800' : ''}
                        ${res.status === 'cancelled' ? 'bg-red-100 text-red-800' : ''}
                      `}>
                        {statusMap[res.status] || res.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => handleDeleteReservation(res.id)}
                        className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="删除预约"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {reservations.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-neutral-500">暂无预约记录</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="space-y-6">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-neutral-200 flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1">时间维度</label>
              <select 
                value={reportPeriod} 
                onChange={e => setReportPeriod(e.target.value)}
                className="px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all bg-white text-sm font-medium"
              >
                <option value="day">按天</option>
                <option value="week">按周</option>
                <option value="month">按月</option>
                <option value="quarter">按季度</option>
                <option value="year">按年</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1">筛选用户 (姓名)</label>
              <input 
                type="text" 
                value={reportFilterName}
                onChange={e => setReportFilterName(e.target.value)}
                placeholder="输入用户姓名"
                className="px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all text-sm w-48"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1">筛选导师</label>
              <input 
                type="text" 
                value={reportFilterSupervisor}
                onChange={e => setReportFilterSupervisor(e.target.value)}
                placeholder="输入导师姓名"
                className="px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all text-sm w-48"
              />
            </div>
            <button 
              onClick={fetchReports}
              className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              应用筛选
            </button>
          </div>

          {loadingReports ? (
            <div className="text-center py-12 text-neutral-500">加载报表中...</div>
          ) : reports ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Usage Over Time Chart */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200 lg:col-span-2">
                <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-indigo-600" />
                  使用时长与收入趋势
                </h3>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reports.usageByTime}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                      <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{fill: '#737373', fontSize: 12}} dy={10} />
                      <YAxis yAxisId="left" orientation="left" stroke="#4f46e5" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                      <YAxis yAxisId="right" orientation="right" stroke="#10b981" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                      <Tooltip cursor={{fill: '#f5f5f5'}} contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                      <Legend iconType="circle" wrapperStyle={{paddingTop: '20px'}} />
                      <Bar yAxisId="left" dataKey="total_hours" name="使用时长 (小时)" fill="#4f46e5" radius={[4, 4, 0, 0]} maxBarSize={40} />
                      <Bar yAxisId="right" dataKey="total_revenue" name="收入 (¥)" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Top Users */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
                <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-600" />
                  用户排行
                </h3>
                <div className="space-y-4">
                  {reports.usageByPerson.length === 0 ? (
                    <p className="text-sm text-neutral-500 text-center py-4">暂无数据</p>
                  ) : (
                    reports.usageByPerson.map((user: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-neutral-50 rounded-xl">
                        <div>
                          <p className="font-medium text-neutral-900">{user.student_name}</p>
                          <p className="text-xs text-neutral-500">{user.student_id}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-indigo-600">¥{user.total_revenue?.toFixed(2) || '0.00'}</p>
                          <p className="text-xs text-neutral-500">{user.total_hours?.toFixed(1) || '0'} 小时</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Top Supervisors */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
                <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-indigo-600" />
                  导师排行
                </h3>
                <div className="space-y-4">
                  {reports.usageBySupervisor.length === 0 ? (
                    <p className="text-sm text-neutral-500 text-center py-4">暂无数据</p>
                  ) : (
                    reports.usageBySupervisor.map((sup: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-neutral-50 rounded-xl">
                        <p className="font-medium text-neutral-900">{sup.supervisor}</p>
                        <div className="text-right">
                          <p className="font-bold text-emerald-600">¥{sup.total_revenue?.toFixed(2) || '0.00'}</p>
                          <p className="text-xs text-neutral-500">{sup.total_hours?.toFixed(1) || '0'} 小时</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
