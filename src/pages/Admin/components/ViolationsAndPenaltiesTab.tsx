import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Clock, FileText, Filter, X, Edit3, Trash2, AlertTriangle, ChevronDown, ChevronUp, Users, UserCheck, BarChart2, Calendar, ShieldAlert, CheckCircle, RefreshCw, Info, ArrowRight } from 'lucide-react';
import { format, subDays, startOfToday } from 'date-fns';
import toast from 'react-hot-toast';
import PenaltyRulesTab from './PenaltyRulesTab';
import ViolationParamsTab from './ViolationParamsTab';
import { getViolationTypeLabel } from '../../../utils';

interface ViolationsAndPenaltiesTabProps {
  token: string | null;
  onLogout: () => void;
  onNavigateToReservation?: (bookingCode: string, date?: string) => void;
}

export default function ViolationsAndPenaltiesTab({ token, onLogout, onNavigateToReservation }: ViolationsAndPenaltiesTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<'records' | 'stats' | 'active_penalties' | 'violation_params' | 'rules'>('records');
  
  // Drill-down Context State
  const [penaltyContext, setPenaltyContext] = useState<{
    studentName: string;
    ruleName: string;
    violationIds: number[];
  } | null>(null);

  // Date Range State
  const [startDate, setStartDate] = useState(format(subDays(startOfToday(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(startOfToday(), 'yyyy-MM-dd'));
  const [appealStatusFilter, setAppealStatusFilter] = useState<'all' | 'appealing' | 'rejected'>('all');
  const [showTimeFilterPopup, setShowTimeFilterPopup] = useState(false);
  const timeFilterPopupRef = useRef<HTMLDivElement>(null);

  // Data State
  const [records, setRecords] = useState<any[]>([]);
  const [stats, setStats] = useState<any[]>([]);
  const [statsDimension, setStatsDimension] = useState<'user' | 'supervisor' | 'equipment'>('user');
  const [activePenalties, setActivePenalties] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Expanded Rows State
  // Revoke Modal State
  const [revokeModalOpen, setRevokeModalOpen] = useState(false);
  const [revokeRecordId, setRevokeRecordId] = useState<number | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [revokeRemark, setRevokeRemark] = useState('');
  const [revokeReservationNotes, setRevokeReservationNotes] = useState('');
  const [modalMode, setModalMode] = useState<'revoke' | 'view' | 'restore' | 'reject-appeal' | 'manage'>('manage');
  
  // Waive Penalty Modal State
  const [waiveModalOpen, setWaiveModalOpen] = useState(false);
  const [selectedPenaltyToWaive, setSelectedPenaltyToWaive] = useState<any>(null);

  // Standalone Violation Modal State
  const [standaloneModalOpen, setStandaloneModalOpen] = useState(false);
  const [standaloneForm, setStandaloneForm] = useState({
    student_id: '',
    booking_code: '',
    violation_type: 'hygiene_issue',
    violation_time: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    admin_note: ''
  });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (timeFilterPopupRef.current && !timeFilterPopupRef.current.contains(event.target as Node)) {
        setShowTimeFilterPopup(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (activeSubTab === 'records') {
      fetchRecords();
    } else if (activeSubTab === 'stats') {
      fetchStats();
      fetchRecords();
    } else if (activeSubTab === 'active_penalties') {
      fetchActivePenalties();
      fetchRecords();
    }
  }, [activeSubTab, startDate, endDate, penaltyContext, appealStatusFilter]);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (penaltyContext) {
        query.append('ids', penaltyContext.violationIds.join(','));
      } else {
        query.append('startDate', startDate);
        query.append('endDate', endDate);
        if (appealStatusFilter !== 'all') {
          query.append('appealStatus', appealStatusFilter);
        }
      }
      const res = await fetch(`/api/admin/violation-records?${query.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return onLogout();
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || '获取违规记录失败');
      }
      const data = await res.json();
      setRecords(data);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || '获取违规记录失败');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ startDate, endDate, dimension: statsDimension });
      const res = await fetch(`/api/admin/reports/violations?${query.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return onLogout();
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || '获取统计数据失败');
      }
      const data = await res.json();
      setStats(data);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || '获取统计数据失败');
      setStats([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'stats') {
      fetchStats();
    }
  }, [startDate, endDate, statsDimension, activeSubTab]);

  const fetchActivePenalties = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/penalties/active`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return onLogout();
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || '获取生效中的惩罚数据失败');
      }
      const data = await res.json();
      setActivePenalties(data);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || '获取生效中的惩罚数据失败');
      setActivePenalties([]);
    } finally {
      setLoading(false);
    }
  };

  const handleWaivePenaltySubmit = async () => {
    if (!selectedPenaltyToWaive) return;

    setLoading(true);
    try {
      const payload = {
        penalty_id: selectedPenaltyToWaive.is_dynamic ? null : selectedPenaltyToWaive.id,
        student_id: selectedPenaltyToWaive.student_id,
        rule_id: selectedPenaltyToWaive.rule_id,
        contributing_violation_ids: selectedPenaltyToWaive.contributing_violation_ids,
        is_dynamic: selectedPenaltyToWaive.is_dynamic
      };

      const res = await fetch(`/api/admin/penalties/waive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      
      if (res.status === 401) return onLogout();
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || '豁免操作失败');
      }
      
      toast.success('已成功豁免并解封');
      setWaiveModalOpen(false);
      setSelectedPenaltyToWaive(null);
      fetchActivePenalties();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || '豁免操作失败');
    } finally {
      setLoading(false);
    }
  };

  const handleModalSubmit = async (actionOverride?: string) => {
    if (!revokeRecordId) return;
    
    const action = actionOverride || (modalMode === 'revoke' ? 'revoke' : modalMode === 'restore' ? 'restore' : 'reject-appeal');
    
    try {
      const res = await fetch(`/api/admin/violation-records/${revokeRecordId}/${action}`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ remark: revokeRemark })
      });
      if (res.ok) {
        toast.success(action === 'revoke' ? '已撤销违规记录' : action === 'restore' ? '已取消撤销' : '已驳回申诉');
        setRevokeModalOpen(false);
        setRevokeRemark('');
        setRevokeRecordId(null);
        fetchRecords();
        if (activeSubTab === 'stats') fetchStats();
        if (activeSubTab === 'active_penalties') fetchActivePenalties();
      } else {
        toast.error('操作失败');
      }
    } catch (err) {
      toast.error('操作失败');
    }
  };

  const handleStandaloneSubmit = async () => {
    if (!standaloneForm.student_id || !standaloneForm.violation_type || !standaloneForm.violation_time) {
      toast.error('请填写所有必填字段');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/violations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...standaloneForm,
          booking_code: standaloneForm.booking_code.trim() || undefined
        })
      });

      if (res.status === 401) return onLogout();
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || '录入失败');
      }

      toast.success('录入违规记录成功');
      setStandaloneModalOpen(false);
      setStandaloneForm({
        student_id: '',
        booking_code: '',
        violation_type: 'hygiene_issue',
        violation_time: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        admin_note: ''
      });
      fetchRecords();
      if (activeSubTab === 'stats') fetchStats();
      if (activeSubTab === 'active_penalties') fetchActivePenalties();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || '录入失败');
    } finally {
      setLoading(false);
    }
  };

  const getPenaltyMethodLabel = (method: string) => {
    const lowerMethod = method?.toLowerCase();
    switch (lowerMethod) {
      case 'ban': return '完全封禁';
      case 'require_approval': return '需管理员审批';
      case 'double_fee': return '费用加倍';
      case 'reduce_advance_days': return '减少提前预约天数';
      case 'restricted': return '使用受限';
      default: return method || '未知';
    }
  };

  const parseRemark = (remarkStr: string) => {
    if (!remarkStr) return { admin_note: '', appeal_reason: '', appeal_reply: '' };
    try {
      return JSON.parse(remarkStr);
    } catch (e) {
      return { admin_note: remarkStr, appeal_reason: '', appeal_reply: '' };
    }
  };

  const setPresetDateRange = (days: number) => {
    setEndDate(format(startOfToday(), 'yyyy-MM-dd'));
    setStartDate(format(subDays(startOfToday(), days), 'yyyy-MM-dd'));
    setShowTimeFilterPopup(false);
  };

  const renderTimeFilter = () => (
    <div className="flex items-center gap-2">
      <input 
        type="date" 
        value={startDate} 
        onChange={e => setStartDate(e.target.value)} 
        className="px-3 py-2 bg-white border border-neutral-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500" 
      />
      <span className="text-neutral-500 text-sm">至</span>
      <input 
        type="date" 
        value={endDate} 
        onChange={e => setEndDate(e.target.value)} 
        className="px-3 py-2 bg-white border border-neutral-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500" 
      />
    </div>
  );

  const [recordsFilterUser, setRecordsFilterUser] = useState('');
  const [recordsFilterEquipment, setRecordsFilterEquipment] = useState('');
  const [recordsFilterCode, setRecordsFilterCode] = useState('');
  const [recordsFilterType, setRecordsFilterType] = useState<string[]>([]);
  const [recordsFilterStatus, setRecordsFilterStatus] = useState<string[]>([]);
  
  const [showTypeFilterPopup, setShowTypeFilterPopup] = useState(false);
  const typeFilterPopupRef = useRef<HTMLDivElement>(null);
  
  const [showStatusFilterPopup, setShowStatusFilterPopup] = useState(false);
  const statusFilterPopupRef = useRef<HTMLDivElement>(null);

  // Active Penalties Filters State
  const [penaltiesFilterUser, setPenaltiesFilterUser] = useState('');
  const [penaltiesFilterRule, setPenaltiesFilterRule] = useState('');
  const [penaltiesFilterMethod, setPenaltiesFilterMethod] = useState<string[]>([]);
  const [showMethodFilterPopup, setShowMethodFilterPopup] = useState(false);
  const methodFilterPopupRef = useRef<HTMLDivElement>(null);
  
  const [penaltiesFilterStartFrom, setPenaltiesFilterStartFrom] = useState('');
  const [penaltiesFilterStartTo, setPenaltiesFilterStartTo] = useState('');
  const [showStartFilterPopup, setShowStartFilterPopup] = useState(false);
  const startFilterPopupRef = useRef<HTMLDivElement>(null);

  const [penaltiesFilterEndFrom, setPenaltiesFilterEndFrom] = useState('');
  const [penaltiesFilterEndTo, setPenaltiesFilterEndTo] = useState('');
  const [showEndFilterPopup, setShowEndFilterPopup] = useState(false);
  const endFilterPopupRef = useRef<HTMLDivElement>(null);

  const [showMobileFilters, setShowMobileFilters] = useState(false);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (typeFilterPopupRef.current && !typeFilterPopupRef.current.contains(event.target as Node)) {
        setShowTypeFilterPopup(false);
      }
      if (statusFilterPopupRef.current && !statusFilterPopupRef.current.contains(event.target as Node)) {
        setShowStatusFilterPopup(false);
      }
      if (methodFilterPopupRef.current && !methodFilterPopupRef.current.contains(event.target as Node)) {
        setShowMethodFilterPopup(false);
      }
      if (startFilterPopupRef.current && !startFilterPopupRef.current.contains(event.target as Node)) {
        setShowStartFilterPopup(false);
      }
      if (endFilterPopupRef.current && !endFilterPopupRef.current.contains(event.target as Node)) {
        setShowEndFilterPopup(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredActivePenalties = activePenalties.filter(p => {
    if (penaltiesFilterUser) {
      const search = penaltiesFilterUser.toLowerCase();
      if (!p.student_name?.toLowerCase().includes(search) && 
          !p.student_id?.toLowerCase().includes(search) &&
          !p.supervisor?.toLowerCase().includes(search)) {
        return false;
      }
    }
    if (penaltiesFilterRule) {
      const search = penaltiesFilterRule.toLowerCase();
      const isDynamic = p.is_dynamic;
      const ruleNameMatch = p.rule_name?.toLowerCase().includes(search);
      const dynamicMatch = search.includes('动态') && isDynamic;
      const fixedMatch = search.includes('固定') && !isDynamic;
      
      if (!ruleNameMatch && !dynamicMatch && !fixedMatch) {
        return false;
      }
    }
    if (penaltiesFilterMethod.length > 0 && !penaltiesFilterMethod.includes(p.penalty_method)) {
      return false;
    }
    if (penaltiesFilterStartFrom && new Date(p.start_time) < new Date(`${penaltiesFilterStartFrom}T00:00:00`)) {
      return false;
    }
    if (penaltiesFilterStartTo && new Date(p.start_time) > new Date(`${penaltiesFilterStartTo}T23:59:59`)) {
      return false;
    }
    if (penaltiesFilterEndFrom) {
      if (!p.end_time) return false; // Permanent penalties don't match a specific end date range
      if (new Date(p.end_time) < new Date(`${penaltiesFilterEndFrom}T00:00:00`)) return false;
    }
    if (penaltiesFilterEndTo) {
      if (!p.end_time) return false;
      if (new Date(p.end_time) > new Date(`${penaltiesFilterEndTo}T23:59:59`)) return false;
    }
    return true;
  });

  const filteredRecords = records.filter(v => {
    if (penaltyContext) {
      return penaltyContext.violationIds.includes(v.id);
    }
    if (recordsFilterUser) {
      const search = recordsFilterUser.toLowerCase();
      if (!v.student_name?.toLowerCase().includes(search) && 
          !v.student_id?.toLowerCase().includes(search) &&
          !v.phone?.includes(search) &&
          !v.email?.toLowerCase().includes(search) &&
          !v.supervisor?.toLowerCase().includes(search)) {
        return false;
      }
    }
    if (recordsFilterEquipment && !v.equipment_name?.toLowerCase().includes(recordsFilterEquipment.toLowerCase())) return false;
    if (recordsFilterCode && !v.booking_code?.toLowerCase().includes(recordsFilterCode.toLowerCase())) return false;
    if (recordsFilterType.length > 0 && !recordsFilterType.includes(v.violation_type)) return false;
    if (recordsFilterStatus.length > 0 && !recordsFilterStatus.includes(v.status)) return false;
    return true;
  });

  const [popoverRecord, setPopoverRecord] = useState<any>(null);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setPopoverRecord(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleBookingCodeClick = (e: React.MouseEvent, record: any) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const popoverWidth = 288; // 72 * 4px = 288px
    let left = rect.left + window.scrollX;
    
    // Prevent overflow on right edge
    if (rect.left + popoverWidth > window.innerWidth) {
      left = window.innerWidth - popoverWidth - 16;
    }
    // Prevent overflow on left edge
    if (left < 16) {
      left = 16;
    }

    setPopoverPosition({
      top: rect.bottom + window.scrollY + 8,
      left: left
    });
    setPopoverRecord(record);
  };

  const renderRecordsTable = (data: any[], showFilters = false) => (
    <div className="overflow-x-auto">
      {penaltyContext && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-between mx-4 md:mx-0 mt-4 md:mt-0">
          <div className="flex items-center gap-2 text-blue-800 text-sm">
            <span className="text-xl">💡</span>
            <span>
              正在查看 <strong>{penaltyContext.studentName}</strong> 触发 <strong>{penaltyContext.ruleName}</strong> 规则的关联违规记录。
            </span>
          </div>
          <button 
            onClick={() => {
              setPenaltyContext(null);
              setRecordsFilterUser('');
            }}
            className="px-3 py-1.5 bg-white text-blue-600 border border-blue-200 rounded-lg text-xs font-medium hover:bg-blue-50 transition-colors whitespace-nowrap ml-2"
          >
            退出查看
          </button>
        </div>
      )}
      <table className="w-full text-left border-collapse">
        <thead className="hidden md:table-header-group">
          <tr className="border-b border-neutral-200 text-sm text-neutral-500">
            <th className="py-3 px-4 font-medium align-top">
              <div className="mb-2">违规时间</div>
            </th>
            <th className="py-3 px-4 font-medium align-top">
              <div className="mb-2">用户</div>
              {showFilters && !penaltyContext && (
                <input 
                  type="text" 
                  placeholder="学生姓名/学号/导师" 
                  value={recordsFilterUser}
                  onChange={e => setRecordsFilterUser(e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal"
                />
              )}
            </th>
            <th className="py-3 px-4 font-medium align-top">
              <div className="mb-2">预约码</div>
              {showFilters && !penaltyContext && (
                <input 
                  type="text" 
                  placeholder="搜索预约码" 
                  value={recordsFilterCode}
                  onChange={e => setRecordsFilterCode(e.target.value)}
                  className="w-20 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal"
                />
              )}
            </th>
            <th className="py-3 px-4 font-medium align-top">
              <div className="mb-2">仪器</div>
              {showFilters && !penaltyContext && (
                <input 
                  list="violations-equipment-list"
                  type="text" 
                  placeholder="仪器名称" 
                  value={recordsFilterEquipment}
                  onChange={e => setRecordsFilterEquipment(e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal text-left"
                />
              )}
            </th>
            <th className="py-3 px-4 font-medium align-top">
              <div className="mb-2">违规类型</div>
              {showFilters && !penaltyContext && (
                <div className="relative" ref={typeFilterPopupRef}>
                  <button 
                    onClick={() => setShowTypeFilterPopup(!showTypeFilterPopup)}
                    className="w-full px-2 py-1 text-xs rounded border border-neutral-300 bg-white text-left min-h-[26px] flex flex-wrap gap-1 items-center"
                  >
                    {recordsFilterType.length > 0 ? (
                      recordsFilterType.map(s => (
                        <span key={s} className="bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1">
                          {getViolationTypeLabel(s)}
                          <X 
                            className="w-3 h-3 cursor-pointer hover:text-red-500" 
                            onClick={(e) => {
                              e.stopPropagation();
                              setRecordsFilterType(recordsFilterType.filter(st => st !== s));
                            }}
                          />
                        </span>
                      ))
                    ) : (
                      <span className="text-neutral-400 font-normal">全部</span>
                    )}
                  </button>
                  {showTypeFilterPopup && (
                    <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 z-10 font-normal">
                      <div className="space-y-1 max-h-48 overflow-y-auto mb-2">
                        {[
                          { value: 'late', label: '迟到' },
                          { value: 'overdue', label: '超时' },
                          { value: 'no-show', label: '爽约' },
                          { value: 'late_cancel', label: '临期取消' },
                          { value: 'hygiene_issue', label: '卫生不达标' },
                          { value: 'improper_operation', label: '违规操作' },
                          { value: 'proxy_booking', label: '代预约' },
                          { value: 'other_manual', label: '其他违规' }
                        ].map((item) => (
                          <label key={item.value} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-50 rounded cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={recordsFilterType.includes(item.value)}
                              onChange={e => {
                                if (e.target.checked) setRecordsFilterType([...recordsFilterType, item.value]);
                                else setRecordsFilterType(recordsFilterType.filter(s => s !== item.value));
                              }}
                              className="text-red-600 rounded border-neutral-300 focus:ring-red-600"
                            />
                            <span className="text-xs text-neutral-700">{item.label}</span>
                          </label>
                        ))}
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-neutral-100">
                        <button 
                          onClick={() => setRecordsFilterType([])}
                          className="text-xs text-neutral-500 hover:text-neutral-700"
                        >
                          清空
                        </button>
                        <button 
                          onClick={() => setShowTypeFilterPopup(false)}
                          className="text-xs text-red-600 font-medium"
                        >
                          确定
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </th>
            <th className="py-3 px-4 font-medium align-top">
              <div className="mb-2">状态</div>
              {showFilters && !penaltyContext && (
                <div className="relative" ref={statusFilterPopupRef}>
                  <button 
                    onClick={() => setShowStatusFilterPopup(!showStatusFilterPopup)}
                    className="w-full px-2 py-1 text-xs rounded border border-neutral-300 bg-white text-left min-h-[26px] flex flex-wrap gap-1 items-center"
                  >
                    {appealStatusFilter !== 'all' ? (
                      <span className="bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1">
                        {appealStatusFilter === 'appealing' ? '申诉中' : '已驳回'}
                        <X 
                          className="w-3 h-3 cursor-pointer hover:text-red-500" 
                          onClick={(e) => {
                            e.stopPropagation();
                            setAppealStatusFilter('all');
                          }}
                        />
                      </span>
                    ) : recordsFilterStatus.length > 0 ? (
                      recordsFilterStatus.map(s => (
                        <span key={s} className="bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1">
                          {s === 'active' ? '生效中' : '已撤销'}
                          <X 
                            className="w-3 h-3 cursor-pointer hover:text-red-500" 
                            onClick={(e) => {
                              e.stopPropagation();
                              setRecordsFilterStatus(recordsFilterStatus.filter(st => st !== s));
                            }}
                          />
                        </span>
                      ))
                    ) : (
                      <span className="text-neutral-400 font-normal">全部</span>
                    )}
                  </button>
                  {showStatusFilterPopup && (
                    <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 z-10 font-normal">
                      <div className="space-y-1 max-h-48 overflow-y-auto mb-2">
                        {[
                          { value: 'active', label: '生效中' },
                          { value: 'revoked', label: '已撤销' }
                        ].map((item) => (
                          <label key={item.value} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-50 rounded cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={recordsFilterStatus.includes(item.value)}
                              onChange={e => {
                                if (e.target.checked) setRecordsFilterStatus([...recordsFilterStatus, item.value]);
                                else setRecordsFilterStatus(recordsFilterStatus.filter(s => s !== item.value));
                              }}
                              className="text-red-600 rounded border-neutral-300 focus:ring-red-600"
                            />
                            <span className="text-xs text-neutral-700">{item.label}</span>
                          </label>
                        ))}
                        <div className="border-t border-neutral-100 my-1 pt-1"></div>
                        {[
                          { value: 'appealing', label: '申诉中' },
                          { value: 'rejected', label: '申诉已驳回' }
                        ].map((item) => (
                          <label key={item.value} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-50 rounded cursor-pointer">
                            <input 
                              type="radio" 
                              name="appealStatus"
                              checked={appealStatusFilter === item.value}
                              onChange={() => setAppealStatusFilter(item.value as any)}
                              className="text-red-600 border-neutral-300 focus:ring-red-600"
                            />
                            <span className="text-xs text-neutral-700">{item.label}</span>
                          </label>
                        ))}
                        <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-50 rounded cursor-pointer">
                          <input 
                            type="radio" 
                            name="appealStatus"
                            checked={appealStatusFilter === 'all'}
                            onChange={() => setAppealStatusFilter('all')}
                            className="text-red-600 border-neutral-300 focus:ring-red-600"
                          />
                          <span className="text-xs text-neutral-700">不限申诉状态</span>
                        </label>
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-neutral-100">
                        <button 
                          onClick={() => {
                            setRecordsFilterStatus([]);
                            setAppealStatusFilter('all');
                          }}
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
              )}
            </th>
            <th className="py-3 px-4 font-medium text-right align-top">
              <div className="mb-2">操作</div>
            </th>
          </tr>
        </thead>
        <tbody className="text-sm block md:table-row-group divide-y divide-neutral-100 md:divide-y-0 p-4 md:p-0">
          {data.map(v => (
            <tr key={v.id} className="block md:table-row hover:bg-neutral-50/50 border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none">
              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                <div className="flex justify-between items-center md:block">
                  <span className="md:hidden font-medium text-neutral-500 text-xs">违规时间</span>
                  <div className="text-right md:text-left">
                    <div className="text-neutral-900">{format(new Date(v.violation_time), 'yyyy-MM-dd')}</div>
                    <div className="text-xs text-neutral-500">{format(new Date(v.violation_time), 'HH:mm:ss')}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                <div className="flex justify-between items-center md:block">
                  <span className="md:hidden font-medium text-neutral-500 text-xs">学生</span>
                  <div className="text-right md:text-left">
                    <div className="font-medium text-neutral-900">{v.student_name || v.student_id}</div>
                    <div className="text-xs text-neutral-500">{v.student_id} | {v.supervisor || '未知'}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                <div className="flex justify-between items-center md:block">
                  <span className="md:hidden font-medium text-neutral-500 text-xs">预约码</span>
                  {v.booking_code ? (
                    <button 
                      onClick={(e) => handleBookingCodeClick(e, v)}
                      className="font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                    >
                      {v.booking_code}
                    </button>
                  ) : (
                    <span className="font-mono text-xs text-neutral-400">-</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                <div className="flex justify-between items-center md:block">
                  <span className="md:hidden font-medium text-neutral-500 text-xs">仪器</span>
                  <span className="text-right md:text-left">{v.equipment_name || '-'}</span>
                </div>
              </td>
              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                <div className="flex justify-between items-center md:block">
                  <span className="md:hidden font-medium text-neutral-500 text-xs">违规类型</span>
                  <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700">
                    {getViolationTypeLabel(v.violation_type)}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                <div className="flex justify-between items-center md:block">
                  <span className="md:hidden font-medium text-neutral-500 text-xs">状态</span>
                  {(() => {
                    const remarkObj = parseRemark(v.remark);
                    const isAppealing = v.status === 'active' && remarkObj.appeal_reason && !remarkObj.appeal_reply;
                    const isRejected = v.status === 'active' && remarkObj.appeal_reason && remarkObj.appeal_reply;

                    return (
                      <div className="relative inline-block">
                        {v.status === 'active' ? (
                          <div className="flex flex-col items-end md:items-start gap-1.5">
                            <span className="text-red-600 font-medium">生效中</span>
                            {isAppealing && (
                              <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-100 w-fit">申诉中</span>
                            )}
                            {isRejected && (
                              <span className="text-[10px] font-medium text-red-700 bg-red-50 px-1.5 py-0.5 rounded-md border border-red-100 w-fit">已驳回</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-neutral-400">已撤销</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </td>
              <td className="px-4 py-3 md:py-4 block md:table-cell">
                <div className="flex justify-end md:justify-end items-center space-x-2">
                  {(() => {
                    const remarkObj = parseRemark(v.remark);
                    const isAppealing = v.status === 'active' && remarkObj.appeal_reason && !remarkObj.appeal_reply;
                    const hasNotes = v.reservation_notes || v.remark;

                    return (
                      <button 
                        onClick={() => {
                          setSelectedRecord(v);
                          setRevokeRecordId(v.id);
                          setRevokeRemark(v.remark || '');
                          setRevokeReservationNotes(v.reservation_notes || '');
                          setModalMode('manage');
                          setRevokeModalOpen(true);
                        }}
                        title={isAppealing ? "处理申诉" : "查看/处理"}
                        className={`p-1.5 rounded-lg transition-colors relative ${
                          isAppealing 
                            ? 'text-amber-600 hover:bg-amber-50' 
                            : 'text-blue-600 hover:bg-blue-50'
                        }`}
                      >
                        {isAppealing ? <AlertTriangle className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                        {hasNotes && !isAppealing && (
                          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full"></span>
                        )}
                      </button>
                    );
                  })()}
                </div>
              </td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr className="block md:table-row">
              <td colSpan={7} className="py-8 text-center text-neutral-500 block md:table-cell">暂无违规记录</td>
            </tr>
          )}
        </tbody>
      </table>
      
      {/* Booking Code Popover */}
      {popoverRecord && (
        <div 
          ref={popoverRef}
          className="absolute z-50 bg-white rounded-xl shadow-xl border border-neutral-200 p-4 w-72 text-sm"
          style={{ top: popoverPosition.top, left: popoverPosition.left }}
        >
          <div className="flex justify-between items-start mb-3">
            <h4 className="font-bold text-neutral-900">预约详情</h4>
            <button onClick={() => setPopoverRecord(null)} className="text-neutral-400 hover:text-neutral-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2 text-neutral-600">
            <div className="flex justify-between">
              <span className="text-neutral-500">预约时间:</span>
              <span className="font-medium text-neutral-900">
                {popoverRecord.start_time ? `${format(new Date(popoverRecord.start_time), 'MM-dd HH:mm')} - ${popoverRecord.end_time ? format(new Date(popoverRecord.end_time), format(new Date(popoverRecord.start_time), 'yyyy-MM-dd') === format(new Date(popoverRecord.end_time), 'yyyy-MM-dd') ? 'HH:mm' : 'MM-dd HH:mm') : '?'}` : '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">实际时间:</span>
              <span className="font-medium text-neutral-900">
                {popoverRecord.actual_start_time ? `${format(new Date(popoverRecord.actual_start_time), 'MM-dd HH:mm')} - ${popoverRecord.actual_end_time ? format(new Date(popoverRecord.actual_end_time), format(new Date(popoverRecord.actual_start_time), 'yyyy-MM-dd') === format(new Date(popoverRecord.actual_end_time), 'yyyy-MM-dd') ? 'HH:mm' : 'MM-dd HH:mm') : '未结束'}` : '-'}
              </span>
            </div>
            <div className="border-t border-neutral-100 my-2 pt-2"></div>
            <div className="flex justify-between">
              <span className="text-neutral-500">联系电话:</span>
              <span className="font-medium text-neutral-900">{popoverRecord.phone || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">联系邮箱:</span>
              <span className="font-medium text-neutral-900 truncate max-w-[140px]" title={popoverRecord.email}>{popoverRecord.email || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">耗材数量:</span>
              <span className="font-medium text-neutral-900">{popoverRecord.consumable_quantity || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">产生费用:</span>
              <span className="font-medium text-neutral-900">¥{popoverRecord.total_cost || 0}</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-neutral-100">
            <button
              onClick={() => {
                if (onNavigateToReservation) {
                  const targetDate = popoverRecord.start_time ? format(new Date(popoverRecord.start_time), 'yyyy-MM-dd') : undefined;
                  onNavigateToReservation(popoverRecord.booking_code, targetDate);
                }
                setPopoverRecord(null);
              }}
              className="w-full py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5"
            >
              前往详细预约记录查看 ↗
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const [statsFilterName, setStatsFilterName] = useState('');
  const [statsFilterLate, setStatsFilterLate] = useState<number>(0);
  const [statsFilterLateMinutes, setStatsFilterLateMinutes] = useState<number>(0);
  const [statsFilterOvertime, setStatsFilterOvertime] = useState<number>(0);
  const [statsFilterOvertimeMinutes, setStatsFilterOvertimeMinutes] = useState<number>(0);
  const [statsFilterNoshow, setStatsFilterNoshow] = useState<number>(0);
  const [statsFilterLateCancel, setStatsFilterLateCancel] = useState<number>(0);
  const [statsFilterNormalCancel, setStatsFilterNormalCancel] = useState<number>(0);
  const [statsFilterTotal, setStatsFilterTotal] = useState<number>(0);
  const [statsFilterViolationRate, setStatsFilterViolationRate] = useState<number>(0);

  const filteredStats = stats.filter(s => {
    if (statsFilterName) {
      const search = statsFilterName.toLowerCase();
      if (!s.name?.toLowerCase().includes(search) && !s.key?.toLowerCase().includes(search)) {
        return false;
      }
    }
    if (s.late_count < statsFilterLate) return false;
    if (s.total_late_minutes < statsFilterLateMinutes) return false;
    if (s.overtime_count < statsFilterOvertime) return false;
    if (s.total_overtime_minutes < statsFilterOvertimeMinutes) return false;
    if (s.noshow_count < statsFilterNoshow) return false;
    if (s.late_cancelled_count < statsFilterLateCancel) return false;
    if (s.normal_cancelled_count < statsFilterNormalCancel) return false;
    if (s.total_violations < statsFilterTotal) return false;
    if (s.violation_rate * 100 < statsFilterViolationRate) return false;
    return true;
  });

  const uniqueEquipments = useMemo(() => {
    return Array.from(new Set(records.map(v => v.equipment_name).filter(Boolean)));
  }, [records]);

  return (
    <div className="space-y-6">
      <datalist id="violations-equipment-list">
        {uniqueEquipments.map((eq: any) => (
          <option key={eq} value={eq} />
        ))}
      </datalist>
      {/* Sub Tabs */}
      <div className="flex gap-2 border-b border-neutral-200 overflow-x-auto whitespace-nowrap">
        <button
          onClick={() => setActiveSubTab('records')}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeSubTab === 'records' ? 'border-red-600 text-red-600' : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'}`}
        >
          违规记录
        </button>
        <button
          onClick={() => setActiveSubTab('stats')}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeSubTab === 'stats' ? 'border-red-600 text-red-600' : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'}`}
        >
          违规统计
        </button>
        <button
          onClick={() => setActiveSubTab('active_penalties')}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeSubTab === 'active_penalties' ? 'border-red-600 text-red-600' : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'}`}
        >
          当前受限名单
        </button>
        <button
          onClick={() => setActiveSubTab('violation_params')}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeSubTab === 'violation_params' ? 'border-red-600 text-red-600' : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'}`}
        >
          违规判定参数
        </button>
        <button
          onClick={() => setActiveSubTab('rules')}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeSubTab === 'rules' ? 'border-red-600 text-red-600' : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'}`}
        >
          惩罚规则
        </button>
      </div>

      {/* Content */}
      {activeSubTab === 'records' && (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-neutral-200 flex justify-between items-center bg-neutral-50/50">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold text-neutral-900">违规记录明细</h2>
              {!penaltyContext && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowMobileFilters(!showMobileFilters)}
                    className="md:hidden p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 rounded-lg flex items-center gap-2"
                  >
                    <Filter className="w-5 h-5" />
                    <span className="text-sm font-medium">筛选</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStandaloneModalOpen(true)}
                    className="md:hidden p-2 text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-2 font-medium"
                  >
                    + 新增
                  </button>
                </>
              )}
            </div>
            <div className="hidden md:flex items-center gap-4">
              <button
                type="button"
                onClick={() => setStandaloneModalOpen(true)}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-xl hover:bg-red-700 transition-colors"
              >
                + 新增违规记录
              </button>
              {!penaltyContext && renderTimeFilter()}
            </div>
          </div>
          {showMobileFilters && !penaltyContext && (
            <div className="p-4 border-b border-neutral-200 bg-neutral-50 grid grid-cols-1 gap-4 md:hidden">
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">时间</label>
                {renderTimeFilter()}
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">用户</label>
                <input 
                  type="text" 
                  placeholder="学生姓名/学号/导师" 
                  value={recordsFilterUser}
                  onChange={e => setRecordsFilterUser(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">预约码</label>
                <input 
                  type="text" 
                  placeholder="搜索预约码" 
                  value={recordsFilterCode}
                  onChange={e => setRecordsFilterCode(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">仪器</label>
                <input 
                  list="violations-equipment-list"
                  type="text" 
                  placeholder="仪器名称" 
                  value={recordsFilterEquipment}
                  onChange={e => setRecordsFilterEquipment(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm text-left"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">违规类型</label>
                <div className="flex flex-wrap gap-2">
                  {['late', 'overdue', 'no-show', 'late_cancel', 'hygiene_issue', 'improper_operation', 'proxy_booking', 'other_manual'].map(type => (
                    <button
                      key={type}
                      onClick={() => {
                        if (recordsFilterType.includes(type)) {
                          setRecordsFilterType(recordsFilterType.filter(t => t !== type));
                        } else {
                          setRecordsFilterType([...recordsFilterType, type]);
                        }
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${recordsFilterType.includes(type) ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-neutral-200 text-neutral-600'}`}
                    >
                      {getViolationTypeLabel(type)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">状态</label>
                <div className="flex flex-wrap gap-2">
                  {['active', 'revoked'].map(status => (
                    <button
                      key={status}
                      onClick={() => {
                        if (recordsFilterStatus.includes(status)) {
                          setRecordsFilterStatus(recordsFilterStatus.filter(s => s !== status));
                        } else {
                          setRecordsFilterStatus([...recordsFilterStatus, status]);
                        }
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${recordsFilterStatus.includes(status) ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-neutral-200 text-neutral-600'}`}
                    >
                      {status === 'active' ? '生效中' : '已撤销'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {renderRecordsTable(filteredRecords, true)}
        </div>
      )}

      {activeSubTab === 'stats' && (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-neutral-200 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center bg-neutral-50/50">
            <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-start">
              <h2 className="text-lg font-semibold text-neutral-900">违规统计</h2>
              <button
                type="button"
                onClick={() => setShowMobileFilters(!showMobileFilters)}
                className="md:hidden p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 rounded-lg flex items-center gap-2"
              >
                <Filter className="w-5 h-5" />
                <span className="text-sm font-medium">筛选</span>
              </button>
            </div>
            
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 w-full md:w-auto">
              <div className="flex bg-neutral-200/60 p-1 rounded-lg">
                <button
                  onClick={() => setStatsDimension('user')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${statsDimension === 'user' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
                >
                  按用户
                </button>
                <button
                  onClick={() => setStatsDimension('supervisor')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${statsDimension === 'supervisor' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
                >
                  按导师
                </button>
                <button
                  onClick={() => setStatsDimension('equipment')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${statsDimension === 'equipment' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
                >
                  按设备
                </button>
              </div>
              <div className="hidden md:block">
                {renderTimeFilter()}
              </div>
            </div>
          </div>
          {showMobileFilters && (
            <div className="p-4 border-b border-neutral-200 bg-neutral-50 grid grid-cols-1 gap-4 md:hidden">
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">时间</label>
                {renderTimeFilter()}
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">{statsDimension === 'user' ? '学生' : statsDimension === 'supervisor' ? '导师' : '设备'}</label>
                <input 
                  type="text" 
                  placeholder={statsDimension === 'user' ? '搜索学生姓名/学号...' : statsDimension === 'supervisor' ? '搜索导师...' : '搜索设备...'} 
                  value={statsFilterName}
                  onChange={e => setStatsFilterName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">迟到次数 &ge; {statsFilterLate}</label>
                  <input 
                    type="range" min="0" max={Math.max(1, ...stats.map(s => s.late_count))} 
                    value={statsFilterLate} 
                    onChange={e => setStatsFilterLate(Number(e.target.value))}
                    className="w-full accent-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">迟到时长 &ge; {statsFilterLateMinutes}m</label>
                  <input 
                    type="range" min="0" max={Math.max(10, ...stats.map(s => s.total_late_minutes))} step="5"
                    value={statsFilterLateMinutes} 
                    onChange={e => setStatsFilterLateMinutes(Number(e.target.value))}
                    className="w-full accent-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">超时次数 &ge; {statsFilterOvertime}</label>
                  <input 
                    type="range" min="0" max={Math.max(1, ...stats.map(s => s.overtime_count))} 
                    value={statsFilterOvertime} 
                    onChange={e => setStatsFilterOvertime(Number(e.target.value))}
                    className="w-full accent-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">超时时长 &ge; {statsFilterOvertimeMinutes}m</label>
                  <input 
                    type="range" min="0" max={Math.max(10, ...stats.map(s => s.total_overtime_minutes))} step="5"
                    value={statsFilterOvertimeMinutes} 
                    onChange={e => setStatsFilterOvertimeMinutes(Number(e.target.value))}
                    className="w-full accent-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">爽约次数 &ge; {statsFilterNoshow}</label>
                  <input 
                    type="range" min="0" max={Math.max(1, ...stats.map(s => s.noshow_count))} 
                    value={statsFilterNoshow} 
                    onChange={e => setStatsFilterNoshow(Number(e.target.value))}
                    className="w-full accent-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">取消(临期) &ge; {statsFilterLateCancel}</label>
                  <input 
                    type="range" min="0" max={Math.max(1, ...stats.map(s => s.late_cancelled_count))} 
                    value={statsFilterLateCancel} 
                    onChange={e => setStatsFilterLateCancel(Number(e.target.value))}
                    className="w-full accent-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">取消(普通) &ge; {statsFilterNormalCancel}</label>
                  <input 
                    type="range" min="0" max={Math.max(1, ...stats.map(s => s.normal_cancelled_count))} 
                    value={statsFilterNormalCancel} 
                    onChange={e => setStatsFilterNormalCancel(Number(e.target.value))}
                    className="w-full accent-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">违规总计 &ge; {statsFilterTotal}</label>
                  <input 
                    type="range" min="0" max={Math.max(1, ...stats.map(s => s.total_violations))} 
                    value={statsFilterTotal} 
                    onChange={e => setStatsFilterTotal(Number(e.target.value))}
                    className="w-full accent-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1">违规率 &ge; {statsFilterViolationRate}%</label>
                  <input 
                    type="range" min="0" max="100" step="1"
                    value={statsFilterViolationRate} 
                    onChange={e => setStatsFilterViolationRate(Number(e.target.value))}
                    className="w-full accent-red-600"
                  />
                </div>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="hidden md:table-header-group">
                <tr className="border-b border-neutral-200 text-sm text-neutral-500 bg-neutral-50/50 whitespace-nowrap">
                  <th className="py-3 px-4 font-medium align-top">
                    <div className="mb-2">{statsDimension === 'user' ? '名称' : statsDimension === 'supervisor' ? '导师' : '设备'}</div>
                    <input 
                      type="text" 
                      placeholder={statsDimension === 'user' ? '搜索学生姓名/学号...' : statsDimension === 'supervisor' ? '搜索导师...' : '搜索设备...'} 
                      value={statsFilterName}
                      onChange={e => setStatsFilterName(e.target.value)}
                      className="w-40 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal"
                    />
                  </th>
                  <th className="py-3 px-4 font-medium text-right align-top border-l border-neutral-200">
                    <div className="mb-2">迟到</div>
                    <div className="flex flex-col gap-1 items-end">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-normal text-neutral-400">次&ge;{statsFilterLate}</span>
                        <input 
                          type="range" min="0" max={Math.max(1, ...stats.map(s => s.late_count))} 
                          value={statsFilterLate} onChange={e => setStatsFilterLate(Number(e.target.value))}
                          className="w-12 accent-red-600"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-normal text-neutral-400">分&ge;{statsFilterLateMinutes}</span>
                        <input 
                          type="range" min="0" max={Math.max(10, ...stats.map(s => s.total_late_minutes))} step="5"
                          value={statsFilterLateMinutes} onChange={e => setStatsFilterLateMinutes(Number(e.target.value))}
                          className="w-12 accent-red-600"
                        />
                      </div>
                    </div>
                  </th>
                  <th className="py-3 px-4 font-medium text-right align-top">
                    <div className="mb-2">超时</div>
                    <div className="flex flex-col gap-1 items-end">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-normal text-neutral-400">次&ge;{statsFilterOvertime}</span>
                        <input 
                          type="range" min="0" max={Math.max(1, ...stats.map(s => s.overtime_count))} 
                          value={statsFilterOvertime} onChange={e => setStatsFilterOvertime(Number(e.target.value))}
                          className="w-12 accent-red-600"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-normal text-neutral-400">分&ge;{statsFilterOvertimeMinutes}</span>
                        <input 
                          type="range" min="0" max={Math.max(10, ...stats.map(s => s.total_overtime_minutes))} step="5"
                          value={statsFilterOvertimeMinutes} onChange={e => setStatsFilterOvertimeMinutes(Number(e.target.value))}
                          className="w-12 accent-red-600"
                        />
                      </div>
                    </div>
                  </th>
                  <th className="py-3 px-4 font-medium text-right align-top">
                    <div className="mb-2">爽约</div>
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-[10px] font-normal text-neutral-400">&ge;{statsFilterNoshow}</span>
                      <input 
                        type="range" min="0" max={Math.max(1, ...stats.map(s => s.noshow_count))} 
                        value={statsFilterNoshow} onChange={e => setStatsFilterNoshow(Number(e.target.value))}
                        className="w-12 accent-red-600"
                      />
                    </div>
                  </th>
                  <th className="py-3 px-4 font-medium text-right align-top">
                    <div className="mb-2">取消</div>
                    <div className="flex flex-col gap-1 items-end">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-normal text-neutral-400">临期&ge;{statsFilterLateCancel}</span>
                        <input 
                          type="range" min="0" max={Math.max(1, ...stats.map(s => s.late_cancelled_count))} 
                          value={statsFilterLateCancel} onChange={e => setStatsFilterLateCancel(Number(e.target.value))}
                          className="w-12 accent-red-600"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-normal text-neutral-400">普通&ge;{statsFilterNormalCancel}</span>
                        <input 
                          type="range" min="0" max={Math.max(1, ...stats.map(s => s.normal_cancelled_count))} 
                          value={statsFilterNormalCancel} onChange={e => setStatsFilterNormalCancel(Number(e.target.value))}
                          className="w-12 accent-red-600"
                        />
                      </div>
                    </div>
                  </th>
                  <th className="py-3 px-2 font-medium text-right align-top border-l border-neutral-200">
                    <div className="mb-2 text-xs">卫生</div>
                  </th>
                  <th className="py-3 px-2 font-medium text-right align-top">
                    <div className="mb-2 text-xs">违操</div>
                  </th>
                  <th className="py-3 px-2 font-medium text-right align-top">
                    <div className="mb-2 text-xs">代约</div>
                  </th>
                  <th className="py-3 px-2 font-medium text-right align-top">
                    <div className="mb-2 text-xs">其他</div>
                  </th>
                  <th className="py-3 px-4 font-medium text-right align-top border-l border-neutral-200">
                    <div className="mb-2">违规数/预约数<br/>违规率</div>
                    <div className="flex flex-col gap-1 items-end">
                      <div className="flex justify-end items-center gap-1">
                        <span className="text-[10px] font-normal text-neutral-400">违规&ge;{statsFilterTotal}</span>
                        <input 
                          type="range" min="0" max={Math.max(1, ...stats.map(s => s.total_violations))} 
                          value={statsFilterTotal} onChange={e => setStatsFilterTotal(Number(e.target.value))}
                          className="w-12 accent-red-600"
                        />
                      </div>
                      <div className="flex justify-end items-center gap-1">
                        <span className="text-[10px] font-normal text-neutral-400">率&ge;{statsFilterViolationRate}%</span>
                        <input 
                          type="range" min="0" max="100" step="1"
                          value={statsFilterViolationRate} onChange={e => setStatsFilterViolationRate(Number(e.target.value))}
                          className="w-12 accent-red-600"
                        />
                      </div>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="text-sm block md:table-row-group divide-y divide-neutral-100 md:divide-y-0 p-4 md:p-0">
                {filteredStats.map(s => (
                  <tr 
                    key={s.key}
                    className="block md:table-row hover:bg-neutral-50/50 cursor-pointer transition-colors border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none"
                    onClick={() => {
                      if (statsDimension === 'user') {
                        setActiveSubTab('records');
                        setRecordsFilterUser(s.key);
                      } else if (statsDimension === 'equipment') {
                        setActiveSubTab('records');
                        setRecordsFilterEquipment(s.name);
                      } else if (statsDimension === 'supervisor') {
                        setActiveSubTab('records');
                        setRecordsFilterUser(s.name);
                      }
                    }}
                  >
                    <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">名称</span>
                        <div className="text-right md:text-left flex items-center justify-end md:justify-start gap-2">
                          <div>
                            <div className="font-medium text-neutral-900 group relative flex items-center gap-1">
                              {statsDimension === 'user' ? (
                                <div className="text-right md:text-left">
                                  <div className="font-medium text-neutral-900">{s.name}</div>
                                  <div className="text-xs text-neutral-500 font-normal mt-0.5">{s.key} | {s.supervisor || '无导师'}</div>
                                </div>
                              ) : (
                                <span>{s.name}</span>
                              )}
                              {s.sub_items_list && s.sub_items_list.length > 0 && (
                                <div className="relative group/tooltip">
                                  <Info className="w-4 h-4 text-neutral-400 cursor-help" />
                                  <div className="absolute left-0 bottom-full mb-2 hidden group-hover/tooltip:block z-50">
                                    <div className="bg-white text-neutral-800 border border-neutral-200 text-xs shadow-xl rounded-xl px-3 py-2 whitespace-nowrap min-w-[200px]">
                                      <div className="font-semibold mb-2 text-neutral-500 border-b border-neutral-100 pb-1.5">
                                        违规明细
                                      </div>
                                      <div className="flex flex-col gap-1.5 mt-1 max-h-48 overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin' }}>
                                        {s.sub_items_list.map((item: any, idx: number) => (
                                          <div key={idx} className="flex justify-between items-center gap-4">
                                            <span className="text-neutral-700">{item.name}</span>
                                            <span className="text-red-600 text-[10px] bg-red-50/50 px-1.5 py-0.5 rounded font-medium">{item.count}次</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="w-3 h-3 bg-white border-b border-r border-neutral-200 rotate-45 absolute -bottom-1.5 left-2"></div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                          {s.active_penalty && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700 whitespace-nowrap">
                              受限中
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:py-4 block md:table-cell md:text-right border-b border-neutral-100 md:border-none md:border-l">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">迟到</span>
                        <div className="text-right flex flex-col md:items-end">
                          <span>{s.late_count} 次</span>
                          <span className="text-xs text-neutral-400">{s.total_late_minutes} 分钟</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:py-4 block md:table-cell md:text-right border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">超时</span>
                        <div className="text-right flex flex-col md:items-end">
                          <span>{s.overtime_count} 次</span>
                          <span className="text-xs text-neutral-400">{s.total_overtime_minutes} 分钟</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:py-4 block md:table-cell md:text-right border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">爽约</span>
                        <span className="text-right">{s.noshow_count}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:py-4 block md:table-cell md:text-right border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">取消</span>
                        <div className="text-right flex flex-col md:items-end">
                          <span>{s.late_cancelled_count} 临期</span>
                          <span className="text-xs text-neutral-400">{s.normal_cancelled_count} 普通</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3 md:py-4 block md:table-cell md:text-right border-b border-neutral-100 md:border-none md:border-l">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">卫生</span>
                        <span className="text-right">{s.hygiene_issue}次</span>
                      </div>
                    </td>
                    <td className="px-2 py-3 md:py-4 block md:table-cell md:text-right border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">违操</span>
                        <span className="text-right">{s.improper_operation}次</span>
                      </div>
                    </td>
                    <td className="px-2 py-3 md:py-4 block md:table-cell md:text-right border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">代约</span>
                        <span className="text-right">{s.proxy_booking}次</span>
                      </div>
                    </td>
                    <td className="px-2 py-3 md:py-4 block md:table-cell md:text-right border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">其他</span>
                        <span className="text-right">{s.other_manual}次</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:py-4 block md:table-cell md:text-right md:border-l md:border-neutral-200">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">违规数/预约数</span>
                        <div className="text-right flex flex-col md:items-end">
                          <span className="text-neutral-900">
                            <span className="font-semibold text-red-600">{s.total_violations}违规</span> / {s.total_reservations}预约
                          </span>
                          <span className="text-xs text-neutral-500">违规率: {(s.violation_rate * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredStats.length === 0 && (
                  <tr className="block md:table-row">
                    <td colSpan={12} className="py-8 text-center text-neutral-500 block md:table-cell">没有找到符合条件的统计数据</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubTab === 'active_penalties' && (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-neutral-200 bg-neutral-50/50 flex justify-between items-start">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-red-500" />
                当前受限名单
              </h2>
              <p className="text-sm text-neutral-500 mt-1 hidden md:block">
                展示当前正处于封禁期或受限状态的用户（包含固定时长惩罚和动态计算惩罚）。点击行可展开查看导致封禁的具体违规记录，撤销记录即可自动解除封禁。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowMobileFilters(!showMobileFilters)}
              className="md:hidden p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 rounded-lg flex items-center gap-2"
            >
              <Filter className="w-5 h-5" />
              <span className="text-sm font-medium">筛选</span>
            </button>
          </div>
          {showMobileFilters && (
            <div className="p-4 border-b border-neutral-200 bg-neutral-50 grid grid-cols-1 gap-4 md:hidden">
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">学生</label>
                <input 
                  type="text" 
                  placeholder="学生姓名/学号" 
                  value={penaltiesFilterUser}
                  onChange={e => setPenaltiesFilterUser(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">触发规则</label>
                <input 
                  type="text" 
                  placeholder="搜索规则名称" 
                  value={penaltiesFilterRule}
                  onChange={e => setPenaltiesFilterRule(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">惩罚方式</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'ban', label: '完全封禁' },
                    { value: 'require_approval', label: '需管理员审批' },
                    { value: 'double_fee', label: '费用加倍' },
                    { value: 'reduce_advance_days', label: '减少提前预约天数' }
                  ].map(item => (
                    <button
                      key={item.value}
                      onClick={() => {
                        if (penaltiesFilterMethod.includes(item.value)) {
                          setPenaltiesFilterMethod(penaltiesFilterMethod.filter(m => m !== item.value));
                        } else {
                          setPenaltiesFilterMethod([...penaltiesFilterMethod, item.value]);
                        }
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${penaltiesFilterMethod.includes(item.value) ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-neutral-200 text-neutral-600'}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">封禁开始时间</label>
                <div className="flex gap-2">
                  <input 
                    type="date" 
                    value={penaltiesFilterStartFrom}
                    onChange={e => setPenaltiesFilterStartFrom(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm"
                  />
                  <span className="text-neutral-500 self-center">至</span>
                  <input 
                    type="date" 
                    value={penaltiesFilterStartTo}
                    onChange={e => setPenaltiesFilterStartTo(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">预计解封时间</label>
                <div className="flex gap-2">
                  <input 
                    type="date" 
                    value={penaltiesFilterEndFrom}
                    onChange={e => setPenaltiesFilterEndFrom(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm"
                  />
                  <span className="text-neutral-500 self-center">至</span>
                  <input 
                    type="date" 
                    value={penaltiesFilterEndTo}
                    onChange={e => setPenaltiesFilterEndTo(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm"
                  />
                </div>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="hidden md:table-header-group">
                <tr className="border-b border-neutral-200 text-sm text-neutral-500 bg-neutral-50/50">
                  <th className="py-3 px-4 font-medium align-top">
                    <div className="mb-2">学生</div>
                    <input 
                      type="text" 
                      placeholder="学生姓名/学号" 
                      value={penaltiesFilterUser}
                      onChange={e => setPenaltiesFilterUser(e.target.value)}
                      className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal bg-white"
                    />
                  </th>
                  <th className="py-3 px-4 font-medium align-top">
                    <div className="mb-2">触发规则</div>
                    <input 
                      type="text" 
                      placeholder="搜索规则名称" 
                      value={penaltiesFilterRule}
                      onChange={e => setPenaltiesFilterRule(e.target.value)}
                      className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal bg-white"
                    />
                  </th>
                  <th className="py-3 px-4 font-medium align-top">
                    <div className="mb-2">惩罚方式</div>
                    <div className="relative" ref={methodFilterPopupRef}>
                      <button 
                        onClick={() => setShowMethodFilterPopup(!showMethodFilterPopup)}
                        className="w-full px-2 py-1 text-xs rounded border border-neutral-300 bg-white text-left min-h-[26px] flex flex-wrap gap-1 items-center"
                      >
                        {penaltiesFilterMethod.length > 0 ? (
                          penaltiesFilterMethod.map(m => (
                            <span key={m} className="bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1">
                              {getPenaltyMethodLabel(m)}
                              <X 
                                className="w-3 h-3 cursor-pointer hover:text-red-500" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPenaltiesFilterMethod(penaltiesFilterMethod.filter(sm => sm !== m));
                                }}
                              />
                            </span>
                          ))
                        ) : (
                          <span className="text-neutral-400 font-normal">全部方式</span>
                        )}
                      </button>
                      {showMethodFilterPopup && (
                        <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 z-10 font-normal">
                          <div className="space-y-1 max-h-48 overflow-y-auto mb-2">
                            {[
                              { value: 'ban', label: '完全封禁' },
                              { value: 'require_approval', label: '需管理员审批' },
                              { value: 'double_fee', label: '费用加倍' },
                              { value: 'reduce_advance_days', label: '减少提前预约天数' }
                            ].map((item) => (
                              <label key={item.value} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-50 rounded cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  checked={penaltiesFilterMethod.includes(item.value)}
                                  onChange={e => {
                                    if (e.target.checked) setPenaltiesFilterMethod([...penaltiesFilterMethod, item.value]);
                                    else setPenaltiesFilterMethod(penaltiesFilterMethod.filter(s => s !== item.value));
                                  }}
                                  className="text-red-600 rounded border-neutral-300 focus:ring-red-600"
                                />
                                <span className="text-sm text-neutral-700">{item.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </th>
                  <th className="py-3 px-4 font-medium align-top">
                    <div className="mb-2">封禁开始时间</div>
                    <div className="relative" ref={startFilterPopupRef}>
                      <button 
                        onClick={() => setShowStartFilterPopup(!showStartFilterPopup)}
                        className="w-full px-2 py-1 text-xs rounded border border-neutral-300 bg-white text-left min-h-[26px] flex items-center justify-between"
                      >
                        <span className={penaltiesFilterStartFrom || penaltiesFilterStartTo ? 'text-neutral-700' : 'text-neutral-400 font-normal'}>
                          {penaltiesFilterStartFrom || penaltiesFilterStartTo 
                            ? `${penaltiesFilterStartFrom || '不限'} 至 ${penaltiesFilterStartTo || '不限'}` 
                            : '全部时间'}
                        </span>
                        {(penaltiesFilterStartFrom || penaltiesFilterStartTo) && (
                          <X 
                            className="w-3 h-3 text-neutral-400 hover:text-red-500" 
                            onClick={(e) => {
                              e.stopPropagation();
                              setPenaltiesFilterStartFrom('');
                              setPenaltiesFilterStartTo('');
                            }}
                          />
                        )}
                      </button>
                      {showStartFilterPopup && (
                        <div className="absolute top-full right-0 mt-1 w-64 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 z-10 font-normal">
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs text-neutral-500 mb-1">起始日期</label>
                              <input 
                                type="date" 
                                value={penaltiesFilterStartFrom}
                                onChange={e => setPenaltiesFilterStartFrom(e.target.value)}
                                className="w-full px-2 py-1.5 text-sm rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-neutral-500 mb-1">结束日期</label>
                              <input 
                                type="date" 
                                value={penaltiesFilterStartTo}
                                onChange={e => setPenaltiesFilterStartTo(e.target.value)}
                                className="w-full px-2 py-1.5 text-sm rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </th>
                  <th className="py-3 px-4 font-medium align-top">
                    <div className="mb-2">预计解封时间</div>
                    <div className="relative" ref={endFilterPopupRef}>
                      <button 
                        onClick={() => setShowEndFilterPopup(!showEndFilterPopup)}
                        className="w-full px-2 py-1 text-xs rounded border border-neutral-300 bg-white text-left min-h-[26px] flex items-center justify-between"
                      >
                        <span className={penaltiesFilterEndFrom || penaltiesFilterEndTo ? 'text-neutral-700' : 'text-neutral-400 font-normal'}>
                          {penaltiesFilterEndFrom || penaltiesFilterEndTo 
                            ? `${penaltiesFilterEndFrom || '不限'} 至 ${penaltiesFilterEndTo || '不限'}` 
                            : '全部时间'}
                        </span>
                        {(penaltiesFilterEndFrom || penaltiesFilterEndTo) && (
                          <X 
                            className="w-3 h-3 text-neutral-400 hover:text-red-500" 
                            onClick={(e) => {
                              e.stopPropagation();
                              setPenaltiesFilterEndFrom('');
                              setPenaltiesFilterEndTo('');
                            }}
                          />
                        )}
                      </button>
                      {showEndFilterPopup && (
                        <div className="absolute top-full right-0 mt-1 w-64 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 z-10 font-normal">
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs text-neutral-500 mb-1">起始日期</label>
                              <input 
                                type="date" 
                                value={penaltiesFilterEndFrom}
                                onChange={e => setPenaltiesFilterEndFrom(e.target.value)}
                                className="w-full px-2 py-1.5 text-sm rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-neutral-500 mb-1">结束日期</label>
                              <input 
                                type="date" 
                                value={penaltiesFilterEndTo}
                                onChange={e => setPenaltiesFilterEndTo(e.target.value)}
                                className="w-full px-2 py-1.5 text-sm rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </th>
                  <th className="py-3 px-4 font-medium align-top text-right hidden md:table-cell">
                    <div className="mb-2">操作</div>
                  </th>
                </tr>
              </thead>
              <tbody className="text-sm block md:table-row-group divide-y divide-neutral-100 md:divide-y-0 p-4 md:p-0">
                {filteredActivePenalties.map(p => (
                  <React.Fragment key={p.id}>
                    <tr 
                      className="block md:table-row hover:bg-neutral-50/50 cursor-pointer transition-colors border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none"
                      onClick={() => {
                        setActiveSubTab('records');
                        setRecordsFilterUser(p.student_name || p.student_id);
                        setPenaltyContext({
                          studentName: p.student_name || p.student_id,
                          ruleName: p.rule_name,
                          violationIds: p.contributing_violation_ids.split(',').filter(Boolean).map(Number)
                        });
                      }}
                    >
                      <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                        <div className="flex justify-between items-center md:block">
                          <span className="md:hidden font-medium text-neutral-500 text-xs">学生</span>
                          <div className="text-right md:text-left">
                            <div className="font-medium text-neutral-900">{p.student_name}</div>
                            <div className="text-xs text-neutral-500">
                              {p.student_id} {p.supervisor ? `| ${p.supervisor}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                        <div className="flex justify-between items-center md:block">
                          <span className="md:hidden font-medium text-neutral-500 text-xs">触发规则</span>
                          <div className="flex items-center gap-2 justify-end md:justify-start">
                            <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-orange-50 text-orange-700 border border-orange-100">
                              {p.rule_name}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                        <div className="flex justify-between items-center md:block">
                          <span className="md:hidden font-medium text-neutral-500 text-xs">惩罚方式</span>
                          <div className="flex items-center gap-2 justify-end md:justify-start">
                            <span className="text-neutral-900">
                              {getPenaltyMethodLabel(p.penalty_method)}
                            </span>
                            {p.is_dynamic ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100">
                                动态
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-600 border border-purple-100">
                                固定
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                        <div className="flex justify-between items-center md:block">
                          <span className="md:hidden font-medium text-neutral-500 text-xs">封禁开始时间</span>
                          <div className="text-right md:text-left">
                            <div>{new Date(p.start_time).toLocaleString('zh-CN')}</div>
                            {p.created_at && (
                              <div className="text-[10px] text-neutral-400 mt-0.5">
                                创建于 {format(new Date(p.created_at + 'Z'), 'MM-dd HH:mm')}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 md:py-4 block md:table-cell">
                        <div className="flex justify-between items-center md:block">
                          <span className="md:hidden font-medium text-neutral-500 text-xs">预计解封时间</span>
                          <span className="text-right font-medium text-red-600">
                            {p.end_time ? new Date(p.end_time).toLocaleString('zh-CN') : '永久'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 md:py-4 block md:table-cell text-right">
                        <button
                          className="px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg text-xs font-medium border border-green-200 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPenaltyToWaive(p);
                            setWaiveModalOpen(true);
                          }}
                        >
                          提前解封
                        </button>
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
                {activePenalties.length === 0 && (
                  <tr className="block md:table-row">
                    <td colSpan={6} className="py-8 text-center text-neutral-500 block md:table-cell">当前没有受限用户</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubTab === 'violation_params' && (
        <ViolationParamsTab token={token || ''} />
      )}

      {activeSubTab === 'rules' && (
        <PenaltyRulesTab token={token || ''} />
      )}

      {/* Standalone Violation Drawer */}
      {standaloneModalOpen && (
        <>
          <div 
            className="fixed inset-0 bg-black/50 z-40 transition-opacity"
            onClick={() => setStandaloneModalOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col transform transition-transform duration-300 translate-x-0">
            <div className="flex justify-between items-center px-6 py-4 border-b border-neutral-200 shrink-0">
              <h3 className="text-xl font-bold text-neutral-900">新增违规记录</h3>
              <button 
                onClick={() => setStandaloneModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    违规学号 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={standaloneForm.student_id}
                    onChange={e => setStandaloneForm(prev => ({ ...prev, student_id: e.target.value }))}
                    placeholder="输入违规学生的学号"
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    关联预约码 <span className="text-neutral-400 font-normal">(选填)</span>
                  </label>
                  <input
                    type="text"
                    value={standaloneForm.booking_code}
                    onChange={e => setStandaloneForm(prev => ({ ...prev, booking_code: e.target.value }))}
                    placeholder="输入预约码关联特定仪器规则"
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                  />
                  <p className="mt-1 text-xs text-neutral-500">若该违规与特定预约相关，填写预约码可触发绑定仪器的特定惩罚规则。</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    违规类型 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={standaloneForm.violation_type}
                    onChange={e => setStandaloneForm(prev => ({ ...prev, violation_type: e.target.value }))}
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                  >
                    <option value="hygiene_issue">卫生不达标 (hygiene_issue)</option>
                    <option value="improper_operation">违规操作 (improper_operation)</option>
                    <option value="proxy_booking">代预约 (proxy_booking)</option>
                    <option value="other_manual">其他违规 (other_manual)</option>
                  </select>
                  <p className="mt-1 text-xs text-neutral-500">此处仅支持新增人工判定的违规记录，不支持新增自动判定类型（如迟到、超时等）。</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    违规时间 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={standaloneForm.violation_time}
                    onChange={e => setStandaloneForm(prev => ({ ...prev, violation_time: e.target.value }))}
                    className="w-full px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    违规说明 <span className="text-neutral-400 font-normal">(选填)</span>
                  </label>
                  <textarea
                    rows={4}
                    value={standaloneForm.admin_note}
                    onChange={e => setStandaloneForm(prev => ({ ...prev, admin_note: e.target.value }))}
                    placeholder="例如：经同学举报，确认该生存在代预约行为..."
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-600 focus:border-transparent resize-none"
                  />
                </div>
              </div>
            </div>
            
            <div className="px-6 py-4 bg-neutral-50 border-t border-neutral-200 flex justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setStandaloneModalOpen(false)}
                className="px-4 py-2 text-neutral-600 font-medium hover:bg-neutral-200 rounded-xl transition-colors"
                disabled={loading}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleStandaloneSubmit}
                disabled={loading}
                className="px-6 py-2 bg-red-600 text-white font-medium rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : null}
                确认录入
              </button>
            </div>
          </div>
        </>
      )}

      {/* Revoke Modal */}
      {revokeModalOpen && selectedRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <h3 className="text-xl font-bold text-neutral-900 mb-6">
                违规记录详情
              </h3>

              <div className="space-y-4">
                <div className="flex flex-col gap-1 text-xs text-neutral-500 bg-neutral-50 p-3 rounded-lg border border-neutral-100">
                  <div className="flex items-center gap-4">
                    <span>违规时间: {format(new Date(selectedRecord.violation_time), 'yyyy-MM-dd HH:mm:ss')}</span>
                  </div>
                  {(() => {
                    const isLateRecord = selectedRecord.created_at && 
                      Math.abs(
                        new Date(selectedRecord.created_at + 'Z').getTime() - 
                        new Date(selectedRecord.violation_time).getTime()
                      ) > 60000;
                      
                    if (isLateRecord) {
                      return (
                        <div className="flex items-center gap-4">
                          <span>记录时间: {format(new Date(selectedRecord.created_at + 'Z'), 'yyyy-MM-dd HH:mm:ss')}</span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>

                {revokeReservationNotes && (
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">预约备注</label>
                    <div className="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-700 text-sm whitespace-pre-wrap">
                      {revokeReservationNotes}
                    </div>
                  </div>
                )}
                
                {(() => {
                  const remarkObj = parseRemark(revokeRemark);
                  const isAppealing = selectedRecord.status === 'active' && remarkObj.appeal_reason && !remarkObj.appeal_reply;
                  
                  return (
                    <>
                      {remarkObj.appeal_reason && (
                        <div>
                          <label className="block text-sm font-medium text-neutral-700 mb-1">申诉理由</label>
                          <div className="w-full px-4 py-3 rounded-xl border border-blue-200 bg-blue-50 text-blue-800 text-sm whitespace-pre-wrap">
                            {remarkObj.appeal_reason}
                          </div>
                        </div>
                      )}
                      {remarkObj.appeal_reply && (
                        <div>
                          <label className="block text-sm font-medium text-neutral-700 mb-1">处理回复</label>
                          <div className="w-full px-4 py-3 rounded-xl border border-purple-200 bg-purple-50 text-purple-800 text-sm whitespace-pre-wrap">
                            {remarkObj.appeal_reply}
                          </div>
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-1">
                          管理员备注
                        </label>
                        <textarea
                          value={remarkObj.admin_note || ''}
                          onChange={e => {
                            const newObj = { ...remarkObj, admin_note: e.target.value };
                            setRevokeRemark(JSON.stringify(newObj));
                          }}
                          className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none resize-none h-24"
                          placeholder="请输入备注信息（选填）..."
                        />
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
            <div className="p-4 border-t border-neutral-100 bg-neutral-50 flex justify-between items-center">
              <button
                onClick={() => {
                  setRevokeModalOpen(false);
                  setSelectedRecord(null);
                }}
                className="px-5 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-200 rounded-xl transition-colors"
              >
                关闭
              </button>
              
              <div className="flex gap-2">
                {(() => {
                  const remarkObj = parseRemark(revokeRemark);
                  const isAppealing = selectedRecord.status === 'active' && remarkObj.appeal_reason && !remarkObj.appeal_reply;
                  
                  if (selectedRecord.status === 'active') {
                    if (isAppealing) {
                      return (
                        <>
                          <button
                            onClick={() => handleModalSubmit('reject-appeal')}
                            className="px-5 py-2.5 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-xl transition-colors"
                          >
                            驳回申诉
                          </button>
                          <button
                            onClick={() => handleModalSubmit('revoke')}
                            className="px-5 py-2.5 text-sm font-medium text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-xl transition-colors"
                          >
                            通过申诉(撤销)
                          </button>
                        </>
                      );
                    } else {
                      return (
                        <button
                          onClick={() => handleModalSubmit('revoke')}
                          className="px-5 py-2.5 text-sm font-medium text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-xl transition-colors"
                        >
                          撤销记录
                        </button>
                      );
                    }
                  } else {
                    return (
                      <button
                        onClick={() => handleModalSubmit('restore')}
                        className="px-5 py-2.5 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-xl transition-colors"
                      >
                        恢复记录
                      </button>
                    );
                  }
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Waive Modal */}
      {waiveModalOpen && selectedPenaltyToWaive && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <h3 className="text-xl font-bold text-neutral-900 mb-6">
                提前解封 / 豁免确认
              </h3>
              
              <div className="space-y-4">
                <p className="text-sm text-neutral-600">
                  您确定要为用户 <strong>{selectedPenaltyToWaive.student_name}</strong> 豁免当前的违规惩罚吗？
                </p>
                <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl">
                  <p className="text-sm text-orange-800 font-medium mb-1">⚠️ 警告：</p>
                  <p className="text-xs text-orange-700">
                    本次豁免仅针对引发该惩罚的**特定历史违规记录组合**。
                    如果该用户在未来产生了新的关联违规记录，惩罚将会立刻被重新触发！
                  </p>
                </div>
              </div>
            </div>
            
            <div className="p-4 border-t border-neutral-100 bg-neutral-50 flex gap-3 justify-end">
              <button
                onClick={() => setWaiveModalOpen(false)}
                className="px-5 py-2.5 text-sm font-medium text-neutral-600 bg-white border border-neutral-300 hover:bg-neutral-50 rounded-xl transition-colors"
                disabled={loading}
              >
                取消
              </button>
              <button
                onClick={handleWaivePenaltySubmit}
                disabled={loading}
                className="px-5 py-2.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-xl transition-colors flex items-center gap-2"
              >
                {loading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                确认豁免并解封
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
