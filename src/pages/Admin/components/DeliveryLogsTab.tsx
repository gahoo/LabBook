import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw, Clock, CheckCircle2, XCircle, AlertCircle, RefreshCcw, Filter, X } from 'lucide-react';
import { format, subDays, startOfToday } from 'date-fns';

interface DeliveryLogsTabProps {
  token: string | null;
}

export default function DeliveryLogsTab({ token }: DeliveryLogsTabProps) {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [targetFilter, setTargetFilter] = useState('');
  const [referenceFilter, setReferenceFilter] = useState('');
  const [startDate, setStartDate] = useState(format(subDays(startOfToday(), 7), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(startOfToday(), 'yyyy-MM-dd'));
  const [page, setPage] = useState(1);
  const limit = 20;

  const [showStatusFilterPopup, setShowStatusFilterPopup] = useState(false);
  const [showTimePopup, setShowTimePopup] = useState(false);
  const statusPopupRef = useRef<HTMLDivElement>(null);
  const timePopupRef = useRef<HTMLDivElement>(null);
  const [showFailureReasonId, setShowFailureReasonId] = useState<number | null>(null);

  const STATUSES = ['待发送', '重试中', '发送成功', '发送失败'];

  const EVENT_MAP: Record<string, string> = {
    booking_created: '预约成功',
    booking_approved: '预约审批通过',
    booking_rejected: '预约审批驳回',
    booking_cancelled: '预约取消',
    violation_created: '违规记录',
    appeal_resolved: '申诉结果通知',
    whitelist_resolved: '白名单审批结果',
    penalty_triggered: '处罚触发',
  };

  const EVENT_OPTIONS = Object.entries(EVENT_MAP).map(([id, name]) => ({ id, name }));

  const [showEventFilterPopup, setShowEventFilterPopup] = useState(false);
  const eventPopupRef = useRef<HTMLDivElement>(null);
  const [eventFilter, setEventFilter] = useState<string[]>([]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (statusPopupRef.current && !statusPopupRef.current.contains(event.target as Node)) {
        setShowStatusFilterPopup(false);
      }
      if (timePopupRef.current && !timePopupRef.current.contains(event.target as Node)) {
        setShowTimePopup(false);
      }
      if (eventPopupRef.current && !eventPopupRef.current.contains(event.target as Node)) {
        setShowEventFilterPopup(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [statusFilter, eventFilter, startDate, endDate, page, token]);

  // Handle Enter key in reference filter
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchLogs();
    }, 500);
    return () => clearTimeout(timer);
  }, [referenceFilter, targetFilter]);

  const fetchLogs = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        status: statusFilter.length > 0 ? statusFilter.join(',') : '全部',
        reference_code: referenceFilter,
        target: targetFilter,
        startDate: startDate,
        endDate: endDate,
        page: String(page),
        limit: String(limit)
      });
      const res = await fetch(`/api/admin/delivery-logs?${qs.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
        setTotal(data.total);
      } else {
        toast.error('获取日志列表失败');
      }
    } catch (e) {
      toast.error('网络错误');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/delivery-logs/${id}/retry`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('已重新置入队列，将即刻发起重试');
        fetchLogs();
      } else {
        toast.error('重试失败');
      }
    } catch (e) {
      toast.error('网络请求失败');
    }
  };

  const renderStatus = (status: string, error_message: string | null, id: number) => {
    let content = null;
    switch(status) {
      case 'pending': 
        content = <span className="flex items-center gap-1 w-fit text-yellow-600 bg-yellow-50 px-2 py-1 rounded-full text-xs font-medium"><Clock className="w-3 h-3"/> 待发送</span>;
        break;
      case 'retrying': 
        content = <span className="flex items-center gap-1 w-fit text-orange-600 bg-orange-50 px-2 py-1 rounded-full text-xs font-medium"><RefreshCw className="w-3 h-3"/> 重试中</span>;
        break;
      case 'success': 
        content = <span className="flex items-center gap-1 w-fit text-green-600 bg-green-50 px-2 py-1 rounded-full text-xs font-medium"><CheckCircle2 className="w-3 h-3"/> 已送达</span>;
        break;
      case 'failed': 
        content = <span className="flex items-center gap-1 w-fit text-red-600 bg-red-50 px-2 py-1 rounded-full text-xs font-medium"><XCircle className="w-3 h-3"/> 失败</span>;
        break;
      default:
        content = <span className="text-gray-500">{status}</span>;
    }

    if (!error_message) return content;

    return (
      <div className="relative inline-block">
        {content}
        <button 
          onClick={() => setShowFailureReasonId(id)}
          className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border border-white cursor-pointer hover:bg-red-600 transition-colors"
          title="点击查看失败原因"
        />
        {showFailureReasonId === id && (
          <div className="absolute top-10 left-0 w-64 p-3 bg-white border border-neutral-200 shadow-xl rounded-lg z-50 text-xs">
            <div className="flex justify-between items-start mb-2">
              <span className="font-semibold text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> 失败原因</span>
              <button onClick={() => setShowFailureReasonId(null)} className="text-neutral-400 hover:text-neutral-600"><X className="w-3 h-3"/></button>
            </div>
            <div className="text-neutral-600 whitespace-pre-wrap break-words">{error_message}</div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-6">
      <div className="flex flex-col md:flex-row items-center justify-between mb-6 gap-4">
        <h2 className="text-lg font-bold text-neutral-800">消息队列日志</h2>
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="relative" ref={timePopupRef}>
            <button 
              onClick={() => setShowTimePopup(!showTimePopup)}
              className="px-3 py-2 text-sm rounded-lg border border-neutral-300 bg-white flex items-center gap-2 outline-none hover:bg-neutral-50 focus:border-red-500 text-neutral-600 transition-colors shadow-sm"
            >
              <Filter className="w-4 h-4" />
              {startDate === endDate ? startDate : `${startDate} 至 ${endDate}`}
            </button>
            {showTimePopup && (
              <div className="absolute top-full right-0 mt-2 p-4 bg-white border border-neutral-200 rounded-xl shadow-xl z-20 w-72 font-normal">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1.5">开始日期</label>
                    <input 
                      type="date" 
                      value={startDate} 
                      onChange={e => { setStartDate(e.target.value); setPage(1); }}
                      className="w-full text-sm px-3 py-2 border border-neutral-300 rounded-lg focus:ring-red-500 focus:border-red-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1.5">结束日期</label>
                    <input 
                      type="date" 
                      value={endDate} 
                      onChange={e => { setEndDate(e.target.value); setPage(1); }}
                      className="w-full text-sm px-3 py-2 border border-neutral-300 rounded-lg focus:ring-red-500 focus:border-red-500 outline-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm block md:table">
            <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200 hidden md:table-header-group">
              <tr>
                <th className="px-4 py-4 font-medium align-top w-20">任务ID</th>
                <th className="px-4 py-4 font-medium align-top w-48">
                  <div className="mb-2">状态</div>
                  <div className="relative" ref={statusPopupRef}>
                    <button 
                      onClick={() => setShowStatusFilterPopup(!showStatusFilterPopup)}
                      className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 bg-white text-left min-h-[30px] flex flex-wrap gap-1 items-center outline-none focus:border-red-500"
                    >
                      {statusFilter.length > 0 ? (
                        statusFilter.map(s => (
                          <span key={s} className="bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded flex items-center gap-1">
                            {s}
                            <X 
                              className="w-3 h-3 cursor-pointer hover:text-red-500" 
                              onClick={(e) => {
                                e.stopPropagation();
                                setStatusFilter(prev => prev.filter(v => v !== s));
                                setPage(1);
                              }}
                            />
                          </span>
                        ))
                      ) : (
                        <span className="text-neutral-400">全部状态</span>
                      )}
                    </button>
                    {showStatusFilterPopup && (
                      <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-neutral-200 rounded-lg shadow-lg p-2 z-10 font-normal">
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {STATUSES.map((value) => (
                            <label key={value} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-50 rounded cursor-pointer">
                              <input 
                                type="checkbox" 
                                checked={statusFilter.includes(value)}
                                onChange={e => {
                                  if (e.target.checked) setStatusFilter(prev => [...prev, value]);
                                  else setStatusFilter(prev => prev.filter(v => v !== value));
                                  setPage(1);
                                }}
                                className="rounded border-neutral-300 text-red-600 focus:ring-red-500"
                              />
                              <span className="text-sm text-neutral-700">{value}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </th>
                <th className="px-4 py-4 font-medium align-top w-48">
                  <div className="mb-2">事件</div>
                  <div className="relative" ref={eventPopupRef}>
                    <button 
                      onClick={() => setShowEventFilterPopup(!showEventFilterPopup)}
                      className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 bg-white text-left min-h-[30px] flex flex-wrap gap-1 items-center outline-none focus:border-red-500"
                    >
                      {eventFilter.length > 0 ? (
                        eventFilter.map(e => (
                          <span key={e} className="bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded flex items-center gap-1">
                            {EVENT_MAP[e] || e}
                            <X 
                              className="w-3 h-3 cursor-pointer hover:text-red-500" 
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setEventFilter(prev => prev.filter(v => v !== e));
                                setPage(1);
                              }}
                            />
                          </span>
                        ))
                      ) : (
                        <span className="text-neutral-400">全部事件</span>
                      )}
                    </button>
                    {showEventFilterPopup && (
                      <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-neutral-200 rounded-lg shadow-lg p-2 z-10 font-normal">
                        <div className="space-y-1 max-h-64 overflow-y-auto">
                          {EVENT_OPTIONS.map((opt) => (
                            <label key={opt.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-50 rounded cursor-pointer">
                              <input 
                                type="checkbox" 
                                checked={eventFilter.includes(opt.id)}
                                onChange={e => {
                                  if (e.target.checked) setEventFilter(prev => [...prev, opt.id]);
                                  else setEventFilter(prev => prev.filter(v => v !== opt.id));
                                  setPage(1);
                                }}
                                className="rounded border-neutral-300 text-red-600 focus:ring-red-500"
                              />
                              <span className="text-sm text-neutral-700">{opt.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </th>
                <th className="px-4 py-4 font-medium align-top w-56">
                  <div className="mb-2">频道 / 投递目标</div>
                  <input 
                    type="text" 
                    placeholder="搜索目标..." 
                    value={targetFilter}
                    onChange={(e) => setTargetFilter(e.target.value)}
                    className="w-full px-2 py-1.5 border border-neutral-300 rounded text-sm placeholder-neutral-400 focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none"
                  />
                </th>
                <th className="px-4 py-4 font-medium align-top w-48">
                  <div className="mb-2">预约码</div>
                  <input 
                    type="text" 
                    placeholder="搜索预约码..." 
                    value={referenceFilter}
                    onChange={(e) => setReferenceFilter(e.target.value)}
                    className="w-full px-2 py-1.5 border border-neutral-300 rounded text-sm placeholder-neutral-400 focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none"
                  />
                </th>
                <th className="px-4 py-4 font-medium align-top w-32">
                  <div className="mb-2">投递时间</div>
                </th>
                <th className="px-4 py-4 font-medium align-top w-24 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group divide-y divide-neutral-100 md:divide-y-0 p-4 md:p-0">
              {logs.map(log => (
                <tr key={log.id} className="block md:table-row hover:bg-neutral-50/50 border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none">
                  <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                     <span className="md:hidden font-medium text-neutral-500 mr-2">任务ID:</span>
                     <span className="text-neutral-500">#{log.id}</span>
                  </td>
                  <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                     <span className="md:hidden font-medium text-neutral-500 mr-2 flex items-center float-left h-full mt-0.5">状态:</span>
                    <div className="flex items-center py-0.5">
                      {renderStatus(log.status, log.error_message, log.id)}
                      {log.retry_count > 0 && <span className="ml-2 text-xs text-neutral-400">重试x{log.retry_count}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                      <span className="md:hidden font-medium text-neutral-500 mr-2">事件:</span>
                      <span className="text-neutral-800">{EVENT_MAP[log.event] || log.event}</span>
                  </td>
                  <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none max-w-xs truncate" title={`${log.channel.toUpperCase()}: ${log.target}`}>
                      <span className="md:hidden font-medium text-neutral-500 mr-2">频道 / 投递目标:</span>
                      <span className="text-xs text-red-600 font-medium bg-red-50 px-1 rounded mr-1.5">{log.channel.toUpperCase()}</span>
                      {log.target} 
                  </td>
                  <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none text-neutral-500 font-mono text-xs">
                      <span className="md:hidden font-medium text-neutral-500 mr-2 font-sans text-sm">预约码:</span>
                      {log.reference_code || '-'}
                  </td>
                  <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                    <span className="md:hidden font-medium text-neutral-500 mr-2 w-full block mb-1">投递时间:</span>
                    <div className="text-neutral-700">{format(new Date(log.created_at + 'Z'), 'MM-dd HH:mm:ss')}</div>
                    {log.status === 'retrying' && <div className="text-xs text-orange-500 mt-0.5">计划: {format(new Date(log.next_retry_time + 'Z'), 'HH:mm:ss')}</div>}
                  </td>
                  <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none text-right">
                    {(log.status === 'failed' || log.status === 'retrying') && (
                      <button 
                        onClick={() => handleRetry(log.id)}
                        className="text-red-600 hover:text-red-800 text-sm font-medium flex items-center md:justify-end gap-1 px-3 py-1.5 md:p-0 md:w-auto w-full border border-red-200 md:border-none rounded md:rounded-none bg-red-50 md:bg-transparent justify-center"
                      >
                        <RefreshCcw className="w-3.5 h-3.5"/> 触发重试
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && !loading && (
                <tr className="block md:table-row">
                  <td colSpan={7} className="px-4 py-12 text-center text-neutral-500 block md:table-cell">
                    <AlertCircle className="w-8 h-8 text-neutral-300 mx-auto mb-3" />
                    没有找到符合条件的队列日志
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        <div className="border-t border-neutral-200 px-4 py-4 flex flex-col md:flex-row gap-4 items-center justify-between text-sm text-neutral-500 bg-neutral-50">
          <div>共 {total} 条记录，当前第 {page} 页 / 共 {Math.max(1, Math.ceil(total / limit))} 页</div>
          <div className="flex gap-2">
            <button 
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="px-4 py-2 bg-white border border-neutral-300 rounded-lg text-sm disabled:opacity-50 hover:bg-neutral-50 transition-colors"
            >
              上一页
            </button>
            <button 
              disabled={page * limit >= total}
              onClick={() => setPage(p => p + 1)}
              className="px-4 py-2 bg-white border border-neutral-300 rounded-lg text-sm disabled:opacity-50 hover:bg-neutral-50 transition-colors"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
