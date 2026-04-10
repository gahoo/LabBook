import React, { useState } from 'react';
import { BarChart3, CalendarDays, List, Lock, FileText, Settings, ShieldAlert } from 'lucide-react';
import AuditLogsTab from './components/AuditLogsTab';
import WhitelistAppsTab from './components/WhitelistAppsTab';
import ReservationsTab from './components/ReservationsTab';
import ReportsTab from './components/ReportsTab';
import EquipmentManagementTab from './components/EquipmentManagementTab';
import SettingsTab from './components/SettingsTab';
import ViolationsAndPenaltiesTab from './components/ViolationsAndPenaltiesTab';

export default function Admin() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('admin_token'));
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [activeTab, setActiveTab] = useState<'reports' | 'reservations' | 'equipment' | 'whitelist_apps' | 'audit_logs' | 'settings' | 'violations'>('reservations');

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

  if (!token) {
    return (
      <div className="max-w-md mx-auto mt-20 bg-white p-8 rounded-2xl shadow-sm border border-neutral-200">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
            <Lock className="w-6 h-6 text-red-600" />
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
              className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" 
              placeholder="请输入管理员密码" 
            />
          </div>
          {loginError && <p className="text-red-500 text-sm">{loginError}</p>}
          <button type="submit" className="w-full py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors">
            登录
          </button>
        </form>
      </div>
    );
  }

  const statusMap: Record<string, string> = {
    pending: '待审批',
    rejected: '已驳回',
    approved: '已通过',
    active: '进行中',
    completed: '已完成',
    cancelled: '已取消'
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">管理后台</h1>
          <p className="text-neutral-500 mt-2">管理仪器设备并查看使用报表。</p>
        </div>
        <div className="flex items-center gap-4 w-full sm:w-auto overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:pb-0">
          <div className="flex gap-2 bg-neutral-100 p-1 rounded-xl whitespace-nowrap">
            <button
              onClick={() => setActiveTab('equipment')}
              className={`px-2 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'equipment' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <List className="w-4 h-4" />
              <span className={activeTab === 'equipment' ? 'inline' : 'hidden sm:inline'}>仪器管理</span>
            </button>
            <button
              onClick={() => setActiveTab('reservations')}
              className={`px-2 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'reservations' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <CalendarDays className="w-4 h-4" />
              <span className={activeTab === 'reservations' ? 'inline' : 'hidden sm:inline'}>预约管理</span>
            </button>
            <button
              onClick={() => setActiveTab('whitelist_apps')}
              className={`px-2 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'whitelist_apps' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <Lock className="w-4 h-4" />
              <span className={activeTab === 'whitelist_apps' ? 'inline' : 'hidden sm:inline'}>白名单申请</span>
            </button>
            <button
              onClick={() => setActiveTab('reports')}
              className={`px-2 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'reports' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <BarChart3 className="w-4 h-4" />
              <span className={activeTab === 'reports' ? 'inline' : 'hidden sm:inline'}>报表</span>
            </button>
            <button
              onClick={() => setActiveTab('violations')}
              className={`px-2 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'violations' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <ShieldAlert className="w-4 h-4" />
              <span className={activeTab === 'violations' ? 'inline' : 'hidden sm:inline'}>违规惩罚</span>
            </button>
            <button
              onClick={() => setActiveTab('audit_logs')}
              className={`px-2 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'audit_logs' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <FileText className="w-4 h-4" />
              <span className={activeTab === 'audit_logs' ? 'inline' : 'hidden sm:inline'}>审计日志</span>
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-2 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'settings' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <Settings className="w-4 h-4" />
              <span className={activeTab === 'settings' ? 'inline' : 'hidden sm:inline'}>设置</span>
            </button>
          </div>
          <button onClick={handleLogout} className="text-sm text-neutral-500 hover:text-neutral-900 underline shrink-0">退出</button>
        </div>
      </div>

      {activeTab === 'equipment' && (
        <EquipmentManagementTab 
          token={token} 
        />
      )}

      {activeTab === 'reservations' && (
        <ReservationsTab token={token} onLogout={handleLogout} statusMap={statusMap} />
      )}

      {activeTab === 'whitelist_apps' && (
        <WhitelistAppsTab token={token} handleLogout={handleLogout} />
      )}

      {activeTab === 'reports' && (
        <ReportsTab token={token} onLogout={handleLogout} />
      )}
      {activeTab === 'violations' && (
        <ViolationsAndPenaltiesTab token={token} onLogout={handleLogout} />
      )}
      {activeTab === 'audit_logs' && (
        <AuditLogsTab token={token} handleLogout={handleLogout} />
      )}
      {activeTab === 'settings' && (
        <SettingsTab token={token} />
      )}
    </div>
  );
}
