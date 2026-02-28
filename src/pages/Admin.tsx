import React, { useState, useEffect } from 'react';
import { PlusCircle, BarChart3, Users, CalendarDays, DollarSign, List, Trash2, Lock, Settings2, Image as ImageIcon, MapPin, Check, CheckCircle, XCircle, X, Download, FileText, ChevronDown, ChevronUp, Edit3, Clock, Upload } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { format, subDays, startOfToday } from 'date-fns';
import toast from 'react-hot-toast';
import cronstrue from 'cronstrue';
import 'cronstrue/locales/zh_CN';

export default function Admin() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('admin_token'));
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [activeTab, setActiveTab] = useState<'add' | 'reports' | 'reservations' | 'equipment' | 'whitelist_apps' | 'audit_logs'>('add');
  const [reports, setReports] = useState<any>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [reportPeriod, setReportPeriod] = useState('day');
  const [reportChartType, setReportChartType] = useState<'bar' | 'line'>('bar');
  const [reportStartDate, setReportStartDate] = useState(format(subDays(startOfToday(), 7), 'yyyy-MM-dd'));
  const [reportEndDate, setReportEndDate] = useState(format(startOfToday(), 'yyyy-MM-dd'));
  const [reportFilterName, setReportFilterName] = useState('');
  const [reportFilterSupervisor, setReportFilterSupervisor] = useState('');
  const [loadingReports, setLoadingReports] = useState(false);
  const [reservations, setReservations] = useState<any[]>([]);
  const [equipmentList, setEquipmentList] = useState<any[]>([]);
  const [editingEquipment, setEditingEquipment] = useState<any>(null);
  const [editingReservation, setEditingReservation] = useState<any>(null);
  const [editingReportRecord, setEditingReportRecord] = useState<any>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteReservationConfirmId, setDeleteReservationConfirmId] = useState<number | null>(null);
  const [whitelistApps, setWhitelistApps] = useState<any[]>([]);

  // Add/Edit Equipment Form State
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    image_url: '',
    location: '',
    auto_approve: true,
    allow_out_of_hours: false,
    price_type: 'hour',
    price: 0,
    consumable_fee: 0,
    whitelist_enabled: false,
    whitelist_data: '',
    advanceDays: 7,
    maxDurationMinutes: 60,
    minDurationMinutes: 30,
    rules: [] as { day: number, start: string, end: string }[]
  });

  const [selectedDays, setSelectedDays] = useState<number[]>([]);

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
  };

  const daysOfWeek = [
    { label: '周日', value: 0 },
    { label: '周一', value: 1 },
    { label: '周二', value: 2 },
    { label: '周三', value: 3 },
    { label: '周四', value: 4 },
    { label: '周五', value: 5 },
    { label: '周六', value: 6 },
  ];

  useEffect(() => {
    if (token) {
      fetchReservations();
      fetchEquipment();
      fetchWhitelistApps();
    }
  }, [token]);

  const fetchWhitelistApps = async () => {
    try {
      const res = await fetch('/api/admin/whitelist/applications', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setWhitelistApps(data);
    } catch (err) {
      toast.error('获取白名单申请失败');
    }
  };

  const handleApproveApp = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/whitelist/applications/${id}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('已批准并加入白名单');
        fetchWhitelistApps();
        fetchEquipment();
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
        toast.success('已拒绝申请');
        fetchWhitelistApps();
      }
    } catch (err) {
      toast.error('操作失败');
    }
  };

  const fetchEquipment = async () => {
    try {
      const res = await fetch('/api/equipment');
      const data = await res.json();
      setEquipmentList(data);
    } catch (err) {
      toast.error('获取仪器列表失败');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (res.ok) {
        setToken(data.token);
        localStorage.setItem('admin_token', data.token);
        setLoginError('');
      } else {
        setLoginError(data.error || '登录失败');
      }
    } catch (err) {
      setLoginError('登录失败');
    }
  };

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('admin_token');
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const availability_json = JSON.stringify({
      rules: formData.rules,
      advanceDays: formData.advanceDays,
      maxDurationMinutes: formData.maxDurationMinutes,
      minDurationMinutes: formData.minDurationMinutes,
      allowOutOfHours: formData.allow_out_of_hours
    });

    try {
      const url = editingEquipment ? `/api/admin/equipment/${editingEquipment.id}` : '/api/admin/equipment';
      const method = editingEquipment ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ ...formData, availability_json })
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(editingEquipment ? '仪器更新成功！' : '仪器添加成功！');
        setFormData({
          name: '',
          description: '',
          image_url: '',
          location: '',
          auto_approve: true,
          allow_out_of_hours: false,
          price_type: 'hour',
          price: 0,
          consumable_fee: 0,
          whitelist_enabled: false,
          whitelist_data: '',
          advanceDays: 7,
          maxDurationMinutes: 60,
          minDurationMinutes: 30,
          rules: []
        });
        setEditingEquipment(null);
        setActiveTab('equipment');
        fetchEquipment();
      }
    } catch (err) {
      toast.error('保存仪器失败');
    }
  };

  const startEdit = (eq: any) => {
    let availability: any = { rules: [], advanceDays: 7, maxDurationMinutes: 60, minDurationMinutes: 30, allowOutOfHours: false };
    try {
      availability = JSON.parse(eq.availability_json || '{}');
    } catch (e) {}

    setEditingEquipment(eq);
    setFormData({
      name: eq.name,
      description: eq.description,
      image_url: eq.image_url || '',
      location: eq.location || '',
      auto_approve: eq.auto_approve === 1,
      allow_out_of_hours: availability.allowOutOfHours === true,
      price_type: eq.price_type,
      price: eq.price,
      consumable_fee: eq.consumable_fee,
      whitelist_enabled: eq.whitelist_enabled === 1,
      whitelist_data: eq.whitelist_data || '',
      advanceDays: availability.advanceDays || 7,
      maxDurationMinutes: availability.maxDurationMinutes || 60,
      minDurationMinutes: availability.minDurationMinutes || 30,
      rules: availability.rules || []
    });
    setActiveTab('add');
  };

  const deleteEquipment = async (id: number) => {
    if (!confirm('确定要删除该仪器吗？')) return;
    try {
      const res = await fetch(`/api/admin/equipment/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('删除成功');
        fetchEquipment();
      }
    } catch (err) {
      toast.error('删除失败');
    }
  };

  const fetchReports = async () => {
    setLoadingReports(true);
    try {
      const query = new URLSearchParams({
        period: reportPeriod,
        startDate: reportStartDate,
        endDate: reportEndDate,
        ...(reportFilterName && { student_name: reportFilterName }),
        ...(reportFilterSupervisor && { supervisor: reportFilterSupervisor })
      });
      const res = await fetch(`/api/admin/reports?${query.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return handleLogout();
      const data = await res.json();
      setReports(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingReports(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Max dimension 800px
        const maxDim = 800;
        if (width > height) {
          if (width > maxDim) {
            height *= maxDim / width;
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width *= maxDim / height;
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        // Compress until < 60KB
        let quality = 0.9;
        let base64 = canvas.toDataURL('image/jpeg', quality);
        while (base64.length > 60 * 1024 && quality > 0.1) {
          quality -= 0.1;
          base64 = canvas.toDataURL('image/jpeg', quality);
        }

        setFormData({ ...formData, image_url: base64 });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const exportToCSV = (data: any[], filename: string, headers: string[], rowMapper: (item: any) => any[]) => {
    const rows = data.map(rowMapper);
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportDetailedReport = () => {
    if (!reports?.allReservations) return;
    const headers = ['预约码', '仪器', '用户', '学号', '导师', '预约开始', '预约结束', '实际开始', '实际结束', '时长(小时)', '费用(¥)', '状态'];
    exportToCSV(
      reports.allReservations,
      `detailed_report_${reportStartDate}_${reportEndDate}`,
      headers,
      (r: any) => {
        const duration = r.actual_start_time && r.actual_end_time 
          ? (new Date(r.actual_end_time).getTime() - new Date(r.actual_start_time).getTime()) / (1000 * 60 * 60)
          : 0;
        return [
          r.booking_code,
          r.equipment_name,
          r.student_name,
          r.student_id,
          r.supervisor,
          format(new Date(r.start_time), 'yyyy-MM-dd HH:mm'),
          format(new Date(r.end_time), 'yyyy-MM-dd HH:mm'),
          r.actual_start_time ? format(new Date(r.actual_start_time), 'yyyy-MM-dd HH:mm') : '-',
          r.actual_end_time ? format(new Date(r.actual_end_time), 'yyyy-MM-dd HH:mm') : '-',
          duration.toFixed(2),
          (r.total_cost || 0).toFixed(2),
          r.reportStatus
        ];
      }
    );
  };

  const exportUserStats = () => {
    if (!reports?.usageByPerson) return;
    const headers = ['姓名', '学号', '导师', '总时长(小时)', '总费用(¥)'];
    exportToCSV(
      reports.usageByPerson,
      `user_stats_${reportStartDate}_${reportEndDate}`,
      headers,
      (u: any) => [u.student_name, u.student_id, u.supervisor, u.total_hours.toFixed(2), u.total_revenue.toFixed(2)]
    );
  };

  const exportSupervisorStats = () => {
    if (!reports?.usageBySupervisor) return;
    const headers = ['导师', '总时长(小时)', '总费用(¥)'];
    exportToCSV(
      reports.usageBySupervisor,
      `supervisor_stats_${reportStartDate}_${reportEndDate}`,
      headers,
      (s: any) => [s.supervisor, s.total_hours.toFixed(2), s.total_revenue.toFixed(2)]
    );
  };

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
        })
      });
      if (res.ok) {
        toast.success('预约更新成功');
        setEditingReservation(null);
        fetchReservations();
      }
    } catch (err) {
      toast.error('更新失败');
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

      const res = await fetch(`/api/admin/reports/reservations/${editingReportRecord.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          actual_start_time: toUTC(editingReportRecord.actual_start_time),
          actual_end_time: toUTC(editingReportRecord.actual_end_time),
          consumable_quantity: editingReportRecord.consumable_quantity
        })
      });
      if (res.ok) {
        toast.success('记录更新成功');
        setEditingReportRecord(null);
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

  const fetchReservations = async () => {
    try {
      const res = await fetch('/api/admin/reservations', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return handleLogout();
      const data = await res.json();
      setReservations(data);
    } catch (err) {
      console.error(err);
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
    if (!token) return;
    if (activeTab === 'reports') {
      fetchReports();
    } else if (activeTab === 'reservations') {
      fetchReservations();
    } else if (activeTab === 'audit_logs') {
      fetchAuditLogs();
    }
  }, [activeTab, reportPeriod, token]);

  if (!token) {
    return (
      <div className="max-w-md mx-auto mt-20 bg-white p-8 rounded-2xl shadow-sm border border-neutral-200">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
            <Lock className="w-6 h-6 text-red-600" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center mb-8">管理后台登录</h2>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">密码</label>
            <input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" 
              placeholder="请输入管理员密码" 
            />
          </div>
          {loginError && <p className="text-red-500 text-sm">{loginError}</p>}
          <button type="submit" className="w-full py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors">
            登录
          </button>
        </form>
      </div>
    );
  }

  const statusMap: Record<string, string> = {
    pending: '待审批',
    rejected: '已驳回',
    approved: '已通过',
    active: '进行中',
    completed: '已完成',
    cancelled: '已取消'
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">管理后台</h1>
          <p className="text-neutral-500 mt-2">管理仪器设备并查看使用报表。</p>
        </div>
        <div className="flex items-center gap-4 w-full sm:w-auto overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:pb-0">
          <div className="flex gap-2 bg-neutral-100 p-1 rounded-xl whitespace-nowrap">
            <button
              onClick={() => { setActiveTab('add'); setEditingEquipment(null); setFormData({ name: '', description: '', image_url: '', location: '', auto_approve: true, allow_out_of_hours: false, price_type: 'hour', price: 0, consumable_fee: 0, whitelist_enabled: false, whitelist_data: '', advanceDays: 7, maxDurationMinutes: 60, minDurationMinutes: 30, rules: [] }); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'add' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <PlusCircle className="w-4 h-4" />
              {editingEquipment ? '编辑仪器' : '添加仪器'}
            </button>
            <button
              onClick={() => setActiveTab('equipment')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'equipment' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <List className="w-4 h-4" />
              仪器管理
            </button>
            <button
              onClick={() => setActiveTab('reservations')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'reservations' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <CalendarDays className="w-4 h-4" />
              预约管理
            </button>
            <button
              onClick={() => setActiveTab('whitelist_apps')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'whitelist_apps' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <Lock className="w-4 h-4" />
              白名单申请
            </button>
            <button
              onClick={() => setActiveTab('reports')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'reports' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <BarChart3 className="w-4 h-4" />
              报表
            </button>
            <button
              onClick={() => setActiveTab('audit_logs')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'audit_logs' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
            >
              <FileText className="w-4 h-4" />
              审计日志
            </button>
          </div>
          <button onClick={handleLogout} className="text-sm text-neutral-500 hover:text-neutral-900 underline shrink-0">退出</button>
        </div>
      </div>

      {activeTab === 'add' && (
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 max-w-2xl mx-auto">
          <h2 className="text-xl font-bold mb-6">{editingEquipment ? '编辑仪器' : '添加新仪器'}</h2>
          <form onSubmit={handleAddSubmit} className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">仪器名称</label>
                <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" placeholder="例如：扫描电子显微镜" />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">仪器描述</label>
                <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" rows={3} placeholder="简要介绍仪器的功能和用途..." />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-neutral-400" />
                    设备图片 (小于 60KB)
                  </label>
                  <div className="flex items-center gap-2">
                    {formData.image_url && <img src={formData.image_url} alt="preview" className="w-10 h-10 object-cover rounded border" />}
                    <label className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-neutral-300 hover:border-red-500 cursor-pointer transition-all text-neutral-500 text-sm">
                      <Upload className="w-4 h-4" />
                      上传图片
                      <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-neutral-400" />
                    所在位置
                  </label>
                  <input type="text" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" placeholder="例如：实验楼 302" />
                </div>
              </div>
              
              <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-neutral-900">开放时间设置</h3>
                </div>
                
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">可提前预约天数</label>
                      <input type="number" min="1" value={formData.advanceDays} onChange={e => setFormData({...formData, advanceDays: Number(e.target.value)})} className="w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">单次最小预约时长 (分钟)</label>
                      <input type="number" min="1" value={formData.minDurationMinutes} onChange={e => setFormData({...formData, minDurationMinutes: Number(e.target.value)})} className="w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">单次最大预约时长 (分钟)</label>
                      <input type="number" min="1" value={formData.maxDurationMinutes} onChange={e => setFormData({...formData, maxDurationMinutes: Number(e.target.value)})} className="w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-sm" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-neutral-500 mb-2">开放规则</label>
                    <div className="space-y-2">
                      {formData.rules.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)).map((rule, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-neutral-200">
                          <span className="text-xs font-medium w-12">{daysOfWeek.find(d => d.value === rule.day)?.label}</span>
                          <span className="text-xs text-neutral-500">{rule.start} - {rule.end}</span>
                          <button 
                            type="button" 
                            onClick={() => setFormData({...formData, rules: formData.rules.filter((_, i) => i !== idx)})}
                            className="ml-auto text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      
                      <div className="p-3 bg-white rounded-xl border border-neutral-200 space-y-3">
                        <div className="flex flex-wrap gap-2">
                          {daysOfWeek.map(d => (
                            <button
                              key={d.value}
                              type="button"
                              onClick={() => {
                                if (selectedDays.includes(d.value)) {
                                  setSelectedDays(selectedDays.filter(v => v !== d.value));
                                } else {
                                  setSelectedDays([...selectedDays, d.value]);
                                }
                              }}
                              className={`px-2 py-1 text-xs rounded-md border transition-colors ${selectedDays.includes(d.value) ? 'bg-red-600 border-red-600 text-white' : 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:border-red-300'}`}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <input id="new-rule-start" type="time" className="flex-1 px-2 py-1.5 text-xs border border-neutral-300 rounded bg-white" defaultValue="08:00" />
                          <span className="text-xs">至</span>
                          <input id="new-rule-end" type="time" className="flex-1 px-2 py-1.5 text-xs border border-neutral-300 rounded bg-white" defaultValue="18:00" />
                          <button 
                            type="button"
                            onClick={() => {
                              if (selectedDays.length === 0) return toast.error('请至少选择一天');
                              const start = (document.getElementById('new-rule-start') as HTMLInputElement).value;
                              const end = (document.getElementById('new-rule-end') as HTMLInputElement).value;
                              if (start >= end) return toast.error('结束时间必须晚于开始时间');
                              
                              const newRules = selectedDays.map(day => ({ day, start, end }));
                              setFormData({...formData, rules: [...formData.rules, ...newRules]});
                              setSelectedDays([]);
                            }}
                            className="px-4 py-1.5 bg-neutral-900 text-white text-xs rounded-lg hover:bg-neutral-800"
                          >
                            批量添加
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-neutral-200 mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-neutral-700">人员白名单</h3>
                      <p className="text-xs text-neutral-500">仅允许白名单内的人员预约此仪器</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFormData({...formData, whitelist_enabled: !formData.whitelist_enabled})}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${formData.whitelist_enabled ? 'bg-red-600' : 'bg-neutral-200'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.whitelist_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  
                  {formData.whitelist_enabled && (
                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">白名单人员名单 (按姓名，逗号或换行分隔)</label>
                      <textarea
                        value={formData.whitelist_data}
                        onChange={e => setFormData({...formData, whitelist_data: e.target.value})}
                        className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all text-sm"
                        rows={3}
                        placeholder="例如：张三, 李四, 王五"
                      />
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-neutral-200 mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-neutral-700">自动审批预约</h3>
                      <p className="text-xs text-neutral-500">开启后，预约将自动通过审批</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFormData({...formData, auto_approve: !formData.auto_approve})}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${formData.auto_approve ? 'bg-red-600' : 'bg-neutral-200'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.auto_approve ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-neutral-700">允许可预约时段外预约</h3>
                      <p className="text-xs text-neutral-500">开启后，用户可选择非开放时段，但需要管理员审批</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFormData({...formData, allow_out_of_hours: !formData.allow_out_of_hours})}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${formData.allow_out_of_hours ? 'bg-red-600' : 'bg-neutral-200'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.allow_out_of_hours ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">计费方式</label>
                  <select value={formData.price_type} onChange={e => setFormData({...formData, price_type: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all bg-white">
                    <option value="hour">按小时</option>
                    <option value="use">按次</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">价格 (¥)</label>
                  <input required type="number" min="0" step="0.01" value={formData.price} onChange={e => setFormData({...formData, price: Number(e.target.value)})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">耗材费 (¥, 可选)</label>
                <input type="number" min="0" step="0.01" value={formData.consumable_fee} onChange={e => setFormData({...formData, consumable_fee: Number(e.target.value)})} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" />
              </div>
            </div>

            <button type="submit" className="w-full py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors">
              {editingEquipment ? '更新仪器' : '保存仪器'}
            </button>
          </form>
        </div>
      )}

      {activeTab === 'equipment' && (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200">
                <tr>
                  <th className="px-6 py-4 font-medium">仪器名称</th>
                  <th className="px-6 py-4 font-medium">计费</th>
                  <th className="px-6 py-4 font-medium">白名单</th>
                  <th className="px-6 py-4 font-medium">自动审批</th>
                  <th className="px-6 py-4 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {equipmentList.map(eq => (
                  <tr key={eq.id} className="hover:bg-neutral-50/50">
                    <td className="px-6 py-4 font-medium">{eq.name}</td>
                    <td className="px-6 py-4">¥{eq.price}/{eq.price_type === 'hour' ? '小时' : '次'}</td>
                    <td className="px-6 py-4">
                      {eq.whitelist_enabled ? (
                        <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs">已开启</span>
                      ) : (
                        <span className="px-2 py-1 bg-neutral-100 text-neutral-500 rounded-full text-xs">未开启</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {eq.auto_approve ? (
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs">是</span>
                      ) : (
                        <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs">否</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button onClick={() => startEdit(eq)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Settings2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteEquipment(eq.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {equipmentList.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-neutral-500">暂无仪器记录</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'reservations' && (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200">
                <tr>
                  <th className="px-6 py-4 font-medium">预约码</th>
                  <th className="px-6 py-4 font-medium">仪器</th>
                  <th className="px-6 py-4 font-medium">用户</th>
                  <th className="px-6 py-4 font-medium">联系方式</th>
                  <th className="px-6 py-4 font-medium">时间</th>
                  <th className="px-6 py-4 font-medium">状态</th>
                  <th className="px-6 py-4 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {reservations.map(res => (
                  <tr key={res.id} className="hover:bg-neutral-50/50">
                    <td className="px-6 py-4 font-mono text-xs">{res.booking_code}</td>
                    <td className="px-6 py-4 font-medium text-neutral-900">{res.equipment_name}</td>
                    <td className="px-6 py-4">
                      <p className="font-medium text-neutral-900">{res.student_name}</p>
                      <p className="text-xs text-neutral-500">{res.supervisor}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs text-neutral-900">{res.phone}</p>
                      <p className="text-xs text-neutral-500">{res.email}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-neutral-900">{format(new Date(res.start_time), 'MM-dd HH:mm')}</p>
                      <p className="text-xs text-neutral-500">至 {format(new Date(res.end_time), 'HH:mm')}</p>
                    </td>
                    <td className="px-6 py-4">
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
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
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
                            className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
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
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="审批驳回"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      <button 
                        onClick={() => startEditReservation(res)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="修改预约"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setDeleteReservationConfirmId(res.id)}
                        className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="删除预约"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {editingReservation && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl p-8 max-w-lg w-full shadow-2xl">
                <h3 className="text-xl font-bold mb-6">修改预约信息</h3>
                <form onSubmit={handleUpdateReservation} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-neutral-500 mb-1">姓名</label>
                      <input type="text" value={editingReservation.student_name} onChange={e => setEditingReservation({...editingReservation, student_name: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-neutral-300" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-500 mb-1">学号</label>
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
                      {Object.entries(statusMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-4 mt-8">
                    <button type="button" onClick={() => setEditingReservation(null)} className="flex-1 py-3 border border-neutral-300 rounded-xl font-medium hover:bg-neutral-50">取消</button>
                    <button type="submit" className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700">保存修改</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'whitelist_apps' && (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200">
                <tr>
                  <th className="px-6 py-4 font-medium">仪器</th>
                  <th className="px-6 py-4 font-medium">申请人</th>
                  <th className="px-6 py-4 font-medium">导师</th>
                  <th className="px-6 py-4 font-medium">联系方式</th>
                  <th className="px-6 py-4 font-medium">状态</th>
                  <th className="px-6 py-4 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {whitelistApps.map(app => (
                  <tr key={app.id} className="hover:bg-neutral-50/50">
                    <td className="px-6 py-4 font-medium">{app.equipment_name}</td>
                    <td className="px-6 py-4">
                      <p className="font-medium">{app.student_name}</p>
                      <p className="text-xs text-neutral-500">{app.student_id}</p>
                    </td>
                    <td className="px-6 py-4">{app.supervisor}</td>
                    <td className="px-6 py-4">
                      <p>{app.phone}</p>
                      <p className="text-xs text-neutral-500">{app.email}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium
                        ${app.status === 'pending' ? 'bg-amber-100 text-amber-800' : ''}
                        ${app.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : ''}
                        ${app.status === 'rejected' ? 'bg-red-100 text-red-800' : ''}
                      `}>
                        {app.status === 'pending' ? '待处理' : app.status === 'approved' ? '已批准' : '已拒绝'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      {app.status === 'pending' && (
                        <>
                          <button onClick={() => handleApproveApp(app.id)} className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                            <Check className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleRejectApp(app.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {whitelistApps.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-neutral-500">暂无申请记录</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200 space-y-6">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">开始日期</label>
                <input type="date" value={reportStartDate} onChange={e => setReportStartDate(e.target.value)} className="px-4 py-2 rounded-xl border border-neutral-300 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">结束日期</label>
                <input type="date" value={reportEndDate} onChange={e => setReportEndDate(e.target.value)} className="px-4 py-2 rounded-xl border border-neutral-300 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">时间维度</label>
                <select 
                  value={reportPeriod} 
                  onChange={e => setReportPeriod(e.target.value)}
                  className="px-4 py-2 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all bg-white text-sm font-medium"
                >
                  <option value="day">按天</option>
                  <option value="week">按周</option>
                  <option value="month">按月</option>
                  <option value="quarter">按季度</option>
                  <option value="year">按年</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">图表类型</label>
                <div className="flex bg-neutral-100 p-1 rounded-xl">
                  <button onClick={() => setReportChartType('bar')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${reportChartType === 'bar' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-500'}`}>柱状图</button>
                  <button onClick={() => setReportChartType('line')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${reportChartType === 'line' ? 'bg-white text-red-600 shadow-sm' : 'text-neutral-500'}`}>折线图</button>
                </div>
              </div>
              <button 
                onClick={fetchReports}
                className="px-6 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors"
              >
                查询
              </button>
            </div>

            <div className="flex flex-wrap gap-4">
              <input 
                type="text" 
                value={reportFilterName}
                onChange={e => setReportFilterName(e.target.value)}
                placeholder="筛选用户姓名"
                className="px-4 py-2 rounded-xl border border-neutral-300 text-sm w-48"
              />
              <input 
                type="text" 
                value={reportFilterSupervisor}
                onChange={e => setReportFilterSupervisor(e.target.value)}
                placeholder="筛选导师姓名"
                className="px-4 py-2 rounded-xl border border-neutral-300 text-sm w-48"
              />
            </div>
          </div>

          {loadingReports ? (
            <div className="text-center py-12 text-neutral-500">加载报表中...</div>
          ) : reports ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Usage Duration Chart */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
                  <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-red-600" />
                    使用时长趋势 (小时)
                  </h3>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      {reportChartType === 'bar' ? (
                        <BarChart data={reports.usageByTime} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e5e5" />
                          <XAxis type="number" axisLine={false} tickLine={false} tick={{fill: '#737373', fontSize: 12}} />
                          <YAxis dataKey="period" type="category" axisLine={false} tickLine={false} tick={{fontSize: 12}} width={80} />
                          <Tooltip cursor={{fill: '#f5f5f5'}} />
                          <Bar dataKey="total_hours" name="时长" fill="#dc2626" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      ) : (
                        <LineChart data={reports.usageByTime}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                          <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{fill: '#737373', fontSize: 12}} />
                          <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                          <Tooltip />
                          <Line type="monotone" dataKey="total_hours" name="时长" stroke="#dc2626" strokeWidth={2} dot={{r: 4}} activeDot={{r: 6}} />
                        </LineChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Revenue Chart */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
                  <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-amber-600" />
                    收入趋势 (¥)
                  </h3>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      {reportChartType === 'bar' ? (
                        <BarChart data={reports.usageByTime} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e5e5" />
                          <XAxis type="number" axisLine={false} tickLine={false} tick={{fill: '#737373', fontSize: 12}} />
                          <YAxis dataKey="period" type="category" axisLine={false} tickLine={false} tick={{fontSize: 12}} width={80} />
                          <Tooltip cursor={{fill: '#f5f5f5'}} />
                          <Bar dataKey="total_revenue" name="收入" fill="#d97706" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      ) : (
                        <LineChart data={reports.usageByTime}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                          <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{fill: '#737373', fontSize: 12}} />
                          <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                          <Tooltip />
                          <Line type="monotone" dataKey="total_revenue" name="收入" stroke="#d97706" strokeWidth={2} dot={{r: 4}} activeDot={{r: 6}} />
                        </LineChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Data Table */}
              <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
                <div className="p-6 border-b border-neutral-100 flex items-center justify-between">
                  <h3 className="font-bold flex items-center gap-2">
                    <FileText className="w-5 h-5 text-red-600" />
                    详细预约记录
                  </h3>
                  <button 
                    onClick={exportDetailedReport}
                    className="p-2 border border-neutral-300 text-neutral-500 rounded-xl hover:bg-neutral-50 hover:text-red-600 transition-colors"
                    title="导出记录"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200">
                      <tr>
                        <th className="px-6 py-4 font-medium">用户/导师</th>
                        <th className="px-6 py-4 font-medium">仪器</th>
                        <th className="px-6 py-4 font-medium">预约时间</th>
                        <th className="px-6 py-4 font-medium">实际上机</th>
                        <th className="px-6 py-4 font-medium">时长/费用</th>
                        <th className="px-6 py-4 font-medium">状态</th>
                        <th className="px-6 py-4 font-medium text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {reports.allReservations.map((r: any) => {
                        const duration = r.actual_start_time && r.actual_end_time 
                          ? (new Date(r.actual_end_time).getTime() - new Date(r.actual_start_time).getTime()) / (1000 * 60 * 60)
                          : 0;
                        return (
                          <tr key={r.id} className="hover:bg-neutral-50/50">
                            <td className="px-6 py-4">
                              <p className="font-medium">{r.student_name}</p>
                              <p className="text-xs text-neutral-500">{r.supervisor}</p>
                            </td>
                            <td className="px-6 py-4">{r.equipment_name}</td>
                            <td className="px-6 py-4">
                              <p className="text-xs">{format(new Date(r.start_time), 'MM-dd HH:mm')}</p>
                              <p className="text-xs text-neutral-400">至 {format(new Date(r.end_time), 'HH:mm')}</p>
                            </td>
                            <td className="px-6 py-4">
                              {r.actual_start_time ? (
                                <>
                                  <p className="text-xs">{format(new Date(r.actual_start_time), 'MM-dd HH:mm')}</p>
                                  {r.actual_end_time && <p className="text-xs text-neutral-400">至 {format(new Date(r.actual_end_time), 'HH:mm')}</p>}
                                </>
                              ) : '-'}
                            </td>
                            <td className="px-6 py-4">
                              <p className="font-medium">{duration.toFixed(2)}h</p>
                              <p className="text-xs text-red-600">¥{(r.total_cost || 0).toFixed(2)}</p>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold
                                ${r.reportStatus === '正常' ? 'bg-emerald-100 text-emerald-700' : ''}
                                ${r.reportStatus === '迟到' ? 'bg-amber-100 text-amber-700' : ''}
                                ${r.reportStatus === '超时' ? 'bg-orange-100 text-orange-700' : ''}
                                ${r.reportStatus === '爽约' ? 'bg-red-100 text-red-700' : ''}
                                ${r.reportStatus === '待上机' ? 'bg-blue-100 text-blue-700' : ''}
                                ${r.reportStatus === '已取消' ? 'bg-neutral-100 text-neutral-500' : ''}
                              `}>
                                {r.reportStatus}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button 
                                onClick={() => {
                                  const toLocalISO = (utcStr: string) => {
                                    if (!utcStr) return '';
                                    const date = new Date(utcStr);
                                    const y = date.getFullYear();
                                    const m = String(date.getMonth() + 1).padStart(2, '0');
                                    const d = String(date.getDate()).padStart(2, '0');
                                    const h = String(date.getHours()).padStart(2, '0');
                                    const min = String(date.getMinutes()).padStart(2, '0');
                                    return `${y}-${m}-${d}T${h}:${min}`;
                                  };
                                  setEditingReportRecord({
                                    ...r,
                                    actual_start_time: toLocalISO(r.actual_start_time),
                                    actual_end_time: toLocalISO(r.actual_end_time),
                                  });
                                }}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="修改记录"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => setDeleteConfirmId(r.id)}
                                className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="删除记录"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {reports.allReservations.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-6 py-12 text-center text-neutral-500">此时间范围内暂无记录</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {editingReportRecord && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-2xl p-8 max-w-lg w-full shadow-2xl">
                    <h3 className="text-xl font-bold mb-6">修改实际上机记录</h3>
                    <form onSubmit={handleUpdateReportRecord} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                      <div className="flex gap-4 mt-8">
                        <button type="button" onClick={() => setEditingReportRecord(null)} className="flex-1 py-3 border border-neutral-300 rounded-xl font-medium hover:bg-neutral-50">取消</button>
                        <button type="submit" className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700">保存修改</button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Users Table */}
                <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
                  <div className="p-6 border-b border-neutral-100 flex items-center justify-between">
                    <h3 className="font-bold">用户排行</h3>
                    <button 
                      onClick={exportUserStats}
                      className="p-2 border border-neutral-300 text-neutral-500 rounded-xl hover:bg-neutral-50 hover:text-red-600 transition-colors"
                      title="导出用户"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200">
                        <tr>
                          <th className="px-6 py-4 font-medium">用户</th>
                          <th className="px-6 py-4 font-medium">总时长</th>
                          <th className="px-6 py-4 font-medium">总费用</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {reports.usageByPerson.map((u: any, i: number) => (
                          <tr key={i}>
                            <td className="px-6 py-4">
                              <p className="font-medium">{u.student_name}</p>
                              <p className="text-xs text-neutral-500">{u.supervisor}</p>
                            </td>
                            <td className="px-6 py-4">{u.total_hours.toFixed(1)}h</td>
                            <td className="px-6 py-4 font-bold">¥{u.total_revenue.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {/* Top Supervisors Table */}
                <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
                  <div className="p-6 border-b border-neutral-100 flex items-center justify-between">
                    <h3 className="font-bold">导师排行</h3>
                    <button 
                      onClick={exportSupervisorStats}
                      className="p-2 border border-neutral-300 text-neutral-500 rounded-xl hover:bg-neutral-50 hover:text-red-600 transition-colors"
                      title="导出导师"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200">
                        <tr>
                          <th className="px-6 py-4 font-medium">导师</th>
                          <th className="px-6 py-4 font-medium">总时长</th>
                          <th className="px-6 py-4 font-medium">总费用</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {reports.usageBySupervisor.map((s: any, i: number) => (
                          <tr key={i}>
                            <td className="px-6 py-4 font-medium">{s.supervisor}</td>
                            <td className="px-6 py-4">{s.total_hours.toFixed(1)}h</td>
                            <td className="px-6 py-4 font-bold">¥{s.total_revenue.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
      {activeTab === 'audit_logs' && (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          <div className="p-6 border-b border-neutral-100">
            <h3 className="font-bold flex items-center gap-2">
              <FileText className="w-5 h-5 text-red-600" />
              审计日志 (最近 100 条)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
                <tr>
                  <th className="px-6 py-4 font-medium">时间</th>
                  <th className="px-6 py-4 font-medium">预约 ID</th>
                  <th className="px-6 py-4 font-medium">操作</th>
                  <th className="px-6 py-4 font-medium">修改前</th>
                  <th className="px-6 py-4 font-medium">修改后</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {auditLogs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-neutral-50/50">
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-neutral-500">
                      {format(new Date(log.created_at + 'Z'), 'yyyy-MM-dd HH:mm:ss')}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs">{log.reservation_id}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-neutral-100 text-neutral-700 rounded-lg text-xs font-medium">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="max-h-24 overflow-y-auto w-64 text-xs font-mono text-neutral-500 bg-neutral-50 p-2 rounded border border-neutral-100">
                        {log.old_data ? JSON.stringify(JSON.parse(log.old_data), null, 2) : '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="max-h-24 overflow-y-auto w-64 text-xs font-mono text-neutral-500 bg-neutral-50 p-2 rounded border border-neutral-100">
                        {log.new_data ? JSON.stringify(JSON.parse(log.new_data), null, 2) : '-'}
                      </div>
                    </td>
                  </tr>
                ))}
                {auditLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-neutral-500">暂无审计日志</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

      {deleteReservationConfirmId !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl">
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
            </div>
            <h3 className="text-xl font-bold text-center mb-2">确认删除</h3>
            <p className="text-sm text-neutral-500 text-center mb-6">
              确定要删除该预约吗？此操作不可恢复。
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setDeleteReservationConfirmId(null)} 
                className="flex-1 py-2.5 border border-neutral-200 rounded-xl text-sm font-medium hover:bg-neutral-50 transition-colors"
              >
                取消
              </button>
              <button 
                onClick={() => handleDeleteReservation(deleteReservationConfirmId)} 
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors"
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
