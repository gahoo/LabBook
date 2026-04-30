import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { format, addDays, startOfToday, parseISO, addMinutes, isBefore, isAfter, startOfDay, endOfDay } from 'date-fns';
import { Calendar as CalendarIcon, Clock, CheckCircle2, ChevronRight, Info, MapPin, Lock, DollarSign, AlertCircle, X, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';
import { ViolationRecord, MyViolationsResponse } from '../types';
import { getViolationTypeLabel } from '../utils';

interface Equipment {
  id: number;
  name: string;
  description: string;
  image_url: string;
  location: string;
  price_type: string;
  price: number;
  consumable_fee: number;
  availability_json: string;
  whitelist_enabled: boolean;
}

interface Slot {
  start: string;
  end: string;
}

interface Reservation {
  start_time: string;
  end_time: string;
  student_name?: string;
  status: string;
}

export default function Booking() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [availableRanges, setAvailableRanges] = useState<Slot[]>([]);
  const [existingReservations, setExistingReservations] = useState<Reservation[]>([]);
  const [maxDuration, setMaxDuration] = useState(60);
  const [minDuration, setMinDuration] = useState(30);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [advanceDays, setAdvanceDays] = useState(7);
  const [allowOutOfHours, setAllowOutOfHours] = useState(false);
  
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [selectionStep, setSelectionStep] = useState<0 | 1 | 2>(0);

  const [formData, setFormData] = useState({
    student_id: '',
    student_name: '',
    supervisor: '',
    phone: '',
    email: ''
  });

  const [bookingCode, setBookingCode] = useState<string | null>(null);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);
  const [bookingCodeDelivery, setBookingCodeDelivery] = useState<any>(null);
  const [successStructuredPenalty, setSuccessStructuredPenalty] = useState<any>(null);
  const [webhookAlias, setWebhookAlias] = useState<string>('Webhook');
  const [needsWhitelist, setNeedsWhitelist] = useState(false);
  const [applyingWhitelist, setApplyingWhitelist] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [showBannedModal, setShowBannedModal] = useState(false);
  const [bannedViolations, setBannedViolations] = useState<ViolationRecord[]>([]);
  const [bannedErrorMsg, setBannedErrorMsg] = useState('');
  const [structuredPenalty, setStructuredPenalty] = useState<any>(null);
  const [appealingId, setAppealingId] = useState<number | null>(null);
  const [appealReason, setAppealReason] = useState('');

  const filteredRules = useMemo(() => {
    if (!structuredPenalty || !structuredPenalty.triggered_rules) return [];
    const rules = structuredPenalty.triggered_rules;
    
    // Group by violation_types and penalty_method
    const groups: Record<string, any[]> = {};
    for (const rule of rules) {
      const typesKey = (rule.violation_types || []).slice().sort().join(',');
      const methodKey = rule.penalty_method || 'UNKNOWN';
      const key = `${typesKey}_${methodKey}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(rule);
    }

    // Select the most severe from each group
    const filtered: any[] = [];
    Object.values(groups).forEach(group => {
      // Sort by descending duration_days
      group.sort((a, b) => (b.duration_days || 0) - (a.duration_days || 0));
      filtered.push(group[0]);
    });

    return filtered;
  }, [structuredPenalty]);

  useEffect(() => {
    fetch('/api/equipment')
      .then(res => res.json())
      .then(data => {
        const eq = data.find((e: any) => e.id === Number(id));
        if (eq) {
          if (eq.is_hidden) {
            toast.error('该仪器暂不开放预约');
            navigate('/');
            return;
          }
          setEquipment(eq);
          try {
            const avail = JSON.parse(eq.availability_json);
            setAdvanceDays(avail.advanceDays || 7);
            setAllowOutOfHours(avail.allowOutOfHours || false);
          } catch (e) {}
        }
      });

    const cookieValue = document.cookie
      .split('; ')
      .find(row => row.startsWith('lab_user_info='))
      ?.split('=')[1];
      
    if (cookieValue) {
      try {
        const decoded = JSON.parse(decodeURIComponent(cookieValue));
        setFormData(decoded);
      } catch (e) {
        console.error('Failed to parse cookie', e);
      }
    }

    const queryParams = new URLSearchParams(location.search);
    const timeParam = queryParams.get('time');
    if (timeParam) {
      handleStartTimeChange(timeParam);
    }
  }, [id, location.search]);

  useEffect(() => {
    if (!id || !selectedDate) return;
    setLoadingSlots(true);
    fetch(`/api/equipment/${id}/availability?date=${format(selectedDate, 'yyyy-MM-dd')}`)
      .then(res => res.json())
      .then(data => {
        setAvailableRanges(data.availableSlots || []);
        setExistingReservations(data.reservations || []);
        setMaxDuration(data.maxDurationMinutes || 60);
        setMinDuration(data.minDurationMinutes || 30);
        setLoadingSlots(false);
      });
  }, [id, selectedDate]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleStartTimeChange = (val: string) => {
    setStartTime(val);
    if (val) {
      const [h, m] = val.split(':').map(Number);
      const start = new Date();
      start.setHours(h, m, 0, 0);
      const end = addMinutes(start, maxDuration);
      setEndTime(format(end, 'HH:mm'));
      setSelectionStep(2);
    }
  };

  const handleTimeGridClick = (date: Date, time: string) => {
    const isDifferentDate = format(date, 'yyyy-MM-dd') !== format(selectedDate, 'yyyy-MM-dd');
    
    setSelectedDate(date);
    
    if (selectionStep === 0 || selectionStep === 2 || isDifferentDate) {
      setStartTime(time);
      const [h, m] = time.split(':').map(Number);
      const start = new Date();
      start.setHours(h, m, 0, 0);
      const end = addMinutes(start, 30);
      setEndTime(format(end, 'HH:mm'));
      setSelectionStep(1);
    } else if (selectionStep === 1) {
      const [h1, m1] = startTime.split(':').map(Number);
      const [h2, m2] = time.split(':').map(Number);
      const start = new Date();
      start.setHours(h1, m1, 0, 0);
      const clickedTime = new Date();
      clickedTime.setHours(h2, m2, 0, 0);
      
      if (clickedTime <= start) {
        setStartTime(time);
        const end = addMinutes(clickedTime, 30);
        setEndTime(format(end, 'HH:mm'));
        setSelectionStep(1);
      } else {
        const end = addMinutes(clickedTime, 30);
        setEndTime(format(end, 'HH:mm'));
        setSelectionStep(2);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startTime || !endTime) return toast.error('请选择预约时间');

    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const start = new Date(`${dateStr}T${startTime}`);
    const end = new Date(`${dateStr}T${endTime}`);

    if (isBefore(end, start)) return toast.error('结束时间必须晚于开始时间');
    
    const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    if (durationMinutes > maxDuration) return toast.error(`预约时长不能超过 ${maxDuration} 分钟`);
    if (durationMinutes < minDuration) return toast.error(`预约时长不能少于 ${minDuration} 分钟`);

    // Check if within available ranges
    const inRange = availableRanges.some(range => {
      const rStart = new Date(range.start);
      const rEnd = new Date(range.end);
      return (start >= rStart && end <= rEnd);
    });
    if (!inRange && !allowOutOfHours) return toast.error('所选时间不在仪器开放范围内');

    // Check conflicts
    const conflict = existingReservations.some(res => {
      const rStart = new Date(res.start_time);
      const rEnd = new Date(res.end_time);
      return (start < rEnd && end > rStart);
    });
    if (conflict) return toast.error('所选时间段已有其他预约');

    // Safe cookie storage for non-Latin1 characters
    const encoded = encodeURIComponent(JSON.stringify(formData));
    document.cookie = `lab_user_info=${encoded}; max-age=31536000; path=/`;

    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_id: id,
          ...formData,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          tz_offset: new Date().getTimezoneOffset()
        })
      });

      let data;
      try {
        data = await res.json();
      } catch (e) {
        throw new Error('服务器响应格式错误');
      }

      if (!res.ok) {
        if (data.needs_whitelist_application) {
          setNeedsWhitelist(true);
          throw new Error('您不在白名单中，请先申请使用权限');
        }
        if (res.status === 403 && data.structured_penalty) {
          setBannedErrorMsg(`${formData.student_name}（学号：${formData.student_id}）${data.error}`);
          const penalty = { ...data.structured_penalty, student_name: formData.student_name };
          setStructuredPenalty(penalty);
          setBannedViolations(penalty.violation_records || []);
          setShowBannedModal(true);
          return;
        } else if (res.status === 403 && data.error && data.error.includes('因触发')) {
          setBannedErrorMsg(`${formData.student_name}（学号：${formData.student_id}）${data.error}`);
          const vRes = await fetch('/api/violations/my', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              student_id: formData.student_id, 
              student_name: formData.student_name,
              violation_ids: data.violation_ids || []
            })
          });
          if (vRes.ok) {
            const vData = await vRes.json() as MyViolationsResponse;
            setBannedViolations(vData.violations);
          }
          setShowBannedModal(true);
          return;
        }
        throw new Error(data.error || '预约请求失败');
      }

      setBookingCode(data.booking_code);
      setBookingStatus(data.status);
      setBookingCodeDelivery(data.booking_code_delivery);
      setSuccessStructuredPenalty(data.structured_penalty);
      if (data.webhook_alias) {
          setWebhookAlias(data.webhook_alias);
      }
      if (data.message) {
        toast(data.message, { icon: '⚠️', duration: 5000 });
      }
      
      // Save booking code to cookies
      if (data.booking_code) {
        const existingCodes = document.cookie
          .split('; ')
          .find(row => row.startsWith('lab_booking_codes='))
          ?.split('=')[1] || '';
        const newCodes = existingCodes ? `${existingCodes},${data.booking_code}` : data.booking_code;
        document.cookie = `lab_booking_codes=${newCodes}; max-age=31536000; path=/`;
      }
    } catch (err: any) {
      console.error('Reservation error:', err);
      toast.error(err.message || '预约失败，请重试');
    }
  };

  const handleApplyWhitelist = async (e: React.FormEvent) => {
    e.preventDefault();
    setApplyingWhitelist(true);
    try {
      const res = await fetch('/api/whitelist/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_id: id,
          ...formData
        })
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('申请已提交，请等待管理员审核');
        setNeedsWhitelist(false);
      } else {
        toast.error(data.error || '申请失败');
      }
    } catch (err) {
      toast.error('申请失败');
    } finally {
      setApplyingWhitelist(false);
    }
  };

  const daysMap: Record<string, string> = {
    Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六', Sun: '周日'
  };

  const [allAvailability, setAllAvailability] = useState<any[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);

  useEffect(() => {
    if (!id || !equipment) return;
    setLoadingAll(true);
    const fetchAll = async () => {
      const dates = Array.from({ length: advanceDays + 1 }).map((_, i) => format(addDays(startOfToday(), i), 'yyyy-MM-dd'));
      const results = await Promise.all(dates.map(d => fetch(`/api/equipment/${id}/availability?date=${d}`).then(r => r.json())));
      setAllAvailability(results.map((r, i) => ({ date: dates[i], ...r })));
      setLoadingAll(false);
    };
    fetchAll();
  }, [id, equipment, advanceDays]);

  // Transform allAvailability into a format for a multi-day heat-map grid
  // X-axis: Time (08:00 to 22:00, 30min steps)
  const timeSteps = Array.from({ length: (22 - 8) * 2 }).map((_, i) => {
    const h = 8 + Math.floor(i / 2);
    const m = (i % 2) * 30;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  });

  const gridData = allAvailability.map(dayData => {
    const dateStr = dayData.date;
    const slots = dayData.availableSlots || [];
    const resvs = dayData.reservations || [];
    
    return {
      date: dateStr,
      times: timeSteps.map(t => {
        const timeDate = new Date(`${dateStr}T${t}`);
        const isAvailable = slots.some((s: any) => {
          const start = new Date(s.start);
          const end = new Date(s.end);
          return timeDate >= start && timeDate < end;
        });
        const isBooked = resvs.some((r: any) => {
          const start = new Date(r.start_time);
          const end = new Date(r.end_time);
          return timeDate >= start && timeDate < end;
        });
        return { time: t, isAvailable, isBooked };
      })
    };
  });

  if (bookingStatus) {
    const isApproved = bookingStatus === 'approved';
    const showCodeOnWeb = bookingCodeDelivery?.web === 'true' || bookingCodeDelivery?.web === true || bookingCodeDelivery?.web === undefined;
    const deliverEmail = bookingCodeDelivery?.email === 'true';
    const deliverWebhook = bookingCodeDelivery?.webhook === 'true';

    return (
      <div className="max-w-md mx-auto mt-12 bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 text-center">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 ${isApproved ? 'bg-emerald-100' : 'bg-amber-100'}`}>
          <CheckCircle2 className={`w-8 h-8 ${isApproved ? 'text-emerald-600' : 'text-amber-600'}`} />
        </div>
        <h2 className="text-2xl font-bold text-neutral-900 mb-2">{isApproved ? '预约成功！' : '预约已提交！'}</h2>
        <div className="mb-8 p-4 rounded-xl bg-neutral-50 border border-neutral-100">
          <p className="text-neutral-500 mb-2">您的预约状态为</p>
          <p className={`text-4xl font-black ${isApproved ? 'text-emerald-600' : 'text-amber-500'}`}>
            {isApproved ? '已通过' : '待审批'}
          </p>
        </div>
        
        {successStructuredPenalty?.restrictions?.fee_multiplier > 1.0 && (
          <div className="bg-orange-50 rounded-xl p-5 mb-8 border border-orange-200 text-left">
            <h3 className="text-sm font-bold text-orange-800 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
              惩罚性费率提醒
            </h3>
            <p className="text-sm text-orange-700 leading-relaxed">
              由于您存在的
              <button type="button" onClick={() => navigate('/violations')} className="underline font-bold text-orange-800 hover:text-orange-900 mx-1">
                违规记录
              </button>
              ，此笔预约及后续预订将受到惩罚性计费处理。
              当前计费倍率为 <strong className="text-lg text-orange-900 mx-1">{successStructuredPenalty.restrictions.fee_multiplier} 倍</strong>。
            </p>
          </div>
        )}

        <div className="bg-neutral-50 rounded-xl p-6 mb-8 border border-neutral-200">
          <p className="text-sm text-neutral-500 mb-2 uppercase tracking-wider font-semibold">您的预约码</p>
          {showCodeOnWeb ? (
            <p className="text-4xl font-mono font-bold text-red-600 tracking-widest">{bookingCode}</p>
          ) : (
            <p className="text-lg font-medium text-neutral-800">
              预约码已通过 {deliverEmail && 'Email'} {deliverEmail && deliverWebhook && ' 及 '} {deliverWebhook && webhookAlias} 发送
            </p>
          )}
          <p className="text-xs text-neutral-400 mt-4">
            {showCodeOnWeb 
              ? '请妥善保存此预约码！您需要使用它进行上机、下机或取消预约。'
              : '为了保护您的预约安全，预约码不再在网页中直接显示。请前往对应渠道查看您的预约码。请妥善保存预约码，您需要使用它进行上机、下机或取消预约。'}
          </p>
        </div>

        <div className="bg-amber-50 rounded-xl p-4 mb-8 border border-amber-200 text-left">
          <h3 className="text-sm font-bold text-amber-800 mb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            履约提醒
          </h3>
          <ul className="text-xs text-amber-700 space-y-1.5 list-disc list-inside">
            <li>请务必于预约时间前到达。迟到或超时使用将产生违规记录。</li>
            <li>如需取消，请提前操作。临期取消或爽约将导致账号受限。</li>
            <li>累计多次违规，系统将自动封禁账号或限制预约权限。</li>
          </ul>
        </div>

        <button 
          onClick={() => navigate('/my-reservations')}
          className="w-full py-3 bg-neutral-900 text-white rounded-xl font-medium hover:bg-neutral-800 transition-colors"
        >
          前往我的预约
        </button>
      </div>
    );
  }

  const submitAppeal = async (violationId: number) => {
    if (!appealReason.trim()) return toast.error('请输入申诉理由');
    try {
      const res = await fetch(`/api/violations/${violationId}/appeal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: formData.student_id,
          student_name: formData.student_name,
          appeal_reason: appealReason
        })
      });
      if (res.ok) {
        toast.success('申诉已提交');
        setAppealingId(null);
        setAppealReason('');
        const vRes = await fetch('/api/violations/my', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            student_id: formData.student_id, 
            student_name: formData.student_name,
            violation_ids: bannedViolations.map(v => v.id)
          })
        });
        if (vRes.ok) {
          const vData = await vRes.json() as MyViolationsResponse;
          setBannedViolations(vData.violations);
        }
      } else {
        const err = await res.json();
        toast.error(err.error || '提交失败');
      }
    } catch (err) {
      toast.error('提交失败');
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Drawer Overlay */}
      <div 
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${showBannedModal ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setShowBannedModal(false)}
      />
      {/* Drawer Panel */}
      <div 
        className={`fixed top-0 right-0 h-full w-full sm:w-[500px] md:w-[600px] lg:w-[768px] bg-white z-50 shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out overflow-hidden ${showBannedModal ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between p-5 border-b border-neutral-100 bg-red-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-red-900">
                {structuredPenalty?.restrictions?.reduce_days > 0 && structuredPenalty?.penalty_method !== 'BAN' ? '账号受限，提前预约天数被限制' : '账号受限，预约失败'}
              </h3>
              <p className="text-sm text-red-700 mt-0.5">{bannedErrorMsg}</p>
            </div>
          </div>
          <button onClick={() => setShowBannedModal(false)} className="p-2 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-5 overflow-y-auto flex-1 bg-neutral-50/50">
          {structuredPenalty && (
                  <>
                    <div className="grid grid-cols-2 gap-3 mb-6">
                      <div className="bg-white p-4 rounded-xl border border-neutral-200">
                        <div className="text-xs text-neutral-500 mb-1">预约人</div>
                        <div className="font-medium">{structuredPenalty.student_name} ({structuredPenalty.student_id})</div>
                      </div>
                      <div className="bg-white p-4 rounded-xl border border-neutral-200">
                        <div className="text-xs text-neutral-500 mb-1">解封时间</div>
                        <div className="font-medium text-red-600">
                          {structuredPenalty.unban_time ? format(new Date(structuredPenalty.unban_time), 'yyyy-MM-dd HH:mm') : '未知 / 动态评估'}
                        </div>
                      </div>
                    </div>

                    <h4 className="text-sm font-bold text-neutral-900 mb-3">限制原因</h4>
                    <div className="space-y-3 mb-6">
                      {filteredRules.map((rule, idx) => (
                        <div key={idx} className="bg-white p-3 rounded-lg border border-red-100 flex items-center justify-between shadow-sm">
                          <span className="font-medium text-neutral-800 text-sm">{rule.rule_name}</span>
                          <span className="text-xs font-bold px-2 py-1 bg-red-50 text-red-700 rounded-md">
                            {rule.penalty_method === 'BAN' ? (rule.duration_days ? `封禁 ${rule.duration_days} 天` : '封禁') : (rule.penalty_method === 'REQUIRE_APPROVAL' ? '转为需审批' : '使用受限')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <h4 className="text-sm font-bold text-neutral-900 mb-4">触发违规记录</h4>
                <div className="space-y-4">
                  {bannedViolations.length === 0 ? (
                    <p className="text-sm text-neutral-500 text-center py-8">暂无违规记录</p>
                  ) : (
                    bannedViolations.map(v => {
                      let remarkObj: any = {};
                      try {
                        remarkObj = v.remark ? JSON.parse(v.remark) : {};
                      } catch (e) {
                        remarkObj = { admin_note: v.remark };
                      }
                      
                      const isAppealing = v.status === 'active' && remarkObj.appeal_reason && !remarkObj.appeal_reply;
                      const isRejected = v.status === 'active' && remarkObj.appeal_reason && remarkObj.appeal_reply;
                      const isApproved = v.status === 'revoked';

                      return (
                        <div key={v.id} className="bg-white border border-neutral-200 rounded-xl p-4 shadow-sm">
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700 border border-red-100 mb-2">
                                {getViolationTypeLabel(v.violation_type)}
                              </span>
                              <div className="text-sm font-medium text-neutral-900">{format(new Date(v.violation_time), 'yyyy-MM-dd HH:mm')}</div>
                              <div className="text-xs text-neutral-500 mt-1">关联仪器：{v.equipment_name}</div>
                              {v.booking_code && <div className="text-xs text-neutral-500 mt-0.5">预约码：{v.booking_code}</div>}
                            </div>
                            
                            <div className="flex flex-col items-end gap-2">
                              <div className="flex flex-col items-end gap-1.5">
                                {isApproved ? (
                                  <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded">已撤销</span>
                                ) : (
                                  <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-1 rounded">生效中</span>
                                )}
                                {isRejected && (
                                  <span className="text-[10px] font-medium text-red-700 bg-red-50 px-1.5 py-0.5 rounded-md border border-red-100">申诉已驳回</span>
                                )}
                                {isAppealing && (
                                  <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-100">申诉处理中</span>
                                )}
                              </div>
                              {!isApproved && !isRejected && !isAppealing && (
                                <button
                                  onClick={() => setAppealingId(appealingId === v.id ? null : v.id)}
                                  className="text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                                >
                                  我要申诉
                                </button>
                              )}
                            </div>
                          </div>

                          {remarkObj.admin_note && (
                            <div className="text-xs text-neutral-600 bg-neutral-50 p-2 rounded mt-2">
                              <span className="font-medium">管理员备注：</span>{remarkObj.admin_note}
                            </div>
                          )}

                          {remarkObj.appeal_reason && (
                            <div className="text-xs text-blue-700 bg-blue-50/50 p-2 rounded mt-2">
                              <span className="font-medium">您的申诉：</span>{remarkObj.appeal_reason}
                            </div>
                          )}

                          {remarkObj.appeal_reply && (
                            <div className="text-xs text-purple-700 bg-purple-50/50 p-2 rounded mt-2">
                              <span className="font-medium">处理回复：</span>{remarkObj.appeal_reply}
                            </div>
                          )}

                          {appealingId === v.id && !isAppealing && !isRejected && !isApproved && (
                            <div className="mt-4 pt-4 border-t border-neutral-100">
                              <textarea
                                value={appealReason}
                                onChange={(e) => setAppealReason(e.target.value)}
                                placeholder="请详细说明您的申诉理由（如：仪器故障、特殊情况等）..."
                                className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none h-20 mb-2"
                              />
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => setAppealingId(null)}
                                  className="px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 rounded-lg transition-colors"
                                >
                                  取消
                                </button>
                                <button
                                  onClick={() => submitAppeal(v.id)}
                                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                                >
                                  提交申诉
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              
              <div className="p-4 border-t border-neutral-100 bg-white flex justify-end gap-3 shrink-0">
                <button 
                  onClick={() => setShowBannedModal(false)}
                  className="px-4 py-2 text-sm rounded-lg text-neutral-600 font-medium hover:bg-neutral-100 transition-colors"
                >
                  关闭
                </button>
                <button
                  onClick={() => navigate('/violations')}
                  className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors shadow-sm"
                >
                  查询完整记录
                </button>
              </div>
      </div>

      <div className="mb-8 flex flex-col md:flex-row gap-6 items-start">
        {equipment?.image_url && (
          <img 
            src={equipment.image_url} 
            alt={equipment.name} 
            className="w-full md:w-48 h-32 object-cover rounded-2xl shadow-sm border border-neutral-200"
            referrerPolicy="no-referrer"
          />
        )}
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">预约仪器</h1>
          {equipment && (
            <div className="mt-2 space-y-1">
              <p className="text-lg font-medium text-neutral-700">{equipment.name}</p>
              <div className="flex flex-col gap-2 text-sm text-neutral-500">
                <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {equipment.location || '未知地点'}</span>
                <span className="flex items-center gap-1">
                  <DollarSign className="w-4 h-4" /> 
                  ¥{equipment.price}/{equipment.price_type === 'hour' ? '小时' : '次'}
                  {equipment.consumable_fee > 0 && ` + ¥${equipment.consumable_fee}/个 耗材费`}
                </span>
                <div className="flex items-start gap-1 cursor-pointer" onClick={() => setShowFullDesc(!showFullDesc)}>
                  <Info className="w-4 h-4 mt-0.5 shrink-0" /> 
                  <div className={`whitespace-pre-wrap ${!showFullDesc ? 'hidden md:line-clamp-2' : ''}`}>
                    {equipment.description}
                  </div>
                  {!showFullDesc && <span className="text-red-600 text-xs mt-0.5 md:hidden">点击查看详情</span>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3 space-y-6">
          {needsWhitelist ? (
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                  <Lock className="w-5 h-5 text-amber-600" />
                </div>
                <h3 className="text-xl font-bold">申请使用权限</h3>
              </div>
              <p className="text-neutral-600 mb-8">此仪器已开启白名单限制，您需要提交申请并获得管理员批准后方可预约使用。</p>
              
              <form onSubmit={handleApplyWhitelist} className="space-y-6 max-w-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">姓名</label>
                    <input required type="text" name="student_name" value={formData.student_name} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">学号/工号</label>
                    <input required type="text" name="student_id" value={formData.student_id} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">电话</label>
                    <input required type="tel" name="phone" value={formData.phone} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">邮箱</label>
                    <input required type="email" name="email" value={formData.email} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">导师姓名</label>
                  <input required type="text" name="supervisor" value={formData.supervisor} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300" />
                </div>
                <div className="flex gap-4">
                  <button type="button" onClick={() => setNeedsWhitelist(false)} className="flex-1 py-3 border border-neutral-300 rounded-xl font-medium">取消</button>
                  <button type="submit" disabled={applyingWhitelist} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium disabled:opacity-50">
                    {applyingWhitelist ? '提交中...' : '提交申请'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <>
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
                <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                  <CalendarIcon className="w-5 h-5 text-red-600" />
                  全周期预约概览 (X轴: 时间, Y轴: 日期)
                </h3>
            
            {loadingAll ? (
              <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div></div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[800px]">
                  {/* Time Header */}
                  <div className="flex border-b border-neutral-100 pb-2 mb-2">
                    <div className="w-24 shrink-0"></div>
                    <div className="flex-1 flex justify-between px-2 text-[10px] text-neutral-400 font-mono">
                      {timeSteps.filter((_, i) => i % 2 === 0).map(t => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                  </div>
                  
                  {/* Date Rows */}
                  <div className="space-y-1">
                    {gridData.map((row, idx) => {
                      const date = parseISO(row.date);
                      const isSelected = format(date, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
                      const dayStr = format(date, 'EEE');
                      
                      return (
                        <div key={idx} className="flex items-center group">
                              <button 
                                onClick={() => setSelectedDate(date)}
                                className={clsx(
                                  "w-24 shrink-0 text-left px-2 py-1 rounded-lg transition-colors cursor-pointer",
                                  isSelected ? "bg-red-600 text-white" : "hover:bg-neutral-50"
                                )}
                              >
                                <p className="text-[10px] font-bold uppercase opacity-70">{daysMap[dayStr] || dayStr}</p>
                                <p className="text-xs font-bold">{format(date, 'MM-dd')}</p>
                              </button>
                              
                              <div className="flex-1 flex bg-neutral-50 rounded-md overflow-hidden p-0.5">
                                {row.times.map((t, i) => {
                                  const timeDate = new Date(`${row.date}T${t.time}`);
                                  const isPast = timeDate < new Date();
                                  
                                  let isSelectedBlock = false;
                                  let isFirstSelected = false;
                                  let isLastSelected = false;
                                  let isNextSelected = false;

                                  if (isSelected && startTime && endTime) {
                                    const blockStart = new Date(`${row.date}T${t.time}`);
                                    const selStart = new Date(`${row.date}T${startTime}`);
                                    const selEnd = new Date(`${row.date}T${endTime}`);
                                    
                                    if (blockStart >= selStart && blockStart < selEnd) {
                                      isSelectedBlock = true;
                                      if (blockStart.getTime() === selStart.getTime()) {
                                        isFirstSelected = true;
                                      }
                                      const blockEnd = addMinutes(blockStart, 30);
                                      if (blockEnd.getTime() === selEnd.getTime()) {
                                        isLastSelected = true;
                                      }
                                    }

                                    if (i < row.times.length - 1) {
                                      const nextBlockStart = new Date(`${row.date}T${row.times[i+1].time}`);
                                      if (nextBlockStart >= selStart && nextBlockStart < selEnd) {
                                        isNextSelected = true;
                                      }
                                    }
                                  }

                                  const showRightGap = i !== row.times.length - 1 && !isSelectedBlock && !isNextSelected;

                                  let bgColor = "bg-neutral-200";
                                  if (t.isBooked) {
                                    bgColor = "bg-red-500";
                                  } else if (t.isAvailable && !isPast) {
                                    bgColor = isSelectedBlock ? "bg-emerald-400" : "bg-emerald-500";
                                  }

                                  return (
                                    <div 
                                      key={i}
                                      title={`${row.date} ${t.time}`}
                                      className={clsx(
                                        "flex-1 aspect-square transition-all",
                                        bgColor,
                                        !t.isBooked && t.isAvailable && !isPast && "hover:opacity-80 cursor-pointer",
                                        showRightGap && "border-r border-neutral-50",
                                        isSelectedBlock && "relative",
                                        isSelectedBlock && isFirstSelected && isLastSelected ? "shadow-[0_0_0_2px_#047857] rounded-sm" :
                                        isSelectedBlock && isFirstSelected ? "shadow-[0_2px_0_#047857,0_-2px_0_#047857,-2px_0_0_#047857] rounded-l-sm" :
                                        isSelectedBlock && isLastSelected ? "shadow-[0_2px_0_#047857,0_-2px_0_#047857,2px_0_0_#047857] rounded-r-sm" :
                                        isSelectedBlock ? "shadow-[0_2px_0_#047857,0_-2px_0_#047857]" : ""
                                      )}
                                      onClick={() => {
                                        if (!t.isBooked && !isPast && t.isAvailable) {
                                          handleTimeGridClick(date, t.time);
                                        }
                                      }}
                                    />
                                  );
                                })}
                              </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-6 mt-6 text-xs text-neutral-500 justify-center border-t border-neutral-50 pt-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-emerald-500 rounded-sm"></div>
                <span>可预约 (点击色块快速选择)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500 rounded-sm"></div>
                <span>已被预约</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-neutral-200 rounded-sm"></div>
                <span>未开放</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5 text-red-600" />
                设置预约时间
              </h3>
              <input 
                type="date" 
                value={format(selectedDate, 'yyyy-MM-dd')}
                onChange={(e) => {
                  if (e.target.value) {
                    setSelectedDate(parseISO(e.target.value));
                  }
                }}
                className="px-3 py-1.5 rounded-lg border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none text-sm font-medium cursor-pointer"
              />
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">开始时间</label>
                <input 
                  type="time" 
                  step="300"
                  value={startTime} 
                  onChange={e => handleStartTimeChange(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all font-mono text-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">结束时间</label>
                <input 
                  type="time" 
                  step="300"
                  value={endTime} 
                  onChange={e => setEndTime(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all font-mono text-lg"
                />
              </div>
            </div>
            <div className="mt-6 p-4 bg-red-50 rounded-2xl border border-red-100 flex items-start gap-3">
              <Info className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="text-xs text-red-800 space-y-1.5">
                <p>• 最小预约时长：<span className="font-bold">{minDuration} 分钟</span></p>
                <p>• 最大预约时长：<span className="font-bold">{maxDuration} 分钟</span></p>
                <p>• 步进单位：<span className="font-bold">5 分钟</span></p>
              </div>
            </div>
            </div>
          </>
        )}
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200 h-fit sticky top-8">
          <h3 className="text-lg font-semibold mb-6">您的信息</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">姓名</label>
              <input required type="text" name="student_name" value={formData.student_name} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" placeholder="张三" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">学号/工号</label>
              <input required type="text" name="student_id" value={formData.student_id} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" placeholder="20230001" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">导师</label>
              <input required type="text" name="supervisor" value={formData.supervisor} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" placeholder="李四教授" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">电话号码</label>
              <input required type="tel" name="phone" value={formData.phone} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" placeholder="13800138000" />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">邮箱</label>
              <input required type="email" name="email" value={formData.email} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" placeholder="zhangsan@university.edu" />
            </div>

            <div className="pt-6">
              <button 
                type="submit" 
                disabled={!startTime || !endTime}
                className="w-full flex items-center justify-center gap-2 py-4 px-4 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg hover:shadow-red-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                确认预约
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
