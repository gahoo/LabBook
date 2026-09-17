import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  AlertTriangle, 
  Clock, 
  FileCheck, 
  Scale, 
  UserCheck, 
  X, 
  RotateCcw,
  Check,
  LayoutList,
  List
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
  return match ? decodeURIComponent(match[3]) : null;
}

function setCookie(name: string, value: string, days: number = 365) {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

export interface UnifiedApprovalBannerProps {
  token: string;
  activeTab: string; // 'equipment' | 'reservations' | 'violations' | 'audit_logs' | 'settings'
  onActionResolved?: (type: 'reservations' | 'whitelist' | 'appeals') => void;
}

interface ActionHistoryItem {
  type: 'reservations' | 'whitelist' | 'appeals';
  id: string | number;
  name: string;
  action: 'approve' | 'reject';
  originalItem?: any;
}

const violationTypeMap: Record<string, string> = {
  late: '迟到',
  overdue: '超时',
  'no-show': '爽约',
  hygiene_issue: '卫生问题',
  improper_operation: '违规操作',
  proxy_booking: '代预约',
  other_manual: '其他违规'
};

export default function UnifiedApprovalBanner({
  token,
  activeTab,
  onActionResolved
}: UnifiedApprovalBannerProps) {
  const [pendingReservations, setPendingReservations] = useState<any[]>([]);
  const [pendingWhitelist, setPendingWhitelist] = useState<any[]>([]);
  const [pendingAppeals, setPendingAppeals] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<'whitelist' | 'reservations' | 'appeals'>('whitelist');
  const [initialVisibleCategories, setInitialVisibleCategories] = useState<Set<string>>(new Set());
  const [actionStack, setActionStack] = useState<ActionHistoryItem[]>([]);
  const [isCompact, setIsCompact] = useState<boolean>(() => {
    return getCookie('admin_banner_compact') === 'true';
  });
  const [tooltipAlign, setTooltipAlign] = useState<'left' | 'right'>('left');
  const lastActiveTabRef = useRef(activeTab);

  const handleCapsulePointerEnter = (e: React.MouseEvent<HTMLDivElement> | React.FocusEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    if (center < window.innerWidth / 2) {
      setTooltipAlign('left');
    } else {
      setTooltipAlign('right');
    }
  };

  const toggleCompactMode = () => {
    setIsCompact(prev => {
      const next = !prev;
      setCookie('admin_banner_compact', String(next));
      return next;
    });
  };

  // Fetch all pending data
  const fetchAllPending = async () => {
    try {
      const headers = { 'Authorization': `Bearer ${token}` };
      const today = format(new Date(), 'yyyy-MM-dd');
      
      const [resRes, whiteRes, appealRes] = await Promise.all([
        fetch(`/api/admin/reservations?status=pending&startDate=${today}`, { headers }),
        fetch('/api/admin/whitelist/applications?status=pending', { headers }),
        fetch('/api/admin/violations?appealStatus=appealing', { headers })
      ]);

      let resList: any[] = [];
      let whiteList: any[] = [];
      let appealList: any[] = [];

      if (resRes.ok) {
        const data = await resRes.json();
        resList = Array.isArray(data) ? data : (data.records || []);
        setPendingReservations(resList);
      }
      if (whiteRes.ok) {
        const data = await whiteRes.json();
        whiteList = Array.isArray(data) ? data : [];
        setPendingWhitelist(whiteList);
      }
      if (appealRes.ok) {
        const data = await appealRes.json();
        appealList = Array.isArray(data) ? data : [];
        setPendingAppeals(appealList);
      }

      // Record categories that have items so they stay visible during this session
      setInitialVisibleCategories(prev => {
        const next = new Set(prev);
        if (whiteList.length > 0) next.add('whitelist');
        if (resList.length > 0) next.add('reservations');
        if (appealList.length > 0) next.add('appeals');
        return next;
      });
    } catch (err) {
      console.error('Failed to fetch pending approval items:', err);
    }
  };

  useEffect(() => {
    fetchAllPending();
  }, [token]);

  const counts = {
    whitelist: pendingWhitelist.length,
    reservations: pendingReservations.length,
    appeals: pendingAppeals.length
  };

  const isCategoryVisible = (type: 'whitelist' | 'reservations' | 'appeals') => {
    // 1. 本次会话载入时或运行中曾有待办
    if (initialVisibleCategories.has(type)) return true;
    // 2. 当前待办数 > 0
    if (counts[type] > 0) return true;
    // 3. 撤销栈中含有该分类操作（随时可吃后悔药）
    if (actionStack.some(action => action.type === type)) return true;
    return false;
  };

  // Tab Perception & priority selection
  useEffect(() => {
    const tabPriorityMap: Record<string, 'whitelist' | 'reservations' | 'appeals'> = {
      equipment: 'whitelist',
      reservations: 'reservations',
      violations: 'appeals'
    };

    const preferred = tabPriorityMap[activeTab];

    // If activeTab just changed, unconditionally switch to its preferred category if defined
    if (lastActiveTabRef.current !== activeTab) {
      lastActiveTabRef.current = activeTab;
      if (preferred) {
        setSelectedCategory(preferred);
        setInitialVisibleCategories(prev => new Set(prev).add(preferred));
        return;
      }
    }

    // Fallback: If current selected has 0 items AND no actions in actionStack for this category AND not preferred
    const hasActionsForCurrent = actionStack.some(a => a.type === selectedCategory);
    if (counts[selectedCategory] === 0 && !hasActionsForCurrent && selectedCategory !== preferred) {
      if (preferred && counts[preferred] > 0) {
        setSelectedCategory(preferred);
      } else if (counts.whitelist > 0) {
        setSelectedCategory('whitelist');
      } else if (counts.reservations > 0) {
        setSelectedCategory('reservations');
      } else if (counts.appeals > 0) {
        setSelectedCategory('appeals');
      }
    }
  }, [activeTab, pendingWhitelist.length, pendingReservations.length, pendingAppeals.length, selectedCategory, actionStack]);

  const totalPendingCount = pendingReservations.length + pendingWhitelist.length + pendingAppeals.length;

  // Don't render if completely empty and no undo actions left
  if (totalPendingCount === 0 && actionStack.length === 0) {
    return null;
  }

  // Handle Approve (Optimistic Update)
  const handleApprove = async (type: 'reservations' | 'whitelist' | 'appeals', id: string | number, name: string) => {
    let originalItem: any = undefined;
    if (type === 'reservations') {
      originalItem = pendingReservations.find(item => item.id === id);
      setPendingReservations(prev => prev.filter(item => item.id !== id));
    } else if (type === 'whitelist') {
      originalItem = pendingWhitelist.find(item => item.id === id);
      setPendingWhitelist(prev => prev.filter(item => item.id !== id));
    } else if (type === 'appeals') {
      originalItem = pendingAppeals.find(item => item.id === id);
      setPendingAppeals(prev => prev.filter(item => item.id !== id));
    }

    try {
      const headers = { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };

      if (type === 'reservations') {
        const res = await fetch(`/api/admin/reservations/${id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ status: 'approved' })
        });
        if (!res.ok) throw new Error();
      } else if (type === 'whitelist') {
        const res = await fetch(`/api/admin/whitelist/applications/${id}/approve`, {
          method: 'POST',
          headers
        });
        if (!res.ok) throw new Error();
      } else if (type === 'appeals') {
        const res = await fetch(`/api/admin/violations/${id}/revoke`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ remark: '申诉已通过，违规记录已撤销' })
        });
        if (!res.ok) throw new Error();
      }

      setActionStack(prev => [...prev, { type, id, name, action: 'approve', originalItem }]);
      toast.success(`已通过: ${name}`);
      onActionResolved?.(type);
      window.dispatchEvent(new CustomEvent('admin-approval-resolved', { detail: { type } }));
    } catch (err) {
      if (originalItem) {
        if (type === 'reservations') setPendingReservations(prev => [originalItem, ...prev]);
        else if (type === 'whitelist') setPendingWhitelist(prev => [originalItem, ...prev]);
        else if (type === 'appeals') setPendingAppeals(prev => [originalItem, ...prev]);
      }
      toast.error('操作失败');
    }
  };

  // Handle Reject (Optimistic Update)
  const handleReject = async (type: 'reservations' | 'whitelist' | 'appeals', id: string | number, name: string) => {
    let originalItem: any = undefined;
    if (type === 'reservations') {
      originalItem = pendingReservations.find(item => item.id === id);
      setPendingReservations(prev => prev.filter(item => item.id !== id));
    } else if (type === 'whitelist') {
      originalItem = pendingWhitelist.find(item => item.id === id);
      setPendingWhitelist(prev => prev.filter(item => item.id !== id));
    } else if (type === 'appeals') {
      originalItem = pendingAppeals.find(item => item.id === id);
      setPendingAppeals(prev => prev.filter(item => item.id !== id));
    }

    try {
      const headers = { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };

      if (type === 'reservations') {
        const res = await fetch(`/api/admin/reservations/${id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ status: 'rejected' })
        });
        if (!res.ok) throw new Error();
      } else if (type === 'whitelist') {
        const res = await fetch(`/api/admin/whitelist/applications/${id}/reject`, {
          method: 'POST',
          headers
        });
        if (!res.ok) throw new Error();
      } else if (type === 'appeals') {
        const res = await fetch(`/api/admin/violations/${id}/reject-appeal`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ remark: '申诉已驳回' })
        });
        if (!res.ok) throw new Error();
      }

      setActionStack(prev => [...prev, { type, id, name, action: 'reject', originalItem }]);
      toast.success(`已驳回: ${name}`);
      onActionResolved?.(type);
      window.dispatchEvent(new CustomEvent('admin-approval-resolved', { detail: { type } }));
    } catch (err) {
      if (originalItem) {
        if (type === 'reservations') setPendingReservations(prev => [originalItem, ...prev]);
        else if (type === 'whitelist') setPendingWhitelist(prev => [originalItem, ...prev]);
        else if (type === 'appeals') setPendingAppeals(prev => [originalItem, ...prev]);
      }
      toast.error('操作失败');
    }
  };

  // Handle Undo Last Action (Optimistic Update)
  const handleUndo = async () => {
    if (actionStack.length === 0) return;
    const last = actionStack[actionStack.length - 1];

    try {
      const headers = { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };

      if (last.type === 'reservations') {
        const res = await fetch(`/api/admin/reservations/${last.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ status: 'pending' })
        });
        if (!res.ok) throw new Error();
        if (last.originalItem) {
          setPendingReservations(prev => [last.originalItem, ...prev]);
        }
      } else if (last.type === 'whitelist') {
        const res = await fetch(`/api/admin/whitelist/applications/${last.id}/undo`, {
          method: 'POST',
          headers
        });
        if (!res.ok) throw new Error();
        if (last.originalItem) {
          setPendingWhitelist(prev => [last.originalItem, ...prev]);
        }
      } else if (last.type === 'appeals') {
        const res = await fetch(`/api/admin/violations/${last.id}/undo-appeal`, {
          method: 'POST',
          headers
        });
        if (!res.ok) throw new Error();
        if (last.originalItem) {
          setPendingAppeals(prev => [last.originalItem, ...prev]);
        }
      }

      setActionStack(prev => prev.slice(0, -1));
      toast.success(`已撤销对 ${last.name} 的操作`);
      onActionResolved?.(last.type);
      window.dispatchEvent(new CustomEvent('admin-approval-resolved', { detail: { type: last.type } }));
    } catch (err) {
      toast.error('撤销失败');
    }
  };

  // Format date helper
  const formatTimeRange = (startStr: string, endStr: string) => {
    if (!startStr || !endStr) return '';
    try {
      const s = new Date(startStr);
      const e = new Date(endStr);
      const m = String(s.getMonth() + 1).padStart(2, '0');
      const d = String(s.getDate()).padStart(2, '0');
      const sh = String(s.getHours()).padStart(2, '0');
      const smin = String(s.getMinutes()).padStart(2, '0');
      const eh = String(e.getHours()).padStart(2, '0');
      const emin = String(e.getMinutes()).padStart(2, '0');
      return `${m}-${d} ${sh}:${smin}~${eh}:${emin}`;
    } catch {
      return '';
    }
  };

  // Format date-time helper
  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${y}-${m}-${day} ${h}:${min}`;
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 transition-all duration-200 shadow-sm">
      <div className="flex items-center gap-2 justify-between">
        
        {/* Left: Categories Switcher */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 min-w-0 flex-1">
          <div className="hidden md:flex items-center gap-1.5 text-amber-900 font-semibold text-sm mr-2 shrink-0">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span>待办事项</span>
          </div>

          {isCategoryVisible('whitelist') && (
            <button
              type="button"
              onClick={() => setSelectedCategory('whitelist')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                selectedCategory === 'whitelist'
                  ? 'bg-amber-200/80 text-amber-950 font-semibold shadow-xs'
                  : 'text-amber-800 hover:bg-amber-100/70'
              }`}
            >
              <FileCheck className="w-3.5 h-3.5" />
              <span className={selectedCategory === 'whitelist' ? 'inline' : 'hidden md:inline'}>
                白名单
              </span>
              {pendingWhitelist.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 text-[10px] bg-amber-600 text-white rounded-full font-bold">
                  {pendingWhitelist.length}
                </span>
              )}
            </button>
          )}

          {isCategoryVisible('reservations') && (
            <button
              type="button"
              onClick={() => setSelectedCategory('reservations')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                selectedCategory === 'reservations'
                  ? 'bg-amber-200/80 text-amber-950 font-semibold shadow-xs'
                  : 'text-amber-800 hover:bg-amber-100/70'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span className={selectedCategory === 'reservations' ? 'inline' : 'hidden md:inline'}>
                待审预约
              </span>
              {pendingReservations.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 text-[10px] bg-amber-600 text-white rounded-full font-bold">
                  {pendingReservations.length}
                </span>
              )}
            </button>
          )}

          {isCategoryVisible('appeals') && (
            <button
              type="button"
              onClick={() => setSelectedCategory('appeals')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                selectedCategory === 'appeals'
                  ? 'bg-amber-200/80 text-amber-950 font-semibold shadow-xs'
                  : 'text-amber-800 hover:bg-amber-100/70'
              }`}
            >
              <Scale className="w-3.5 h-3.5" />
              <span className={selectedCategory === 'appeals' ? 'inline' : 'hidden md:inline'}>
                违规申诉
              </span>
              {pendingAppeals.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 text-[10px] bg-amber-600 text-white rounded-full font-bold">
                  {pendingAppeals.length}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Undo button */}
        {actionStack.length > 0 && (() => {
          const rawName = actionStack[actionStack.length - 1].name;
          const personName = rawName.replace(/ 的.*$/, '');
          return (
            <button 
              type="button"
              onClick={handleUndo}
              className="ml-auto text-xs px-2.5 py-1 bg-white border border-amber-300 text-amber-800 rounded-md shadow-xs hover:bg-amber-50 flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3 h-3 text-amber-700" />
              <span className="sm:hidden">撤销 {personName}</span>
              <span className="hidden sm:inline">撤销 ({personName})</span>
            </button>
          );
        })()}
      </div>

      {/* Right / Flow: Capsules Stream */}
      <div className="flex items-center flex-wrap gap-2 mt-1 pt-2.5 border-t border-amber-200/70">
        {/* View Density Toggle Button */}
        <button
          type="button"
          onClick={toggleCompactMode}
          className="p-2 md:p-1.5 min-w-[32px] min-h-[32px] md:min-w-0 md:min-h-0 rounded-lg text-amber-800 hover:text-amber-950 bg-amber-200/60 hover:bg-amber-200/90 border border-amber-300/70 transition-colors shadow-2xs flex items-center justify-center shrink-0 cursor-pointer"
          title={isCompact ? '切换为详细视图' : '切换为极简视图'}
          aria-label={isCompact ? '切换为详细视图' : '切换为极简视图'}
        >
          {isCompact ? <LayoutList className="w-4 h-4 md:w-3.5 md:h-3.5" /> : <List className="w-4 h-4 md:w-3.5 md:h-3.5" />}
        </button>
        <div className="w-[1px] h-5 md:h-4.5 bg-amber-300/70 shrink-0 mx-0.5" />

        <AnimatePresence mode="popLayout">
          {selectedCategory === 'whitelist' && (
            pendingWhitelist.length === 0 ? (
              <span className="text-xs text-amber-700/80 italic py-0.5">暂无白名单待审</span>
            ) : (
              pendingWhitelist.map(app => (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.8, x: -20 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.8, x: -20, transition: { duration: 0.2 } }}
                  key={`white-${app.id}`}
                  tabIndex={0}
                  onMouseEnter={handleCapsulePointerEnter}
                  onFocus={handleCapsulePointerEnter}
                  className="relative group/tooltip bg-white rounded-lg border border-amber-200 px-2 py-0.5 md:px-2.5 md:py-1 shadow-xs flex items-center shrink-0 cursor-default"
                >
                  <div className="flex items-center gap-1 text-sm md:text-xs text-neutral-800">
                    <span className="font-semibold text-neutral-900">{app.student_name}</span>
                    {!isCompact && (
                      <>
                        <span className="text-neutral-400">·</span>
                        <span className="text-neutral-600">{app.equipment_name}</span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center border-l border-amber-100 pl-1 ml-1.5 md:pl-1.5 md:ml-2">
                    <button 
                      type="button"
                      onClick={() => handleApprove('whitelist', app.id, app.student_name)}
                      className="p-1.5 md:p-1 min-w-[28px] min-h-[28px] md:min-w-0 md:min-h-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors flex items-center justify-center"
                      title="通过"
                    >
                      <UserCheck className="w-4 h-4 md:w-3.5 md:h-3.5" />
                    </button>
                    <button 
                      type="button"
                      onClick={() => handleReject('whitelist', app.id, app.student_name)}
                      className="p-1.5 md:p-1 min-w-[28px] min-h-[28px] md:min-w-0 md:min-h-0 text-red-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex items-center justify-center"
                      title="驳回"
                    >
                      <X className="w-4 h-4 md:w-3.5 md:h-3.5" />
                    </button>
                  </div>

                  {/* Tooltip Card */}
                  <div className={`absolute top-full mt-2 hidden group-hover/tooltip:block group-focus/tooltip:block z-50 pointer-events-none ${tooltipAlign === 'right' ? 'right-0 md:left-1/2 md:-translate-x-1/2 md:right-auto' : 'left-0 md:left-1/2 md:-translate-x-1/2'}`}>
                    <div className="bg-white text-neutral-800 border border-neutral-200 text-xs shadow-xl rounded-xl px-3.5 py-2.5 whitespace-nowrap min-w-[220px] max-w-[calc(100vw-2rem)]">
                      <div className="font-semibold mb-2 text-neutral-500 border-b border-neutral-100 pb-1.5">
                        白名单申请明细
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center gap-4">
                          <span className="text-neutral-500">申请仪器</span>
                          <span className="text-neutral-900 font-medium">{app.equipment_name}</span>
                        </div>
                        <div className="flex justify-between items-center gap-4">
                          <span className="text-neutral-500">申请人</span>
                          <span className="text-neutral-900">{app.student_name} ({app.student_id})</span>
                        </div>
                        <div className="flex justify-between items-center gap-4">
                          <span className="text-neutral-500">所属导师</span>
                          <span className="text-neutral-900">{app.supervisor || '未填写'}</span>
                        </div>
                        {app.reason && (
                          <div className="flex flex-col gap-1 mt-1 pt-1 border-t border-neutral-100">
                            <span className="text-neutral-500">申请理由</span>
                            <span className="text-neutral-800 whitespace-pre-wrap max-w-xs">{app.reason}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))
            )
          )}

          {selectedCategory === 'reservations' && (
            pendingReservations.length === 0 ? (
              <span className="text-xs text-amber-700/80 italic py-0.5">暂无待审批预约</span>
            ) : (
              pendingReservations.map(res => (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.8, x: -20 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.8, x: -20, transition: { duration: 0.2 } }}
                  key={`res-${res.id}`}
                  tabIndex={0}
                  onMouseEnter={handleCapsulePointerEnter}
                  onFocus={handleCapsulePointerEnter}
                  className="relative group/tooltip bg-white rounded-lg border border-amber-200 px-2 py-0.5 md:px-2.5 md:py-1 shadow-xs flex items-center shrink-0 cursor-default"
                >
                  <div className="flex items-center gap-1 text-sm md:text-xs text-neutral-800">
                    <span className="font-semibold text-neutral-900">{res.student_name}</span>
                    {!isCompact && (
                      <>
                        <span className="text-neutral-400">·</span>
                        <span className="text-neutral-600">{res.equipment_name}</span>
                        <span className="text-neutral-400">·</span>
                        <span className="font-mono text-neutral-500">{formatTimeRange(res.start_time, res.end_time)}</span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center border-l border-amber-100 pl-1 ml-1.5 md:pl-1.5 md:ml-2">
                    <button 
                      type="button"
                      onClick={() => handleApprove('reservations', res.id, `${res.student_name} 的预约`)}
                      className="p-1.5 md:p-1 min-w-[28px] min-h-[28px] md:min-w-0 md:min-h-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors flex items-center justify-center"
                      title="通过预约"
                    >
                      <Check className="w-4 h-4 md:w-3.5 md:h-3.5" />
                    </button>
                    <button 
                      type="button"
                      onClick={() => handleReject('reservations', res.id, `${res.student_name} 的预约`)}
                      className="p-1.5 md:p-1 min-w-[28px] min-h-[28px] md:min-w-0 md:min-h-0 text-red-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex items-center justify-center"
                      title="驳回预约"
                    >
                      <X className="w-4 h-4 md:w-3.5 md:h-3.5" />
                    </button>
                  </div>

                  {/* Tooltip Card */}
                  <div className={`absolute top-full mt-2 hidden group-hover/tooltip:block group-focus/tooltip:block z-50 pointer-events-none ${tooltipAlign === 'right' ? 'right-0 md:left-1/2 md:-translate-x-1/2 md:right-auto' : 'left-0 md:left-1/2 md:-translate-x-1/2'}`}>
                    <div className="bg-white text-neutral-800 border border-neutral-200 text-xs shadow-xl rounded-xl px-3.5 py-2.5 whitespace-nowrap min-w-[220px] max-w-[calc(100vw-2rem)]">
                      <div className="font-semibold mb-2 text-neutral-500 border-b border-neutral-100 pb-1.5 flex justify-between items-center">
                        <span>预约待审明细</span>
                        <span className="text-amber-600 font-mono text-[11px]">{res.booking_code}</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center gap-4">
                          <span className="text-neutral-500">申请人</span>
                          <span className="text-neutral-900 font-medium">{res.student_name} ({res.student_id})</span>
                        </div>
                        <div className="flex justify-between items-center gap-4">
                          <span className="text-neutral-500">所属导师</span>
                          <span className="text-neutral-900">{res.supervisor || '未填写'}</span>
                        </div>
                        <div className="flex justify-between items-center gap-4">
                          <span className="text-neutral-500">仪器名称</span>
                          <span className="text-neutral-900 font-medium">{res.equipment_name}</span>
                        </div>
                        <div className="flex justify-between items-center gap-4">
                          <span className="text-neutral-500">预约时段</span>
                          <span className="text-neutral-900 font-mono">{formatTimeRange(res.start_time, res.end_time)}</span>
                        </div>
                        {res.notes && (
                          <div className="flex flex-col gap-1 mt-1 pt-1 border-t border-neutral-100">
                            <span className="text-neutral-500">预约备注</span>
                            <span className="text-neutral-800 whitespace-pre-wrap max-w-xs">{res.notes}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))
            )
          )}

          {selectedCategory === 'appeals' && (
            pendingAppeals.length === 0 ? (
              <span className="text-xs text-amber-700/80 italic py-0.5">暂无违规申诉</span>
            ) : (
              pendingAppeals.map(appeal => {
                let remarkObj: any = {};
                try {
                  remarkObj = JSON.parse(appeal.remark || '{}');
                } catch {
                  remarkObj = {};
                }
                const appealReason = remarkObj.appeal_reason || '未填写申诉理由';

                return (
                  <motion.div
                    layout
                    initial={{ opacity: 0, scale: 0.8, x: -20 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.8, x: -20, transition: { duration: 0.2 } }}
                    key={`appeal-${appeal.id}`}
                    tabIndex={0}
                    onMouseEnter={handleCapsulePointerEnter}
                    onFocus={handleCapsulePointerEnter}
                    className="relative group/tooltip bg-white rounded-lg border border-amber-200 px-2 py-0.5 md:px-2.5 md:py-1 shadow-xs flex items-center shrink-0 cursor-default"
                  >
                    <div className="flex items-center gap-1 text-sm md:text-xs text-neutral-800">
                      <span className="font-semibold text-neutral-900">{appeal.student_name || appeal.student_id}</span>
                      {!isCompact && (
                        <>
                          <span className="text-neutral-400">·</span>
                          <span className="text-red-700 font-medium">
                            {violationTypeMap[appeal.violation_type] || appeal.violation_type}
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center border-l border-amber-100 pl-1 ml-1.5 md:pl-1.5 md:ml-2">
                      <button 
                        type="button"
                        onClick={() => handleApprove('appeals', appeal.id, `${appeal.student_name} 的申诉`)}
                        className="p-1.5 md:p-1 min-w-[28px] min-h-[28px] md:min-w-0 md:min-h-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors flex items-center justify-center"
                        title="通过申诉 (撤销违规)"
                      >
                        <Check className="w-4 h-4 md:w-3.5 md:h-3.5" />
                      </button>
                      <button 
                        type="button"
                        onClick={() => handleReject('appeals', appeal.id, `${appeal.student_name} 的申诉`)}
                        className="p-1.5 md:p-1 min-w-[28px] min-h-[28px] md:min-w-0 md:min-h-0 text-red-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex items-center justify-center"
                        title="驳回申诉"
                      >
                        <X className="w-4 h-4 md:w-3.5 md:h-3.5" />
                      </button>
                    </div>

                    {/* Tooltip Card */}
                    <div className={`absolute top-full mt-2 hidden group-hover/tooltip:block group-focus/tooltip:block z-50 pointer-events-none ${tooltipAlign === 'right' ? 'right-0 md:left-1/2 md:-translate-x-1/2 md:right-auto' : 'left-0 md:left-1/2 md:-translate-x-1/2'}`}>
                      <div className="bg-white text-neutral-800 border border-neutral-200 text-xs shadow-xl rounded-xl px-3.5 py-2.5 whitespace-nowrap min-w-[220px] max-w-[calc(100vw-2rem)]">
                        <div className="font-semibold mb-2 text-neutral-500 border-b border-neutral-100 pb-1.5 flex justify-between items-center">
                          <span>违规申诉明细</span>
                          {appeal.booking_code && (
                            <span className="text-amber-600 font-mono text-[11px]">{appeal.booking_code}</span>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex justify-between items-center gap-4">
                            <span className="text-neutral-500">申诉人</span>
                            <span className="text-neutral-900 font-medium">{appeal.student_name} ({appeal.student_id})</span>
                          </div>
                          <div className="flex justify-between items-center gap-4">
                            <span className="text-neutral-500">违规类型</span>
                            <span className="text-neutral-900">{violationTypeMap[appeal.violation_type] || appeal.violation_type}</span>
                          </div>
                          <div className="flex justify-between items-center gap-4">
                            <span className="text-neutral-500">关联仪器</span>
                            <span className="text-neutral-900">{appeal.equipment_name || '无'}</span>
                          </div>
                          {appeal.violation_time && (
                            <div className="flex justify-between items-center gap-4">
                              <span className="text-neutral-500">违规时间</span>
                              <span className="text-neutral-900 font-mono">{formatDateTime(appeal.violation_time)}</span>
                            </div>
                          )}
                          {appeal.booking_code && (
                            <div className="flex justify-between items-center gap-4">
                              <span className="text-neutral-500">预约码</span>
                              <span className="text-neutral-900 font-mono">{appeal.booking_code}</span>
                            </div>
                          )}
                          <div className="flex flex-col gap-1 mt-1 pt-1 border-t border-neutral-100">
                            <span className="text-neutral-500">申诉理由</span>
                            <span className="text-neutral-800 whitespace-pre-wrap max-w-xs">{appealReason}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
