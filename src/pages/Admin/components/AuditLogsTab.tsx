import React, { useState, useEffect, useRef } from 'react';
import { FileText, Filter, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';

interface AuditLogsTabProps {
  token: string;
  handleLogout: () => void;
}

export default function AuditLogsTab({ token, handleLogout }: AuditLogsTabProps) {
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  
  // Audit Log Filters
  const [auditFilterTimeStart, setAuditFilterTimeStart] = useState('');
  const [auditFilterTimeEnd, setAuditFilterTimeEnd] = useState('');
  const [auditFilterResId, setAuditFilterResId] = useState('');
  const [auditFilterAction, setAuditFilterAction] = useState('');
  const [auditFilterBefore, setAuditFilterBefore] = useState('');
  const [auditFilterAfter, setAuditFilterAfter] = useState('');
  const [showAuditMobileFilters, setShowAuditMobileFilters] = useState(false);
  const [showAuditTimeFilterPopup, setShowAuditTimeFilterPopup] = useState(false);
  const auditTimeFilterPopupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (auditTimeFilterPopupRef.current && !auditTimeFilterPopupRef.current.contains(event.target as Node)) {
        setShowAuditTimeFilterPopup(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchAuditLogs = async () => {
    try {
      const res = await fetch('/api/admin/audit-logs', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return handleLogout();
      const data = await res.json();
      setAuditLogs(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (token) {
      fetchAuditLogs();
    }
  }, [token]);

  const filteredAuditLogs = auditLogs.filter(log => {
    if (auditFilterTimeStart && new Date(log.created_at + 'Z') < new Date(auditFilterTimeStart)) return false;
    if (auditFilterTimeEnd && new Date(log.created_at + 'Z') > new Date(auditFilterTimeEnd)) return false;
    if (auditFilterResId && !String(log.reservation_id).includes(auditFilterResId)) return false;
    if (auditFilterAction && !log.action.toLowerCase().includes(auditFilterAction.toLowerCase())) return false;
    if (auditFilterBefore && !(log.old_data || '').toLowerCase().includes(auditFilterBefore.toLowerCase())) return false;
    if (auditFilterAfter && !(log.new_data || '').toLowerCase().includes(auditFilterAfter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
      <div className="p-4 border-b border-neutral-200 flex items-center justify-between bg-neutral-50">
        <h3 className="font-bold flex items-center gap-2">
          <FileText className="w-5 h-5 text-red-600" />
          审计日志 (最近 100 条)
        </h3>
        <button
          type="button"
          onClick={() => setShowAuditMobileFilters(!showAuditMobileFilters)}
          className="md:hidden p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 rounded-lg flex items-center gap-2"
        >
          <Filter className="w-5 h-5" />
          <span className="text-sm font-medium">筛选</span>
        </button>
      </div>
      {showAuditMobileFilters && (
        <div className="p-4 border-b border-neutral-200 bg-neutral-50 grid grid-cols-1 gap-4 md:hidden">
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">时间</label>
            <div className="flex gap-2">
              <input type="date" value={auditFilterTimeStart ? format(new Date(auditFilterTimeStart), 'yyyy-MM-dd') : ''} onChange={e => setAuditFilterTimeStart(e.target.value ? new Date(e.target.value).toISOString() : '')} className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
              <input type="date" value={auditFilterTimeEnd ? format(new Date(auditFilterTimeEnd), 'yyyy-MM-dd') : ''} onChange={e => {
                if (e.target.value) {
                  const date = new Date(e.target.value);
                  date.setHours(23, 59, 59, 999);
                  setAuditFilterTimeEnd(date.toISOString());
                } else {
                  setAuditFilterTimeEnd('');
                }
              }} className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">预约 ID</label>
            <input type="text" placeholder="搜索 ID..." value={auditFilterResId} onChange={e => setAuditFilterResId(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">操作</label>
            <input type="text" placeholder="搜索操作..." value={auditFilterAction} onChange={e => setAuditFilterAction(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">修改前</label>
            <input type="text" placeholder="搜索内容..." value={auditFilterBefore} onChange={e => setAuditFilterBefore(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">修改后</label>
            <input type="text" placeholder="搜索内容..." value={auditFilterAfter} onChange={e => setAuditFilterAfter(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left whitespace-nowrap block md:table">
          <thead className="bg-neutral-50 text-neutral-500 text-xs hidden md:table-header-group">
            <tr>
              <th className="px-4 py-4 font-medium align-top">
                <div className="mb-2">时间</div>
                <div className="relative" ref={auditTimeFilterPopupRef}>
                  <button 
                    onClick={() => setShowAuditTimeFilterPopup(!showAuditTimeFilterPopup)}
                    className="w-32 px-2 py-1 text-xs rounded border border-neutral-300 bg-white text-left flex items-center justify-between truncate"
                  >
                    <span className="truncate">
                      {auditFilterTimeStart || auditFilterTimeEnd 
                        ? `${auditFilterTimeStart ? format(new Date(auditFilterTimeStart), 'MM-dd') : '不限'} 至 ${auditFilterTimeEnd ? format(new Date(auditFilterTimeEnd), 'MM-dd') : '不限'}`
                        : '全部时间'}
                    </span>
                    <ChevronDown className="w-3 h-3 ml-1 shrink-0" />
                  </button>
                  {showAuditTimeFilterPopup && (
                    <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 z-10">
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs text-neutral-500 mb-1">开始日期</label>
                          <input 
                            type="date" 
                            value={auditFilterTimeStart ? format(new Date(auditFilterTimeStart), 'yyyy-MM-dd') : ''}
                            onChange={e => setAuditFilterTimeStart(e.target.value ? new Date(e.target.value).toISOString() : '')}
                            className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-neutral-500 mb-1">结束日期</label>
                          <input 
                            type="date" 
                            value={auditFilterTimeEnd ? format(new Date(auditFilterTimeEnd), 'yyyy-MM-dd') : ''}
                            onChange={e => {
                              if (e.target.value) {
                                const date = new Date(e.target.value);
                                date.setHours(23, 59, 59, 999);
                                setAuditFilterTimeEnd(date.toISOString());
                              } else {
                                setAuditFilterTimeEnd('');
                              }
                            }}
                            className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                          />
                        </div>
                        <div className="flex justify-end gap-2 pt-2 border-t border-neutral-100">
                          <button 
                            onClick={() => { setAuditFilterTimeStart(''); setAuditFilterTimeEnd(''); }}
                            className="text-xs text-neutral-500 hover:text-neutral-700"
                          >
                            重置
                          </button>
                          <button 
                            onClick={() => setShowAuditTimeFilterPopup(false)}
                            className="text-xs bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700"
                          >
                            确定
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </th>
              <th className="px-4 py-4 font-medium align-top">
                <div className="mb-2">预约 ID</div>
                <input 
                  type="text" 
                  placeholder="搜索 ID..." 
                  value={auditFilterResId}
                  onChange={e => setAuditFilterResId(e.target.value)}
                  className="w-20 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                />
              </th>
              <th className="px-4 py-4 font-medium align-top">
                <div className="mb-2">操作</div>
                <input 
                  type="text" 
                  placeholder="搜索操作..." 
                  value={auditFilterAction}
                  onChange={e => setAuditFilterAction(e.target.value)}
                  className="w-24 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                />
              </th>
              <th className="px-4 py-4 font-medium align-top">
                <div className="mb-2">修改前</div>
                <input 
                  type="text" 
                  placeholder="搜索内容..." 
                  value={auditFilterBefore}
                  onChange={e => setAuditFilterBefore(e.target.value)}
                  className="w-32 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                />
              </th>
              <th className="px-4 py-4 font-medium align-top">
                <div className="mb-2">修改后</div>
                <input 
                  type="text" 
                  placeholder="搜索内容..." 
                  value={auditFilterAfter}
                  onChange={e => setAuditFilterAfter(e.target.value)}
                  className="w-32 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                />
              </th>
            </tr>
          </thead>
          <tbody className="block md:table-row-group divide-y divide-neutral-100 md:divide-y-0 p-4 md:p-0">
            {filteredAuditLogs.map((log: any) => (
              <tr key={log.id} className="block md:table-row hover:bg-neutral-50/50 border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none">
                <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                  <div className="flex justify-between items-center md:block">
                    <span className="md:hidden font-medium text-neutral-500 text-xs">时间</span>
                    <span className="text-xs text-neutral-500">{format(new Date(log.created_at + 'Z'), 'yyyy-MM-dd HH:mm:ss')}</span>
                  </div>
                </td>
                <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                  <div className="flex justify-between items-center md:block">
                    <span className="md:hidden font-medium text-neutral-500 text-xs">预约 ID</span>
                    <span className="font-mono text-xs text-neutral-900">{log.reservation_id}</span>
                  </div>
                </td>
                <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                  <div className="flex justify-between items-center md:block">
                    <span className="md:hidden font-medium text-neutral-500 text-xs">操作</span>
                    <span className="px-2 py-1 bg-neutral-100 text-neutral-700 rounded-lg text-xs font-medium">
                      {log.action}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                  <div className="flex flex-col md:block gap-2">
                    <span className="md:hidden font-medium text-neutral-500 text-xs">修改前</span>
                    <div className="max-h-24 overflow-y-auto w-full md:w-64 text-xs font-mono text-neutral-500 bg-neutral-50 p-2 rounded border border-neutral-100">
                      {log.old_data ? JSON.stringify(JSON.parse(log.old_data), null, 2) : '-'}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 md:py-4 block md:table-cell">
                  <div className="flex flex-col md:block gap-2">
                    <span className="md:hidden font-medium text-neutral-500 text-xs">修改后</span>
                    <div className="max-h-24 overflow-y-auto w-full md:w-64 text-xs font-mono text-neutral-500 bg-neutral-50 p-2 rounded border border-neutral-100">
                      {log.new_data ? JSON.stringify(JSON.parse(log.new_data), null, 2) : '-'}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
            {auditLogs.length === 0 && (
              <tr className="block md:table-row">
                <td colSpan={5} className="px-4 py-12 text-center text-neutral-500 block md:table-cell">暂无审计日志</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
