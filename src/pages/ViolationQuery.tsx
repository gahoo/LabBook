import React, { useState, useEffect } from 'react';
import { AlertTriangle, Search, X } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { ViolationRecord, UserPenaltyDetails, MyViolationsResponse } from '../types';

export default function ViolationQuery() {
  const [studentId, setStudentId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [violations, setViolations] = useState<ViolationRecord[]>([]);
  const [penaltyDetails, setPenaltyDetails] = useState<UserPenaltyDetails | null>(null);
  const [highlightRuleId, setHighlightRuleId] = useState<number | null>(null);
  const [highlightRecordIds, setHighlightRecordIds] = useState<number[]>([]);

  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [appealingId, setAppealingId] = useState<number | null>(null);
  const [appealReason, setAppealReason] = useState('');
  const [rules, setRules] = useState<any[]>([]);

  useEffect(() => {
    // Fetch active rules
    fetch('/api/public/penalty-rules')
      .then(res => res.json())
      .then(data => setRules(data))
      .catch(err => console.error('Failed to fetch rules', err));

    // Auto-fill from cookie and search
    const cookies = document.cookie.split(';');
    let savedId = '';
    let savedName = '';
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'lab_user_info' && value) {
        try {
          const info = JSON.parse(decodeURIComponent(value));
          if (info.student_id) savedId = info.student_id;
          if (info.student_name) savedName = info.student_name;
        } catch (e) {}
      }
    }

    if (savedId && savedName) {
      setStudentId(savedId);
      setStudentName(savedName);
      handleSearchWithParams(savedId, savedName);
    }
  }, []);

  const handleSearchWithParams = async (id: string, name: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/violations/my', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: id, student_name: name })
      });
      if (res.ok) {
        const data = await res.json() as MyViolationsResponse;
        setViolations(data.violations);
        setPenaltyDetails(data.userPenaltyDetails);
        setHasSearched(true);
      } else {
        toast.error('查询失败');
      }
    } catch (err) {
      toast.error('查询失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId || !studentName) return toast.error('请输入学号和姓名');
    handleSearchWithParams(studentId, studentName);
  };

  const submitAppeal = async (violationId: number) => {
    if (!appealReason.trim()) return toast.error('请输入申诉理由');
    try {
      const res = await fetch(`/api/violations/${violationId}/appeal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          student_name: studentName,
          appeal_reason: appealReason
        })
      });
      if (res.ok) {
        toast.success('申诉已提交');
        setAppealingId(null);
        setAppealReason('');
        // Refresh
        handleSearch({ preventDefault: () => {} } as any);
      } else {
        const err = await res.json();
        toast.error(err.error || '提交失败');
      }
    } catch (err) {
      toast.error('提交失败');
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold tracking-tight text-neutral-900 mb-8">违规与申诉查询</h1>
      
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200 mb-8">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-neutral-700 mb-1">学号/工号</label>
            <input 
              required 
              type="text" 
              value={studentId} 
              onChange={e => setStudentId(e.target.value)} 
              className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" 
              placeholder="请输入学号" 
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-neutral-700 mb-1">姓名</label>
            <input 
              required 
              type="text" 
              value={studentName} 
              onChange={e => setStudentName(e.target.value)} 
              className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-red-600 focus:border-transparent outline-none transition-all" 
              placeholder="请输入姓名" 
            />
          </div>
          <div className="flex items-end">
            <button 
              type="submit" 
              disabled={loading}
              className="w-full sm:w-auto px-6 py-2.5 bg-neutral-900 text-white rounded-xl font-medium hover:bg-neutral-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Search className="w-4 h-4" />
              查询
            </button>
          </div>
        </form>
      </div>

      {hasSearched && (
        <div className="space-y-4 mb-8">
          <h2 className="text-lg font-bold text-neutral-900 mb-4">查询结果</h2>
          {violations.length === 0 ? (
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 text-center">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-emerald-500" />
              </div>
              <h3 className="text-lg font-medium text-neutral-900 mb-1">信用良好</h3>
              <p className="text-sm text-neutral-500">未查询到任何违规记录</p>
            </div>
          ) : (
            violations.map(v => {
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
                <div key={v.id} className={`bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm transition-all duration-300 ${highlightRuleId !== null ? (highlightRecordIds.includes(v.id) ? 'ring-2 ring-red-500/50 bg-red-50/10 scale-[1.01]' : 'opacity-40 grayscale-[20%]') : 'opacity-100'}`}>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700 border border-red-100 mb-2">
                        {v.violation_type?.toLowerCase() === 'late' ? '迟到' : 
                         (v.violation_type?.toLowerCase() === 'overdue' || v.violation_type?.toLowerCase() === 'overtime') ? '超时' : 
                         (v.violation_type?.toLowerCase() === 'no-show' || v.violation_type?.toLowerCase() === 'noshow') ? '爽约' : 
                         '临期取消'}
                      </span>
                      <div className="text-base font-medium text-neutral-900">{format(new Date(v.violation_time), 'yyyy-MM-dd HH:mm')}</div>
                      <div className="text-sm text-neutral-500 mt-1">关联仪器：{v.equipment_name}</div>
                      {v.booking_code && (
                        <div className="text-xs font-mono text-neutral-400 mt-0.5">预约码: {v.booking_code}</div>
                      )}
                    </div>
                    
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex flex-col items-end gap-1.5">
                        {isApproved ? (
                          <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1.5 rounded-lg">已撤销</span>
                        ) : (
                          <span className="text-xs font-medium text-red-600 bg-red-50 px-2.5 py-1.5 rounded-lg">生效中</span>
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
                          className="text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-xl transition-colors"
                        >
                          我要申诉
                        </button>
                      )}
                    </div>
                  </div>

                  {remarkObj.admin_note && (
                    <div className="text-sm text-neutral-600 bg-neutral-50 p-3 rounded-xl mt-3">
                      <span className="font-medium">管理员备注：</span>{remarkObj.admin_note}
                    </div>
                  )}

                  {remarkObj.appeal_reason && (
                    <div className="text-sm text-blue-700 bg-blue-50/50 p-3 rounded-xl mt-3">
                      <span className="font-medium">您的申诉：</span>{remarkObj.appeal_reason}
                    </div>
                  )}

                  {remarkObj.appeal_reply && (
                    <div className="text-sm text-purple-700 bg-purple-50/50 p-3 rounded-xl mt-3">
                      <span className="font-medium">处理回复：</span>{remarkObj.appeal_reply}
                    </div>
                  )}

                  {appealingId === v.id && !isAppealing && !isRejected && !isApproved && (
                    <div className="mt-5 pt-5 border-t border-neutral-100">
                      <textarea
                        value={appealReason}
                        onChange={(e) => setAppealReason(e.target.value)}
                        placeholder="请详细说明您的申诉理由（如：仪器故障、特殊情况等）..."
                        className="w-full px-4 py-3 text-sm rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none h-24 mb-3"
                      />
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => setAppealingId(null)}
                          className="px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 rounded-xl transition-colors"
                        >
                          取消
                        </button>
                        <button
                          onClick={() => submitAppeal(v.id)}
                          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors"
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
      )}

      <div className="bg-neutral-50 rounded-2xl p-6 border border-neutral-200">
        <h3 className="text-sm font-bold text-neutral-900 mb-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          具体处罚规则说明
        </h3>
        {rules.length > 0 ? (
          <div className="space-y-3">
            {rules.map(rule => {
              let trigger: any = {};
              let action: any = {};
              try {
                trigger = JSON.parse(rule.trigger_config);
                action = JSON.parse(rule.action_config);
              } catch (e) {}

              const getViolationTypeLabel = (type: string) => {
                switch (type?.toLowerCase()) {
                  case 'late': return '迟到';
                  case 'overdue': return '超时';
                  case 'no-show': return '爽约';
                  case 'late_cancel': return '临期取消';
                  case 'overtime': return '超时';
                  case 'noshow': return '爽约';
                  case 'cancel_late': return '临期取消';
                  case 'hygiene_issue': return '卫生不达标';
                  case 'improper_operation': return '违规操作';
                  case 'proxy_booking': return '代预约';
                  case 'other_manual': return '其他违规';
                  default: return type;
                }
              };

              const getTriggerDesc = () => {
                let timeDesc = '';
                if (trigger.window_type === 'natural_period') {
                  const pMap: any = { month: '自然月', week: '自然周', year: '自然年', semester: '学期' };
                  timeDesc = `在每个${pMap[trigger.period_type] || '周期'}内`;
                } else if (trigger.window_type === 'rolling_days') {
                  timeDesc = `在过去的 ${trigger.period_days} 天内`;
                } else {
                  timeDesc = `在本月内`;
                }

                let typesStr = getViolationTypeLabel(rule.violation_type);
                if (trigger.violation_types && Array.isArray(trigger.violation_types)) {
                  typesStr = trigger.violation_types.map((t: string) => getViolationTypeLabel(t)).join(' 或 ');
                }

                const metricDesc = trigger.metric === 'count' ? `次数达到 ${trigger.threshold} 次` : `累计时长达到 ${trigger.threshold} 分钟`;
                return `${timeDesc}，${typesStr}${metricDesc}`;
              };

              const getActionDesc = () => {
                let baseAction = '';
                switch (action.type) {
                  case 'ban': baseAction = '完全封禁'; break;
                  case 'require_approval': baseAction = '需管理员审批'; break;
                  case 'double_fee': baseAction = `费用加倍 (${action.params?.multiplier || 2}倍)`; break;
                  case 'reduce_advance_days': baseAction = `减少提前预约天数 (减少${action.params?.reduce_days || 0}天)`; break;
                  default: baseAction = '限制预约';
                }

                let durationDesc = '';
                if (action.duration_type === 'fixed') {
                  durationDesc = `，持续 ${action.duration_days} 天`;
                } else {
                  durationDesc = `，直到本周期结束`;
                }

                return `${baseAction}${durationDesc}`;
              };

              const triggeredDetail = penaltyDetails?.triggered_rules_details?.find((r: any) => r.rule_id === rule.id);
              const isTriggered = !!triggeredDetail;
              const isActiveHighlight = highlightRuleId === rule.id;

              return (
                <div 
                  key={rule.id} 
                  onClick={() => {
                    if (isActiveHighlight) {
                      setHighlightRuleId(null);
                      setHighlightRecordIds([]);
                    } else if (isTriggered) {
                      setHighlightRuleId(rule.id);
                      setHighlightRecordIds(triggeredDetail.contributing_ids || []);
                    }
                  }}
                  className={`text-sm p-3 rounded-xl border shadow-sm transition-all duration-300 ${isTriggered ? 'cursor-pointer hover:shadow-md' : ''} ${isActiveHighlight ? 'bg-red-50 border-red-200 ring-1 ring-red-500' : (isTriggered ? 'bg-orange-50/50 border-orange-200' : 'bg-white border-neutral-100')}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className={`font-medium mr-2 ${isTriggered ? 'text-red-700' : 'text-neutral-900'}`}>【{rule.name}】</span>
                      <span className={isTriggered ? 'text-orange-900' : 'text-neutral-700'}>
                        {getTriggerDesc()}，将触发 <span className={`font-medium ${isTriggered ? 'text-red-700' : 'text-red-600'}`}>{getActionDesc()}</span>。
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">当前没有生效的处罚规则。</p>
        )}
        <div className="mt-4 pt-4 border-t border-neutral-200">
          <ul className="text-xs text-neutral-500 space-y-1.5 list-disc list-inside">
            <li>如果您认为违规记录有误或有特殊情况，请在记录产生后尽快提交申诉。</li>
            <li>每条违规记录仅可申诉一次，请如实填写申诉理由。</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
