import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { flattenObj, unflattenObj } from '../../../utils';
import { Save, Bell, Mail, Webhook, Settings, Play, ChevronDown, ChevronRight, X, Edit3 } from 'lucide-react';

interface NotificationsTabProps {
  token: string | null;
}

export default function NotificationsTab({ token }: NotificationsTabProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    global: true,
    smtp: false,
    webhook: false,
    events: true,
  });
  const [selectedEvent, setSelectedEvent] = useState<any>(null); // Drawer state
  
  const [config, setConfig] = useState<any>({
    notification_interval_seconds: '30',
    smtp: { enabled: false, admin_emails: '' },
    webhook: { enabled: false, events: {} },
    email: { events: {} }
  });

  const EVENT_TYPES = [
    { id: 'booking_created', name: '预约成功', vars: '{{ student_id }}, {{ equipment_name }}, {{ booking_code }}, {{ start_time }}, {{ end_time }}' },
    { id: 'booking_approved', name: '预约审批通过', vars: '{{ student_id }}, {{ equipment_name }}, {{ booking_code }}, {{ start_time }}, {{ end_time }}' },
    { id: 'booking_rejected', name: '预约审批驳回', vars: '{{ student_id }}, {{ equipment_name }}, {{ booking_code }}, {{ start_time }}, {{ end_time }}' },
    { id: 'booking_cancelled', name: '预约取消', vars: '{{ student_id }}, {{ equipment_name }}, {{ booking_code }}' },
    { id: 'violation_created', name: '违规记录', vars: '{{ student_id }}, {{ violation_type }}, {{ equipment_name }}' },
    { id: 'appeal_resolved', name: '申诉结果通知', vars: '{{ student_id }}, {{ violation_id }}, {{ resolution }}, {{ reply }}' },
    { id: 'whitelist_resolved', name: '白名单审批结果', vars: '{{ student_id }}, {{ equipment_name }}, {{ resolution }}, {{ reason }}' },
    { id: 'penalty_triggered', name: '处罚触发', vars: '{{ student_id }}, {{ penalty_method }}, {{ reason }}' },
  ];

  const EVENT_MAP: Record<string, string> = {
    booking_created: '用户提交了实验室预约申请（或自动通过）',
    booking_approved: '需要审批的设备被管理员批准通过',
    booking_rejected: '需要审批的设备被管理员驳回申请',
    booking_cancelled: '用户或系统取消了该次预约',
    violation_created: '用户因过失（迟到/未上机等）产生了新的违规记录',
    appeal_resolved: '管理员对用户的违规申诉进行了判定处理',
    whitelist_resolved: '管理员对用户的白名单准入申请处理完毕',
    penalty_triggered: '违规记录累积导致处罚熔断，触发使用限制'
  };

  useEffect(() => {
    fetchSettings();
  }, [token]);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('获取设置失败');
      const data = await res.json();
      
      const unflattened = unflattenObj(data);
      setConfig({
        notification_interval_seconds: unflattened.notification_interval_seconds || '30',
        smtp: unflattened.smtp || { enabled: false },
        webhook: unflattened.webhook || { enabled: false, events: {} },
        email: unflattened.email || { events: {} }
      });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const flatData = flattenObj({
        notification_interval_seconds: config.notification_interval_seconds,
        smtp: config.smtp,
        webhook: config.webhook,
        email: config.email
      });

      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(flatData)
      });

      if (!res.ok) throw new Error('保存失败');
      toast.success('通知设置已保存');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (path: string[], value: any) => {
    setConfig((prev: any) => {
      const newConfig = { ...prev };
      let current = newConfig;
      for (let i = 0; i < path.length - 1; i++) {
        if (!current[path[i]]) current[path[i]] = {};
        current = current[path[i]];
      }
      current[path[path.length - 1]] = value;
      return newConfig;
    });
  };

  const testConnection = async (type: 'smtp' | 'webhook') => {
    const toastId = toast.loading(`正在测试 ${type.toUpperCase()} 连接...`);
    try {
      const res = await fetch('/api/admin/notifications/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ type, config: config[type] })
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message, { id: toastId });
      } else {
        toast.error(data.error, { id: toastId });
      }
    } catch (e) {
      toast.error('网络请求失败', { id: toastId });
    }
  };

  const testEvent = async (event: string, type: 'smtp' | 'webhook') => {
    const toastId = toast.loading(`正在测试推送 ${event}...`);
    try {
      const res = await fetch('/api/admin/notifications/test-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          event, 
          type, 
          config: config[type],
          eventConfig: config[type]?.events?.[event] || {}
        })
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message, { id: toastId });
      } else {
        toast.error(data.error, { id: toastId });
      }
    } catch (e) {
      toast.error('网络请求失败', { id: toastId });
    }
  };

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleEventOnOff = (eventId: string, channel: 'email' | 'webhook', isEnabled: boolean) => {
      updateConfig([channel, 'events', eventId, 'enabled'], isEnabled ? 'true' : 'false');
  };

  if (loading) return <div className="p-8 text-center text-neutral-500">加载中...</div>;

  return (
    <div className="p-6 relative">
      <div className="flex flex-col md:flex-row items-center justify-between mb-6 gap-4">
        <div>
          <h2 className="text-lg font-bold text-neutral-800">通知配置</h2>
          <p className="text-sm text-neutral-500 mt-1">控制系统产生核心事件时的投递途径，包含邮件(SMTP)、及自定义回调(Webhook)。系统采用队列机制限速分发。</p>
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full md:w-auto bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-70 whitespace-nowrap"
          >
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : '保存全局配置'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* 全局设置区 */}
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <button 
            type="button" 
            onClick={() => toggleSection('global')} 
            className="w-full flex items-center justify-between p-4 bg-neutral-50 hover:bg-neutral-100 transition-colors pointer-events-auto"
          >
            <div className="flex items-center gap-2 text-neutral-800 font-medium h-6">
              <Settings className="w-4 h-4 text-neutral-500" />
              全局流控与配置
            </div>
            {openSections['global'] ? <ChevronDown className="w-5 h-5 text-neutral-400" /> : <ChevronRight className="w-5 h-5 text-neutral-400" />}
          </button>
          
          {openSections['global'] && (
            <div className="p-6 border-t border-neutral-200 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm text-neutral-600 mb-1">通知发送时间间隔(秒)</label>
                  <input
                    type="number"
                    value={config.notification_interval_seconds || '30'}
                    onChange={(e) => updateConfig(['notification_interval_seconds'], e.target.value)}
                    placeholder="30"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                  />
                  <p className="text-xs text-neutral-500 mt-1.5 leading-relaxed">控制消息分发队列在发送时的最快吐出速率，防止由于大面积通知发送而导致并发请求过多、过度拥堵或被服务商拉黑限制等问题。默认为 30 秒。</p>
                </div>
                <div>
                  <label className="block text-sm text-neutral-600 mb-1">系统管理员邮箱列表</label>
                  <input
                    type="text"
                    value={config.smtp?.admin_emails || ''}
                    onChange={(e) => updateConfig(['smtp', 'admin_emails'], e.target.value)}
                    placeholder="admin1@test.com, admin2@test.com"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                  />
                  <p className="text-xs text-neutral-500 mt-1.5 leading-relaxed">支持通过英文逗号 <code>,</code> 分隔多个邮箱地址。后续可在事件配置下选择将部分事件的内容抄送给该管理员名单内的所有成员。</p>
                </div>
              </div>
              <div className="pt-4 border-t border-neutral-100">
                <label className="block text-sm font-medium text-neutral-800 mb-3">预约码发放方式组合</label>
                <div className="flex flex-wrap gap-6 items-center">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 text-red-600 rounded border-neutral-300 focus:ring-red-500"
                      checked={String(config.booking_code_delivery?.web) !== 'false'}
                      onChange={(e) => updateConfig(['booking_code_delivery', 'web'], e.target.checked ? 'true' : 'false')}
                    />
                    <span className="text-sm font-medium text-neutral-700">网页上展示预约码</span>
                  </label>
                  <label className={`flex items-center gap-2 ${String(config.smtp?.enabled) !== 'true' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 text-red-600 rounded border-neutral-300 focus:ring-red-500 disabled:opacity-50"
                      disabled={String(config.smtp?.enabled) !== 'true'}
                      checked={String(config.booking_code_delivery?.email) === 'true'}
                      onChange={(e) => updateConfig(['booking_code_delivery', 'email'], e.target.checked ? 'true' : 'false')}
                    />
                    <span className="text-sm font-medium text-neutral-700">由 Email 信件投递发放</span>
                  </label>
                  <label className={`flex items-center gap-2 ${String(config.webhook?.enabled) !== 'true' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 text-red-600 rounded border-neutral-300 focus:ring-red-500 disabled:opacity-50"
                      disabled={String(config.webhook?.enabled) !== 'true'}
                      checked={String(config.booking_code_delivery?.webhook) === 'true'}
                      onChange={(e) => updateConfig(['booking_code_delivery', 'webhook'], e.target.checked ? 'true' : 'false')}
                    />
                    <span className="text-sm font-medium text-neutral-700">由 Webhook 通道通知发放</span>
                  </label>
                </div>
                <p className="text-xs text-neutral-500 mt-2">注：Email及Webhook选项需要相应频道"全局启用"之后才可供选择使用。若您未勾选"网页"，那么网页上的预约成功界面则不显示预约代码，仅提醒用户通过其它方式查询。</p>
              </div>
            </div>
          )}
        </div>

        {/* SMTP 配置区 */}
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <button 
            type="button" 
            onClick={() => toggleSection('smtp')} 
            className="w-full flex items-center justify-between p-4 bg-neutral-50 hover:bg-neutral-100 transition-colors pointer-events-auto"
          >
            <div className="flex items-center gap-2 text-neutral-800 font-medium h-6">
              <Mail className="w-4 h-4 text-neutral-500" />
              SMTP邮件服务器
              {String(config.smtp?.enabled) === 'true' && <span className="ml-2 bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs">已启用</span>}
            </div>
            <div className="flex items-center gap-4">
              <div 
                className="flex items-center gap-2 text-sm text-neutral-600 font-normal outline-none focus:outline-none" 
                onClick={(e) => e.stopPropagation()}
              >
                <span>全局启用</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    value="" 
                    className="sr-only peer"
                    checked={String(config.smtp?.enabled) === 'true'}
                    onChange={(e) => updateConfig(['smtp', 'enabled'], e.target.checked ? 'true' : 'false')}
                  />
                  <div className="w-9 h-5 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600"></div>
                </label>
              </div>
              {openSections['smtp'] ? <ChevronDown className="w-5 h-5 text-neutral-400" /> : <ChevronRight className="w-5 h-5 text-neutral-400" />}
            </div>
          </button>

          {openSections['smtp'] && (
            <div className="p-6 border-t border-neutral-200">
               <div className="flex items-center justify-end mb-4">
                 <button 
                  onClick={() => testConnection('smtp')} 
                  className="text-xs flex items-center gap-1.5 font-medium px-3 py-1.5 rounded bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50 shadow-sm"
                 >
                   <Play className="w-3.5 h-3.5" /> 测试通道连通性
                 </button>
               </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-sm text-neutral-600 mb-1">Host 服务器地址</label>
                  <input
                    type="text"
                    value={config.smtp?.host || ''}
                    onChange={(e) => updateConfig(['smtp', 'host'], e.target.value)}
                    placeholder="smtp.example.com"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                  />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-sm text-neutral-600 mb-1">端口 (Port)</label>
                  <input
                    type="number"
                    value={config.smtp?.port || ''}
                    onChange={(e) => updateConfig(['smtp', 'port'], e.target.value)}
                    placeholder="465"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                  />
                  <p className="text-xs text-neutral-400 mt-1">通常 465 使用 SSL/TLS，其余则看服务商要求</p>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-neutral-600 mb-1">认证账号 (User)</label>
                  <input
                    type="text"
                    value={config.smtp?.user || ''}
                    onChange={(e) => updateConfig(['smtp', 'user'], e.target.value)}
                    placeholder="no-reply@test.com"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-neutral-600 mb-1">认证秘钥密码 (Password/Auth-Code)</label>
                  <input
                    type="password"
                    value={config.smtp?.pass || ''}
                    onChange={(e) => updateConfig(['smtp', 'pass'], e.target.value)}
                    placeholder="********"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                  />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-sm text-neutral-600 mb-1">发件地址</label>
                  <input
                    type="text"
                    value={config.smtp?.from_email || ''}
                    onChange={(e) => updateConfig(['smtp', 'from_email'], e.target.value)}
                    placeholder="no-reply@test.com"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                  />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-sm text-neutral-600 mb-1">展示昵称</label>
                  <input
                    type="text"
                    value={config.smtp?.from_name || ''}
                    onChange={(e) => updateConfig(['smtp', 'from_name'], e.target.value)}
                    placeholder="实验室系统"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Webhook 配置区 */}
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <button 
            type="button" 
            onClick={() => toggleSection('webhook')} 
            className="w-full flex items-center justify-between p-4 bg-neutral-50 hover:bg-neutral-100 transition-colors pointer-events-auto"
          >
            <div className="flex items-center gap-2 text-neutral-800 font-medium h-6">
              <Webhook className="w-4 h-4 text-neutral-500" />
              Webhook 设置
              {String(config.webhook?.enabled) === 'true' && <span className="ml-2 bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs">已启用</span>}
            </div>
            <div className="flex items-center gap-4">
              <div 
                className="flex items-center gap-2 text-sm text-neutral-600 font-normal outline-none focus:outline-none" 
                onClick={(e) => e.stopPropagation()}
              >
                <span>全局启用</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    value="" 
                    className="sr-only peer"
                    checked={String(config.webhook?.enabled) === 'true'}
                    onChange={(e) => updateConfig(['webhook', 'enabled'], e.target.checked ? 'true' : 'false')}
                  />
                  <div className="w-9 h-5 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600"></div>
                </label>
              </div>
              {openSections['webhook'] ? <ChevronDown className="w-5 h-5 text-neutral-400" /> : <ChevronRight className="w-5 h-5 text-neutral-400" />}
            </div>
          </button>

          {openSections['webhook'] && (
            <div className="p-6 border-t border-neutral-200">
               <div className="flex items-center justify-end mb-4">
                 <button 
                  onClick={() => testConnection('webhook')} 
                  className="text-xs flex items-center gap-1.5 font-medium px-3 py-1.5 rounded bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50 shadow-sm"
                 >
                   <Play className="w-3.5 h-3.5" /> 测试通道连通性
                 </button>
               </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-neutral-600 mb-1">Webhook 发送投递 URL</label>
                  <input
                    type="text"
                    value={config.webhook?.url || ''}
                    onChange={(e) => updateConfig(['webhook', 'url'], e.target.value)}
                    placeholder="https://hook.example.com/api/send"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                  />
                  <p className="text-xs text-neutral-400 mt-1">将在发生具体事件时，往该地址投递 POST 请求并贴合配置模板渲染后的 JSON 内容作为 Payload。</p>
                </div>
                <div>
                  <label className="block text-sm text-neutral-600 mb-1">请求头 Headers (JSON)</label>
                  <textarea
                    value={config.webhook?.headers || ''}
                    onChange={(e) => updateConfig(['webhook', 'headers'], e.target.value)}
                    placeholder='{"Authorization": "Bearer TOKEN"}'
                    rows={3}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm font-mono outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                  />
                  <p className="text-xs text-neutral-500 mt-1">确保内容为合法的 JSON String 格式</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 系统级通知事件分发 */}
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <button 
            type="button" 
            onClick={() => toggleSection('events')} 
            className="w-full flex items-center justify-between p-4 bg-neutral-50 hover:bg-neutral-100 transition-colors pointer-events-auto"
          >
            <div className="flex items-center gap-2 text-neutral-800 font-medium h-6">
              <Bell className="w-4 h-4 text-neutral-500" />
              事件通知管理 ({EVENT_TYPES.length})
            </div>
            {openSections['events'] ? <ChevronDown className="w-5 h-5 text-neutral-400" /> : <ChevronRight className="w-5 h-5 text-neutral-400" />}
          </button>

          {openSections['events'] && (
            <div className="border-t border-neutral-200 p-0">
               <ul className="divide-y divide-neutral-100">
                  {EVENT_TYPES.map(evt => {
                    const webhookEnabled = String(config.webhook?.events?.[evt.id]?.enabled) === 'true';
                    const emailEnabled = String(config.email?.events?.[evt.id]?.enabled) === 'true';
                    return (
                        <li key={evt.id} className="flex flex-col sm:flex-row px-6 py-4 hover:bg-neutral-50 sm:items-center justify-between group transition-colors gap-4">
                            <div>
                                <div className="font-medium text-neutral-900 flex items-center gap-2">
                                  {evt.name}
                                  <span className="text-xs bg-neutral-100 text-neutral-500 font-mono px-1.5 py-0.5 rounded">{evt.id}</span>
                                </div>
                                <div className="text-xs text-neutral-500 mt-1">{EVENT_MAP[evt.id]}</div>
                            </div>
                            <div className="flex items-center sm:gap-6 justify-between sm:justify-end">
                                <div className="flex items-center gap-4 border-r border-neutral-200 pr-6">
                                     <div className="flex flex-col gap-2 items-end">
                                        <div className="flex items-center gap-2 text-xs text-neutral-600">
                                            <Mail className="w-3.5 h-3.5 opacity-60" /> 邮件
                                            <label className="relative inline-flex items-center cursor-pointer">
                                              <input 
                                                type="checkbox" 
                                                className="sr-only peer"
                                                checked={emailEnabled}
                                                onChange={(e) => toggleEventOnOff(evt.id, 'email', e.target.checked)}
                                              />
                                              <div className="w-7 h-4 bg-neutral-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-red-600"></div>
                                            </label>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-neutral-600">
                                            <Webhook className="w-3.5 h-3.5 opacity-60" /> Hook
                                            <label className="relative inline-flex items-center cursor-pointer">
                                              <input 
                                                type="checkbox" 
                                                className="sr-only peer"
                                                checked={webhookEnabled}
                                                onChange={(e) => toggleEventOnOff(evt.id, 'webhook', e.target.checked)}
                                              />
                                              <div className="w-7 h-4 bg-neutral-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-red-600"></div>
                                            </label>
                                        </div>
                                     </div>
                                </div>
                                <button 
                                  onClick={() => setSelectedEvent(evt)} 
                                  className="text-neutral-500 hover:text-red-600 bg-neutral-100 hover:bg-red-50 p-2 rounded-lg transition-colors cursor-pointer"
                                  title="配置该事件"
                                >
                                    <Edit3 className="w-4 h-4" />
                                </button>
                            </div>
                        </li>
                    )
                  })}
               </ul>
            </div>
          )}
        </div>
      </div>

      {/* Settings Drawer for Event */}
      {selectedEvent && (
        <>
          <div className="fixed inset-0 bg-neutral-900/40 z-40 transition-opacity backdrop-blur-sm" onClick={() => setSelectedEvent(null)} />
          <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-xl z-50 transform transition-transform overflow-hidden flex flex-col border-l border-neutral-200">
            <div className="flex justify-between items-center px-6 py-5 border-b border-neutral-200 bg-neutral-50/50">
              <div>
                <h3 className="text-lg font-bold text-neutral-900 leading-tight">{selectedEvent.name}</h3>
                <code className="text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded mt-1.5 inline-block">{selectedEvent.id}</code>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-sm disabled:opacity-70"
                >
                  <Save className="w-4 h-4" />
                  {saving ? '保存中...' : '保存事件模板'}
                </button>
                <button onClick={() => setSelectedEvent(null)} className="text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200 p-2 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-neutral-50/30">
               {/* Drawer Variables Warning */}
               <div className="bg-red-50 border border-red-100 text-red-800 px-4 py-3 rounded-lg text-sm flex gap-3">
                  <Bell className="w-5 h-5 text-red-500 shrink-0" />
                  <div>
                    在JSON Payload和Markdown模板中可以使用以下变量：
                    <div className="mt-2 text-xs font-mono bg-white p-2 border border-red-100 rounded leading-relaxed text-red-900 break-words">{selectedEvent.vars}</div>
                  </div>
               </div>

               {/* Drawer Email Settings */}
               <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="flex items-center justify-between p-4 border-b border-neutral-100 bg-neutral-50 flex-wrap gap-y-3">
                      <div className="flex items-center gap-2 font-medium text-neutral-800">
                        <Mail className="w-4 h-4 text-neutral-500" />
                        Email 模板与抄送
                      </div>
                      <div className="flex items-center gap-4 flex-wrap">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              className="w-4 h-4 text-red-600 rounded border-neutral-300 focus:ring-red-500"
                              checked={String(config.email?.events?.[selectedEvent.id]?.notify_user) !== 'false'}
                              onChange={(e) => updateConfig(['email', 'events', selectedEvent.id, 'notify_user'], e.target.checked ? 'true' : 'false')}
                            />
                            <span className="text-sm text-neutral-600 select-none">当事人</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              className="w-4 h-4 text-red-600 rounded border-neutral-300 focus:ring-red-500"
                              checked={String(config.email?.events?.[selectedEvent.id]?.notify_admin) === 'true'}
                              onChange={(e) => updateConfig(['email', 'events', selectedEvent.id, 'notify_admin'], e.target.checked ? 'true' : 'false')}
                            />
                            <span className="text-sm text-neutral-600 select-none">系统管理组</span>
                          </label>
                          <button 
                            onClick={() => testEvent(selectedEvent.id, 'smtp')} 
                            className="text-xs ml-2 flex items-center gap-1 text-neutral-600 hover:text-neutral-900 bg-white border border-neutral-200 hover:border-neutral-300 px-2.5 py-1 rounded shadow-sm"
                          >
                            <Play className="w-3 h-3" /> 测试
                          </button>
                          <label className="flex items-center gap-2 cursor-pointer border-l border-neutral-300 pl-4">
                            <span className="text-sm text-neutral-600 select-none">使用该通道</span>
                            <div className="relative inline-flex items-center">
                              <input 
                                type="checkbox" 
                                className="sr-only peer"
                                checked={String(config.email?.events?.[selectedEvent.id]?.enabled) === 'true'}
                                onChange={(e) => updateConfig(['email', 'events', selectedEvent.id, 'enabled'], e.target.checked ? 'true' : 'false')}
                              />
                               <div className="w-9 h-5 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600"></div>
                            </div>
                          </label>
                      </div>
                  </div>
                  <div className="p-5 space-y-4">
                     <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-1.5">邮件标题 (Subject)</label>
                        <input
                          type="text"
                          value={config.email?.events?.[selectedEvent.id]?.subject || ''}
                          onChange={(e) => updateConfig(['email', 'events', selectedEvent.id, 'subject'], e.target.value)}
                          placeholder="[通知] 您的预约设置触发了通知..."
                          className="w-full px-4 py-2.5 border border-neutral-300 rounded-lg text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 transition-colors"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between mb-1.5 items-end">
                            <label className="block text-sm font-medium text-neutral-700">邮件正文 (Markdown)</label>
                            <span className="text-xs text-neutral-400 font-mono">支持 Markdown 排版语法，投递时会自动转为 HTML</span>
                        </div>
                        <textarea
                          value={config.email?.events?.[selectedEvent.id]?.template || ''}
                          onChange={(e) => updateConfig(['email', 'events', selectedEvent.id, 'template'], e.target.value)}
                          placeholder="## 尊敬的用户你好&#10;&#10;关于您在系统里的操作发生了以下改变......"
                          rows={10}
                          className="w-full px-4 py-3 border border-neutral-300 rounded-lg text-sm font-mono outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 transition-colors"
                        />
                      </div>
                  </div>
               </div>

               {/* Drawer Webhook Settings */}
               <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="flex items-center justify-between p-4 border-b border-neutral-100 bg-neutral-50 flex-wrap gap-y-3">
                      <div className="flex items-center gap-2 font-medium text-neutral-800">
                        <Webhook className="w-4 h-4 text-neutral-500" />
                        Webhook 模板
                      </div>
                      <div className="flex gap-4 items-center">
                         <button 
                            onClick={() => testEvent(selectedEvent.id, 'webhook')} 
                            className="text-xs flex items-center gap-1 text-neutral-600 hover:text-neutral-900 bg-white border border-neutral-200 hover:border-neutral-300 px-2.5 py-1 rounded shadow-sm"
                          >
                            <Play className="w-3 h-3" /> 测试
                          </button>
                          <label className="flex items-center gap-2 cursor-pointer border-l border-neutral-300 pl-4">
                            <span className="text-sm text-neutral-600 select-none">使用该通道</span>
                            <div className="relative inline-flex items-center">
                              <input 
                                type="checkbox" 
                                className="sr-only peer"
                                checked={String(config.webhook?.events?.[selectedEvent.id]?.enabled) === 'true'}
                                onChange={(e) => updateConfig(['webhook', 'events', selectedEvent.id, 'enabled'], e.target.checked ? 'true' : 'false')}
                              />
                               <div className="w-9 h-5 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600"></div>
                            </div>
                          </label>
                      </div>
                  </div>
                  <div className="p-5">
                      <textarea
                        value={config.webhook?.events?.[selectedEvent.id]?.template || ''}
                        onChange={(e) => updateConfig(['webhook', 'events', selectedEvent.id, 'template'], e.target.value)}
                        placeholder='{"msgtype":"text","text":{"content":"{{ student_id }} 触发了 {{ event_name }}"}}'
                        rows={6}
                        className="w-full px-4 py-3 border border-neutral-300 rounded-lg text-sm font-mono outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 transition-colors"
                      />
                  </div>
               </div>

            </div>
          </div>
        </>
      )}
    </div>
  );
}
