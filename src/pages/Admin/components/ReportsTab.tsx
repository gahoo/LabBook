import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Clock, DollarSign, FileText, Download, Filter, X, Edit3, Trash2, AlertTriangle, ChevronDown, ChevronUp, Users, UserCheck, BarChart2, Calendar } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { format, subDays, startOfToday } from 'date-fns';
import toast from 'react-hot-toast';

interface ReportsTabProps {
  token: string | null;
  onLogout: () => void;
}

export default function ReportsTab({ token, onLogout }: ReportsTabProps) {
  const [reports, setReports] = useState<any>(null);
  const [loadingReports, setLoadingReports] = useState(false);
  const [reportPeriod, setReportPeriod] = useState('day');
  const [reportChartType, setReportChartType] = useState<'bar' | 'line'>('bar');
  const [syncWithFilters, setSyncWithFilters] = useState(false);
  const [reportStartDate, setReportStartDate] = useState(format(subDays(startOfToday(), 7), 'yyyy-MM-dd'));
  const [reportEndDate, setReportEndDate] = useState(format(startOfToday(), 'yyyy-MM-dd'));
  const [reportFilterUser, setReportFilterUser] = useState('');
  const [reportFilterEquipment, setReportFilterEquipment] = useState('');
  const [reportFilterDurationMin, setReportFilterDurationMin] = useState('');
  const [reportFilterDurationMax, setReportFilterDurationMax] = useState('');
  const [reportFilterCostMin, setReportFilterCostMin] = useState('');
  const [reportFilterCostMax, setReportFilterCostMax] = useState('');
  const [reportFilterStatus, setReportFilterStatus] = useState<string[]>([]);
  const [reportFilterNotes, setReportFilterNotes] = useState('');
  const [reportFilterCode, setReportFilterCode] = useState('');
  const [reportCurrentPage, setReportCurrentPage] = useState(1);
  const reportPageSize = 20;
  
  const [showReportTimeFilterPopup, setShowReportTimeFilterPopup] = useState(false);
  const [showReportStatusFilterPopup, setShowReportStatusFilterPopup] = useState(false);
  const [showReportMobileFilters, setShowReportMobileFilters] = useState(false);
  const reportTimeFilterPopupRef = useRef<HTMLDivElement>(null);
  const reportStatusFilterPopupRef = useRef<HTMLDivElement>(null);
  
  const [editingReportRecord, setEditingReportRecord] = useState<any>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const [activeSubTab, setActiveSubTab] = useState<'detailed' | 'stats' | 'charts' | 'violations'>('detailed');
  const [chartMetric, setChartMetric] = useState<'duration' | 'revenue'>('duration');
  const [statsType, setStatsType] = useState<'user' | 'supervisor'>('user');
  const [statsFilterUser, setStatsFilterUser] = useState('');
  const [statsFilterSupervisor, setStatsFilterSupervisor] = useState('');
  const [statsFilterDurationMin, setStatsFilterDurationMin] = useState('');
  const [statsFilterDurationMax, setStatsFilterDurationMax] = useState('');
  const [statsFilterCostMin, setStatsFilterCostMin] = useState('');
  const [statsFilterCostMax, setStatsFilterCostMax] = useState('');
  const [violationsData, setViolationsData] = useState<any[]>([]);
  const [loadingViolations, setLoadingViolations] = useState(false);

  const [violationFilterUser, setViolationFilterUser] = useState('');
  const [violationFilterLate, setViolationFilterLate] = useState<number>(0);
  const [violationFilterOvertime, setViolationFilterOvertime] = useState<number>(0);
  const [violationFilterNoshow, setViolationFilterNoshow] = useState<number>(0);
  const [violationFilterCancel, setViolationFilterCancel] = useState<number>(0);
  const [violationFilterTotal, setViolationFilterTotal] = useState<number>(0);
  const [violationFilterPenalty, setViolationFilterPenalty] = useState<string[]>([]);
  const [showViolationPenaltyFilterPopup, setShowViolationPenaltyFilterPopup] = useState(false);
  const violationPenaltyFilterPopupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (reportTimeFilterPopupRef.current && !reportTimeFilterPopupRef.current.contains(event.target as Node)) {
        setShowReportTimeFilterPopup(false);
      }
      if (reportStatusFilterPopupRef.current && !reportStatusFilterPopupRef.current.contains(event.target as Node)) {
        setShowReportStatusFilterPopup(false);
      }
      if (violationPenaltyFilterPopupRef.current && !violationPenaltyFilterPopupRef.current.contains(event.target as Node)) {
        setShowViolationPenaltyFilterPopup(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchReports = async () => {
    setLoadingReports(true);
    try {
      const query = new URLSearchParams({
        period: reportPeriod,
        startDate: reportStartDate,
        endDate: reportEndDate
      });
      const res = await fetch(`/api/admin/reports?${query.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return onLogout();
      const data = await res.json();
      setReports(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingReports(false);
    }
  };

  const fetchViolations = async () => {
    setLoadingViolations(true);
    try {
      const res = await fetch(`/api/admin/reports/violations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return onLogout();
      const data = await res.json();
      setViolationsData(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingViolations(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchReports();
    }
  }, [reportPeriod, reportStartDate, reportEndDate, token]);

  useEffect(() => {
    if (activeSubTab === 'violations' && token) {
      fetchViolations();
    }
  }, [activeSubTab, token]);

  const filteredUsageByPerson = useMemo(() => {
    if (!reports?.usageByPerson) return [];
    return reports.usageByPerson.filter((u: any) => {
      if (statsFilterUser) {
        const search = statsFilterUser.toLowerCase();
        if (!u.student_name.toLowerCase().includes(search) && 
            !u.student_id.toLowerCase().includes(search) && 
            !u.supervisor.toLowerCase().includes(search)) {
          return false;
        }
      }
      if (statsFilterDurationMin && u.total_hours < Number(statsFilterDurationMin)) return false;
      if (statsFilterDurationMax && u.total_hours > Number(statsFilterDurationMax)) return false;
      if (statsFilterCostMin && u.total_revenue < Number(statsFilterCostMin)) return false;
      if (statsFilterCostMax && u.total_revenue > Number(statsFilterCostMax)) return false;
      return true;
    });
  }, [reports?.usageByPerson, statsFilterUser, statsFilterDurationMin, statsFilterDurationMax, statsFilterCostMin, statsFilterCostMax]);

  const filteredUsageBySupervisor = useMemo(() => {
    if (!reports?.usageBySupervisor) return [];
    return reports.usageBySupervisor.filter((s: any) => {
      if (statsFilterSupervisor && !s.supervisor.toLowerCase().includes(statsFilterSupervisor.toLowerCase())) return false;
      if (statsFilterDurationMin && s.total_hours < Number(statsFilterDurationMin)) return false;
      if (statsFilterDurationMax && s.total_hours > Number(statsFilterDurationMax)) return false;
      if (statsFilterCostMin && s.total_revenue < Number(statsFilterCostMin)) return false;
      if (statsFilterCostMax && s.total_revenue > Number(statsFilterCostMax)) return false;
      return true;
    });
  }, [reports?.usageBySupervisor, statsFilterSupervisor, statsFilterDurationMin, statsFilterDurationMax, statsFilterCostMin, statsFilterCostMax]);

  const filteredViolationsData = useMemo(() => {
    return violationsData.filter((v: any) => {
      if (violationFilterUser) {
        const search = violationFilterUser.toLowerCase();
        if (!v.student_name.toLowerCase().includes(search) && 
            !v.student_id.toLowerCase().includes(search) && 
            !v.supervisor.toLowerCase().includes(search)) {
          return false;
        }
      }
      if (v.late_count < violationFilterLate) return false;
      if (v.overtime_count < violationFilterOvertime) return false;
      if (v.noshow_count < violationFilterNoshow) return false;
      if (v.cancelled_count < violationFilterCancel) return false;
      if (v.total_violations < violationFilterTotal) return false;
      if (violationFilterPenalty.length > 0 && !violationFilterPenalty.includes(v.suggested_penalty)) return false;
      return true;
    });
  }, [violationsData, violationFilterUser, violationFilterLate, violationFilterOvertime, violationFilterNoshow, violationFilterCancel, violationFilterTotal, violationFilterPenalty]);

  const filteredReportReservations = useMemo(() => {
    return (reports?.allReservations || []).filter((res: any) => {
      if (reportFilterCode && !res.booking_code.toLowerCase().includes(reportFilterCode.toLowerCase())) return false;
      if (reportFilterUser) {
        const search = reportFilterUser.toLowerCase();
        if (!res.student_name.toLowerCase().includes(search) && 
            !res.student_id.toLowerCase().includes(search) && 
            !res.supervisor.toLowerCase().includes(search)) {
          return false;
        }
      }
      if (reportFilterEquipment && !res.equipment_name.toLowerCase().includes(reportFilterEquipment.toLowerCase())) return false;
      
      const duration = res.actual_start_time && res.actual_end_time 
        ? (new Date(res.actual_end_time).getTime() - new Date(res.actual_start_time).getTime()) / (1000 * 60 * 60)
        : 0;
      
      if (reportFilterDurationMin && duration < Number(reportFilterDurationMin)) return false;
      if (reportFilterDurationMax && duration > Number(reportFilterDurationMax)) return false;
      
      if (reportFilterCostMin && (res.total_cost || 0) < Number(reportFilterCostMin)) return false;
      if (reportFilterCostMax && (res.total_cost || 0) > Number(reportFilterCostMax)) return false;
      
      if (reportFilterStatus.length > 0) {
        const statuses = res.reportStatus.split(', ');
        if (!statuses.some((s: string) => reportFilterStatus.includes(s))) {
          return false;
        }
      }
      
      if (reportFilterNotes) {
        if (!res.notes || !res.notes.toLowerCase().includes(reportFilterNotes.toLowerCase())) {
          return false;
        }
      }
      
      return true;
    });
  }, [reports, reportFilterCode, reportFilterUser, reportFilterEquipment, reportFilterDurationMin, reportFilterDurationMax, reportFilterCostMin, reportFilterCostMax, reportFilterStatus, reportFilterNotes]);

  const syncedUsageByTime = useMemo(() => {
    if (!syncWithFilters) return reports?.usageByTime || [];
    
    const timeMap = new Map();
    const statsReservations = filteredReportReservations.filter((r: any) => 
      (r.actual_start_time && r.status === 'completed') || r.reportStatus?.includes('爽约')
    );

    statsReservations.forEach((r: any) => {
      let hours = 0;
      if (r.actual_start_time && r.actual_end_time) {
        hours = (new Date(r.actual_end_time).getTime() - new Date(r.actual_start_time).getTime()) / (1000 * 60 * 60);
      }
      const revenue = r.total_cost || 0;

      const dateToUse = r.actual_start_time ? new Date(r.actual_start_time) : new Date(r.start_time);
      let pStr = format(dateToUse, 'yyyy-MM-dd');
      if (reportPeriod === 'week') pStr = format(dateToUse, "yyyy-'W'II");
      if (reportPeriod === 'month') pStr = format(dateToUse, 'yyyy-MM');
      if (reportPeriod === 'quarter') pStr = format(dateToUse, "yyyy-'Q'Q");
      if (reportPeriod === 'year') pStr = format(dateToUse, 'yyyy');

      if (!timeMap.has(pStr)) {
        timeMap.set(pStr, { period: pStr, total_hours: 0, total_revenue: 0 });
      }
      const t = timeMap.get(pStr);
      t.total_hours += hours;
      t.total_revenue += revenue;
    });

    return Array.from(timeMap.values()).sort((a: any, b: any) => a.period.localeCompare(b.period));
  }, [syncWithFilters, reports?.usageByTime, filteredReportReservations, reportPeriod]);

  const reportTotalPages = Math.ceil(filteredReportReservations.length / reportPageSize);
  const paginatedReportReservations = filteredReportReservations.slice(
    (reportCurrentPage - 1) * reportPageSize,
    reportCurrentPage * reportPageSize
  );

  const exportToCSV = (data: any[], filename: string, headers: string[], rowMapper: (item: any) => any[]) => {
    const csvContent = [
      headers.join(','),
      ...data.map(item => rowMapper(item).map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.csv`;
    link.click();
  };

  const exportDetailedReport = () => {
    if (!reports?.allReservations) return;
    const headers = ['预约码', '仪器', '用户', '学号', '导师', '预约时间', '实际时间', '时长(小时)', '费用(¥)', '状态', '迟到时长(小时)', '超时时长(小时)', '备注'];
    exportToCSV(
      reports.allReservations,
      `detailed_report_${reportStartDate}_${reportEndDate}`,
      headers,
      (r: any) => [
        r.booking_code,
        r.equipment_name,
        r.student_name,
        r.student_id,
        r.supervisor,
        `${format(new Date(r.start_time), 'yyyy-MM-dd HH:mm')} - ${format(new Date(r.end_time), 'yyyy-MM-dd HH:mm')}`,
        r.actual_start_time ? `${format(new Date(r.actual_start_time), 'yyyy-MM-dd HH:mm')} - ${format(new Date(r.actual_end_time), 'yyyy-MM-dd HH:mm')}` : '-',
        (r.actual_start_time && r.actual_end_time 
          ? (new Date(r.actual_end_time).getTime() - new Date(r.actual_start_time).getTime()) / (1000 * 60 * 60)
          : 0
        ).toFixed(2),
        (r.total_cost || 0).toFixed(2),
        r.reportStatus,
        r.late_mins ? Number((r.late_mins / 60).toFixed(1)) : 0,
        r.overtime_mins ? Number((r.overtime_mins / 60).toFixed(1)) : 0,
        r.notes || ''
      ]
    );
  };

  const exportStats = () => {
    if (statsType === 'user') {
      if (!filteredUsageByPerson || filteredUsageByPerson.length === 0) return;
      const headers = ['用户', '学号', '导师', '总时长(小时)', '总费用(¥)'];
      exportToCSV(
        filteredUsageByPerson,
        `user_stats_${reportStartDate}_${reportEndDate}`,
        headers,
        (u: any) => [u.student_name, u.student_id, u.supervisor, (u.total_hours || 0).toFixed(2), (u.total_revenue || 0).toFixed(2)]
      );
    } else {
      if (!filteredUsageBySupervisor || filteredUsageBySupervisor.length === 0) return;
      const headers = ['导师', '总时长(小时)', '总费用(¥)'];
      exportToCSV(
        filteredUsageBySupervisor,
        `supervisor_stats_${reportStartDate}_${reportEndDate}`,
        headers,
        (s: any) => [s.supervisor, (s.total_hours || 0).toFixed(2), (s.total_revenue || 0).toFixed(2)]
      );
    }
  };

  const exportViolations = () => {
    if (!filteredViolationsData || filteredViolationsData.length === 0) return;
    const headers = ['学号', '姓名', '导师', '迟到次数', '累计迟到时长(小时)', '超时次数', '累计超时时长(小时)', '爽约次数', '取消次数(临期)', '违规总计', '建议处罚'];
    exportToCSV(
      filteredViolationsData,
      `violations_stats_${format(subDays(startOfToday(), 30), 'yyyy-MM-dd')}_${format(startOfToday(), 'yyyy-MM-dd')}`,
      headers,
      (v: any) => [v.student_id, v.student_name, v.supervisor, v.late_count, v.late_duration ? Number((v.late_duration / 60).toFixed(1)) : 0, v.overtime_count, v.overtime_duration ? Number((v.overtime_duration / 60).toFixed(1)) : 0, v.noshow_count, v.late_cancelled_count > 0 ? `${v.cancelled_count} (${v.late_cancelled_count})` : v.cancelled_count, v.total_violations, v.suggested_penalty]
    );
  };

  const handleUpdateReportRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingReportRecord) return;
    
    try {
      const toUTC = (localStr: string) => {
        if (!localStr) return null;
        const [datePart, timePart] = localStr.split('T');
        const [y, m, d] = datePart.split('-').map(Number);
        const [h, min] = timePart.split(':').map(Number);
        return new Date(y, m - 1, d, h, min).toISOString();
      };
      
      const res = await fetch(`/api/admin/reports/reservations/${editingReportRecord.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          actual_start_time: toUTC(editingReportRecord.actual_start_time),
          actual_end_time: toUTC(editingReportRecord.actual_end_time),
          consumable_quantity: editingReportRecord.consumable_quantity,
          notes: editingReportRecord.notes
        })
      });
      if (res.ok) {
        toast.success('记录更新成功');
        setIsDrawerOpen(false);
        fetchReports();
      } else {
        toast.error('更新失败');
      }
    } catch (err) {
      toast.error('更新失败');
    }
  };

  const handleDeleteReportRecord = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/reports/reservations/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('删除成功');
        setDeleteConfirmId(null);
        fetchReports();
      } else {
        toast.error('删除失败');
      }
    } catch (err) {
      toast.error('删除失败');
    }
  };

  return (
    <>
      <div className="space-y-1">
        <div className="flex justify-end">
          <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-neutral-200 shadow-sm w-fit">
            <Calendar className="w-4 h-4 text-neutral-400" />
            <span className="hidden sm:inline text-sm font-medium text-neutral-500">统计区间</span>
            <input type="date" value={reportStartDate} onChange={e => setReportStartDate(e.target.value)} className="bg-transparent text-sm outline-none text-neutral-700 font-medium w-[110px]" />
            <span className="text-neutral-300">-</span>
            <input type="date" value={reportEndDate} onChange={e => setReportEndDate(e.target.value)} className="bg-transparent text-sm outline-none text-neutral-700 font-medium w-[110px]" />
          </div>
        </div>

        {loadingReports ? (
          <div className="text-center py-12 text-neutral-500">加载报表中...</div>
        ) : reports ? (
          <div className="space-y-6">
            {/* Sub-tabs for Detailed vs Violations */}
            <div className="flex border-b border-neutral-200 overflow-x-auto">
              <button
                onClick={() => setActiveSubTab('detailed')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeSubTab === 'detailed'
                    ? 'border-red-600 text-red-600'
                    : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span className={activeSubTab === 'detailed' ? '' : 'hidden md:inline'}>详细预约记录</span>
              </button>
              <button
                onClick={() => setActiveSubTab('stats')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeSubTab === 'stats'
                    ? 'border-red-600 text-red-600'
                    : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
                }`}
              >
                <Users className="w-4 h-4" />
                <span className={activeSubTab === 'stats' ? '' : 'hidden md:inline'}>时长费用统计</span>
              </button>
              <button
                onClick={() => setActiveSubTab('charts')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeSubTab === 'charts'
                    ? 'border-red-600 text-red-600'
                    : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
                }`}
              >
                <BarChart2 className="w-4 h-4" />
                <span className={activeSubTab === 'charts' ? '' : 'hidden md:inline'}>统计图表</span>
              </button>
              <button
                onClick={() => setActiveSubTab('violations')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeSubTab === 'violations'
                    ? 'border-red-600 text-red-600'
                    : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
                }`}
              >
                <AlertTriangle className="w-4 h-4" />
                <span className={activeSubTab === 'violations' ? '' : 'hidden md:inline'}>违规统计</span>
              </button>
            </div>

            {/* Data Table */}
            {activeSubTab === 'detailed' && (
              <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
                <div className="p-4 border-b border-neutral-200 flex items-center justify-between bg-neutral-50">
                  <h3 className="font-bold flex items-center gap-2">
                    <FileText className="w-5 h-5 text-red-600" />
                    详细预约记录
                  </h3>
                  <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowReportMobileFilters(!showReportMobileFilters)}
                    className="md:hidden p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 rounded-lg flex items-center gap-2"
                  >
                    <Filter className="w-5 h-5" />
                    <span className="text-sm font-medium">筛选</span>
                  </button>
                  <button 
                    onClick={exportDetailedReport}
                    className="p-2 border border-neutral-300 text-neutral-500 rounded-xl hover:bg-neutral-50 hover:text-red-600 transition-colors"
                    title="导出记录"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {showReportMobileFilters && (
                <div className="md:hidden p-4 bg-neutral-50 border-b border-neutral-200 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-neutral-500 mb-1">预约码</label>
                    <input type="text" value={reportFilterCode} onChange={e => setReportFilterCode(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm" placeholder="搜索预约码..." />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-500 mb-1">用户/导师</label>
                    <input type="text" value={reportFilterUser} onChange={e => setReportFilterUser(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm" placeholder="姓名/学号/导师..." />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-500 mb-1">仪器</label>
                    <input type="text" value={reportFilterEquipment} onChange={e => setReportFilterEquipment(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm" placeholder="搜索仪器..." />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-500 mb-2">时长/费用</label>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <input type="number" placeholder="Min h" value={reportFilterDurationMin} onChange={e => setReportFilterDurationMin(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm" />
                        <span className="text-neutral-400">-</span>
                        <input type="number" placeholder="Max h" value={reportFilterDurationMax} onChange={e => setReportFilterDurationMax(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm" />
                      </div>
                      <div className="flex items-center gap-2">
                        <input type="number" placeholder="Min ¥" value={reportFilterCostMin} onChange={e => setReportFilterCostMin(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm" />
                        <span className="text-neutral-400">-</span>
                        <input type="number" placeholder="Max ¥" value={reportFilterCostMax} onChange={e => setReportFilterCostMax(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-500 mb-2">状态</label>
                    <div className="flex flex-wrap gap-2">
                      {['正常', '迟到', '超时', '待上机', '爽约', '临期取消'].map((value) => (
                        <label key={value} className="flex items-center gap-2 px-2 py-1.5 bg-white border border-neutral-200 rounded-lg">
                          <input type="checkbox" checked={reportFilterStatus.includes(value)} onChange={e => {
                            if (e.target.checked) setReportFilterStatus([...reportFilterStatus, value]);
                            else setReportFilterStatus(reportFilterStatus.filter(s => s !== value));
                          }} className="text-red-600 rounded border-neutral-300 focus:ring-red-600" />
                          <span className="text-sm">{value}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap block md:table">
                  <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200 hidden md:table-header-group">
                    <tr>
                      <th className="px-4 py-4 font-medium align-top">
                        <div className="mb-2">预约码</div>
                        <input 
                          type="text" 
                          placeholder="搜索预约码..." 
                          value={reportFilterCode}
                          onChange={e => setReportFilterCode(e.target.value)}
                          className="w-20 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal"
                        />
                      </th>
                      <th className="px-4 py-4 font-medium align-top">
                        <div className="mb-2">用户/导师</div>
                        <input 
                          type="text" 
                          placeholder="姓名/学号/导师..." 
                          value={reportFilterUser}
                          onChange={e => setReportFilterUser(e.target.value)}
                          className="w-20 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal"
                        />
                      </th>
                      <th className="px-4 py-4 font-medium align-top">
                        <div className="mb-2">仪器</div>
                        <input 
                          type="text" 
                          placeholder="搜索仪器..." 
                          value={reportFilterEquipment}
                          onChange={e => setReportFilterEquipment(e.target.value)}
                          className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal"
                        />
                      </th>
                      <th className="px-4 py-4 font-medium align-top">预约时间</th>
                      <th className="px-4 py-4 font-medium align-top">实际上机</th>
                      <th className="px-4 py-4 font-medium align-top">
                        <div className="mb-2">时长/费用</div>
                        <div className="relative" ref={reportTimeFilterPopupRef}>
                          <button 
                            onClick={() => setShowReportTimeFilterPopup(!showReportTimeFilterPopup)}
                            className="w-full px-2 py-1 text-xs rounded border border-neutral-300 bg-white text-left min-h-[26px] flex items-center justify-between"
                          >
                            <span className="text-neutral-500 truncate">
                              {reportFilterDurationMin || reportFilterDurationMax || reportFilterCostMin || reportFilterCostMax ? '已筛选' : '筛选时长/费用'}
                            </span>
                            <Filter className="w-3 h-3 text-neutral-400" />
                          </button>
                          {showReportTimeFilterPopup && (
                            <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 z-10 font-normal">
                              <div className="space-y-3">
                                <div>
                                  <label className="block text-xs text-neutral-500 mb-1">时长 (小时)</label>
                                  <div className="flex items-center gap-1">
                                    <input type="number" placeholder="Min" value={reportFilterDurationMin} onChange={e => setReportFilterDurationMin(e.target.value)} className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none" />
                                    <span className="text-neutral-400">-</span>
                                    <input type="number" placeholder="Max" value={reportFilterDurationMax} onChange={e => setReportFilterDurationMax(e.target.value)} className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none" />
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-xs text-neutral-500 mb-1">费用 (¥)</label>
                                  <div className="flex items-center gap-1">
                                    <input type="number" placeholder="Min" value={reportFilterCostMin} onChange={e => setReportFilterCostMin(e.target.value)} className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none" />
                                    <span className="text-neutral-400">-</span>
                                    <input type="number" placeholder="Max" value={reportFilterCostMax} onChange={e => setReportFilterCostMax(e.target.value)} className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none" />
                                  </div>
                                </div>
                                <div className="flex justify-between items-center pt-2 border-t border-neutral-100">
                                  <button 
                                    onClick={() => {
                                      setReportFilterDurationMin('');
                                      setReportFilterDurationMax('');
                                      setReportFilterCostMin('');
                                      setReportFilterCostMax('');
                                    }}
                                    className="text-xs text-neutral-500 hover:text-neutral-700"
                                  >
                                    清空
                                  </button>
                                  <button 
                                    onClick={() => setShowReportTimeFilterPopup(false)}
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
                        <div className="mb-2">状态/备注</div>
                        <div className="relative" ref={reportStatusFilterPopupRef}>
                          <button 
                            onClick={() => setShowReportStatusFilterPopup(!showReportStatusFilterPopup)}
                            className="w-full px-2 py-1 text-xs rounded border border-neutral-300 bg-white text-left min-h-[26px] flex flex-wrap gap-1 items-center"
                          >
                            {reportFilterStatus.length > 0 || reportFilterNotes ? (
                              <>
                                {reportFilterStatus.map(s => (
                                  <span key={s} className="bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1">
                                    {s}
                                    <X 
                                      className="w-3 h-3 cursor-pointer hover:text-red-500" 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setReportFilterStatus(reportFilterStatus.filter(st => st !== s));
                                      }}
                                    />
                                  </span>
                                ))}
                                {reportFilterNotes && (
                                  <span className="bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1">
                                    备注: {reportFilterNotes}
                                    <X 
                                      className="w-3 h-3 cursor-pointer hover:text-red-500" 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setReportFilterNotes('');
                                      }}
                                    />
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-neutral-400">全部状态</span>
                            )}
                          </button>
                          {showReportStatusFilterPopup && (
                            <div className="absolute top-full right-0 mt-1 w-56 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 z-10 font-normal">
                              <div className="mb-3">
                                <label className="block text-[10px] font-medium text-neutral-500 mb-1 uppercase tracking-wider">状态</label>
                                <div className="space-y-1 max-h-48 overflow-y-auto">
                                  {['正常', '迟到', '超时', '待上机', '爽约', '临期取消'].map((value) => (
                                    <label key={value} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-50 rounded cursor-pointer">
                                      <input 
                                        type="checkbox" 
                                        checked={reportFilterStatus.includes(value)}
                                        onChange={e => {
                                          if (e.target.checked) setReportFilterStatus([...reportFilterStatus, value]);
                                          else setReportFilterStatus(reportFilterStatus.filter(s => s !== value));
                                        }}
                                        className="text-red-600 rounded border-neutral-300 focus:ring-red-600"
                                      />
                                      <span className="text-xs text-neutral-700">{value}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                              <div className="mb-3">
                                <label className="block text-[10px] font-medium text-neutral-500 mb-1 uppercase tracking-wider">备注</label>
                                <input 
                                  type="text" 
                                  placeholder="搜索备注..."
                                  value={reportFilterNotes}
                                  onChange={e => setReportFilterNotes(e.target.value)}
                                  className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 focus:border-transparent outline-none"
                                />
                              </div>
                              <div className="flex justify-between items-center pt-2 border-t border-neutral-100">
                                <button 
                                  onClick={() => {
                                    setReportFilterStatus([]);
                                    setReportFilterNotes('');
                                  }}
                                  className="text-xs text-neutral-500 hover:text-neutral-700"
                                >
                                  清空
                                </button>
                                <button 
                                  onClick={() => setShowReportStatusFilterPopup(false)}
                                  className="text-xs text-red-600 font-medium"
                                >
                                  确定
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </th>
                      <th className="px-4 py-4 font-medium align-top">耗材</th>
                      <th className="px-4 py-4 font-medium align-top">操作</th>
                    </tr>
                  </thead>
                  <tbody className="block md:table-row-group divide-y divide-neutral-100 md:divide-y-0 p-4 md:p-0">
                    {paginatedReportReservations.map((res: any) => (
                      <tr key={res.id} className="block md:table-row hover:bg-neutral-50/50 border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none">
                        <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">预约码</span>
                            <span className="font-mono text-xs text-neutral-500">{res.booking_code || '-'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">用户/导师</span>
                            <div className="text-right md:text-left">
                              <p className="font-medium text-neutral-900">{res.student_name}</p>
                              <p className="text-xs text-neutral-500">{res.student_id} | {res.supervisor}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">仪器</span>
                            <span className="text-neutral-900">{res.equipment_name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">预约时间</span>
                            <div className="text-right md:text-left text-xs text-neutral-500">
                              <p>{format(new Date(res.start_time), 'yyyy-MM-dd')}</p>
                              <p>{format(new Date(res.start_time), 'HH:mm')} - {format(new Date(res.end_time), 'HH:mm')}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">实际上机</span>
                            <div className="text-right md:text-left text-xs text-neutral-500">
                              {res.actual_start_time ? (
                                <>
                                  <p>{format(new Date(res.actual_start_time), 'yyyy-MM-dd')}</p>
                                  <p>{format(new Date(res.actual_start_time), 'HH:mm')} - {res.actual_end_time ? format(new Date(res.actual_end_time), 'HH:mm') : '至今'}</p>
                                </>
                              ) : (
                                <span className="text-neutral-400">-</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">时长/费用</span>
                            <div className="text-right md:text-left">
                              <p className="text-neutral-900">
                                {(res.actual_start_time && res.actual_end_time 
                                  ? (new Date(res.actual_end_time).getTime() - new Date(res.actual_start_time).getTime()) / (1000 * 60 * 60)
                                  : 0
                                ).toFixed(2)}h
                              </p>
                              <p className="text-xs font-medium text-amber-600">¥{(res.total_cost || 0).toFixed(2)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">状态</span>
                            <div className="relative inline-flex flex-wrap gap-1">
                              {res.reportStatus?.split(', ').map((status: string, index: number) => (
                                <span key={index} className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  status === '正常' ? 'bg-emerald-100 text-emerald-700' :
                                  status === '迟到' ? 'bg-amber-100 text-amber-700' :
                                  status === '超时' ? 'bg-orange-100 text-orange-700' :
                                  status === '待上机' ? 'bg-blue-100 text-blue-700' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {status}
                                  {status === '迟到' && res.late_mins ? ` (${Number((res.late_mins / 60).toFixed(1))}h)` : ''}
                                  {status === '超时' && res.overtime_mins ? ` (${Number((res.overtime_mins / 60).toFixed(1))}h)` : ''}
                                </span>
                              ))}
                              {res.notes && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border border-white" title={res.notes}></span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">耗材</span>
                            <span className="text-neutral-900">{res.consumable_quantity || 0}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 md:py-4 block md:table-cell">
                          <div className="flex justify-end md:justify-start gap-2">
                            <button 
                              onClick={() => {
                                const toLocal = (utcStr: string) => {
                                  if (!utcStr) return '';
                                  const d = new Date(utcStr);
                                  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                                };
                                setEditingReportRecord({
                                  ...res,
                                  actual_start_time: toLocal(res.actual_start_time),
                                  actual_end_time: toLocal(res.actual_end_time)
                                });
                                setIsDrawerOpen(true);
                              }}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="编辑记录"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => setDeleteConfirmId(res.id)}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="删除记录"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {paginatedReportReservations.length === 0 && (
                      <tr className="block md:table-row">
                        <td colSpan={9} className="px-4 py-12 text-center text-neutral-500 block md:table-cell">没有找到符合条件的记录</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              
              {/* Pagination */}
              {reportTotalPages > 1 && (
                <div className="p-4 border-t border-neutral-200 flex items-center justify-between bg-neutral-50">
                  <div className="text-sm text-neutral-500">
                    共 {filteredReportReservations.length} 条记录
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      disabled={reportCurrentPage === 1}
                      onClick={() => setReportCurrentPage(prev => prev - 1)}
                      className="px-3 py-1.5 border border-neutral-300 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white transition-colors"
                    >
                      上一页
                    </button>
                    <span className="text-sm font-medium text-neutral-700">
                      {reportCurrentPage} / {reportTotalPages}
                    </span>
                    <button 
                      disabled={reportCurrentPage === reportTotalPages}
                      onClick={() => setReportCurrentPage(prev => prev + 1)}
                      className="px-3 py-1.5 border border-neutral-300 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white transition-colors"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Edit Drawer */}
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
                <h2 className="text-lg font-bold text-neutral-900">编辑预约记录</h2>
                <button 
                  onClick={() => setIsDrawerOpen(false)}
                  className="p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 sm:p-6">
                {editingReportRecord && (
                  <form onSubmit={handleUpdateReportRecord} className="space-y-4">
                    <div className="bg-neutral-50 p-4 rounded-xl mb-6 space-y-1.5">
                      <p className="text-sm text-neutral-500">预约码: <span className="font-mono text-neutral-900">{editingReportRecord.booking_code}</span></p>
                      <p className="text-sm text-neutral-500">姓名: <span className="text-neutral-900">{editingReportRecord.student_name}</span></p>
                      <p className="text-sm text-neutral-500">学号: <span className="text-neutral-900">{editingReportRecord.student_id}</span></p>
                      <p className="text-sm text-neutral-500">导师: <span className="text-neutral-900">{editingReportRecord.supervisor}</span></p>
                      <p className="text-sm text-neutral-500">仪器: <span className="text-neutral-900">{editingReportRecord.equipment_name}</span></p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-neutral-500 mb-1">实际上机时间</label>
                        <input 
                          type="datetime-local" 
                          step="300"
                          value={editingReportRecord.actual_start_time || ''} 
                          onChange={e => setEditingReportRecord({...editingReportRecord, actual_start_time: e.target.value})} 
                          className="w-full px-4 py-2 rounded-xl border border-neutral-300" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-neutral-500 mb-1">实际下机时间</label>
                        <input 
                          type="datetime-local" 
                          step="300"
                          value={editingReportRecord.actual_end_time || ''} 
                          onChange={e => setEditingReportRecord({...editingReportRecord, actual_end_time: e.target.value})} 
                          className="w-full px-4 py-2 rounded-xl border border-neutral-300" 
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-500 mb-1">耗材数量</label>
                      <input 
                        type="number" 
                        min="0"
                        value={editingReportRecord.consumable_quantity || 0} 
                        onChange={e => setEditingReportRecord({...editingReportRecord, consumable_quantity: Number(e.target.value)})} 
                        className="w-full px-4 py-2 rounded-xl border border-neutral-300" 
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-500 mb-1">备注</label>
                      <textarea 
                        rows={3}
                        value={editingReportRecord.notes || ''} 
                        onChange={e => setEditingReportRecord({...editingReportRecord, notes: e.target.value})} 
                        className="w-full px-4 py-2 rounded-xl border border-neutral-300 resize-none"
                        placeholder="添加备注信息..."
                      />
                    </div>
                    <div className="flex gap-4 mt-8">
                      <button type="button" onClick={() => setIsDrawerOpen(false)} className="flex-1 py-3 border border-neutral-300 rounded-xl font-medium hover:bg-neutral-50">取消</button>
                      <button type="submit" className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700">保存修改</button>
                    </div>
                  </form>
                )}
              </div>
            </div>

            {activeSubTab === 'stats' && (
              <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
                <div className="p-6 border-b border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <h3 className="font-bold">时长费用统计</h3>
                    <div className="flex bg-neutral-100 p-1 rounded-lg">
                      <button
                        onClick={() => setStatsType('user')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                          statsType === 'user' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                      >
                        按用户
                      </button>
                      <button
                        onClick={() => setStatsType('supervisor')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                          statsType === 'supervisor' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                      >
                        按导师
                      </button>
                    </div>
                  </div>
                  <button 
                    onClick={exportStats}
                    className="p-2 border border-neutral-300 text-neutral-500 rounded-xl hover:bg-neutral-50 hover:text-red-600 transition-colors self-end sm:self-auto"
                    title={`导出${statsType === 'user' ? '用户' : '导师'}统计`}
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm block md:table">
                    <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200 hidden md:table-header-group">
                      <tr>
                        <th className="px-4 py-4 font-medium align-top">
                          <div className="mb-2">{statsType === 'user' ? '用户/导师' : '导师'}</div>
                          {statsType === 'user' ? (
                            <input 
                              type="text" 
                              placeholder="姓名/学号/导师..." 
                              value={statsFilterUser}
                              onChange={e => setStatsFilterUser(e.target.value)}
                              className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                            />
                          ) : (
                            <input 
                              type="text" 
                              placeholder="搜索导师..." 
                              value={statsFilterSupervisor}
                              onChange={e => setStatsFilterSupervisor(e.target.value)}
                              className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                            />
                          )}
                        </th>
                        <th className="px-4 py-4 font-medium align-top">
                          <div className="mb-2">总时长</div>
                          <div className="flex items-center gap-1">
                            <input 
                              type="number" 
                              placeholder="Min" 
                              value={statsFilterDurationMin}
                              onChange={e => setStatsFilterDurationMin(e.target.value)}
                              className="w-16 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                            />
                            <span className="text-neutral-400">-</span>
                            <input 
                              type="number" 
                              placeholder="Max" 
                              value={statsFilterDurationMax}
                              onChange={e => setStatsFilterDurationMax(e.target.value)}
                              className="w-16 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                            />
                          </div>
                        </th>
                        <th className="px-4 py-4 font-medium align-top">
                          <div className="mb-2">总费用</div>
                          <div className="flex items-center gap-1">
                            <input 
                              type="number" 
                              placeholder="Min" 
                              value={statsFilterCostMin}
                              onChange={e => setStatsFilterCostMin(e.target.value)}
                              className="w-16 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                            />
                            <span className="text-neutral-400">-</span>
                            <input 
                              type="number" 
                              placeholder="Max" 
                              value={statsFilterCostMax}
                              onChange={e => setStatsFilterCostMax(e.target.value)}
                              className="w-16 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                            />
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="block md:table-row-group divide-y divide-neutral-100 md:divide-y-0 p-4 md:p-0">
                      {statsType === 'user' ? (
                        filteredUsageByPerson.map((u: any, i: number) => (
                          <tr key={i} className="block md:table-row hover:bg-neutral-50/50 border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none">
                            <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                              <div className="flex justify-between items-center md:block">
                                <span className="md:hidden font-medium text-neutral-500 text-xs">用户/导师</span>
                                <div className="text-right md:text-left">
                                  <p className="font-medium text-neutral-900">{u.student_name}</p>
                                  <p className="text-xs text-neutral-500">{u.student_id} | {u.supervisor}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                              <div className="flex justify-between items-center md:block">
                                <span className="md:hidden font-medium text-neutral-500 text-xs">总时长</span>
                                <span className="text-neutral-900">{u.total_hours.toFixed(1)}h</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 md:py-4 block md:table-cell">
                              <div className="flex justify-between items-center md:block">
                                <span className="md:hidden font-medium text-neutral-500 text-xs">总费用</span>
                                <span className="font-bold text-neutral-900">¥{u.total_revenue.toFixed(2)}</span>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        filteredUsageBySupervisor.map((s: any, i: number) => (
                          <tr key={i} className="block md:table-row hover:bg-neutral-50/50 border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none">
                            <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                              <div className="flex justify-between items-center md:block">
                                <span className="md:hidden font-medium text-neutral-500 text-xs">导师</span>
                                <span className="font-medium text-neutral-900">{s.supervisor}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                              <div className="flex justify-between items-center md:block">
                                <span className="md:hidden font-medium text-neutral-500 text-xs">总时长</span>
                                <span className="text-neutral-900">{s.total_hours.toFixed(1)}h</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 md:py-4 block md:table-cell">
                              <div className="flex justify-between items-center md:block">
                                <span className="md:hidden font-medium text-neutral-500 text-xs">总费用</span>
                                <span className="font-bold text-neutral-900">¥{s.total_revenue.toFixed(2)}</span>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                      {((statsType === 'user' && filteredUsageByPerson.length === 0) || 
                        (statsType === 'supervisor' && filteredUsageBySupervisor.length === 0)) && (
                        <tr className="block md:table-row">
                          <td colSpan={3} className="px-4 py-12 text-center text-neutral-500 block md:table-cell">暂无数据</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeSubTab === 'charts' && (
              <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
                <div className="p-6 border-b border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <h3 className="font-bold flex items-center gap-2">
                      <BarChart2 className="w-5 h-5 text-red-600" />
                      统计图表
                    </h3>
                    <div className="flex bg-neutral-100 p-1 rounded-lg">
                      <button
                        onClick={() => setChartMetric('duration')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                          chartMetric === 'duration' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                      >
                        按时长
                      </button>
                      <button
                        onClick={() => setChartMetric('revenue')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                          chartMetric === 'revenue' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                      >
                        按费用
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-neutral-500">与详细记录筛选联动</label>
                      <button
                        onClick={() => setSyncWithFilters(!syncWithFilters)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 ${
                          syncWithFilters ? 'bg-red-600' : 'bg-neutral-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            syncWithFilters ? 'translate-x-[18px]' : 'translate-x-[2px]'
                          }`}
                        />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-neutral-500">时间维度</label>
                      <select 
                        value={reportPeriod} 
                        onChange={e => setReportPeriod(e.target.value)}
                        className="px-3 py-1.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all bg-white text-sm font-medium"
                      >
                        <option value="day">按天</option>
                        <option value="week">按周</option>
                        <option value="month">按月</option>
                        <option value="quarter">按季度</option>
                        <option value="year">按年</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-neutral-500">图表类型</label>
                      <div className="flex bg-neutral-100 p-1 rounded-xl">
                        <button onClick={() => setReportChartType('bar')} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${reportChartType === 'bar' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-500'}`}>柱状图</button>
                        <button onClick={() => setReportChartType('line')} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${reportChartType === 'line' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-500'}`}>折线图</button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  <div className="h-96">
                    <ResponsiveContainer width="100%" height="100%">
                      {reportChartType === 'bar' ? (
                        <BarChart data={syncedUsageByTime} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e5e5" />
                          <XAxis type="number" axisLine={false} tickLine={false} tick={{fill: '#737373', fontSize: 12}} tickFormatter={(val) => Number(val).toFixed(2)} />
                          <YAxis dataKey="period" type="category" axisLine={false} tickLine={false} tick={{fontSize: 12}} width={80} />
                          <Tooltip cursor={{fill: '#f5f5f5'}} formatter={(value: number) => Number(value).toFixed(2)} />
                          <Bar 
                            dataKey={chartMetric === 'duration' ? 'total_hours' : 'total_revenue'} 
                            name={chartMetric === 'duration' ? '时长 (小时)' : '收入 (¥)'} 
                            fill={chartMetric === 'duration' ? '#dc2626' : '#d97706'} 
                            radius={[0, 4, 4, 0]} 
                          />
                        </BarChart>
                      ) : (
                        <LineChart data={syncedUsageByTime}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                          <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{fill: '#737373', fontSize: 12}} />
                          <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} tickFormatter={(val) => Number(val).toFixed(2)} />
                          <Tooltip formatter={(value: number) => Number(value).toFixed(2)} />
                          <Line 
                            type="monotone" 
                            dataKey={chartMetric === 'duration' ? 'total_hours' : 'total_revenue'} 
                            name={chartMetric === 'duration' ? '时长 (小时)' : '收入 (¥)'} 
                            stroke={chartMetric === 'duration' ? '#dc2626' : '#d97706'} 
                            strokeWidth={2} 
                            dot={{r: 4}} 
                            activeDot={{r: 6}} 
                          />
                        </LineChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {activeSubTab === 'violations' && (
              <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
                <div className="p-4 border-b border-neutral-200 flex items-center justify-between bg-neutral-50">
                  <h3 className="font-bold flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                    违规统计 (近30天)
                  </h3>
                  <button 
                    onClick={exportViolations}
                    className="p-2 border border-neutral-300 text-neutral-500 rounded-xl hover:bg-neutral-50 hover:text-red-600 transition-colors"
                    title="导出违规记录"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
                
                {loadingViolations ? (
                  <div className="text-center py-12 text-neutral-500">加载违规数据中...</div>
                ) : violationsData.length === 0 ? (
                  <div className="text-center py-12 text-neutral-500">近30天无违规记录</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200">
                        <tr>
                          <th className="px-4 py-4 font-medium align-top">
                            <div className="mb-2">用户/导师</div>
                            <input 
                              type="text" 
                              placeholder="搜索..." 
                              value={violationFilterUser}
                              onChange={e => setViolationFilterUser(e.target.value)}
                              className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal"
                            />
                          </th>
                          <th className="px-4 py-4 font-medium align-top">
                            <div className="mb-2">迟到次数</div>
                            <div className="flex items-center gap-2">
                              <input 
                                type="range" 
                                min="0" 
                                max={Math.max(0, ...violationsData.map(v => v.late_count))} 
                                value={violationFilterLate}
                                onChange={e => setViolationFilterLate(Number(e.target.value))}
                                className="w-16 accent-red-600"
                              />
                              <span className="text-xs font-normal">≥{violationFilterLate}</span>
                            </div>
                          </th>
                          <th className="px-4 py-4 font-medium align-top">
                            <div className="mb-2">超时次数</div>
                            <div className="flex items-center gap-2">
                              <input 
                                type="range" 
                                min="0" 
                                max={Math.max(0, ...violationsData.map(v => v.overtime_count))} 
                                value={violationFilterOvertime}
                                onChange={e => setViolationFilterOvertime(Number(e.target.value))}
                                className="w-16 accent-red-600"
                              />
                              <span className="text-xs font-normal">≥{violationFilterOvertime}</span>
                            </div>
                          </th>
                          <th className="px-4 py-4 font-medium align-top">
                            <div className="mb-2">爽约次数</div>
                            <div className="flex items-center gap-2">
                              <input 
                                type="range" 
                                min="0" 
                                max={Math.max(0, ...violationsData.map(v => v.noshow_count))} 
                                value={violationFilterNoshow}
                                onChange={e => setViolationFilterNoshow(Number(e.target.value))}
                                className="w-16 accent-red-600"
                              />
                              <span className="text-xs font-normal">≥{violationFilterNoshow}</span>
                            </div>
                          </th>
                          <th className="px-4 py-4 font-medium align-top">
                            <div className="mb-2">取消次数(临期)</div>
                            <div className="flex items-center gap-2">
                              <input 
                                type="range" 
                                min="0" 
                                max={Math.max(0, ...violationsData.map(v => v.cancelled_count))} 
                                value={violationFilterCancel}
                                onChange={e => setViolationFilterCancel(Number(e.target.value))}
                                className="w-16 accent-red-600"
                              />
                              <span className="text-xs font-normal">≥{violationFilterCancel}</span>
                            </div>
                          </th>
                          <th className="px-4 py-4 font-medium align-top">
                            <div className="mb-2">违规总计</div>
                            <div className="flex items-center gap-2">
                              <input 
                                type="range" 
                                min="0" 
                                max={Math.max(0, ...violationsData.map(v => v.total_violations))} 
                                value={violationFilterTotal}
                                onChange={e => setViolationFilterTotal(Number(e.target.value))}
                                className="w-16 accent-red-600"
                              />
                              <span className="text-xs font-normal">≥{violationFilterTotal}</span>
                            </div>
                          </th>
                          <th className="px-4 py-4 font-medium align-top">
                            <div className="mb-2">建议处罚</div>
                            <div className="relative" ref={violationPenaltyFilterPopupRef}>
                              <button 
                                onClick={() => setShowViolationPenaltyFilterPopup(!showViolationPenaltyFilterPopup)}
                                className="w-full px-2 py-1 text-xs rounded border border-neutral-300 bg-white text-left min-h-[26px] flex flex-wrap gap-1 items-center font-normal"
                              >
                                {violationFilterPenalty.length > 0 ? (
                                  <>
                                    {violationFilterPenalty.map(p => (
                                      <span key={p} className="bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1">
                                        {p}
                                        <X 
                                          className="w-3 h-3 cursor-pointer hover:text-red-500" 
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setViolationFilterPenalty(violationFilterPenalty.filter(st => st !== p));
                                          }}
                                        />
                                      </span>
                                    ))}
                                  </>
                                ) : (
                                  <span className="text-neutral-400">全部处罚</span>
                                )}
                              </button>
                              {showViolationPenaltyFilterPopup && (
                                <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-neutral-200 rounded-lg shadow-lg p-2 z-10 font-normal">
                                  <div className="space-y-1 max-h-48 overflow-y-auto">
                                    {['无', '警告', '频繁取消警告', '暂停预约7天', '暂停预约30天'].map(penalty => (
                                      <label key={penalty} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-50 rounded cursor-pointer">
                                        <input 
                                          type="checkbox"
                                          checked={violationFilterPenalty.includes(penalty)}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setViolationFilterPenalty([...violationFilterPenalty, penalty]);
                                            } else {
                                              setViolationFilterPenalty(violationFilterPenalty.filter(st => st !== penalty));
                                            }
                                          }}
                                          className="text-red-600 rounded border-neutral-300 focus:ring-red-600"
                                        />
                                        <span className="text-sm text-neutral-700">{penalty}</span>
                                      </label>
                                    ))}
                                  </div>
                                  <div className="mt-2 pt-2 border-t border-neutral-100 flex justify-end">
                                    <button
                                      onClick={() => setViolationFilterPenalty([])}
                                      className="text-xs text-neutral-500 hover:text-neutral-700 px-2 py-1"
                                    >
                                      清空
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredViolationsData.map((v: any, idx: number) => (
                          <tr key={idx} className="border-b border-neutral-100 hover:bg-neutral-50 transition-colors">
                            <td className="px-4 py-3">
                              <p className="font-medium text-neutral-900">{v.student_name}</p>
                              <p className="text-xs text-neutral-500">{v.student_id} | {v.supervisor}</p>
                            </td>
                            <td className="px-4 py-3 text-neutral-600">
                              {v.late_count}
                              {v.late_duration > 0 && <span className="text-xs text-neutral-400 ml-1">({Number((v.late_duration / 60).toFixed(1))}h)</span>}
                            </td>
                            <td className="px-4 py-3 text-neutral-600">
                              {v.overtime_count}
                              {v.overtime_duration > 0 && <span className="text-xs text-neutral-400 ml-1">({Number((v.overtime_duration / 60).toFixed(1))}h)</span>}
                            </td>
                            <td className="px-4 py-3 text-neutral-600">{v.noshow_count}</td>
                            <td className="px-4 py-3 text-neutral-600">
                              {v.cancelled_count}
                              {v.late_cancelled_count > 0 && <span className="text-xs text-neutral-400 ml-1">({v.late_cancelled_count})</span>}
                            </td>
                            <td className="px-4 py-3 font-bold text-red-600">{v.total_violations}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                v.suggested_penalty === '无' ? 'bg-neutral-100 text-neutral-600' :
                                v.suggested_penalty === '警告' ? 'bg-amber-100 text-amber-700' :
                                v.suggested_penalty === '频繁取消警告' ? 'bg-orange-100 text-orange-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                {v.suggested_penalty}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {deleteConfirmId !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl">
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
            </div>
            <h3 className="text-xl font-bold text-center mb-2">确认删除</h3>
            <p className="text-sm text-neutral-500 text-center mb-6">
              确定要删除该预约记录吗？此操作不可恢复，且将被记录在审计日志中。
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setDeleteConfirmId(null)} 
                className="flex-1 py-2.5 border border-neutral-200 rounded-xl text-sm font-medium hover:bg-neutral-50 transition-colors"
              >
                取消
              </button>
              <button 
                onClick={() => handleDeleteReportRecord(deleteConfirmId)} 
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
