import React, { useState, useEffect, useRef } from 'react';
import { Clock, FileText, Filter, X, Edit3, Trash2, AlertTriangle, ChevronDown, ChevronUp, Users, UserCheck, BarChart2, Calendar, ShieldAlert } from 'lucide-react';
import { format, subDays, startOfToday } from 'date-fns';
import toast from 'react-hot-toast';
import PenaltyRulesTab from './PenaltyRulesTab';

interface ViolationsAndPenaltiesTabProps {
  token: string | null;
  onLogout: () => void;
}

export default function ViolationsAndPenaltiesTab({ token, onLogout }: ViolationsAndPenaltiesTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<'records' | 'stats' | 'active_penalties' | 'rules'>('records');
  
  // Drill-down Context State
  const [penaltyContext, setPenaltyContext] = useState<{
    studentName: string;
    ruleName: string;
    violationIds: number[];
  } | null>(null);

  // Date Range State
  const [startDate, setStartDate] = useState(format(subDays(startOfToday(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(startOfToday(), 'yyyy-MM-dd'));
  const [showTimeFilterPopup, setShowTimeFilterPopup] = useState(false);
  const timeFilterPopupRef = useRef<HTMLDivElement>(null);

  // Data State
  const [records, setRecords] = useState<any[]>([]);
  const [stats, setStats] = useState<any[]>([]);
  const [activePenalties, setActivePenalties] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Expanded Rows State
  // Revoke Modal State
  const [revokeModalOpen, setRevokeModalOpen] = useState(false);
  const [revokeRecordId, setRevokeRecordId] = useState<number | null>(null);
  const [revokeRemark, setRevokeRemark] = useState('');
  const [revokeReservationNotes, setRevokeReservationNotes] = useState('');
  const [modalMode, setModalMode] = useState<'revoke' | 'view' | 'restore'>('revoke');

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
  }, [activeSubTab, startDate, endDate, penaltyContext]);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (penaltyContext) {
        query.append('ids', penaltyContext.violationIds.join(','));
      } else {
        query.append('startDate', startDate);
        query.append('endDate', endDate);
      }
      const res = await fetch(`/api/admin/violation-records?${query.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return onLogout();
      const data = await res.json();
      setRecords(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ startDate, endDate });
      const res = await fetch(`/api/admin/reports/violations?${query.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return onLogout();
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchActivePenalties = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/penalties/active`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return onLogout();
      const data = await res.json();
      setActivePenalties(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleModalSubmit = async () => {
    if (!revokeRecordId) return;
    
    const action = modalMode === 'revoke' ? 'revoke' : 'restore';
    
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
        toast.success(action === 'revoke' ? '已撤销违规记录' : '已取消撤销');
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

  const getViolationTypeLabel = (type: string) => {
    switch (type) {
      case 'late': return '迟到';
      case 'overdue': return '超时';
      case 'no-show': return '爽约';
      case 'late_cancel': return '临期取消';
      default: return type;
    }
  };

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
          !v.student_id?.toLowerCase().includes(search)) {
        return false;
      }
    }
    if (recordsFilterEquipment && !v.equipment_name?.toLowerCase().includes(recordsFilterEquipment.toLowerCase())) return false;
    if (recordsFilterCode && !v.booking_code?.toLowerCase().includes(recordsFilterCode.toLowerCase())) return false;
    if (recordsFilterType.length > 0 && !recordsFilterType.includes(v.violation_type)) return false;
    if (recordsFilterStatus.length > 0 && !recordsFilterStatus.includes(v.status)) return false;
    return true;
  });

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
              <div className="mb-2">学生</div>
              {showFilters && !penaltyContext && (
                <input 
                  type="text" 
                  placeholder="学生姓名/学号" 
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
                  className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal"
                />
              )}
            </th>
            <th className="py-3 px-4 font-medium align-top">
              <div className="mb-2">仪器</div>
              {showFilters && !penaltyContext && (
                <input 
                  type="text" 
                  placeholder="仪器名称" 
                  value={recordsFilterEquipment}
                  onChange={e => setRecordsFilterEquipment(e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal"
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
                      <span className="text-neutral-400 font-normal">全部类型</span>
                    )}
                  </button>
                  {showTypeFilterPopup && (
                    <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 z-10 font-normal">
                      <div className="space-y-1 max-h-48 overflow-y-auto mb-2">
                        {[
                          { value: 'late', label: '迟到' },
                          { value: 'overdue', label: '超时' },
                          { value: 'no-show', label: '爽约' },
                          { value: 'late_cancel', label: '临期取消' }
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
                    {recordsFilterStatus.length > 0 ? (
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
                      <span className="text-neutral-400 font-normal">全部状态</span>
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
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-neutral-100">
                        <button 
                          onClick={() => setRecordsFilterStatus([])}
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
                    <div className="font-medium text-neutral-900">{v.student_name}</div>
                    <div className="text-xs text-neutral-500">{v.student_id} | {v.supervisor || '未知'}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                <div className="flex justify-between items-center md:block">
                  <span className="md:hidden font-medium text-neutral-500 text-xs">预约码</span>
                  <span className="font-mono text-xs">{v.booking_code || '-'}</span>
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
                  <div className="relative inline-block">
                    {v.status === 'active' ? (
                      <span className="text-red-600 font-medium">生效中</span>
                    ) : (
                      <span className="text-neutral-400">已撤销</span>
                    )}
                    {(v.reservation_notes || v.remark) && (
                      <span className="absolute -top-1 -right-2 w-2 h-2 bg-red-500 rounded-full border border-white"></span>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 md:py-4 block md:table-cell">
                <div className="flex justify-end md:justify-end items-center space-x-1">
                  {v.status === 'active' ? (
                    <button 
                      onClick={() => {
                        setRevokeRecordId(v.id);
                        setRevokeRemark(v.remark || '');
                        setRevokeReservationNotes(v.reservation_notes || '');
                        setModalMode('revoke');
                        setRevokeModalOpen(true);
                      }}
                      className="text-red-600 hover:text-red-700 font-medium"
                    >
                      撤销
                    </button>
                  ) : (
                    <button 
                      onClick={() => {
                        setRevokeRecordId(v.id);
                        setRevokeRemark(v.remark || '');
                        setRevokeReservationNotes(v.reservation_notes || '');
                        setModalMode('restore');
                        setRevokeModalOpen(true);
                      }}
                      className="text-neutral-500 hover:text-neutral-700 font-medium"
                    >
                      取消撤销
                    </button>
                  )}
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
    </div>
  );

  const [statsFilterUser, setStatsFilterUser] = useState('');
  const [statsFilterLate, setStatsFilterLate] = useState<number>(0);
  const [statsFilterOvertime, setStatsFilterOvertime] = useState<number>(0);
  const [statsFilterNoshow, setStatsFilterNoshow] = useState<number>(0);
  const [statsFilterLateCancel, setStatsFilterLateCancel] = useState<number>(0);
  const [statsFilterTotal, setStatsFilterTotal] = useState<number>(0);

  const filteredStats = stats.filter(s => {
    if (statsFilterUser) {
      const search = statsFilterUser.toLowerCase();
      if (!s.student_name?.toLowerCase().includes(search) && 
          !s.student_id?.toLowerCase().includes(search) &&
          !s.supervisor?.toLowerCase().includes(search)) {
        return false;
      }
    }
    if (s.late_count < statsFilterLate) return false;
    if (s.overtime_count < statsFilterOvertime) return false;
    if (s.noshow_count < statsFilterNoshow) return false;
    if (s.late_cancelled_count < statsFilterLateCancel) return false;
    if (s.total_violations < statsFilterTotal) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Sub Tabs */}
      <div className="flex gap-2 border-b border-neutral-200">
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
                <button
                  type="button"
                  onClick={() => setShowMobileFilters(!showMobileFilters)}
                  className="md:hidden p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 rounded-lg flex items-center gap-2"
                >
                  <Filter className="w-5 h-5" />
                  <span className="text-sm font-medium">筛选</span>
                </button>
              )}
            </div>
            <div className="hidden md:block">
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
                <label className="block text-xs font-medium text-neutral-500 mb-1">学生</label>
                <input 
                  type="text" 
                  placeholder="学生姓名/学号" 
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
                  type="text" 
                  placeholder="仪器名称" 
                  value={recordsFilterEquipment}
                  onChange={e => setRecordsFilterEquipment(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">违规类型</label>
                <div className="flex flex-wrap gap-2">
                  {['late', 'overdue', 'no-show', 'late_cancel'].map(type => (
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
          <div className="p-4 border-b border-neutral-200 flex justify-between items-center bg-neutral-50/50">
            <div className="flex items-center gap-4">
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
            <div className="hidden md:block">
              {renderTimeFilter()}
            </div>
          </div>
          {showMobileFilters && (
            <div className="p-4 border-b border-neutral-200 bg-neutral-50 grid grid-cols-1 gap-4 md:hidden">
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">时间</label>
                {renderTimeFilter()}
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">学生</label>
                <input 
                  type="text" 
                  placeholder="学生姓名/学号/导师" 
                  value={statsFilterUser}
                  onChange={e => setStatsFilterUser(e.target.value)}
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
                  <label className="block text-xs font-medium text-neutral-500 mb-1">超时次数 &ge; {statsFilterOvertime}</label>
                  <input 
                    type="range" min="0" max={Math.max(1, ...stats.map(s => s.overtime_count))} 
                    value={statsFilterOvertime} 
                    onChange={e => setStatsFilterOvertime(Number(e.target.value))}
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
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-neutral-500 mb-1">违规总计 &ge; {statsFilterTotal}</label>
                  <input 
                    type="range" min="0" max={Math.max(1, ...stats.map(s => s.total_violations))} 
                    value={statsFilterTotal} 
                    onChange={e => setStatsFilterTotal(Number(e.target.value))}
                    className="w-full accent-red-600"
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
                      placeholder="学生姓名/学号/导师" 
                      value={statsFilterUser}
                      onChange={e => setStatsFilterUser(e.target.value)}
                      className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal"
                    />
                  </th>
                  <th className="py-3 px-4 font-medium text-right align-top">
                    <div className="mb-2">迟到次数</div>
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-xs font-normal text-neutral-400">&ge;{statsFilterLate}</span>
                      <input 
                        type="range" min="0" max={Math.max(1, ...stats.map(s => s.late_count))} 
                        value={statsFilterLate} 
                        onChange={e => setStatsFilterLate(Number(e.target.value))}
                        className="w-16 accent-red-600"
                      />
                    </div>
                  </th>
                  <th className="py-3 px-4 font-medium text-right align-top">
                    <div className="mb-2">超时次数</div>
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-xs font-normal text-neutral-400">&ge;{statsFilterOvertime}</span>
                      <input 
                        type="range" min="0" max={Math.max(1, ...stats.map(s => s.overtime_count))} 
                        value={statsFilterOvertime} 
                        onChange={e => setStatsFilterOvertime(Number(e.target.value))}
                        className="w-16 accent-red-600"
                      />
                    </div>
                  </th>
                  <th className="py-3 px-4 font-medium text-right align-top">
                    <div className="mb-2">爽约次数</div>
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-xs font-normal text-neutral-400">&ge;{statsFilterNoshow}</span>
                      <input 
                        type="range" min="0" max={Math.max(1, ...stats.map(s => s.noshow_count))} 
                        value={statsFilterNoshow} 
                        onChange={e => setStatsFilterNoshow(Number(e.target.value))}
                        className="w-16 accent-red-600"
                      />
                    </div>
                  </th>
                  <th className="py-3 px-4 font-medium text-right align-top">
                    <div className="mb-2">取消次数(临期)</div>
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-xs font-normal text-neutral-400">&ge;{statsFilterLateCancel}</span>
                      <input 
                        type="range" min="0" max={Math.max(1, ...stats.map(s => s.late_cancelled_count))} 
                        value={statsFilterLateCancel} 
                        onChange={e => setStatsFilterLateCancel(Number(e.target.value))}
                        className="w-16 accent-red-600"
                      />
                    </div>
                  </th>
                  <th className="py-3 px-4 font-medium text-right align-top">
                    <div className="mb-2">违规总计</div>
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-xs font-normal text-neutral-400">&ge;{statsFilterTotal}</span>
                      <input 
                        type="range" min="0" max={Math.max(1, ...stats.map(s => s.total_violations))} 
                        value={statsFilterTotal} 
                        onChange={e => setStatsFilterTotal(Number(e.target.value))}
                        className="w-16 accent-red-600"
                      />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="text-sm block md:table-row-group divide-y divide-neutral-100 md:divide-y-0 p-4 md:p-0">
                {filteredStats.map(s => (
                  <tr 
                    key={s.student_id}
                    className="block md:table-row hover:bg-neutral-50/50 cursor-pointer transition-colors border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none"
                    onClick={() => {
                      setActiveSubTab('records');
                      setRecordsFilterUser(s.student_id);
                    }}
                  >
                    <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">学生</span>
                        <div className="text-right md:text-left">
                          <div className="font-medium text-neutral-900">{s.student_name}</div>
                          <div className="text-xs text-neutral-500">{s.student_id} | {s.supervisor || '未知'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">迟到次数</span>
                        <span className="text-right">{s.late_count}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">超时次数</span>
                        <span className="text-right">{s.overtime_count}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">爽约次数</span>
                        <span className="text-right">{s.noshow_count}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">取消次数(临期)</span>
                        <span className="text-right">{s.late_cancelled_count}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:py-4 block md:table-cell">
                      <div className="flex justify-between items-center md:block">
                        <span className="md:hidden font-medium text-neutral-500 text-xs">违规总计</span>
                        <span className="text-right font-semibold text-red-600">{s.total_violations}</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredStats.length === 0 && (
                  <tr className="block md:table-row">
                    <td colSpan={6} className="py-8 text-center text-neutral-500 block md:table-cell">没有找到符合条件的统计数据</td>
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
                    { value: 'BAN', label: '禁止预约' },
                    { value: 'REQUIRE_APPROVAL', label: '需审批' },
                    { value: 'RESTRICTED', label: '受限制' }
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
                              {m === 'BAN' ? '禁止预约' : m === 'REQUIRE_APPROVAL' ? '需审批' : '受限制'}
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
                              { value: 'BAN', label: '禁止预约' },
                              { value: 'REQUIRE_APPROVAL', label: '需审批' },
                              { value: 'RESTRICTED', label: '受限制' }
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
                          <span className="md:hidden font-medium text-neutral-500 text-xs">惩罚方式</span>
                          <span className="text-right">
                            {p.penalty_method === 'BAN' ? '禁止预约' : p.penalty_method === 'REQUIRE_APPROVAL' ? '需审批' : '受限制'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                        <div className="flex justify-between items-center md:block">
                          <span className="md:hidden font-medium text-neutral-500 text-xs">封禁开始时间</span>
                          <span className="text-right">{new Date(p.start_time).toLocaleString('zh-CN')}</span>
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
                    </tr>
                  </React.Fragment>
                ))}
                {activePenalties.length === 0 && (
                  <tr className="block md:table-row">
                    <td colSpan={5} className="py-8 text-center text-neutral-500 block md:table-cell">当前没有受限用户</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubTab === 'rules' && (
        <PenaltyRulesTab token={token || ''} />
      )}

      {/* Revoke Modal */}
      {revokeModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <h3 className="text-xl font-bold text-neutral-900 mb-2">
                {modalMode === 'revoke' ? '确认撤销违规记录' : modalMode === 'restore' ? '确认取消撤销' : '违规记录备注详情'}
              </h3>
              {modalMode === 'revoke' && (
                <p className="text-sm text-neutral-500 mb-6">
                  撤销此记录后，该记录将不再计入违规统计。如果此记录曾触发过固定时长的封禁，该封禁也将被自动解除。
                </p>
              )}
              {modalMode === 'restore' && (
                <p className="text-sm text-neutral-500 mb-6">
                  取消撤销后，该记录将重新计入违规统计，并可能触发相应的惩罚规则。
                </p>
              )}
              <div className="space-y-4">
                {revokeReservationNotes && (
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">预约备注</label>
                    <div className="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-700 text-sm whitespace-pre-wrap">
                      {revokeReservationNotes}
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    备注 {(modalMode === 'revoke' || modalMode === 'restore') && '(选填)'}
                  </label>
                  {modalMode === 'revoke' || modalMode === 'restore' ? (
                    <textarea
                      value={revokeRemark}
                      onChange={e => setRevokeRemark(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 outline-none resize-none h-24"
                      placeholder="请输入备注信息..."
                    />
                  ) : (
                    <div className="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-700 text-sm min-h-[6rem] whitespace-pre-wrap">
                      {revokeRemark || <span className="text-neutral-400">无备注</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-neutral-100 bg-neutral-50 flex justify-end gap-3">
              <button
                onClick={() => setRevokeModalOpen(false)}
                className="px-5 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-200 rounded-xl transition-colors"
              >
                {modalMode === 'view' ? '关闭' : '取消'}
              </button>
              {modalMode !== 'view' && (
                <button
                  onClick={handleModalSubmit}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors"
                >
                  {modalMode === 'revoke' ? '确认撤销' : '确认取消撤销'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
