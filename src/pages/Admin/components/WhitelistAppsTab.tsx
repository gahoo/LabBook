import React, { useState, useEffect, useRef } from 'react';
import { Filter, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';

interface WhitelistAppsTabProps {
  token: string;
  handleLogout: () => void;
}

export default function WhitelistAppsTab({ token, handleLogout }: WhitelistAppsTabProps) {
  const [whitelistApps, setWhitelistApps] = useState<any[]>([]);
  
  // Whitelist App Filters
  const [hideProcessedWhitelistApps, setHideProcessedWhitelistApps] = useState(true);
  const [wlFilterEquipment, setWlFilterEquipment] = useState('');
  const [wlFilterApplicant, setWlFilterApplicant] = useState('');
  const [wlFilterSupervisor, setWlFilterSupervisor] = useState('');
  const [wlFilterContact, setWlFilterContact] = useState('');
  const [wlFilterStatus, setWlFilterStatus] = useState<string[]>([]);
  const [showWlStatusFilterPopup, setShowWlStatusFilterPopup] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const wlStatusFilterPopupRef = useRef<HTMLDivElement>(null);

  const statusMap: Record<string, string> = {
    pending: '待审批',
    rejected: '已驳回',
    approved: '已通过',
    active: '进行中',
    completed: '已完成',
    cancelled: '已取消'
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wlStatusFilterPopupRef.current && !wlStatusFilterPopupRef.current.contains(event.target as Node)) {
        setShowWlStatusFilterPopup(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchWhitelistApps = async () => {
    try {
      const res = await fetch('/api/admin/whitelist/applications', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return handleLogout();
      const data = await res.json();
      setWhitelistApps(data);
    } catch (err) {
      toast.error('获取白名单申请失败');
    }
  };

  useEffect(() => {
    if (token) {
      fetchWhitelistApps();
    }
  }, [token]);

  const handleApproveApp = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/whitelist/applications/${id}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('已通过并加入白名单');
        fetchWhitelistApps();
      } else {
        toast.error('操作失败');
      }
    } catch (err) {
      toast.error('操作失败');
    }
  };

  const handleRejectApp = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/whitelist/applications/${id}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('已驳回申请');
        fetchWhitelistApps();
      } else {
        toast.error('操作失败');
      }
    } catch (err) {
      toast.error('操作失败');
    }
  };

  const filteredWhitelistApps = whitelistApps.filter(app => {
    if (hideProcessedWhitelistApps && app.status !== 'pending') return false;
    if (wlFilterEquipment && !app.equipment_name.toLowerCase().includes(wlFilterEquipment.toLowerCase())) return false;
    if (wlFilterApplicant && !app.student_name.toLowerCase().includes(wlFilterApplicant.toLowerCase()) && !app.student_id.toLowerCase().includes(wlFilterApplicant.toLowerCase())) return false;
    if (wlFilterSupervisor && !app.supervisor.toLowerCase().includes(wlFilterSupervisor.toLowerCase())) return false;
    if (wlFilterContact && !app.phone.includes(wlFilterContact) && !app.email.toLowerCase().includes(wlFilterContact.toLowerCase())) return false;
    if (wlFilterStatus.length > 0 && !wlFilterStatus.includes(app.status)) return false;
    return true;
  });

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
      <div className="p-4 border-b border-neutral-200 flex items-center justify-between bg-neutral-50">
        <button
          type="button"
          onClick={() => setShowMobileFilters(!showMobileFilters)}
          className="md:hidden p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 rounded-lg flex items-center gap-2"
        >
          <Filter className="w-5 h-5" />
          <span className="text-sm font-medium">筛选</span>
        </button>
        <div className="flex items-center gap-3 ml-auto">
          <h3 className="text-sm font-medium text-neutral-700">隐藏已处理申请</h3>
          <button
            type="button"
            onClick={() => setHideProcessedWhitelistApps(!hideProcessedWhitelistApps)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${hideProcessedWhitelistApps ? 'bg-red-600' : 'bg-neutral-200'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${hideProcessedWhitelistApps ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>
      {showMobileFilters && (
        <div className="p-4 border-b border-neutral-200 bg-neutral-50 grid grid-cols-1 gap-4 md:hidden">
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">仪器</label>
            <input type="text" placeholder="搜索仪器..." value={wlFilterEquipment} onChange={e => setWlFilterEquipment(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">申请人/导师</label>
            <input type="text" placeholder="姓名/学号/导师..." value={wlFilterApplicant} onChange={e => setWlFilterApplicant(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">联系方式</label>
            <input type="text" placeholder="电话/邮箱..." value={wlFilterContact} onChange={e => setWlFilterContact(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-2">状态</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(statusMap).filter(([key]) => ['pending', 'approved', 'rejected'].includes(key)).map(([key, value]) => (
                <label key={key} className="flex items-center gap-2 px-2 py-1.5 bg-white border border-neutral-200 rounded-lg">
                  <input type="checkbox" checked={wlFilterStatus.includes(key)} onChange={e => {
                    if (e.target.checked) setWlFilterStatus([...wlFilterStatus, key]);
                    else setWlFilterStatus(wlFilterStatus.filter(s => s !== key));
                  }} className="text-red-600 rounded border-neutral-300 focus:ring-red-600" />
                  <span className="text-sm">{value}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm block md:table">
          <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200 hidden md:table-header-group">
            <tr>
              <th className="px-4 py-4 font-medium align-top">
                <div className="mb-2">仪器</div>
                <input 
                  type="text" 
                  placeholder="搜索仪器..." 
                  value={wlFilterEquipment}
                  onChange={e => setWlFilterEquipment(e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                />
              </th>
              <th className="px-4 py-4 font-medium align-top">
                <div className="mb-2">申请人/导师</div>
                <input 
                  type="text" 
                  placeholder="姓名/学号/导师..." 
                  value={wlFilterApplicant}
                  onChange={e => setWlFilterApplicant(e.target.value)}
                  className="w-24 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                />
              </th>
              <th className="px-4 py-4 font-medium align-top">
                <div className="mb-2">联系方式</div>
                <input 
                  type="text" 
                  placeholder="电话/邮箱..." 
                  value={wlFilterContact}
                  onChange={e => setWlFilterContact(e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                />
              </th>
              <th className="px-4 py-4 font-medium align-top">
                <div className="mb-2">状态</div>
                <div className="relative" ref={wlStatusFilterPopupRef}>
                  <button 
                    onClick={() => setShowWlStatusFilterPopup(!showWlStatusFilterPopup)}
                    className="w-full px-2 py-1 text-xs rounded border border-neutral-300 bg-white text-left min-h-[26px] flex flex-wrap gap-1 items-center"
                  >
                    {wlFilterStatus.length > 0 ? (
                      <>
                        {wlFilterStatus.map(s => (
                          <span key={s} className="bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1">
                            {statusMap[s]}
                            <X 
                              className="w-3 h-3 cursor-pointer hover:text-red-500" 
                              onClick={(e) => {
                                e.stopPropagation();
                                setWlFilterStatus(wlFilterStatus.filter(st => st !== s));
                              }}
                            />
                          </span>
                        ))}
                      </>
                    ) : (
                      <span className="text-neutral-400">全部状态</span>
                    )}
                  </button>
                  {showWlStatusFilterPopup && (
                    <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-neutral-200 rounded-lg shadow-lg p-2 z-10">
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {Object.entries(statusMap).filter(([key]) => ['pending', 'approved', 'rejected'].includes(key)).map(([key, value]) => (
                          <label key={key} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-50 rounded cursor-pointer">
                            <input 
                              type="checkbox"
                              checked={wlFilterStatus.includes(key)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setWlFilterStatus([...wlFilterStatus, key]);
                                } else {
                                  setWlFilterStatus(wlFilterStatus.filter(s => s !== key));
                                }
                              }}
                              className="w-3.5 h-3.5 text-red-600 rounded border-neutral-300 focus:ring-red-600"
                            />
                            <span className="text-xs">{value}</span>
                          </label>
                        ))}
                      </div>
                      <div className="flex justify-between items-center pt-2 mt-2 border-t border-neutral-100 px-2">
                         <button 
                            onClick={() => setWlFilterStatus([])}
                            className="text-xs text-neutral-500 hover:text-neutral-700"
                          >
                            清空
                          </button>
                          <button 
                            onClick={() => setShowWlStatusFilterPopup(false)}
                            className="text-xs text-red-600 font-medium"
                          >
                            确定
                          </button>
                      </div>
                    </div>
                  )}
                </div>
              </th>
              <th className="px-4 py-4 font-medium text-right align-top">操作</th>
            </tr>
          </thead>
          <tbody className="block md:table-row-group divide-y divide-neutral-100 md:divide-y-0 p-4 md:p-0">
            {filteredWhitelistApps.map(app => (
              <tr key={app.id} className="block md:table-row hover:bg-neutral-50/50 border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none">
                <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                  <div className="flex justify-between items-center md:block">
                    <span className="md:hidden font-medium text-neutral-500 text-xs">仪器</span>
                    <span className="font-medium text-neutral-900">{app.equipment_name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                  <div className="flex justify-between items-center md:block">
                    <span className="md:hidden font-medium text-neutral-500 text-xs">申请人/导师</span>
                    <div className="text-right md:text-left">
                      <p className="font-medium text-neutral-900">{app.student_name}</p>
                      <p className="text-xs text-neutral-500">{app.student_id} | {app.supervisor}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                  <div className="flex justify-between items-center md:block">
                    <span className="md:hidden font-medium text-neutral-500 text-xs">联系方式</span>
                    <div className="text-right md:text-left">
                      <p className="text-neutral-900">{app.phone}</p>
                      <p className="text-xs text-neutral-500">{app.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                  <div className="flex justify-between items-center md:block">
                    <span className="md:hidden font-medium text-neutral-500 text-xs">状态</span>
                    <div>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium
                        ${app.status === 'pending' ? 'bg-amber-100 text-amber-800' : ''}
                        ${app.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : ''}
                        ${app.status === 'rejected' ? 'bg-red-100 text-red-800' : ''}
                      `}>
                        {statusMap[app.status] || app.status}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 md:py-4 block md:table-cell">
                  <div className="flex justify-end md:justify-end items-center space-x-1">
                  {app.status === 'pending' && (
                    <>
                      <button onClick={() => handleApproveApp(app.id)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleRejectApp(app.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  </div>
                </td>
              </tr>
            ))}
            {whitelistApps.length === 0 && (
              <tr className="block md:table-row">
                <td colSpan={6} className="px-4 py-12 text-center text-neutral-500 block md:table-cell">暂无申请记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
