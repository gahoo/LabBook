import React, { useState, useEffect, useRef } from 'react';
import { format, startOfToday } from 'date-fns';
import { Calendar, Clock, Edit3, Trash2, CheckCircle, XCircle, AlertCircle, Filter, ChevronDown, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface ReservationsTabProps {
  token: string;
  onLogout: () => void;
  statusMap: Record<string, string>;
}

export default function ReservationsTab({ token, onLogout, statusMap }: ReservationsTabProps) {
  const [reservations, setReservations] = useState<any[]>([]);
  const [editingReservation, setEditingReservation] = useState<any>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [deleteReservationConfirmId, setDeleteReservationConfirmId] = useState<number | null>(null);

  // Reservation Filters
  const [hideExpiredReservations, setHideExpiredReservations] = useState(true);
  const [resFilterUser, setResFilterUser] = useState('');
  const [resFilterEquipment, setResFilterEquipment] = useState('');
  const [resFilterContact, setResFilterContact] = useState('');
  const [resFilterTimeStart, setResFilterTimeStart] = useState('');
  const [resFilterTimeEnd, setResFilterTimeEnd] = useState('');
  const [resFilterStatus, setResFilterStatus] = useState<string[]>([]);
  const [resFilterCode, setResFilterCode] = useState('');
  const [showTimeFilterPopup, setShowTimeFilterPopup] = useState(false);
  const [showStatusFilterPopup, setShowStatusFilterPopup] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const timeFilterPopupRef = useRef<HTMLDivElement>(null);
  const statusFilterPopupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (timeFilterPopupRef.current && !timeFilterPopupRef.current.contains(event.target as Node)) {
        setShowTimeFilterPopup(false);
      }
      if (statusFilterPopupRef.current && !statusFilterPopupRef.current.contains(event.target as Node)) {
        setShowStatusFilterPopup(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchReservations = async () => {
    try {
      const res = await fetch('/api/admin/reservations', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return onLogout();
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      if (Array.isArray(data)) {
        setReservations(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (token) {
      fetchReservations();
    }
  }, [token]);

  const handleUpdateReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingReservation) return;
    
    try {
      // Convert local time back to UTC for server safely
      const toUTC = (localStr: string) => {
        const [datePart, timePart] = localStr.split('T');
        const [y, m, d] = datePart.split('-').map(Number);
        const [h, min] = timePart.split(':').map(Number);
        return new Date(y, m - 1, d, h, min).toISOString();
      };
      
      const res = await fetch(`/api/admin/reservations/${editingReservation.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...editingReservation,
          start_time: toUTC(editingReservation.start_time),
          end_time: toUTC(editingReservation.end_time),
          tz_offset: new Date().getTimezoneOffset()
        })
      });
      if (res.ok) {
        toast.success('预约更新成功');
        setIsDrawerOpen(false);
        setEditingReservation(null);
        fetchReservations();
      } else {
        toast.error('更新失败');
      }
    } catch (err) {
      toast.error('更新失败');
    }
  };

  const handleDeleteReservation = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/reservations/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('删除成功');
        setDeleteReservationConfirmId(null);
        fetchReservations();
      } else {
        toast.error('删除失败');
      }
    } catch (err) {
      toast.error('删除失败');
    }
  };

  const startEditReservation = (res: any) => {
    // Convert UTC to local for datetime-local input safely
    const toLocalISO = (utcStr: string) => {
      const date = new Date(utcStr);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      const h = String(date.getHours()).padStart(2, '0');
      const min = String(date.getMinutes()).padStart(2, '0');
      return `${y}-${m}-${d}T${h}:${min}`;
    };

    setEditingReservation({
      ...res,
      start_time: toLocalISO(res.start_time),
      end_time: toLocalISO(res.end_time),
    });
    setIsDrawerOpen(true);
  };

  const filteredReservations = reservations.filter(res => {
    if (hideExpiredReservations) {
      const today = startOfToday();
      if (new Date(res.end_time) < today) return false;
    }
    if (resFilterCode && !res.booking_code.toLowerCase().includes(resFilterCode.toLowerCase())) return false;
    if (resFilterUser && !res.student_name.toLowerCase().includes(resFilterUser.toLowerCase()) && !res.student_id.toLowerCase().includes(resFilterUser.toLowerCase()) && !res.supervisor.toLowerCase().includes(resFilterUser.toLowerCase())) return false;
    if (resFilterEquipment && !res.equipment_name.toLowerCase().includes(resFilterEquipment.toLowerCase())) return false;
    if (resFilterContact && !res.phone.includes(resFilterContact) && !res.email.toLowerCase().includes(resFilterContact.toLowerCase())) return false;
    if (resFilterTimeStart && new Date(res.start_time) < new Date(resFilterTimeStart)) return false;
    if (resFilterTimeEnd && new Date(res.end_time) > new Date(resFilterTimeEnd)) return false;
    if (resFilterStatus.length > 0 && !resFilterStatus.includes(res.status)) return false;
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
          <h3 className="text-sm font-medium text-neutral-700">隐藏已过期预约</h3>
          <button
            type="button"
            onClick={() => setHideExpiredReservations(!hideExpiredReservations)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${hideExpiredReservations ? 'bg-red-600' : 'bg-neutral-200'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${hideExpiredReservations ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>
      {showMobileFilters && (
        <div className="p-4 border-b border-neutral-200 bg-neutral-50 grid grid-cols-1 gap-4 md:hidden">
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">预约码</label>
            <input type="text" placeholder="搜索预约码..." value={resFilterCode} onChange={e => setResFilterCode(e.target.value)} className="w-16 px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">仪器</label>
            <input type="text" placeholder="搜索仪器..." value={resFilterEquipment} onChange={e => setResFilterEquipment(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">用户</label>
            <input type="text" placeholder="姓名/学号/工号/导师..." value={resFilterUser} onChange={e => setResFilterUser(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">联系方式</label>
            <input type="text" placeholder="电话/邮箱..." value={resFilterContact} onChange={e => setResFilterContact(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">时间</label>
            <div className="flex gap-2">
              <input type="date" value={resFilterTimeStart ? format(new Date(resFilterTimeStart), 'yyyy-MM-dd') : ''} onChange={e => setResFilterTimeStart(e.target.value ? new Date(e.target.value).toISOString() : '')} className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
              <input type="date" value={resFilterTimeEnd ? format(new Date(resFilterTimeEnd), 'yyyy-MM-dd') : ''} onChange={e => {
                if (e.target.value) {
                  const date = new Date(e.target.value);
                  date.setHours(23, 59, 59, 999);
                  setResFilterTimeEnd(date.toISOString());
                } else {
                  setResFilterTimeEnd('');
                }
              }} className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-2">状态</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(statusMap).map(([key, value]) => (
                <label key={key} className="flex items-center gap-2 px-2 py-1.5 bg-white border border-neutral-200 rounded-lg">
                  <input type="checkbox" checked={resFilterStatus.includes(key)} onChange={e => {
                    if (e.target.checked) setResFilterStatus([...resFilterStatus, key]);
                    else setResFilterStatus(resFilterStatus.filter(s => s !== key));
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
                <div className="mb-2">预约码</div>
                <input 
                  type="text" 
                  placeholder="搜索预约码..." 
                  value={resFilterCode}
                  onChange={e => setResFilterCode(e.target.value)}
                  className="w-20 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                />
              </th>
              <th className="px-4 py-4 font-medium align-top">
                <div className="mb-2">仪器</div>
                <input 
                  type="text" 
                  placeholder="搜索仪器..." 
                  value={resFilterEquipment}
                  onChange={e => setResFilterEquipment(e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                />
              </th>
              <th className="px-4 py-4 font-medium align-top">
                <div className="mb-2">用户</div>
                <input 
                  type="text" 
                  placeholder="姓名/学号/工号/导师..." 
                  value={resFilterUser}
                  onChange={e => setResFilterUser(e.target.value)}
                  className="w-20 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                />
              </th>
              <th className="px-4 py-4 font-medium align-top">
                <div className="mb-2">联系方式</div>
                <input 
                  type="text" 
                  placeholder="电话/邮箱..." 
                  value={resFilterContact}
                  onChange={e => setResFilterContact(e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                />
              </th>
              <th className="px-4 py-4 font-medium align-top">
                <div className="mb-2">时间</div>
                <div className="relative" ref={timeFilterPopupRef}>
                  <button 
                    onClick={() => setShowTimeFilterPopup(!showTimeFilterPopup)}
                    className="w-full px-2 py-1 text-xs rounded border border-neutral-300 bg-white text-left flex items-center justify-between truncate"
                  >
                    <span className="truncate">
                      {resFilterTimeStart || resFilterTimeEnd 
                        ? `${resFilterTimeStart ? format(new Date(resFilterTimeStart), 'MM-dd') : '不限'} 至 ${resFilterTimeEnd ? format(new Date(resFilterTimeEnd), 'MM-dd') : '不限'}`
                        : '全部时间'}
                    </span>
                    <ChevronDown className="w-3 h-3 ml-1 shrink-0" />
                  </button>
                  {showTimeFilterPopup && (
                    <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 z-10">
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs text-neutral-500 mb-1">开始日期</label>
                          <input 
                            type="date" 
                            value={resFilterTimeStart ? format(new Date(resFilterTimeStart), 'yyyy-MM-dd') : ''}
                            onChange={e => setResFilterTimeStart(e.target.value ? new Date(e.target.value).toISOString() : '')}
                            className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-neutral-500 mb-1">结束日期</label>
                          <input 
                            type="date" 
                            value={resFilterTimeEnd ? format(new Date(resFilterTimeEnd), 'yyyy-MM-dd') : ''}
                            onChange={e => {
                              if (e.target.value) {
                                const date = new Date(e.target.value);
                                date.setHours(23, 59, 59, 999);
                                setResFilterTimeEnd(date.toISOString());
                              } else {
                                setResFilterTimeEnd('');
                              }
                            }}
                            className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                          />
                        </div>
                        <div className="flex justify-end gap-2 pt-2 border-t border-neutral-100">
                          <button 
                            onClick={() => { setResFilterTimeStart(''); setResFilterTimeEnd(''); }}
                            className="text-xs text-neutral-500 hover:text-neutral-700"
                          >
                            清空
                          </button>
                          <button 
                            onClick={() => setShowTimeFilterPopup(false)}
                            className="text-xs text-red-600 font-medium"
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
                <div className="mb-2">状态</div>
                <div className="relative" ref={statusFilterPopupRef}>
                  <button 
                    onClick={() => setShowStatusFilterPopup(!showStatusFilterPopup)}
                    className="w-full px-2 py-1 text-xs rounded border border-neutral-300 bg-white text-left min-h-[26px] flex flex-wrap gap-1 items-center"
                  >
                    {resFilterStatus.length > 0 ? (
                      <>
                        {resFilterStatus.map(s => (
                          <span key={s} className="bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1">
                            {statusMap[s]}
                            <X 
                              className="w-3 h-3 cursor-pointer hover:text-red-500" 
                              onClick={(e) => {
                                e.stopPropagation();
                                setResFilterStatus(resFilterStatus.filter(st => st !== s));
                              }}
                            />
                          </span>
                        ))}
                      </>
                    ) : (
                      <span className="text-neutral-400">全部状态</span>
                    )}
                  </button>
                  {showStatusFilterPopup && (
                    <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-neutral-200 rounded-lg shadow-lg p-2 z-10">
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {Object.entries(statusMap).map(([key, value]) => (
                          <label key={key} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-50 rounded cursor-pointer">
                            <input 
                              type="checkbox"
                              checked={resFilterStatus.includes(key)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setResFilterStatus([...resFilterStatus, key]);
                                } else {
                                  setResFilterStatus(resFilterStatus.filter(s => s !== key));
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
                            onClick={() => setResFilterStatus([])}
                            className="text-xs text-neutral-500 hover:text-neutral-700"
                          >
                            清空
                          </button>
                          <button 
                            onClick={() => setShowStatusFilterPopup(false)}
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
            {filteredReservations.map(res => (
              <tr key={res.id} className="block md:table-row hover:bg-neutral-50/50 border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none">
                <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                  <div className="flex justify-between items-center md:block">
                    <span className="md:hidden font-medium text-neutral-500 text-xs">预约码</span>
                    <span className="font-mono text-xs">{res.booking_code}</span>
                  </div>
                </td>
                <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                  <div className="flex justify-between items-center md:block">
                    <span className="md:hidden font-medium text-neutral-500 text-xs">仪器</span>
                    <span className="font-medium text-neutral-900">{res.equipment_name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                  <div className="flex justify-between items-center md:block">
                    <span className="md:hidden font-medium text-neutral-500 text-xs">用户</span>
                    <div className="text-right md:text-left">
                      <p className="font-medium text-neutral-900">{res.student_name}</p>
                      <p className="text-xs text-neutral-500">{res.student_id} | {res.supervisor}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                  <div className="flex justify-between items-center md:block">
                    <span className="md:hidden font-medium text-neutral-500 text-xs">联系方式</span>
                    <div className="text-right md:text-left">
                      <p className="text-xs text-neutral-900">{res.phone}</p>
                      <p className="text-xs text-neutral-500">{res.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                  <div className="flex justify-between items-center md:block">
                    <span className="md:hidden font-medium text-neutral-500 text-xs">时间</span>
                    <div className="text-right md:text-left">
                      <p className="text-neutral-900">{format(new Date(res.start_time), 'yyyy-MM-dd')}</p>
                      <p className="text-xs text-neutral-500">{format(new Date(res.start_time), 'HH:mm')} - {format(new Date(res.end_time), 'HH:mm')}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                  <div className="flex justify-between items-center md:block">
                    <span className="md:hidden font-medium text-neutral-500 text-xs">状态</span>
                    <div>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium
                        ${res.status === 'pending' ? 'bg-amber-100 text-amber-800' : ''}
                        ${res.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : ''}
                        ${res.status === 'active' ? 'bg-red-100 text-red-800' : ''}
                        ${res.status === 'completed' ? 'bg-neutral-100 text-neutral-800' : ''}
                        ${res.status === 'cancelled' ? 'bg-red-100 text-red-800' : ''}
                        ${res.status === 'rejected' ? 'bg-red-100 text-red-800' : ''}
                      `}>
                        {statusMap[res.status] || res.status}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 md:py-4 block md:table-cell">
                  <div className="flex justify-end md:justify-end items-center space-x-1">
                  {res.status === 'pending' && (
                    <>
                      <button 
                        onClick={async () => {
                          try {
                            const response = await fetch(`/api/admin/reservations/${res.id}`, {
                              method: 'PUT',
                              headers: { 
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                              },
                              body: JSON.stringify({ ...res, status: 'approved' })
                            });
                            if (response.ok) {
                              toast.success('已审批通过');
                              fetchReservations();
                            }
                          } catch (err) {
                            toast.error('审批失败');
                          }
                        }}
                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="审批通过"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={async () => {
                          try {
                            const response = await fetch(`/api/admin/reservations/${res.id}`, {
                              method: 'PUT',
                              headers: { 
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                              },
                              body: JSON.stringify({ ...res, status: 'rejected' })
                            });
                            if (response.ok) {
                              toast.success('已驳回');
                              fetchReservations();
                            }
                          } catch (err) {
                            toast.error('驳回失败');
                          }
                        }}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="审批驳回"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  <button 
                    onClick={() => startEditReservation(res)}
                    className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="修改预约"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setDeleteReservationConfirmId(res.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="删除预约"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredReservations.length === 0 && (
              <tr className="block md:table-row">
                <td colSpan={7} className="px-4 py-12 text-center text-neutral-500 block md:table-cell">暂无预约记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Drawer Overlay */}
      <div 
        className={`fixed inset-0 bg-black/50 z-50 transition-opacity duration-300 ${isDrawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsDrawerOpen(false)}
      />

      {/* Drawer Panel */}
      <div 
        className={`fixed top-0 right-0 h-full w-full sm:w-[500px] md:w-[600px] bg-white z-50 shadow-2xl transform transition-transform duration-300 ease-in-out overflow-y-auto ${isDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-neutral-900">修改预约信息</h2>
          <button 
            onClick={() => setIsDrawerOpen(false)}
            className="p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 sm:p-6">
          {editingReservation && (
            <form onSubmit={handleUpdateReservation} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">姓名</label>
                  <input type="text" value={editingReservation.student_name} onChange={e => setEditingReservation({...editingReservation, student_name: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-neutral-300" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">学号/工号</label>
                  <input type="text" value={editingReservation.student_id} onChange={e => setEditingReservation({...editingReservation, student_id: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-neutral-300" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">导师</label>
                  <input type="text" value={editingReservation.supervisor} onChange={e => setEditingReservation({...editingReservation, supervisor: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-neutral-300" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">手机号码</label>
                  <input type="text" value={editingReservation.phone} onChange={e => setEditingReservation({...editingReservation, phone: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-neutral-300" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">邮箱</label>
                  <input type="email" value={editingReservation.email} onChange={e => setEditingReservation({...editingReservation, email: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-neutral-300" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">开始时间</label>
                  <input 
                    type="datetime-local" 
                    step="300"
                    value={editingReservation.start_time} 
                    onChange={e => setEditingReservation({...editingReservation, start_time: e.target.value})} 
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">结束时间</label>
                  <input 
                    type="datetime-local" 
                    step="300"
                    value={editingReservation.end_time} 
                    onChange={e => setEditingReservation({...editingReservation, end_time: e.target.value})} 
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300" 
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">状态</label>
                <select value={editingReservation.status} onChange={e => setEditingReservation({...editingReservation, status: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-neutral-300 bg-white">
                  {Object.entries(statusMap).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}
                </select>
              </div>
              <div className="flex gap-4 mt-8">
                <button type="button" onClick={() => setIsDrawerOpen(false)} className="flex-1 py-3 border border-neutral-300 rounded-xl font-medium hover:bg-neutral-50">取消</button>
                <button type="submit" className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700">保存修改</button>
              </div>
            </form>
          )}
        </div>
      </div>

      {deleteReservationConfirmId !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl">
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
            </div>
            <h3 className="text-xl font-bold text-center mb-2">确认删除</h3>
            <p className="text-sm text-neutral-500 text-center mb-6">
              确定要删除该预约记录吗？此操作不可恢复。
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setDeleteReservationConfirmId(null)} 
                className="flex-1 py-2.5 border border-neutral-300 rounded-xl font-medium hover:bg-neutral-50"
              >
                取消
              </button>
              <button 
                onClick={() => handleDeleteReservation(deleteReservationConfirmId)} 
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
