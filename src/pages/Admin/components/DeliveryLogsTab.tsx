import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw, Search, Clock, CheckCircle2, XCircle, AlertCircle, RefreshCcw } from 'lucide-react';
import { format } from 'date-fns';

interface DeliveryLogsTabProps {
  token: string | null;
}

export default function DeliveryLogsTab({ token }: DeliveryLogsTabProps) {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('全部');
  const [referenceFilter, setReferenceFilter] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const STATUSES = ['全部', '待发送', '重试中', '发送成功', '发送失败'];

  useEffect(() => {
    fetchLogs();
  }, [statusFilter, page, token]);

  const fetchLogs = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        status: statusFilter,
        reference_code: referenceFilter,
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

  const renderStatus = (status: string) => {
    switch(status) {
      case 'pending': 
        return <span className="flex items-center gap-1 w-fit text-yellow-600 bg-yellow-50 px-2 py-1 rounded-full text-xs font-medium"><Clock className="w-3 h-3"/> 待发送</span>;
      case 'retrying': 
        return <span className="flex items-center gap-1 w-fit text-orange-600 bg-orange-50 px-2 py-1 rounded-full text-xs font-medium"><RefreshCw className="w-3 h-3"/> 重试中</span>;
      case 'success': 
        return <span className="flex items-center gap-1 w-fit text-green-600 bg-green-50 px-2 py-1 rounded-full text-xs font-medium"><CheckCircle2 className="w-3 h-3"/> 已送达</span>;
      case 'failed': 
        return <span className="flex items-center gap-1 w-fit text-red-600 bg-red-50 px-2 py-1 rounded-full text-xs font-medium"><XCircle className="w-3 h-3"/> 失败</span>;
      default:
        return <span className="text-gray-500">{status}</span>;
    }
  };

  return (
    <div className="p-6">
      <div className="flex flex-col md:flex-row items-center justify-between mb-6 gap-4">
        <h2 className="text-lg font-bold text-neutral-800">系统发出通讯日志队列</h2>
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="搜索关联单号 (如预约号)" 
              value={referenceFilter}
              onChange={(e) => setReferenceFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchLogs()}
              className="pl-9 pr-4 py-2 w-full border border-neutral-300 rounded-lg text-sm outline-none focus:border-indigo-500"
            />
          </div>
          <button onClick={fetchLogs} className="p-2 border border-neutral-300 rounded-lg hover:bg-neutral-50" title="刷新">
            <RefreshCw className={`w-4 h-4 text-neutral-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {STATUSES.map(s => (
          <button 
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${statusFilter === s ? 'bg-indigo-100 text-indigo-700' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600">
              <tr>
                <th className="px-4 py-3 font-medium">任务ID</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">触发事件</th>
                <th className="px-4 py-3 font-medium">投递隧道</th>
                <th className="px-4 py-3 font-medium">投递目标</th>
                <th className="px-4 py-3 font-medium">关联单号</th>
                <th className="px-4 py-3 font-medium">排期时间/创建时间</th>
                <th className="px-4 py-3 font-medium">失败原因</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3 text-neutral-500">#{log.id}</td>
                  <td className="px-4 py-3">
                    {renderStatus(log.status)}
                    {log.retry_count > 0 && <span className="ml-2 text-xs text-neutral-400">重试x{log.retry_count}</span>}
                  </td>
                  <td className="px-4 py-3 text-neutral-800">{log.event}</td>
                  <td className="px-4 py-3 text-indigo-600 font-medium">{log.channel.toUpperCase()}</td>
                  <td className="px-4 py-3 max-w-[200px] truncate" title={log.target}>{log.target}</td>
                  <td className="px-4 py-3 text-neutral-500">{log.reference_code || '-'}</td>
                  <td className="px-4 py-3">
                    <div className="text-neutral-700">{format(new Date(log.created_at + 'Z'), 'MM-dd HH:mm:ss')}</div>
                    {log.status === 'retrying' && <div className="text-xs text-orange-500">计划: {format(new Date(log.next_retry_time + 'Z'), 'HH:mm:ss')}</div>}
                  </td>
                  <td className="px-4 py-3 max-w-[200px] truncate text-red-500" title={log.error_message}>{log.error_message || '-'}</td>
                  <td className="px-4 py-3 text-right">
                    {(log.status === 'failed' || log.status === 'retrying') && (
                      <button 
                        onClick={() => handleRetry(log.id)}
                        className="text-indigo-600 hover:text-indigo-800 text-sm font-medium flex items-center gap-1 justify-end w-full"
                      >
                        <RefreshCcw className="w-3 h-3"/> 强制重试
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-neutral-500">
                    <AlertCircle className="w-8 h-8 text-neutral-300 mx-auto mb-3" />
                    没有找到符合条件的队列日志
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        <div className="border-t border-neutral-200 px-4 py-3 flex items-center justify-between">
          <div className="text-sm text-neutral-500">共 {total} 条记录</div>
          <div className="flex gap-2">
            <button 
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 bg-white border border-neutral-300 rounded text-sm disabled:opacity-50"
            >
              上一页
            </button>
            <button 
              disabled={page * limit >= total}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 bg-white border border-neutral-300 rounded text-sm disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
