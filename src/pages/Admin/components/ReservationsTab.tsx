import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, DollarSign, FileText, Download, Filter, X, Edit3, Trash2, AlertTriangle, ChevronDown, ChevronUp, Users, UserCheck, BarChart2, Calendar, Info } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import { format, subDays, startOfToday, addDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import ReservationEditDrawer from './ReservationEditDrawer';
import toast from 'react-hot-toast';

interface ReservationsTabProps {
  token: string | null;
  onLogout: () => void;
  initialBookingCode?: string | null;
  initialDate?: string | null;
  onClearInitialBookingCode?: () => void;
  statusMap: Record<string, string>;
}

export default function ReservationsTab({ token, onLogout, initialBookingCode, initialDate, onClearInitialBookingCode, statusMap }: ReservationsTabProps) {
  const [reports, setReports] = useState<any>(null);
  const [loadingReports, setLoadingReports] = useState(false);
  const [pendingWhitelistApps, setPendingWhitelistApps] = useState<any[]>([]);

  const fetchWhitelistApps = async () => {
    try {
      const res = await fetch('/api/admin/whitelist/applications?status=pending', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPendingWhitelistApps(data);
      }
    } catch (err) {
      console.error('Failed to fetch whitelist apps:', err);
    }
  };

  const handleApproveWhitelist = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/whitelist/applications/${id}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('已通过');
        fetchWhitelistApps();
      } else {
        const data = await res.json();
        toast.error(data.error || '操作失败');
      }
    } catch (error) {
      toast.error('操作失败');
    }
  };

  const handleRejectWhitelist = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/whitelist/applications/${id}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('已驳回');
        fetchWhitelistApps();
      } else {
        const data = await res.json();
        toast.error(data.error || '操作失败');
      }
    } catch (error) {
      toast.error('操作失败');
    }
  };

  useEffect(() => {
    fetchWhitelistApps();
  }, []);
  const [reportPeriod, setReportPeriod] = useState(initialDate ? 'day' : 'day');
  const [reportChartType, setReportChartType] = useState<'bar' | 'line'>('bar');
  const [syncChartWithFilters, setSyncChartWithFilters] = useState(false);
  const [syncStatsWithFilters, setSyncStatsWithFilters] = useState(false);
  const [showSyncChartTooltip, setShowSyncChartTooltip] = useState(false);
  const [showSyncStatsTooltip, setShowSyncStatsTooltip] = useState(false);
  const [reportStartDate, setReportStartDate] = useState(initialDate || format(subDays(startOfToday(), 7), 'yyyy-MM-dd'));
  const [reportEndDate, setReportEndDate] = useState(initialDate || format(startOfToday(), 'yyyy-MM-dd'));
  const [reportFilterUser, setReportFilterUser] = useState('');
  const [reportFilterEquipment, setReportFilterEquipment] = useState('');
  const [reportFilterDurationMin, setReportFilterDurationMin] = useState('');
  const [reportFilterDurationMax, setReportFilterDurationMax] = useState('');
  const [reportFilterCostMin, setReportFilterCostMin] = useState('');
  const [reportFilterCostMax, setReportFilterCostMax] = useState('');
  const [reportFilterUtilizationMin, setReportFilterUtilizationMin] = useState('');
  const [reportFilterUtilizationMax, setReportFilterUtilizationMax] = useState('');
  const [reportFilterStatus, setReportFilterStatus] = useState<string[]>([]);
  const [reportFilterNotes, setReportFilterNotes] = useState('');
  const [reportFilterFromToday, setReportFilterFromToday] = useState(false);
  const [reportFilterCode, setReportFilterCode] = useState(initialBookingCode || '');
  const [reportCurrentPage, setReportCurrentPage] = useState(1);
  const reportPageSize = 20;
  
  const [showReportTimeFilterPopup, setShowReportTimeFilterPopup] = useState(false);
  const [showReportCostFilterPopup, setShowReportCostFilterPopup] = useState(false);
  const [showReportStatusFilterPopup, setShowReportStatusFilterPopup] = useState(false);
  const [showReportMobileFilters, setShowReportMobileFilters] = useState(false);
  const reportTimeFilterPopupRef = useRef<HTMLDivElement>(null);
  const reportCostFilterPopupRef = useRef<HTMLDivElement>(null);
  const reportStatusFilterPopupRef = useRef<HTMLDivElement>(null);
  
  const [editingReportRecord, setEditingReportRecord] = useState<any>(null);
  const [manualViolations, setManualViolations] = useState<{id: number | null, type: string, remark: string}[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const [activeSubTab, setActiveSubTab] = useState<'detailed' | 'stats' | 'charts'>('detailed');
  const [chartMetric, setChartMetric] = useState<'duration' | 'revenue'>('duration');
  const [chartDimension, setChartDimension] = useState<'time' | 'user' | 'supervisor' | 'equipment'>('user');
  const [statsType, setStatsType] = useState<'user' | 'supervisor' | 'equipment'>('user');
  const [statsFilterUser, setStatsFilterUser] = useState('');
  const [statsFilterSupervisor, setStatsFilterSupervisor] = useState('');
  const [statsFilterEquipment, setStatsFilterEquipment] = useState('');
  const [statsFilterDurationMin, setStatsFilterDurationMin] = useState('');
  const [statsFilterDurationMax, setStatsFilterDurationMax] = useState('');
  const [statsFilterBookedMin, setStatsFilterBookedMin] = useState('');
  const [statsFilterBookedMax, setStatsFilterBookedMax] = useState('');
  const [statsFilterUtilMin, setStatsFilterUtilMin] = useState('');
  const [statsFilterUtilMax, setStatsFilterUtilMax] = useState('');
  const [statsFilterCostMin, setStatsFilterCostMin] = useState('');
  const [statsFilterCostMax, setStatsFilterCostMax] = useState('');

  useEffect(() => {
    if (initialBookingCode) {
      setActiveSubTab('detailed');
      setReportFilterCode(initialBookingCode);
      if (onClearInitialBookingCode) {
        onClearInitialBookingCode();
      }
    }
  }, [initialBookingCode, onClearInitialBookingCode]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (reportTimeFilterPopupRef.current && !reportTimeFilterPopupRef.current.contains(event.target as Node)) {
        setShowReportTimeFilterPopup(false);
      }
      if (reportStatusFilterPopupRef.current && !reportStatusFilterPopupRef.current.contains(event.target as Node)) {
        setShowReportStatusFilterPopup(false);
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
      const [listRes, statsRes] = await Promise.all([
        fetch(`/api/admin/reservations?${query.toString()}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`/api/admin/reservations/stats?${query.toString()}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);
      
      if (listRes.status === 401 || statsRes.status === 401) return onLogout();
      if (!listRes.ok) {
        const errorData = await listRes.json().catch(() => ({}));
        throw new Error(errorData.error || '获取预约列表失败');
      }
      if (!statsRes.ok) {
        const errorData = await statsRes.json().catch(() => ({}));
        throw new Error(errorData.error || '获取统计数据失败');
      }
      const listData = await listRes.json();
      const statsData = await statsRes.json();
      
      setReports({
        allReservations: listData,
        ...statsData
      });
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || '获取报表数据失败');
      setReports(null);
    } finally {
      setLoadingReports(false);
    }
  };

  const fetchManualViolations = async (reservationId: number) => {
    try {
      const res = await fetch(`/api/admin/violations?reservation_id=${reservationId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const manuals = data.filter((v: any) => 
          ['hygiene_issue', 'improper_operation', 'proxy_booking', 'other_manual'].includes(v.violation_type) && 
          v.status === 'active'
        ).map((v: any) => {
          let remark = '';
          try {
            const parsed = JSON.parse(v.remark);
            remark = parsed.admin_note || '';
          } catch (e) {
            remark = v.remark || '';
          }
          return { id: v.id, type: v.violation_type, remark };
        });
        setManualViolations(manuals);
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || '获取人工违规记录失败');
      }
    } catch (error: any) {
      console.error('Failed to fetch manual violations:', error);
      toast.error(error.message || '获取人工违规记录失败');
    }
  };

  useEffect(() => {
    if (token) {
      fetchReports();
    }
  }, [reportPeriod, reportStartDate, reportEndDate, token]);

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

      const bookedDuration = res.start_time && res.end_time 
        ? (new Date(res.end_time).getTime() - new Date(res.start_time).getTime()) / (1000 * 60 * 60)
        : 0;

      const utilization = bookedDuration > 0 ? (duration / bookedDuration) * 100 : 0;
      
      if (reportFilterDurationMin && duration < Number(reportFilterDurationMin)) return false;
      if (reportFilterDurationMax && duration > Number(reportFilterDurationMax)) return false;
      
      if (reportFilterCostMin && (res.total_cost || 0) < Number(reportFilterCostMin)) return false;
      if (reportFilterCostMax && (res.total_cost || 0) > Number(reportFilterCostMax)) return false;

      if (reportFilterUtilizationMin && utilization < Number(reportFilterUtilizationMin)) return false;
      if (reportFilterUtilizationMax && utilization > Number(reportFilterUtilizationMax)) return false;
      
      if (reportFilterStatus.length > 0) {
        const NATIVE_STATUSES = ['待审批', '已通过', '进行中', '已完成', '已取消', '已驳回'];
        const COMPUTED_STATUSES = ['正常', '迟到', '超时', '待上机', '爽约', '临期取消'];
        
        const selectedNative = reportFilterStatus.filter(s => NATIVE_STATUSES.includes(s));
        const selectedComputed = reportFilterStatus.filter(s => COMPUTED_STATUSES.includes(s));
        
        const resNative = statusMap[res.status] || res.status;
        const resComputed = res.reportStatus ? res.reportStatus.split(', ') : [];
        
        const matchNative = selectedNative.length === 0 || selectedNative.includes(resNative);
        const matchComputed = selectedComputed.length === 0 || resComputed.some((s: string) => selectedComputed.includes(s));
        
        if (!(matchNative && matchComputed)) {
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
  }, [reports, reportFilterCode, reportFilterUser, reportFilterEquipment, reportFilterDurationMin, reportFilterDurationMax, reportFilterCostMin, reportFilterCostMax, reportFilterUtilizationMin, reportFilterUtilizationMax, reportFilterStatus, reportFilterNotes]);

  const uniqueEquipments = useMemo(() => {
    return Array.from(new Set((reports?.allReservations || []).map((r: any) => r.equipment_name).filter(Boolean)));
  }, [reports?.allReservations]);

  const aggregatedFilteredBase = useMemo(() => {
    const personMap = new Map();
    const supervisorMap = new Map();
    const equipmentMap = new Map();
    const timeMap = new Map();

    const statsReservations = filteredReportReservations.filter((r: any) => 
      (r.actual_start_time && r.status === 'completed') || r.reportStatus?.includes('爽约')
    );

    statsReservations.forEach((r: any) => {
      let machine_hours = 0;
      if (r.actual_start_time && r.actual_end_time) {
        machine_hours = (new Date(r.actual_end_time).getTime() - new Date(r.actual_start_time).getTime()) / (1000 * 60 * 60);
      }
      
      let booked_hours = 0;
      if (r.start_time && r.end_time) {
        booked_hours = (new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / (1000 * 60 * 60);
      }
      
      const revenue = r.total_cost || 0;

      const personKey = `${r.student_id}_${r.student_name}`;
      if (!personMap.has(personKey)) {
        personMap.set(personKey, { student_name: r.student_name, student_id: r.student_id, supervisor: r.supervisor, total_hours: 0, machine_hours: 0, booked_hours: 0, total_revenue: 0 });
      }
      const pu = personMap.get(personKey);
      pu.total_hours += machine_hours;
      pu.machine_hours += machine_hours;
      pu.booked_hours += booked_hours;
      pu.total_revenue += revenue;

      const supKey = r.supervisor;
      if (!supervisorMap.has(supKey)) {
        supervisorMap.set(supKey, { supervisor: r.supervisor, total_hours: 0, machine_hours: 0, booked_hours: 0, total_revenue: 0 });
      }
      const su = supervisorMap.get(supKey);
      su.total_hours += machine_hours;
      su.machine_hours += machine_hours;
      su.booked_hours += booked_hours;
      su.total_revenue += revenue;

      const eqKey = r.equipment_id;
      if (!equipmentMap.has(eqKey)) {
        equipmentMap.set(eqKey, { equipment_id: r.equipment_id, equipment_name: r.equipment_name || '未知仪器', total_hours: 0, machine_hours: 0, booked_hours: 0, total_revenue: 0 });
      }
      const eq = equipmentMap.get(eqKey);
      eq.total_hours += machine_hours;
      eq.machine_hours += machine_hours;
      eq.booked_hours += booked_hours;
      eq.total_revenue += revenue;

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
      t.total_hours += machine_hours;
      t.total_revenue += revenue;
    });

    return {
      personData: Array.from(personMap.values()).sort((a: any, b: any) => b.total_hours - a.total_hours),
      supervisorData: Array.from(supervisorMap.values()).sort((a: any, b: any) => b.total_hours - a.total_hours),
      equipmentData: Array.from(equipmentMap.values()).sort((a: any, b: any) => b.total_hours - a.total_hours),
      timeData: Array.from(timeMap.values()).sort((a: any, b: any) => a.period.localeCompare(b.period))
    };
  }, [filteredReportReservations, reportPeriod]);

  const { statsBasePersonData, statsBaseSupervisorData, statsBaseEquipmentData } = useMemo(() => {
    if (!syncStatsWithFilters) {
      return { 
        statsBasePersonData: reports?.usageByPerson || [], 
        statsBaseSupervisorData: reports?.usageBySupervisor || [], 
        statsBaseEquipmentData: reports?.usageByEquipment || [] 
      };
    }
    return {
      statsBasePersonData: aggregatedFilteredBase.personData,
      statsBaseSupervisorData: aggregatedFilteredBase.supervisorData,
      statsBaseEquipmentData: aggregatedFilteredBase.equipmentData
    };
  }, [syncStatsWithFilters, reports, aggregatedFilteredBase]);

  const { chartBasePersonData, chartBaseSupervisorData, chartBaseEquipmentData, chartUsageByTime } = useMemo(() => {
    if (!syncChartWithFilters) {
      return { 
        chartBasePersonData: reports?.usageByPerson || [], 
        chartBaseSupervisorData: reports?.usageBySupervisor || [], 
        chartBaseEquipmentData: reports?.usageByEquipment || [],
        chartUsageByTime: reports?.usageByTime || []
      };
    }
    return {
      chartBasePersonData: aggregatedFilteredBase.personData,
      chartBaseSupervisorData: aggregatedFilteredBase.supervisorData,
      chartBaseEquipmentData: aggregatedFilteredBase.equipmentData,
      chartUsageByTime: aggregatedFilteredBase.timeData
    };
  }, [syncChartWithFilters, reports, aggregatedFilteredBase]);

  const filteredUsageByPerson = useMemo(() => {
    return statsBasePersonData.filter((u: any) => {
      if (statsFilterUser) {
        const search = statsFilterUser.toLowerCase();
        if (!u.student_name.toLowerCase().includes(search) && 
            !u.student_id.toLowerCase().includes(search) && 
            !u.supervisor.toLowerCase().includes(search)) {
          return false;
        }
      }
      if (statsFilterDurationMin && u.machine_hours < Number(statsFilterDurationMin)) return false;
      if (statsFilterDurationMax && u.machine_hours > Number(statsFilterDurationMax)) return false;
      if (statsFilterBookedMin && u.booked_hours < Number(statsFilterBookedMin)) return false;
      if (statsFilterBookedMax && u.booked_hours > Number(statsFilterBookedMax)) return false;
      const util = u.booked_hours > 0 ? (u.machine_hours / u.booked_hours) * 100 : 0;
      if (statsFilterUtilMin && util < Number(statsFilterUtilMin)) return false;
      if (statsFilterUtilMax && util > Number(statsFilterUtilMax)) return false;
      if (statsFilterCostMin && u.total_revenue < Number(statsFilterCostMin)) return false;
      if (statsFilterCostMax && u.total_revenue > Number(statsFilterCostMax)) return false;
      return true;
    });
  }, [statsBasePersonData, statsFilterUser, statsFilterDurationMin, statsFilterDurationMax, statsFilterBookedMin, statsFilterBookedMax, statsFilterUtilMin, statsFilterUtilMax, statsFilterCostMin, statsFilterCostMax]);

  const filteredUsageBySupervisor = useMemo(() => {
    return statsBaseSupervisorData.filter((s: any) => {
      if (statsFilterSupervisor && !s.supervisor.toLowerCase().includes(statsFilterSupervisor.toLowerCase())) return false;
      if (statsFilterDurationMin && s.machine_hours < Number(statsFilterDurationMin)) return false;
      if (statsFilterDurationMax && s.machine_hours > Number(statsFilterDurationMax)) return false;
      if (statsFilterBookedMin && s.booked_hours < Number(statsFilterBookedMin)) return false;
      if (statsFilterBookedMax && s.booked_hours > Number(statsFilterBookedMax)) return false;
      const util = s.booked_hours > 0 ? (s.machine_hours / s.booked_hours) * 100 : 0;
      if (statsFilterUtilMin && util < Number(statsFilterUtilMin)) return false;
      if (statsFilterUtilMax && util > Number(statsFilterUtilMax)) return false;
      if (statsFilterCostMin && s.total_revenue < Number(statsFilterCostMin)) return false;
      if (statsFilterCostMax && s.total_revenue > Number(statsFilterCostMax)) return false;
      return true;
    });
  }, [statsBaseSupervisorData, statsFilterSupervisor, statsFilterDurationMin, statsFilterDurationMax, statsFilterBookedMin, statsFilterBookedMax, statsFilterUtilMin, statsFilterUtilMax, statsFilterCostMin, statsFilterCostMax]);

  const filteredUsageByEquipment = useMemo(() => {
    return statsBaseEquipmentData.filter((e: any) => {
      if (statsFilterEquipment && !e.equipment_name.toLowerCase().includes(statsFilterEquipment.toLowerCase())) return false;
      if (statsFilterDurationMin && e.machine_hours < Number(statsFilterDurationMin)) return false;
      if (statsFilterDurationMax && e.machine_hours > Number(statsFilterDurationMax)) return false;
      if (statsFilterBookedMin && e.booked_hours < Number(statsFilterBookedMin)) return false;
      if (statsFilterBookedMax && e.booked_hours > Number(statsFilterBookedMax)) return false;
      const util = e.booked_hours > 0 ? (e.machine_hours / e.booked_hours) * 100 : 0;
      if (statsFilterUtilMin && util < Number(statsFilterUtilMin)) return false;
      if (statsFilterUtilMax && util > Number(statsFilterUtilMax)) return false;
      if (statsFilterCostMin && e.total_revenue < Number(statsFilterCostMin)) return false;
      if (statsFilterCostMax && e.total_revenue > Number(statsFilterCostMax)) return false;
      return true;
    });
  }, [statsBaseEquipmentData, statsFilterEquipment, statsFilterDurationMin, statsFilterDurationMax, statsFilterBookedMin, statsFilterBookedMax, statsFilterUtilMin, statsFilterUtilMax, statsFilterCostMin, statsFilterCostMax]);

  const { multiLineData, multiLineKeys } = useMemo(() => {
    if (chartDimension === 'time') return { multiLineData: [], multiLineKeys: [] };
    
    const baseReservations = syncChartWithFilters ? filteredReportReservations : (reports?.allReservations || []);
    const statsReservations = baseReservations.filter((r: any) => 
      (r.actual_start_time && r.status === 'completed') || r.reportStatus?.includes('爽约')
    );

    const timeMap = new Map();
    const keysSet = new Set<string>();

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
      
      let key = '';
      if (chartDimension === 'user') key = `${r.student_name}`;
      else if (chartDimension === 'supervisor') key = r.supervisor;
      else if (chartDimension === 'equipment') key = r.equipment_name || '未知仪器';

      if (key) keysSet.add(key);

      if (!timeMap.has(pStr)) {
        timeMap.set(pStr, { period: pStr });
      }
      const t = timeMap.get(pStr);
      t[`${key}_duration`] = (t[`${key}_duration`] || 0) + hours;
      t[`${key}_revenue`] = (t[`${key}_revenue`] || 0) + revenue;
    });

    return { 
      multiLineData: Array.from(timeMap.values()).sort((a: any, b: any) => a.period.localeCompare(b.period)),
      multiLineKeys: Array.from(keysSet)
    };
  }, [chartDimension, syncChartWithFilters, reports?.allReservations, filteredReportReservations, reportPeriod]);

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
    const headers = ['预约码', '仪器', '用户', '学号', '导师', '预约时间', '实际时间', '时长(小时)', '耗材数量', '费用(¥)', '状态', '迟到时长(小时)', '超时时长(小时)', '备注'];
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
        r.consumable_quantity || 0,
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
      const headers = ['用户', '学号', '导师', '上机时长(小时)', '预约时长(小时)', '时长利用率(%)', '总费用(¥)'];
      exportToCSV(
        filteredUsageByPerson,
        `user_stats_${reportStartDate}_${reportEndDate}`,
        headers,
        (u: any) => [u.student_name, u.student_id, u.supervisor, (u.machine_hours || 0).toFixed(2), (u.booked_hours || 0).toFixed(2), (u.booked_hours > 0 ? (u.machine_hours / u.booked_hours * 100) : 0).toFixed(1) + '%', (u.total_revenue || 0).toFixed(2)]
      );
    } else if (statsType === 'supervisor') {
      if (!filteredUsageBySupervisor || filteredUsageBySupervisor.length === 0) return;
      const headers = ['导师', '上机时长(小时)', '预约时长(小时)', '时长利用率(%)', '总费用(¥)'];
      exportToCSV(
        filteredUsageBySupervisor,
        `supervisor_stats_${reportStartDate}_${reportEndDate}`,
        headers,
        (s: any) => [s.supervisor, (s.machine_hours || 0).toFixed(2), (s.booked_hours || 0).toFixed(2), (s.booked_hours > 0 ? (s.machine_hours / s.booked_hours * 100) : 0).toFixed(1) + '%', (s.total_revenue || 0).toFixed(2)]
      );
    } else if (statsType === 'equipment') {
      if (!filteredUsageByEquipment || filteredUsageByEquipment.length === 0) return;
      const headers = ['仪器名称', '上机时长(小时)', '预约时长(小时)', '时长利用率(%)', '总费用(¥)'];
      exportToCSV(
        filteredUsageByEquipment,
        `equipment_stats_${reportStartDate}_${reportEndDate}`,
        headers,
        (e: any) => [e.equipment_name, (e.machine_hours || 0).toFixed(2), (e.booked_hours || 0).toFixed(2), (e.booked_hours > 0 ? (e.machine_hours / e.booked_hours * 100) : 0).toFixed(1) + '%', (e.total_revenue || 0).toFixed(2)]
      );
    }
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
      
      const res = await fetch(`/api/admin/reservations/${editingReportRecord.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          actual_start_time: toUTC(editingReportRecord.actual_start_time),
          actual_end_time: toUTC(editingReportRecord.actual_end_time),
          consumable_quantity: editingReportRecord.consumable_quantity,
          notes: editingReportRecord.notes,
          manual_violations: manualViolations
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
      const res = await fetch(`/api/admin/reservations/${id}`, {
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
      <datalist id="reports-equipment-list">
        {uniqueEquipments.map((eq: any) => (
          <option key={eq} value={eq} />
        ))}
      </datalist>
      <div className="space-y-4">
        {pendingWhitelistApps.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-amber-800 shrink-0">
                <AlertTriangle className="w-4 h-4" />
                <span className="font-medium text-sm">白名单待审批 ({pendingWhitelistApps.length})</span>
              </div>
              <div className="flex items-center flex-wrap gap-1">
                <AnimatePresence mode="popLayout">
                {pendingWhitelistApps.map(app => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, scale: 0.8, x: -20 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.8, x: -20, transition: { duration: 0.2 } }}
                    key={app.id} 
                    tabIndex={0}
                    className="relative group/tooltip bg-white rounded-lg border border-amber-200 px-3 py-2 md:px-2 md:py-1 shadow-sm flex items-center shrink-0 cursor-pointer md:cursor-default"
                  >
                    <span className="font-medium text-sm text-neutral-900">{app.student_name}</span>
                    <div className="flex items-center border-l border-amber-100 pl-2 ml-2">
                      <button onClick={() => handleApproveWhitelist(app.id)} className="p-1 text-emerald-500 hover:text-emerald-700 rounded transition-colors" title="通过">
                        <UserCheck className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleRejectWhitelist(app.id)} className="p-1 text-red-400 hover:text-red-600 rounded transition-colors" title="驳回">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 hidden group-hover/tooltip:block group-focus/tooltip:block z-50">
                      <div className="bg-white text-neutral-800 border border-neutral-200 text-xs shadow-xl rounded-xl px-3 py-2 whitespace-nowrap min-w-[200px]">
                        <div className="font-semibold mb-2 text-neutral-500 border-b border-neutral-100 pb-1.5">
                          申请明细
                        </div>
                        <div className="flex flex-col gap-1.5 mt-1">
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
                            <span className="text-neutral-900">{app.supervisor}</span>
                          </div>
                          <div className="flex justify-between items-center gap-4">
                            <span className="text-neutral-500">手机</span>
                            <span className="text-neutral-900">{app.phone || '无'}</span>
                          </div>
                          <div className="flex justify-between items-center gap-4">
                            <span className="text-neutral-500">Email</span>
                            <span className="text-neutral-900">{app.email || '无'}</span>
                          </div>
                          <div className="flex justify-between items-center gap-4">
                            <span className="text-neutral-500">申请时间</span>
                            <span className="text-neutral-900">{new Date(app.created_at).toLocaleDateString()}</span>
                          </div>
                          {app.reason && (
                            <div className="mt-1 pt-2 border-t border-neutral-100 whitespace-normal">
                              <div className="text-neutral-500 mb-1">申请理由:</div>
                              <div className="text-neutral-900">{app.reason}</div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="w-3 h-3 bg-white border-t border-l border-neutral-200 rotate-45 absolute -top-1.5 left-1/2 -translate-x-1/2"></div>
                    </div>
                                    </motion.div>
                ))}
                </AnimatePresence>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end items-center gap-3">
          {(() => {
            const today = new Date();
            const todayStr = format(today, 'yyyy-MM-dd');
            const currentWeekStart = reportFilterFromToday ? todayStr : format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd');
            const currentWeekEnd = reportFilterFromToday ? format(addDays(today, 6), 'yyyy-MM-dd') : format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd');
            const currentMonthStart = reportFilterFromToday ? todayStr : format(startOfMonth(today), 'yyyy-MM-dd');
            const currentMonthEnd = reportFilterFromToday ? format(addDays(today, 29), 'yyyy-MM-dd') : format(endOfMonth(today), 'yyyy-MM-dd');

            const isThisWeek = reportStartDate === currentWeekStart && reportEndDate === currentWeekEnd;
            const isThisMonth = reportStartDate === currentMonthStart && reportEndDate === currentMonthEnd;

            return (
              <div className="flex items-center gap-2">
                {(isThisWeek || isThisMonth) && (
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <div className={`relative w-8 h-4 rounded-full transition-colors ${reportFilterFromToday ? 'bg-red-500' : 'bg-neutral-300'}`}>
                      <input type="checkbox" className="sr-only" checked={reportFilterFromToday} onChange={(e) => {
                        setReportFilterFromToday(e.target.checked);
                        if (isThisWeek) {
                          setReportStartDate(e.target.checked ? todayStr : format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
                          setReportEndDate(e.target.checked ? format(addDays(today, 6), 'yyyy-MM-dd') : format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
                        } else if (isThisMonth) {
                          setReportStartDate(e.target.checked ? todayStr : format(startOfMonth(today), 'yyyy-MM-dd'));
                          setReportEndDate(e.target.checked ? format(addDays(today, 29), 'yyyy-MM-dd') : format(endOfMonth(today), 'yyyy-MM-dd'));
                        }
                      }} />
                      <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${reportFilterFromToday ? 'translate-x-4' : 'translate-x-0'}`}></div>
                    </div>
                    <span className="text-xs font-medium text-neutral-500">今日起</span>
                  </label>
                )}
                <div className="flex bg-neutral-100 p-1 rounded-lg">
                  <button
                    onClick={() => {
                      setReportStartDate(currentWeekStart);
                      setReportEndDate(currentWeekEnd);
                    }}
                    className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${isThisWeek ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'}`}
                  >
                    本周
                  </button>
                  <button
                    onClick={() => {
                      setReportStartDate(currentMonthStart);
                      setReportEndDate(currentMonthEnd);
                    }}
                    className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${isThisMonth ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'}`}
                  >
                    本月
                  </button>
                </div>
              </div>
            );
          })()}
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
                    <input list="reports-equipment-list" type="text" value={reportFilterEquipment} onChange={e => setReportFilterEquipment(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm text-left" placeholder="搜索仪器..." />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-500 mb-2">时长/利用率/费用</label>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <input type="number" placeholder="时间Min(h)" value={reportFilterDurationMin} onChange={e => setReportFilterDurationMin(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm" />
                        <span className="text-neutral-400">-</span>
                        <input type="number" placeholder="时间Max(h)" value={reportFilterDurationMax} onChange={e => setReportFilterDurationMax(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm" />
                      </div>
                      <div className="flex items-center gap-2">
                        <input type="number" placeholder="利用率Min(%)" value={reportFilterUtilizationMin} onChange={e => setReportFilterUtilizationMin(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm" />
                        <span className="text-neutral-400">-</span>
                        <input type="number" placeholder="利用率Max(%)" value={reportFilterUtilizationMax} onChange={e => setReportFilterUtilizationMax(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm" />
                      </div>
                      <div className="flex items-center gap-2">
                        <input type="number" placeholder="费用Min(¥)" value={reportFilterCostMin} onChange={e => setReportFilterCostMin(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm" />
                        <span className="text-neutral-400">-</span>
                        <input type="number" placeholder="费用Max(¥)" value={reportFilterCostMax} onChange={e => setReportFilterCostMax(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-500 mb-2">状态</label>
                    <div className="flex gap-3">
                      <div className="flex-1 space-y-2">
                        <div className="text-xs text-neutral-400">原生状态</div>
                        <div className="flex flex-wrap gap-2">
                          {['待审批', '已通过', '进行中', '已完成', '已取消', '已驳回'].map((value) => (
                            <label key={value} className="flex items-center gap-2 px-2 py-1.5 bg-white border border-neutral-200 rounded-lg cursor-pointer hover:bg-neutral-50 transition-colors">
                              <input type="checkbox" checked={reportFilterStatus.includes(value)} onChange={e => {
                                if (e.target.checked) setReportFilterStatus([...reportFilterStatus, value]);
                                else setReportFilterStatus(reportFilterStatus.filter(s => s !== value));
                              }} className="text-red-600 rounded border-neutral-300 focus:ring-red-600" />
                              <span className="text-sm text-neutral-700">{value}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="w-px bg-neutral-200"></div>
                      <div className="flex-1 space-y-2">
                        <div className="text-xs text-neutral-400">计算状态</div>
                        <div className="flex flex-wrap gap-2">
                          {['正常', '迟到', '超时', '待上机', '爽约', '临期取消'].map((value) => (
                            <label key={value} className="flex items-center gap-2 px-2 py-1.5 bg-white border border-neutral-200 rounded-lg cursor-pointer hover:bg-neutral-50 transition-colors">
                              <input type="checkbox" checked={reportFilterStatus.includes(value)} onChange={e => {
                                if (e.target.checked) setReportFilterStatus([...reportFilterStatus, value]);
                                else setReportFilterStatus(reportFilterStatus.filter(s => s !== value));
                              }} className="text-red-600 rounded border-neutral-300 focus:ring-red-600" />
                              <span className="text-sm text-neutral-700">{value}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap block md:table">
                  <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200 hidden md:table-header-group">
                    <tr>
                      <th className="px-3 py-4 font-medium align-top">
                        <div className="mb-2">预约码</div>
                        <input 
                          type="text" 
                          placeholder="搜索预约码..." 
                          value={reportFilterCode}
                          onChange={e => setReportFilterCode(e.target.value)}
                          className="w-20 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal"
                        />
                      </th>
                      <th className="px-3 py-4 font-medium align-top">
                        <div className="mb-2">用户/导师</div>
                        <input 
                          type="text" 
                          placeholder="姓名/学号/导师..." 
                          value={reportFilterUser}
                          onChange={e => setReportFilterUser(e.target.value)}
                          className="w-20 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal"
                        />
                      </th>
                      <th className="px-3 py-4 font-medium align-top">
                        <div className="mb-2">仪器</div>
                        <input 
                          list="reports-equipment-list"
                          type="text" 
                          placeholder="搜索仪器..." 
                          value={reportFilterEquipment}
                          onChange={e => setReportFilterEquipment(e.target.value)}
                          className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none font-normal text-left"
                        />
                      </th>
                      <th className="px-3 py-4 font-medium align-top">预约时间</th>
                      <th className="px-3 py-4 font-medium align-top">实际上机</th>
                      <th className="px-3 py-4 font-medium align-top">
                        <div className="mb-2">时长</div>
                        <div className="relative" ref={reportTimeFilterPopupRef}>
                          <button 
                            onClick={() => setShowReportTimeFilterPopup(!showReportTimeFilterPopup)}
                            className="w-full px-2 py-1 text-xs rounded border border-neutral-300 bg-white text-left min-h-[26px] flex items-center justify-between"
                          >
                            <span className="text-neutral-500 truncate">
                              {reportFilterDurationMin || reportFilterDurationMax || reportFilterUtilizationMin || reportFilterUtilizationMax ? '已筛选' : '时长'}
                            </span>
                            <Filter className="w-3 h-3 text-neutral-400" />
                          </button>
                          {showReportTimeFilterPopup && (
                            <div className="absolute top-full left-0 mt-1 w-52 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 z-10 font-normal">
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
                                  <label className="block text-xs text-neutral-500 mb-1">时长利用率 (%)</label>
                                  <div className="flex items-center gap-1">
                                    <input type="number" placeholder="Min" value={reportFilterUtilizationMin} onChange={e => setReportFilterUtilizationMin(e.target.value)} className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none" />
                                    <span className="text-neutral-400">-</span>
                                    <input type="number" placeholder="Max" value={reportFilterUtilizationMax} onChange={e => setReportFilterUtilizationMax(e.target.value)} className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none" />
                                  </div>
                                </div>
                                <div className="flex justify-between items-center pt-2 border-t border-neutral-100">
                                  <button 
                                    onClick={() => {
                                      setReportFilterDurationMin('');
                                      setReportFilterDurationMax('');
                                      setReportFilterUtilizationMin('');
                                      setReportFilterUtilizationMax('');
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
                      <th className="px-3 py-4 font-medium align-top">
                        <div className="mb-2">总费用</div>
                        <div className="relative" ref={reportCostFilterPopupRef}>
                          <button 
                            onClick={() => setShowReportCostFilterPopup(!showReportCostFilterPopup)}
                            className="w-full px-2 py-1 text-xs rounded border border-neutral-300 bg-white text-left min-h-[26px] flex items-center justify-between"
                          >
                            <span className="text-neutral-500 truncate">
                              {reportFilterCostMin || reportFilterCostMax ? '已筛选' : '总费用'}
                            </span>
                            <Filter className="w-3 h-3 text-neutral-400" />
                          </button>
                          {showReportCostFilterPopup && (
                            <div className="absolute top-full left-0 mt-1 w-52 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 z-10 font-normal">
                              <div className="space-y-3">
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
                                      setReportFilterCostMin('');
                                      setReportFilterCostMax('');
                                    }}
                                    className="text-xs text-neutral-500 hover:text-neutral-700"
                                  >
                                    清空
                                  </button>
                                  <button 
                                    onClick={() => setShowReportCostFilterPopup(false)}
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
                      <th className="px-3 py-4 font-medium align-top">
                        <div className="mb-2">状态</div>
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
                            <div className="absolute top-full right-0 mt-1 w-[280px] bg-white border border-neutral-200 rounded-lg shadow-lg p-3 z-10 font-normal">
                              <div className="mb-3">
                                <label className="block text-[10px] font-medium text-neutral-500 mb-1 uppercase tracking-wider">状态</label>
                                <div className="flex gap-2">
                                  <div className="flex-1 space-y-1 pr-1">
                                    <div className="text-[10px] text-neutral-400 mb-1 px-2">原生状态</div>
                                    {['待审批', '已通过', '进行中', '已完成', '已取消', '已驳回'].map((value) => (
                                      <label key={value} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-50 rounded cursor-pointer transition-colors">
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
                                  <div className="w-px bg-neutral-200"></div>
                                  <div className="flex-1 space-y-1 pr-1">
                                    <div className="text-[10px] text-neutral-400 mb-1 px-2">计算状态</div>
                                    {['正常', '迟到', '超时', '待上机', '爽约', '临期取消'].map((value) => (
                                      <label key={value} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-50 rounded cursor-pointer transition-colors">
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
                      <th className="px-3 py-4 font-medium align-top">耗材</th>
                      <th className="px-3 py-4 font-medium align-top">操作</th>
                    </tr>
                  </thead>
                  <tbody className="block md:table-row-group divide-y divide-neutral-100 md:divide-y-0 p-4 md:p-0">
                    {paginatedReportReservations.map((res: any) => {
                      const mDuration = res.actual_start_time && res.actual_end_time 
                        ? (new Date(res.actual_end_time).getTime() - new Date(res.actual_start_time).getTime()) / (1000 * 60 * 60)
                        : 0;
                      const bDuration = res.start_time && res.end_time 
                        ? (new Date(res.end_time).getTime() - new Date(res.start_time).getTime()) / (1000 * 60 * 60)
                        : 0;
                      const utilization = bDuration > 0 ? (mDuration / bDuration * 100) : 0;
                      return (
                      <tr key={res.id} className="block md:table-row hover:bg-neutral-50/50 border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none">
                                                <td className="px-3 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">预约码</span>
                            <span className="font-mono text-xs text-neutral-500">{res.booking_code || '-'}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">用户/导师</span>
                            <div className="text-right md:text-left">
                              <div className="flex items-center justify-end md:justify-start gap-1">
                                <p className="font-medium text-neutral-900">{res.student_name}</p>
                                <div className="group relative cursor-pointer inline-flex ml-1">
                                  <Info className="w-3 h-3 text-neutral-400" />
                                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-50">
                                    <div className="bg-white text-neutral-800 border border-neutral-200 text-xs shadow-xl rounded-xl px-3 py-2 whitespace-nowrap">
                                      <div className="font-semibold mb-1.5 text-neutral-500 border-b border-neutral-100 pb-1">
                                        联系方式
                                      </div>
                                      <div className="flex flex-col gap-1 mt-1 text-neutral-900">
                                        <div className="flex justify-between gap-4">
                                          <span className="text-neutral-500 text-[10px]">手机</span>
                                          <span>{res.phone || '无'}</span>
                                        </div>
                                        <div className="flex justify-between gap-4">
                                          <span className="text-neutral-500 text-[10px]">Email</span>
                                          <span>{res.email || '无'}</span>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="w-3 h-3 bg-white border-b border-r border-neutral-200 rotate-45 absolute -bottom-1.5 left-1/2 -translate-x-1/2"></div>
                                  </div>
                                </div>
                              </div>
                              <div className="text-xs text-neutral-500 text-right md:text-left mt-0.5">
                                {res.student_id} | {res.supervisor}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">仪器</span>
                            <div className="text-neutral-900 max-w-[200px] whitespace-normal break-words">{res.equipment_name}</div>
                          </div>
                        </td>
                        <td className="px-3 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">预约时间</span>
                            <div className="text-right md:text-left text-xs text-neutral-500">
                              <p>{format(new Date(res.start_time), 'yyyy-MM-dd')}</p>
                              <p>{format(new Date(res.start_time), 'HH:mm')} - {format(new Date(res.end_time), 'HH:mm')}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
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
                        <td className="px-3 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">时长</span>
                            <div className="text-right md:text-left">
                              <p className="text-neutral-900">
                                {mDuration.toFixed(2)}h
                              </p>
                              {bDuration > 0 && (
                                <p className="text-xs font-medium text-blue-600">
                                  {utilization.toFixed(1)}%
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">总费用</span>
                            <div className="text-right md:text-left">
                              <p className="text-neutral-900 font-medium">¥{(res.total_cost || 0).toFixed(2)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">状态</span>
    <div className="flex flex-col gap-1 items-end md:items-start">
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
        res.status === 'pending' ? 'bg-amber-100 text-amber-700' :
        res.status === 'rejected' ? 'bg-red-100 text-red-700' :
        res.status === 'cancelled' ? 'bg-neutral-100 text-neutral-600' :
        res.status === 'active' ? 'bg-blue-100 text-blue-700' :
        'bg-emerald-100 text-emerald-700'
      }`}>
        {statusMap[res.status] || res.status}
      </span>
      <div className="relative inline-flex flex-wrap gap-1">
        {res.reportStatus?.split(', ').map((status: string, index: number) => (
          <span key={index} className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
            status === '正常' ? 'bg-emerald-50 border border-emerald-200 text-emerald-600' :
            status === '迟到' ? 'bg-amber-50 border border-amber-200 text-amber-600' :
            status === '超时' ? 'bg-orange-50 border border-orange-200 text-orange-600' :
            status === '待上机' ? 'bg-blue-50 border border-blue-200 text-blue-600' :
            'bg-red-50 border border-red-200 text-red-600'
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
  </div>
</td>
                        <td className="px-3 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                          <div className="flex justify-between items-center md:block">
                            <span className="md:hidden font-medium text-neutral-500 text-xs">耗材</span>
                            <span className="text-neutral-900">{res.consumable_quantity || 0}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 md:py-4 block md:table-cell">
                          <div className="flex justify-end md:justify-start gap-1">
                            <button 
                              onClick={() => {
                                const toLocal = (utcStr: string) => {
                                  if (!utcStr) return '';
                                  const d = new Date(utcStr);
                                  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                                };
                                setEditingReportRecord({
                                  ...res,
                                  start_time: toLocal(res.start_time),
                                  end_time: toLocal(res.end_time),
                                  actual_start_time: toLocal(res.actual_start_time),
                                  actual_end_time: toLocal(res.actual_end_time)
                                });
                                setManualViolations([]);
                                fetchManualViolations(res.id);
                                setIsDrawerOpen(true);
                              }}
                              className="p-1 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="编辑记录"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => setDeleteConfirmId(res.id)}
                              className="p-1 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="删除记录"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                    {paginatedReportReservations.length === 0 && (
                      <tr className="block md:table-row">
                        <td colSpan={10} className="px-4 py-12 text-center text-neutral-500 block md:table-cell">没有找到符合条件的记录</td>
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
                      <button
                        onClick={() => setStatsType('equipment')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                          statsType === 'equipment' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                      >
                        按仪器
                      </button>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4 self-end sm:self-auto">
                    <div className="flex items-center gap-2 relative"
                         onMouseEnter={() => setShowSyncStatsTooltip(true)}
                         onMouseLeave={() => setShowSyncStatsTooltip(false)}
                         onClick={() => setShowSyncStatsTooltip(!showSyncStatsTooltip)}
                    >
                      <div className="flex items-center gap-1 cursor-pointer">
                        <label className="text-xs font-medium text-neutral-500 cursor-pointer">联动</label>
                        <Info className="w-3.5 h-3.5 text-neutral-400 hover:text-neutral-600 transition-colors" />
                      </div>
                      
                      {showSyncStatsTooltip && (
                        <div className="absolute z-50 top-full mt-2 right-0 md:left-1/2 md:-translate-x-1/2 w-48 sm:w-max sm:whitespace-nowrap p-3 bg-white text-neutral-600 border border-neutral-200 text-xs rounded-xl shadow-lg ring-1 ring-black/5"
                             onClick={(e) => e.stopPropagation()}
                        >
                          与详细预约记录表的筛选条件联动
                        </div>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSyncStatsWithFilters(!syncStatsWithFilters);
                        }}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 ${
                          syncStatsWithFilters ? 'bg-red-600' : 'bg-neutral-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            syncStatsWithFilters ? 'translate-x-[18px]' : 'translate-x-[2px]'
                          }`}
                        />
                      </button>
                    </div>

                    <button 
                      onClick={exportStats}
                      className="p-2 border border-neutral-300 text-neutral-500 rounded-xl hover:bg-neutral-50 hover:text-red-600 transition-colors"
                      title={`导出${statsType === 'user' ? '用户' : statsType === 'supervisor' ? '导师' : '仪器'}统计`}
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm block md:table">
                    <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200 hidden md:table-header-group">
                      <tr>
                        <th className="px-4 py-4 font-medium align-top">
                          <div className="mb-2">{statsType === 'user' ? '用户/导师' : statsType === 'supervisor' ? '导师' : '仪器'}</div>
                          {statsType === 'user' ? (
                            <input 
                              type="text" 
                              placeholder="姓名/学号/导师..." 
                              value={statsFilterUser}
                              onChange={e => setStatsFilterUser(e.target.value)}
                              className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                            />
                          ) : statsType === 'supervisor' ? (
                            <input 
                              type="text" 
                              placeholder="搜索导师..." 
                              value={statsFilterSupervisor}
                              onChange={e => setStatsFilterSupervisor(e.target.value)}
                              className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                            />
                          ) : (
                            <input 
                              list="reports-equipment-list"
                              type="text" 
                              placeholder="搜索仪器..." 
                              value={statsFilterEquipment}
                              onChange={e => setStatsFilterEquipment(e.target.value)}
                              className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none text-left"
                            />
                          )}
                        </th>
                        <th className="px-4 py-4 font-medium align-top">
                          <div className="mb-2">上机时长</div>
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
                          <div className="mb-2">预约时长</div>
                          <div className="flex items-center gap-1">
                            <input 
                              type="number" 
                              placeholder="Min" 
                              value={statsFilterBookedMin}
                              onChange={e => setStatsFilterBookedMin(e.target.value)}
                              className="w-16 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                            />
                            <span className="text-neutral-400">-</span>
                            <input 
                              type="number" 
                              placeholder="Max" 
                              value={statsFilterBookedMax}
                              onChange={e => setStatsFilterBookedMax(e.target.value)}
                              className="w-16 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                            />
                          </div>
                        </th>
                        <th className="px-4 py-4 font-medium align-top">
                          <div className="mb-2">时长利用率</div>
                          <div className="flex items-center gap-1">
                            <input 
                              type="number" 
                              placeholder="Min%" 
                              value={statsFilterUtilMin}
                              onChange={e => setStatsFilterUtilMin(e.target.value)}
                              className="w-16 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                            />
                            <span className="text-neutral-400">-</span>
                            <input 
                              type="number" 
                              placeholder="Max%" 
                              value={statsFilterUtilMax}
                              onChange={e => setStatsFilterUtilMax(e.target.value)}
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
                        filteredUsageByPerson.map((u: any, i: number) => {
                          const utilization = u.booked_hours > 0 ? (u.machine_hours / u.booked_hours) * 100 : 0;
                          return (
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
                                  <span className="md:hidden font-medium text-neutral-500 text-xs">上机时长</span>
                                  <span className="text-neutral-900">{(u.machine_hours || 0).toFixed(1)}h</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                                <div className="flex justify-between items-center md:block">
                                  <span className="md:hidden font-medium text-neutral-500 text-xs">预约时长</span>
                                  <span className="text-neutral-900">{(u.booked_hours || 0).toFixed(1)}h</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                                <div className="flex justify-between items-center md:block">
                                  <span className="md:hidden font-medium text-neutral-500 text-xs">时长利用率</span>
                                  <span className="text-neutral-900">{utilization.toFixed(1)}%</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 md:py-4 block md:table-cell">
                                <div className="flex justify-between items-center md:block">
                                  <span className="md:hidden font-medium text-neutral-500 text-xs">总费用</span>
                                  <span className="font-bold text-neutral-900">¥{(u.total_revenue || 0).toFixed(2)}</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      ) : statsType === 'supervisor' ? (
                        filteredUsageBySupervisor.map((s: any, i: number) => {
                          const utilization = s.booked_hours > 0 ? (s.machine_hours / s.booked_hours) * 100 : 0;
                          return (
                            <tr key={i} className="block md:table-row hover:bg-neutral-50/50 border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none">
                              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                                <div className="flex justify-between items-center md:block">
                                  <span className="md:hidden font-medium text-neutral-500 text-xs">导师</span>
                                  <span className="font-medium text-neutral-900">{s.supervisor}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                                <div className="flex justify-between items-center md:block">
                                  <span className="md:hidden font-medium text-neutral-500 text-xs">上机时长</span>
                                  <span className="text-neutral-900">{(s.machine_hours || 0).toFixed(1)}h</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                                <div className="flex justify-between items-center md:block">
                                  <span className="md:hidden font-medium text-neutral-500 text-xs">预约时长</span>
                                  <span className="text-neutral-900">{(s.booked_hours || 0).toFixed(1)}h</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                                <div className="flex justify-between items-center md:block">
                                  <span className="md:hidden font-medium text-neutral-500 text-xs">时长利用率</span>
                                  <span className="text-neutral-900">{utilization.toFixed(1)}%</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 md:py-4 block md:table-cell">
                                <div className="flex justify-between items-center md:block">
                                  <span className="md:hidden font-medium text-neutral-500 text-xs">总费用</span>
                                  <span className="font-bold text-neutral-900">¥{(s.total_revenue || 0).toFixed(2)}</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        filteredUsageByEquipment.map((e: any, i: number) => {
                          const utilization = e.booked_hours > 0 ? (e.machine_hours / e.booked_hours) * 100 : 0;
                          return (
                            <tr key={i} className="block md:table-row hover:bg-neutral-50/50 border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none">
                              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                                <div className="flex justify-between items-center md:block">
                                  <span className="md:hidden font-medium text-neutral-500 text-xs">仪器</span>
                                  <p className="font-medium text-neutral-900">{e.equipment_name}</p>
                                </div>
                              </td>
                              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                                <div className="flex justify-between items-center md:block">
                                  <span className="md:hidden font-medium text-neutral-500 text-xs">上机时长</span>
                                  <span className="text-neutral-900">{(e.machine_hours || 0).toFixed(1)}h</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                                <div className="flex justify-between items-center md:block">
                                  <span className="md:hidden font-medium text-neutral-500 text-xs">预约时长</span>
                                  <span className="text-neutral-900">{(e.booked_hours || 0).toFixed(1)}h</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                                <div className="flex justify-between items-center md:block">
                                  <span className="md:hidden font-medium text-neutral-500 text-xs">时长利用率</span>
                                  <span className="text-neutral-900">{utilization.toFixed(1)}%</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 md:py-4 block md:table-cell">
                                <div className="flex justify-between items-center md:block">
                                  <span className="md:hidden font-medium text-neutral-500 text-xs">总费用</span>
                                  <span className="font-bold text-neutral-900">¥{(e.total_revenue || 0).toFixed(2)}</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                      {((statsType === 'user' && filteredUsageByPerson.length === 0) || 
                        (statsType === 'supervisor' && filteredUsageBySupervisor.length === 0) ||
                        (statsType === 'equipment' && filteredUsageByEquipment.length === 0)) && (
                        <tr className="block md:table-row">
                          <td colSpan={5} className="px-4 py-12 text-center text-neutral-500 block md:table-cell">暂无数据</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeSubTab === 'charts' && (
              <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
                <div className="p-4 border-b border-neutral-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <h3 className="text-sm font-bold text-neutral-900">统计图表</h3>
                    <div className="flex bg-neutral-100 p-1 rounded-xl">
                      <button onClick={() => setChartMetric('duration')} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${chartMetric === 'duration' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}>时长</button>
                      <button onClick={() => setChartMetric('revenue')} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${chartMetric === 'revenue' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}>收入</button>
                    </div>
                    <div className="flex bg-neutral-100 p-1 rounded-xl">
                      <button onClick={() => setChartDimension('time')} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${chartDimension === 'time' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}>按时间</button>
                      <button onClick={() => setChartDimension('user')} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${chartDimension === 'user' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}>按用户</button>
                      <button onClick={() => setChartDimension('supervisor')} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${chartDimension === 'supervisor' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}>按导师</button>
                      <button onClick={() => setChartDimension('equipment')} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${chartDimension === 'equipment' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}>按仪器</button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div 
                      className="relative flex items-center gap-2" 
                      onMouseEnter={() => setShowSyncChartTooltip(true)} 
                      onMouseLeave={() => setShowSyncChartTooltip(false)}
                    >
                      <div className="flex items-center gap-1 cursor-pointer">
                        <label className="text-xs font-medium text-neutral-500 cursor-pointer">联动</label>
                        <Info className="w-3.5 h-3.5 text-neutral-400 hover:text-neutral-600 transition-colors" />
                      </div>
                      
                      {showSyncChartTooltip && (
                        <div className="absolute z-50 top-full mt-2 left-0 md:left-1/2 md:-translate-x-1/2 w-48 sm:w-max sm:whitespace-nowrap p-3 bg-white text-neutral-600 border border-neutral-200 text-xs rounded-xl shadow-lg ring-1 ring-black/5"
                             onClick={(e) => e.stopPropagation()}
                        >
                          与详细预约记录表的筛选条件联动
                        </div>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSyncChartWithFilters(!syncChartWithFilters);
                        }}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 ${
                          syncChartWithFilters ? 'bg-red-600' : 'bg-neutral-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            syncChartWithFilters ? 'translate-x-[18px]' : 'translate-x-[2px]'
                          }`}
                        />
                      </button>
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
                  {(() => {
                    let chartData = chartDimension === 'time' ? chartUsageByTime : chartDimension === 'user' ? chartBasePersonData : chartDimension === 'supervisor' ? chartBaseSupervisorData : chartBaseEquipmentData;
                    const keyAxis = chartDimension === 'time' ? 'period' : chartDimension === 'user' ? 'student_name' : chartDimension === 'supervisor' ? 'supervisor' : 'equipment_name';
                    
                    if (chartDimension !== 'time') {
                      const sortKey = chartMetric === 'duration' ? 'total_hours' : 'total_revenue';
                      chartData = [...chartData].sort((a: any, b: any) => Number(b[sortKey] || 0) - Number(a[sortKey] || 0));
                    }
                    
                    const getLabelWidth = (str: string) => {
                      let len = 0;
                      if (!str) return 0;
                      const s = String(str);
                      for(let i = 0; i < s.length; i++) {
                        len += s.charCodeAt(i) > 255 ? 14 : 8;
                      }
                      return len;
                    };
                    
                    const calculatedMaxWidth = Math.max(...chartData.map(d => getLabelWidth(d[keyAxis as keyof typeof d] as string || '')));
                    const maxLabelWidth = Math.min(150, Math.max(80, calculatedMaxWidth));
                    const hasWrapping = calculatedMaxWidth > 150;
                    const dynamicRowHeight = hasWrapping ? 36 : 24;
                    const dynamicHeight = reportChartType === 'bar' ? Math.max(384, chartData.length * dynamicRowHeight + 80) : 384;         
                    const renderCustomYAxisTick = ({ x, y, payload }: any) => {  
                      const label = String(payload.value || '');  
                      let lines: string[] = [];  
                      let currentLine = '';  
                      let currentLen = 0;  
                      for(let i=0; i<label.length; i++) {  
                        const char = label[i];  
                        const charWidth = char.charCodeAt(0) > 255 ? 14 : 8;  
                        if (currentLen + charWidth > maxLabelWidth) {  
                          lines.push(currentLine);  
                          currentLine = char;  
                          currentLen = charWidth;  
                        } else {  
                          currentLine += char;  
                          currentLen += charWidth;  
                        }  
                      }  
                      if (currentLine) lines.push(currentLine);         
                      return (  
                        <g transform={`translate(${x},${y})`}>  
                          <text x={-8} y={4 - (lines.length - 1) * 6} textAnchor="end" fill="#666" fontSize={12}>  
                            <title>{label}</title>  
                            {lines.map((line, index) => (  
                              <tspan key={index} x={-8} dy={index === 0 ? 0 : "1.2em"}>{line}</tspan>  
                            ))}  
                          </text>  
                        </g>  
                      );  
                    };         
                    return (  
                      <div style={{ height: dynamicHeight }} className="w-full transition-all duration-300">  
                        <ResponsiveContainer width="100%" height="100%">  
                          {reportChartType === 'bar' ? (  
                            <BarChart data={chartData} layout="vertical">  
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e5e5" />  
                              <XAxis type="number" axisLine={false} tickLine={false} tick={{fill: '#737373', fontSize: 12}} tickFormatter={(val) => Number(val).toFixed(2)} />  
                              <YAxis   
                                dataKey={keyAxis}   
                                type="category"   
                                axisLine={false}   
                                tickLine={false}   
                                width={maxLabelWidth + 16}   
                                interval={0}   
                                tick={renderCustomYAxisTick}   
                              />  
                              <Tooltip cursor={{fill: '#f5f5f5'}} formatter={(value: number) => Number(value).toFixed(2)} />  
                              <Bar   
                                dataKey={chartMetric === 'duration' ? 'total_hours' : 'total_revenue'}   
                                name={chartMetric === 'duration' ? '时长 (小时)' : '收入 (¥)'}   
                                fill={chartMetric === 'duration' ? '#dc2626' : '#d97706'}   
                                radius={[0, 4, 4, 0]}   
                              />  
                            </BarChart>  
                          ) : (  
                            <LineChart data={chartDimension === 'time' ? chartData : multiLineData}>  
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />  
                              <XAxis dataKey={chartDimension === 'time' ? keyAxis : 'period'} axisLine={false} tickLine={false} tick={{fill: '#737373', fontSize: 12}} />  
                              <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} tickFormatter={(val) => Number(val).toFixed(2)} />  
                              <Tooltip formatter={(value: number) => Number(value).toFixed(2)} />  
                              {chartDimension !== 'time' && <Legend wrapperStyle={{ fontSize: '12px' }} />}  
                              {chartDimension === 'time' ? (  
                                <Line   
                                  type="monotone"   
                                  dataKey={chartMetric === 'duration' ? 'total_hours' : 'total_revenue'}   
                                  name={chartMetric === 'duration' ? '时长 (小时)' : '收入 (¥)'}   
                                  stroke={chartMetric === 'duration' ? '#dc2626' : '#d97706'}   
                                  strokeWidth={2}   
                                  dot={{r: 4}}   
                                  activeDot={{r: 6}}   
                                />  
                              ) : (  
                                multiLineKeys.map((k, i) => {  
                                  const colors = ['#dc2626', '#d97706', '#059669', '#2563eb', '#7c3aed', '#db2777', '#0891b2', '#4f46e5', '#ea580c', '#16a34a'];  
                                  return (  
                                    <Line  
                                      key={k}  
                                      type="monotone"  
                                      dataKey={`${k}_${chartMetric}`}  
                                      name={k}  
                                      stroke={colors[i % colors.length]}  
                                      strokeWidth={2}  
                                      dot={{r: 4}}  
                                      activeDot={{r: 6}}  
                                    />  
                                  );  
                                })  
                              )}  
                            </LineChart>  
                          )}  
                        </ResponsiveContainer>  
                      </div>  
                    );  
                  })()}  
                </div>  
              </div>  
            )}

          </div>
        ) : null}
      </div>
<ReservationEditDrawer 
          isOpen={isDrawerOpen} 
          onClose={() => setIsDrawerOpen(false)} 
          reservation={editingReportRecord} 
          token={token} 
          onUpdate={fetchReports} 
        />
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
