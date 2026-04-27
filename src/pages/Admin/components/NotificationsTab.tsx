import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { flattenObj, unflattenObj } from '../../../utils';
import { Save, Bell, Mail, Webhook, Settings, Play } from 'lucide-react';

interface NotificationsTabProps {
  token: string | null;
}

export default function NotificationsTab({ token }: NotificationsTabProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState<any>({
      notification_interval_seconds: '1',
      smtp: { enabled: false, admin_emails: '' },
      webhook: { enabled: false, events: {} },
      email: { events: {} }
    });

    const EVENT_TYPES = [
    { id: 'booking_created', name: '预约成功', vars: '{{ student_id }}, {{ equipment_name }}, {{ booking_code }}, {{ start_time }}, {{ end_time }}' },
    { id: 'booking_cancelled', name: '预约取消', vars: '{{ student_id }}, {{ equipment_name }}, {{ booking_code }}' },
    { id: 'violation_created', name: '违规记录', vars: '{{ student_id }}, {{ violation_type }}, {{ equipment_name }}' },
    { id: 'penalty_triggered', name: '触发封禁', vars: '{{ student_id }}, {{ rule_name }}, {{ penalty_method }}, {{ start_time }}, {{ end_time }}' }
  ];

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

  if (loading) return <div className="p-8 text-center text-neutral-500">加载中...</div>;

  return (
    <div className="space-y-8 pb-16">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-medium text-neutral-900 flex items-center gap-2">
            <Bell className="w-5 h-5 text-indigo-600" />
            系统通知配置
          </h2>
          <p className="text-sm text-neutral-500 mt-1">配置邮件服务器及 Webhook，实现系统的全自动化触达。</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          {saving ? '保存中...' : '保存配置'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 全局设置区 */}
        <div className="bg-white p-6 rounded-lg border border-neutral-200 col-span-1 lg:col-span-2">
          <h3 className="text-base font-medium text-neutral-900 flex items-center gap-2 mb-4">
            <Settings className="w-4 h-4" />
            全局流控限制
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">通知发送时间间隔(秒)</label>
              <input
                type="number"
                value={config.notification_interval_seconds || '1'}
                onChange={(e) => updateConfig(['notification_interval_seconds'], e.target.value)}
                placeholder="1"
                className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm"
              />
              <p className="text-xs text-neutral-500 mt-1">控制消息分发队列在发送时的最快吐出速率，防止过度拥堵或被拉黑限制。</p>
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">系统管理员邮箱列表</label>
              <input
                type="text"
                value={config.smtp?.admin_emails || ''}
                onChange={(e) => updateConfig(['smtp', 'admin_emails'], e.target.value)}
                placeholder="admin1@test.com, admin2@test.com"
                className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm"
              />
              <p className="text-xs text-neutral-500 mt-1">支持英文逗号分隔的多邮箱。后续可配置将部分事件抄送给名单成员。</p>
            </div>
          </div>
        </div>

        {/* SMTP 配置区 */}
        <div className="bg-white p-6 rounded-lg border border-neutral-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-medium text-neutral-900 flex items-center gap-2">
              <Mail className="w-4 h-4" />
              SMTP 邮件服务器
            </h3>
            <div className="flex items-center gap-4">
              <button 
                onClick={() => testConnection('smtp')} 
                className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium"
              >
                <Play className="w-3 h-3" /> 测试连接
              </button>
              <label className="flex items-center gap-2 cursor-pointer border-l border-neutral-300 pl-4">
                <span className="text-sm text-neutral-600">全局启用</span>
                <input
                  type="checkbox"
                  className="w-4 h-4 text-indigo-600 rounded"
                  checked={String(config.smtp?.enabled) === 'true'}
                  onChange={(e) => updateConfig(['smtp', 'enabled'], e.target.checked ? 'true' : 'false')}
                />
              </label>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm text-neutral-600 mb-1">Host 服务器地址</label>
              <input
                type="text"
                value={config.smtp?.host || ''}
                onChange={(e) => updateConfig(['smtp', 'host'], e.target.value)}
                placeholder="smtp.example.com"
                className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">端口 (Port)</label>
              <input
                type="number"
                value={config.smtp?.port || ''}
                onChange={(e) => updateConfig(['smtp', 'port'], e.target.value)}
                placeholder="465"
                className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">账号 (User)</label>
              <input
                type="text"
                value={config.smtp?.user || ''}
                onChange={(e) => updateConfig(['smtp', 'user'], e.target.value)}
                placeholder="no-reply@test.com"
                className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm text-neutral-600 mb-1">密码 (Password/Auth-Code)</label>
              <input
                type="password"
                value={config.smtp?.pass || ''}
                onChange={(e) => updateConfig(['smtp', 'pass'], e.target.value)}
                placeholder="********"
                className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">发件人邮箱</label>
              <input
                type="text"
                value={config.smtp?.from_email || ''}
                onChange={(e) => updateConfig(['smtp', 'from_email'], e.target.value)}
                placeholder="no-reply@test.com"
                className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">发件人昵称</label>
              <input
                type="text"
                value={config.smtp?.from_name || ''}
                onChange={(e) => updateConfig(['smtp', 'from_name'], e.target.value)}
                placeholder="实验室预约系统"
                className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm"
              />
            </div>
          </div>
        </div>

        {/* Webhook 配置区 */}
        <div className="bg-white p-6 rounded-lg border border-neutral-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-medium text-neutral-900 flex items-center gap-2">
              <Webhook className="w-4 h-4" />
              Webhook 频道设定
            </h3>
            <div className="flex items-center gap-4">
              <button 
                onClick={() => testConnection('webhook')} 
                className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium"
              >
                <Play className="w-3 h-3" /> 测试连接
              </button>
              <label className="flex items-center gap-2 cursor-pointer border-l border-neutral-300 pl-4">
                <span className="text-sm text-neutral-600">全局启用</span>
                <input
                  type="checkbox"
                  className="w-4 h-4 text-indigo-600 rounded"
                  checked={String(config.webhook?.enabled) === 'true'}
                  onChange={(e) => updateConfig(['webhook', 'enabled'], e.target.checked ? 'true' : 'false')}
                />
              </label>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Webhook URL</label>
              <input
                type="text"
                value={config.webhook?.url || ''}
                onChange={(e) => updateConfig(['webhook', 'url'], e.target.value)}
                placeholder="https://hook.example.com/api/send"
                className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">请求头 Headers (JSON)</label>
              <textarea
                value={config.webhook?.headers || ''}
                onChange={(e) => updateConfig(['webhook', 'headers'], e.target.value)}
                placeholder='{"Authorization": "Bearer TOKEN"}'
                rows={3}
                className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm font-mono"
              />
              <p className="text-xs text-neutral-500 mt-1">确保内容为合法的 JSON String 格式</p>
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">签名 Secret (可选)</label>
              <input
                type="text"
                value={config.webhook?.secret || ''}
                onChange={(e) => updateConfig(['webhook', 'secret'], e.target.value)}
                placeholder="(预留项) 验签使用"
                className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium text-neutral-900 mb-4">事件驱动模板设置</h3>
        <div className="space-y-4">
          {EVENT_TYPES.map(evt => {
            const webhookEnabled = String(config.webhook?.events?.[evt.id]?.enabled) === 'true';
            const emailEnabled = String(config.email?.events?.[evt.id]?.enabled) === 'true';

            return (
              <details key={evt.id} className="bg-white border text-sm border-neutral-200 rounded-lg group">
                <summary className="px-6 py-4 flex items-center justify-between cursor-pointer list-none hover:bg-neutral-50">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-neutral-800">{evt.name}</span>
                    <span className="text-xs text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded">{evt.id}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className={`px-2 py-1 rounded ${webhookEnabled ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-500'}`}>
                      Webhook: {webhookEnabled ? '开' : '关'}
                    </span>
                    <span className={`px-2 py-1 rounded ${emailEnabled ? 'bg-blue-50 text-blue-700' : 'bg-neutral-100 text-neutral-500'}`}>
                      Email: {emailEnabled ? '开' : '关'}
                    </span>
                    <span className="text-neutral-400 group-open:rotate-180 transition-transform">▼</span>
                  </div>
                </summary>
                
                <div className="p-6 border-t border-neutral-200 bg-neutral-50 grid grid-cols-1 xl:grid-cols-2 gap-6">
                  {/* Webhook 面板 */}
                  <div className="bg-white border border-neutral-200 rounded-md p-4">
                    <div className="flex justify-between items-center mb-3">
                      <div className="font-medium text-neutral-700 flex items-center gap-2">
                        <Webhook className="w-4 h-4 text-neutral-400" />
                        Webhook 模板
                      </div>
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={() => testEvent(evt.id, 'webhook')} 
                          className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          <Play className="w-3 h-3" /> 测试模板
                        </button>
                        <label className="flex items-center gap-2 cursor-pointer border-l pl-4 border-neutral-300">
                          <input
                            type="checkbox"
                            className="w-4 h-4 text-indigo-600 rounded"
                            checked={webhookEnabled}
                            onChange={(e) => updateConfig(['webhook', 'events', evt.id, 'enabled'], e.target.checked ? 'true' : 'false')}
                          />
                          <span className="text-xs text-neutral-600">启用该事件</span>
                        </label>
                      </div>
                    </div>
                    <p className="text-xs text-neutral-500 mb-2">
                      可用变量：<code className="text-indigo-600 bg-indigo-50 px-1 rounded">{evt.vars}</code>
                    </p>
                    <textarea
                      value={config.webhook?.events?.[evt.id]?.template || ''}
                      onChange={(e) => updateConfig(['webhook', 'events', evt.id, 'template'], e.target.value)}
                      placeholder='{"msgtype":"text","text":{"content":"{{ student_id }} 触发了 {{ event_name }}"}}'
                      rows={6}
                      className="w-full px-3 py-2 border border-neutral-300 rounded-md text-xs font-mono"
                    />
                  </div>

                  {/* Email 面板 */}
                  <div className="bg-white border border-neutral-200 rounded-md p-4">
                    <div className="flex justify-between items-center mb-3">
                      <div className="font-medium text-neutral-700 flex items-center gap-2">
                        <Mail className="w-4 h-4 text-neutral-400" />
                        Email 模板
                      </div>
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={() => testEvent(evt.id, 'smtp')} 
                          className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          <Play className="w-3 h-3" /> 测试模板
                        </button>
                        <label className="flex items-center gap-1 cursor-pointer border-l pl-4 border-neutral-300">
                          <input
                            type="checkbox"
                            className="w-3.5 h-3.5 text-indigo-600 rounded"
                            checked={String(config.email?.events?.[evt.id]?.notify_user) !== 'false'}
                            onChange={(e) => updateConfig(['email', 'events', evt.id, 'notify_user'], e.target.checked ? 'true' : 'false')}
                          />
                          <span className="text-xs text-neutral-600">发给当事人</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            className="w-3.5 h-3.5 text-indigo-600 rounded"
                            checked={String(config.email?.events?.[evt.id]?.notify_admin) === 'true'}
                            onChange={(e) => updateConfig(['email', 'events', evt.id, 'notify_admin'], e.target.checked ? 'true' : 'false')}
                          />
                          <span className="text-xs text-neutral-600">抄送管理员</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer border-l pl-4 border-neutral-300">
                          <input
                            type="checkbox"
                            className="w-4 h-4 text-indigo-600 rounded"
                            checked={emailEnabled}
                            onChange={(e) => updateConfig(['email', 'events', evt.id, 'enabled'], e.target.checked ? 'true' : 'false')}
                          />
                          <span className="text-xs text-neutral-600">启用该事件</span>
                        </label>
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-neutral-600 mb-1">邮件标题 (Subject)</label>
                        <input
                          type="text"
                          value={config.email?.events?.[evt.id]?.subject || ''}
                          onChange={(e) => updateConfig(['email', 'events', evt.id, 'subject'], e.target.value)}
                          placeholder="[通知] 您的预约成功"
                          className="w-full px-3 py-2 border border-neutral-300 rounded-md text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs flex justify-between text-neutral-600 mb-1">
                          <span>邮件正文 (HTML)</span>
                          <span className="text-neutral-400">可用变量同左</span>
                        </label>
                        <textarea
                          value={config.email?.events?.[evt.id]?.template || ''}
                          onChange={(e) => updateConfig(['email', 'events', evt.id, 'template'], e.target.value)}
                          placeholder="<html><body>你好 {{ student_id }}...</body></html>"
                          rows={4}
                          className="w-full px-3 py-2 border border-neutral-300 rounded-md text-xs font-mono"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </div>
  );
}
