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

  const [activeTab, setActiveTab] = useState<'add' | 'reports' | 'reservations'>('add');
  const [reports, setReports] = useState<any>(null);
  const [reportPeriod, setReportPeriod] = useState('day');
  const [reportFilterName, setReportFilterName] = useState('');
  const [reportFilterSupervisor, setReportFilterSupervisor] = useState('');
  const [loadingReports, setLoadingReports] = useState(false);
  const [reservations, setReservations] = useState<any[]>([]);

  // Add Equipment Form State
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    auto_approve: true,
    price_type: 'hour',
    price: 0,
    consumable_fee: 0,
    whitelist_enabled: false,
    whitelist_data: ''
  });

  // Cron UI State
  const [isAdvancedCron, setIsAdvancedCron] = useState(false);
  const [customCron, setCustomCron] = useState('0 8-18 * * 1,2,3,4,5');
  const [cronDays, setCronDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [cronStartHour, setCronStartHour] = useState(8);
  const [cronEndHour, setCronEndHour] = useState(18);

  const getGeneratedCron = () => {
    if (isAdvancedCron) return customCron;
    const daysStr = cronDays.length > 0 ? cronDays.sort().join(',') : '*';
    
    let hourPart = `${cronStartHour}-${cronEndHour}`;
    if (cronStartHour === cronEndHour) {
      hourPart = `${cronStartHour}`;
    }
    
    return `0 ${hourPart} * * ${daysStr}`;
  };

  const getCronDescription = (expr: string) => {
    try {
      return cronstrue.toString(expr, { locale: 'zh_CN' });
    } catch (e) {
      return '无效的Cron表达式';
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
    
    let cron_availability = '';

    if (isAdvancedCron) {
      cron_availability = customCron;
    } else {
      if (cronDays.length === 0) {
        return toast.error('请至少选择一天');
      }
      if (cronStartHour > cronEndHour) {
        return toast.error('结束时间必须晚于开始时间');
      }
      cron_availability = getGeneratedCron();
    }

    try {
      const res = await fetch('/api/admin/equipment', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ ...formData, cron_availability })
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success('仪器添加成功！');
        setFormData({
          name: '',
          description: '',
          auto_approve: true,
          price_type: 'hour',
          price: 0,
          consumable_fee: 0,
          whitelist_enabled: false,
          whitelist_data: ''
        });
      }
    } catch (err) {
      toast.error('添加仪器失败');
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

  const daysOfWeek = [
    { value: 1, label: '周一' },
    { value: 2, label: '周二' },
    { value: 3, label: '周三' },
    { value: 4, label: '周四' },
    { value: 5, label: '周五' },
    { value: 6, label: '周六' },
    { value: 0, label: '周日' }
  ];

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
              onClick={() => setActiveTab('add')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'add' ? 'bg-white text-indigo-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <PlusCircle className="w-4 h-4" />
              添加仪器
            </button>
            <button
              onClick={() => setActiveTab('reservations')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'reservations' ? 'bg-white text-indigo-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <List className="w-4 h-4" />
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
          <h2 className="text-xl font-bold mb-6">添加新仪器</h2>
          <form onSubmit={handleAddSubmit} className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">仪器名称</label>
                <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all" placeholder="例如：电子显微镜" />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">描述</label>
                <textarea required value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all" rows={3} placeholder="仪器的简要描述..." />
              </div>
              
              <div className="bg-neutral-50 p-4 rounded-xl border border-neutral-200 space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-neutral-700">可预约时间段</h3>
                  <button
                    type="button"
                    onClick={() => setIsAdvancedCron(!isAdvancedCron)}
                    className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    <Settings2 className="w-3 h-3" />
                    {isAdvancedCron ? '切换到基础模式' : '切换到高级模式'}
                  </button>
                </div>
                
                {!isAdvancedCron ? (
                  <>
                    <div>
                      <label className="block text-xs text-neutral-500 mb-2">开放星期</label>
                      <div className="flex flex-wrap gap-2">
                        {daysOfWeek.map(day => (
                          <button
                            key={day.value}
                            type="button"
                            onClick={() => {
                              if (cronDays.includes(day.value)) {
                                setCronDays(cronDays.filter(d => d !== day.value));
                              } else {
                                setCronDays([...cronDays, day.value]);
                              }
                            }}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${cronDays.includes(day.value) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-neutral-600 border-neutral-300 hover:border-indigo-300'}`}
                          >
                            {day.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-neutral-500 mb-1">开始时间</label>
                        <select value={cronStartHour} onChange={e => setCronStartHour(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-sm">
                          {Array.from({length: 24}).map((_, i) => (
                            <option key={i} value={i}>{i.toString().padStart(2, '0')} 时</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-neutral-500 mb-1">结束时间</label>
                        <select value={cronEndHour} onChange={e => setCronEndHour(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-sm">
                          {Array.from({length: 24}).map((_, i) => (
                            <option key={i} value={i}>{i.toString().padStart(2, '0')} 时</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">Cron 表达式</label>
                    <input 
                      type="text" 
                      value={customCron} 
                      onChange={e => setCustomCron(e.target.value)} 
                      className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all font-mono text-sm" 
                      placeholder="例如：0 8-18 * * 1-5" 
                    />
                    <p className="text-xs text-neutral-500 mt-2">
                      支持标准的 Cron 语法。例如：<code className="bg-neutral-200 px-1 rounded">0 8-18 * * 1-5</code> 表示周一至周五的 8:00 到 18:00。
                    </p>
                  </div>
                )}

                <div className="mt-4 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                  <p className="text-xs text-indigo-600 font-medium mb-1">当前设置解析：</p>
                  <p className="text-sm text-indigo-900 font-mono mb-1">{getGeneratedCron()}</p>
                  <p className="text-sm text-indigo-800">{getCronDescription(getGeneratedCron().replace(/^\*/, '0'))}</p>
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
              保存仪器
            </button>
          </form>
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
