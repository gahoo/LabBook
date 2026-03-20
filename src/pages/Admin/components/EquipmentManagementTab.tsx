import React, { useState, useEffect, useRef } from 'react';
import { Settings2, Trash2, Filter, ChevronDown, AlertCircle, PlusCircle, X, Clock, FileCheck, Zap, Edit3, EyeOff, TimerReset } from 'lucide-react';
import toast from 'react-hot-toast';
import EquipmentForm from './EquipmentForm';
import BatchEditEquipmentForm from './BatchEditEquipmentForm';

interface EquipmentManagementTabProps {
  token: string | null;
}

const daysOfWeek = [
  { label: '周日', value: 0 },
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
];

export default function EquipmentManagementTab({
  token
}: EquipmentManagementTabProps) {
  const [equipmentList, setEquipmentList] = useState<any[]>([]);
  const [deleteEquipmentConfirmId, setDeleteEquipmentConfirmId] = useState<number | null>(null);
  
  // Drawer state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isBatchDrawerOpen, setIsBatchDrawerOpen] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<any>(null);

  // Equipment Filters
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [eqFilterName, setEqFilterName] = useState('');
  const [eqFilterLocation, setEqFilterLocation] = useState('');
  const [eqFilterPriceMin, setEqFilterPriceMin] = useState('');
  const [eqFilterPriceMax, setEqFilterPriceMax] = useState('');
  const [eqFilterConsumableMin, setEqFilterConsumableMin] = useState('');
  const [eqFilterConsumableMax, setEqFilterConsumableMax] = useState('');
  const [eqFilterPriceEnabled, setEqFilterPriceEnabled] = useState(false);
  const [eqFilterConsumableEnabled, setEqFilterConsumableEnabled] = useState(false);
  const [eqFilterAdvanceDaysMin, setEqFilterAdvanceDaysMin] = useState('');
  const [eqFilterAdvanceDaysMax, setEqFilterAdvanceDaysMax] = useState('');
  const [eqFilterDaysOfWeek, setEqFilterDaysOfWeek] = useState<number[]>([]);
  const [eqFilterTimeRangeStart, setEqFilterTimeRangeStart] = useState('');
  const [eqFilterTimeRangeEnd, setEqFilterTimeRangeEnd] = useState('');
  const [eqFilterOutOfHours, setEqFilterOutOfHours] = useState<string>('all');
  const [eqFilterWhitelist, setEqFilterWhitelist] = useState<string>('all');
  const [eqFilterAutoApprove, setEqFilterAutoApprove] = useState<string>('all');
  const [eqFilterIsHidden, setEqFilterIsHidden] = useState<string>('all');
  const [eqFilterReleaseNoshow, setEqFilterReleaseNoshow] = useState<string>('all');
  const [showEqPricePopup, setShowEqPricePopup] = useState(false);
  const [showEqAdvanceDaysPopup, setShowEqAdvanceDaysPopup] = useState(false);
  const [showEqFeaturesPopup, setShowEqFeaturesPopup] = useState(false);

  const eqPricePopupRef = useRef<HTMLDivElement>(null);
  const eqAdvanceDaysPopupRef = useRef<HTMLDivElement>(null);
  const eqFeaturesPopupRef = useRef<HTMLDivElement>(null);

  const fetchEquipment = async () => {
    try {
      const res = await fetch('/api/equipment');
      const data = await res.json();
      setEquipmentList(data);
    } catch (err) {
      toast.error('获取仪器列表失败');
    }
  };

  useEffect(() => {
    if (token) {
      fetchEquipment();
    }
  }, [token]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (eqPricePopupRef.current && !eqPricePopupRef.current.contains(event.target as Node)) {
        setShowEqPricePopup(false);
      }
      if (eqAdvanceDaysPopupRef.current && !eqAdvanceDaysPopupRef.current.contains(event.target as Node)) {
        setShowEqAdvanceDaysPopup(false);
      }
      if (eqFeaturesPopupRef.current && !eqFeaturesPopupRef.current.contains(event.target as Node)) {
        setShowEqFeaturesPopup(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const deleteEquipment = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/equipment/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('删除成功');
        fetchEquipment();
        setDeleteEquipmentConfirmId(null);
      } else {
        toast.error('删除失败，可能存在相关预约记录');
      }
    } catch (err) {
      toast.error('删除失败');
    }
  };

  const filteredEquipmentList = equipmentList.filter(eq => {
    let advanceDays = 7;
    let allowOutOfHours = false;
    let rules: any[] = [];
    try {
      const avail = JSON.parse(eq.availability_json || '{}');
      advanceDays = avail.advanceDays || 7;
      allowOutOfHours = avail.allowOutOfHours === true;
      rules = avail.rules || [];
    } catch (e) {}

    if (eqFilterName && !eq.name.toLowerCase().includes(eqFilterName.toLowerCase())) return false;
    if (eqFilterLocation && !(eq.location || '').toLowerCase().includes(eqFilterLocation.toLowerCase())) return false;
    
    if (eqFilterPriceEnabled) {
      if (eqFilterPriceMin && eq.price < Number(eqFilterPriceMin)) return false;
      if (eqFilterPriceMax && eq.price > Number(eqFilterPriceMax)) return false;
    }
    
    if (eqFilterConsumableEnabled) {
      if (eqFilterConsumableMin && eq.consumable_fee < Number(eqFilterConsumableMin)) return false;
      if (eqFilterConsumableMax && eq.consumable_fee > Number(eqFilterConsumableMax)) return false;
    }
    
    if (eqFilterAdvanceDaysMin && advanceDays < Number(eqFilterAdvanceDaysMin)) return false;
    if (eqFilterAdvanceDaysMax && advanceDays > Number(eqFilterAdvanceDaysMax)) return false;

    if (eqFilterDaysOfWeek.length > 0 || eqFilterTimeRangeStart || eqFilterTimeRangeEnd) {
      if (rules.length === 0) return false;

      const hasMatchingRule = rules.some(rule => {
        if (eqFilterDaysOfWeek.length > 0 && !eqFilterDaysOfWeek.includes(rule.day)) return false;
        if (eqFilterTimeRangeStart && rule.end <= eqFilterTimeRangeStart) return false;
        if (eqFilterTimeRangeEnd && rule.start >= eqFilterTimeRangeEnd) return false;
        return true;
      });
      if (!hasMatchingRule) return false;
    }

    if (eqFilterOutOfHours !== 'all') {
      const isAllowed = eqFilterOutOfHours === 'true';
      if (allowOutOfHours !== isAllowed) return false;
    }

    if (eqFilterWhitelist !== 'all') {
      const isEnabled = eqFilterWhitelist === 'true';
      if (Boolean(eq.whitelist_enabled) !== isEnabled) return false;
    }

    if (eqFilterAutoApprove !== 'all') {
      const isAuto = eqFilterAutoApprove === 'true';
      if (Boolean(eq.auto_approve) !== isAuto) return false;
    }

    if (eqFilterIsHidden !== 'all') {
      const isHidden = eqFilterIsHidden === 'true';
      if (Boolean(eq.is_hidden) !== isHidden) return false;
    }

    if (eqFilterReleaseNoshow !== 'all') {
      const releaseNoshow = eqFilterReleaseNoshow === 'true';
      if (Boolean(eq.release_noshow_slots) !== releaseNoshow) return false;
    }

    return true;
  });

  return (
    <>
      <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between bg-neutral-50">
          <h3 className="text-sm font-medium text-neutral-700 md:hidden">仪器列表</h3>
          <div className="hidden md:flex items-center gap-4">
            <h3 className="text-sm font-medium text-neutral-700">仪器列表</h3>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            {(eqFilterName || eqFilterLocation || eqFilterPriceEnabled || eqFilterConsumableEnabled || eqFilterDaysOfWeek.length > 0 || eqFilterTimeRangeStart || eqFilterTimeRangeEnd || eqFilterAdvanceDaysMin || eqFilterAdvanceDaysMax || eqFilterOutOfHours !== 'all' || eqFilterWhitelist !== 'all' || eqFilterAutoApprove !== 'all' || eqFilterIsHidden !== 'all' || eqFilterReleaseNoshow !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  if (filteredEquipmentList.length === 0) {
                    toast.error('当前筛选条件下没有仪器');
                    return;
                  }
                  setIsBatchDrawerOpen(true);
                }}
                className="p-2 md:px-3 md:py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-red-700 transition-colors"
              >
                <Edit3 className="w-4 h-4" />
                <span className="hidden md:inline">批量修改 ({filteredEquipmentList.length})</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setEditingEquipment(null);
                setIsDrawerOpen(true);
              }}
              className="p-2 md:px-3 md:py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-red-700 transition-colors"
            >
              <PlusCircle className="w-4 h-4" />
              <span className="hidden md:inline">添加仪器</span>
            </button>
            <button
              type="button"
              onClick={() => setShowMobileFilters(!showMobileFilters)}
              className="p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 rounded-lg flex items-center gap-2 md:hidden"
            >
              <Filter className="w-5 h-5" />
              <span className="text-sm font-medium">筛选</span>
            </button>
          </div>
        </div>
        {showMobileFilters && (
          <div className="p-4 border-b border-neutral-200 bg-neutral-50 grid grid-cols-1 gap-4 md:hidden">
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1">仪器名称</label>
              <input type="text" placeholder="搜索名称..." value={eqFilterName} onChange={e => setEqFilterName(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1">所在位置</label>
              <input type="text" placeholder="搜索位置..." value={eqFilterLocation} onChange={e => setEqFilterLocation(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-medium text-neutral-500">计费</label>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={eqFilterPriceEnabled} onChange={e => setEqFilterPriceEnabled(e.target.checked)} className="rounded border-neutral-300 text-red-600 focus:ring-red-600" />
                <span className="text-sm">启用计费筛选</span>
              </div>
              {eqFilterPriceEnabled && (
                <div className="flex gap-2">
                  <input type="number" placeholder="最低" value={eqFilterPriceMin} onChange={e => setEqFilterPriceMin(e.target.value)} className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
                  <input type="number" placeholder="最高" value={eqFilterPriceMax} onChange={e => setEqFilterPriceMax(e.target.value)} className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
                </div>
              )}
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={eqFilterConsumableEnabled} onChange={e => setEqFilterConsumableEnabled(e.target.checked)} className="rounded border-neutral-300 text-red-600 focus:ring-red-600" />
                <span className="text-sm">启用耗材筛选</span>
              </div>
              {eqFilterConsumableEnabled && (
                <div className="flex gap-2">
                  <input type="number" placeholder="最低" value={eqFilterConsumableMin} onChange={e => setEqFilterConsumableMin(e.target.value)} className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
                  <input type="number" placeholder="最高" value={eqFilterConsumableMax} onChange={e => setEqFilterConsumableMax(e.target.value)} className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-neutral-500">预约规则</label>
              <div className="flex gap-2">
                <input type="number" placeholder="最小提前天数" value={eqFilterAdvanceDaysMin} onChange={e => setEqFilterAdvanceDaysMin(e.target.value)} className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
                <input type="number" placeholder="最大提前天数" value={eqFilterAdvanceDaysMax} onChange={e => setEqFilterAdvanceDaysMax(e.target.value)} className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-neutral-500">开放时间</label>
              <div className="flex flex-wrap gap-2">
                {daysOfWeek.map(d => (
                  <label key={d.value} className="flex items-center gap-1">
                    <input type="checkbox" checked={eqFilterDaysOfWeek.includes(d.value)} onChange={e => {
                      if (e.target.checked) setEqFilterDaysOfWeek([...eqFilterDaysOfWeek, d.value]);
                      else setEqFilterDaysOfWeek(eqFilterDaysOfWeek.filter(v => v !== d.value));
                    }} className="rounded border-neutral-300 text-red-600 focus:ring-red-600" />
                    <span className="text-sm">{d.label}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <input type="time" value={eqFilterTimeRangeStart} onChange={e => setEqFilterTimeRangeStart(e.target.value)} className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
                <input type="time" value={eqFilterTimeRangeEnd} onChange={e => setEqFilterTimeRangeEnd(e.target.value)} className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 text-sm" />
              </div>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-medium text-neutral-500">功能设置</label>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-neutral-500 mb-1 flex items-center justify-center gap-1">
                    <Clock className="w-3 h-3" /> 时段外
                  </label>
                  <select value={eqFilterOutOfHours} onChange={e => setEqFilterOutOfHours(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded-lg border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none bg-white">
                    <option value="all">全部</option>
                    <option value="true">允许</option>
                    <option value="false">不允许</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-neutral-500 mb-1 flex items-center justify-center gap-1">
                    <FileCheck className="w-3 h-3" /> 白名单
                  </label>
                  <select value={eqFilterWhitelist} onChange={e => setEqFilterWhitelist(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded-lg border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none bg-white">
                    <option value="all">全部</option>
                    <option value="true">开启</option>
                    <option value="false">未开启</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-neutral-500 mb-1 flex items-center justify-center gap-1">
                    <Zap className="w-3 h-3" /> 自动审批
                  </label>
                  <select value={eqFilterAutoApprove} onChange={e => setEqFilterAutoApprove(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded-lg border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none bg-white">
                    <option value="all">全部</option>
                    <option value="true">是</option>
                    <option value="false">否</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-neutral-500 mb-1 flex items-center justify-center gap-1">
                    <EyeOff className="w-3 h-3" /> 隐藏仪器
                  </label>
                  <select value={eqFilterIsHidden} onChange={e => setEqFilterIsHidden(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded-lg border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none bg-white">
                    <option value="all">全部</option>
                    <option value="true">是</option>
                    <option value="false">否</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-neutral-500 mb-1 flex items-center justify-center gap-1">
                    <TimerReset className="w-3 h-3" /> 释放爽约
                  </label>
                  <select value={eqFilterReleaseNoshow} onChange={e => setEqFilterReleaseNoshow(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded-lg border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none bg-white">
                    <option value="all">全部</option>
                    <option value="true">是</option>
                    <option value="false">否</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm block md:table">
            <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-200 hidden md:table-header-group">
              <tr>
                <th className="px-4 py-4 font-medium align-top">
                  <div className="mb-2">仪器名称</div>
                  <input 
                    type="text" 
                    placeholder="搜索名称..." 
                    value={eqFilterName}
                    onChange={e => setEqFilterName(e.target.value)}
                    className="w-full px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                  />
                </th>
                <th className="px-4 py-4 font-medium align-top">
                  <div className="mb-2">所在位置</div>
                  <input 
                    type="text" 
                    placeholder="搜索位置..." 
                    value={eqFilterLocation}
                    onChange={e => setEqFilterLocation(e.target.value)}
                    className="w-20 px-2 py-1 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none"
                  />
                </th>
                <th className="px-4 py-4 font-medium align-top">
                  <div className="mb-2">计费</div>
                  <div className="relative" ref={eqPricePopupRef}>
                    <button 
                      onClick={() => setShowEqPricePopup(!showEqPricePopup)}
                      className="w-26 text-left px-2 py-1 text-xs rounded border border-neutral-300 bg-white hover:bg-neutral-50 flex items-center justify-between"
                    >
                      <div className="flex flex-col gap-0.5 w-full overflow-hidden">
                        {!eqFilterPriceEnabled && !eqFilterConsumableEnabled && <span>全部</span>}
                        {eqFilterPriceEnabled && <span className="truncate">计费: {eqFilterPriceMin || 0}-{eqFilterPriceMax || '∞'}</span>}
                        {eqFilterConsumableEnabled && <span className="truncate">耗材: {eqFilterConsumableMin || 0}-{eqFilterConsumableMax || '∞'}</span>}
                      </div>
                      <ChevronDown className="w-3 h-3 ml-1 shrink-0" />
                    </button>
                    
                    {showEqPricePopup && (
                      <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-xl shadow-xl border border-neutral-200 p-4 z-50">
                        <div className="mb-4">
                          <label className="flex items-center gap-2 text-xs font-medium text-neutral-700 mb-2">
                            <input 
                              type="checkbox" 
                              checked={eqFilterPriceEnabled} 
                              onChange={e => setEqFilterPriceEnabled(e.target.checked)}
                              className="rounded border-neutral-300 text-red-600 focus:ring-red-600"
                            />
                            计费区间 (¥)
                          </label>
                          {eqFilterPriceEnabled && (
                            <>
                              <div className="flex items-center gap-2">
                                <input type="number" placeholder="Min" value={eqFilterPriceMin} onChange={e => setEqFilterPriceMin(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none" />
                                <span className="text-neutral-400">-</span>
                                <input type="number" placeholder="Max" value={eqFilterPriceMax} onChange={e => setEqFilterPriceMax(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none" />
                              </div>
                              <div className="mt-2 px-1">
                                <input type="range" min="0" max="500" step="10" value={eqFilterPriceMax || 500} onChange={e => setEqFilterPriceMax(e.target.value)} className="w-full accent-red-600" />
                              </div>
                            </>
                          )}
                        </div>
                        
                        <div>
                          <label className="flex items-center gap-2 text-xs font-medium text-neutral-700 mb-2">
                            <input 
                              type="checkbox" 
                              checked={eqFilterConsumableEnabled} 
                              onChange={e => setEqFilterConsumableEnabled(e.target.checked)}
                              className="rounded border-neutral-300 text-red-600 focus:ring-red-600"
                            />
                            耗材费区间 (¥)
                          </label>
                          {eqFilterConsumableEnabled && (
                            <>
                              <div className="flex items-center gap-2">
                                <input type="number" placeholder="Min" value={eqFilterConsumableMin} onChange={e => setEqFilterConsumableMin(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none" />
                                <span className="text-neutral-400">-</span>
                                <input type="number" placeholder="Max" value={eqFilterConsumableMax} onChange={e => setEqFilterConsumableMax(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none" />
                              </div>
                              <div className="mt-2 px-1">
                                <input type="range" min="0" max="500" step="10" value={eqFilterConsumableMax || 500} onChange={e => setEqFilterConsumableMax(e.target.value)} className="w-full accent-red-600" />
                              </div>
                            </>
                          )}
                        </div>
                        
                        <div className="mt-4 flex justify-end">
                          <button onClick={() => {
                            setEqFilterPriceEnabled(false); setEqFilterConsumableEnabled(false);
                            setEqFilterPriceMin(''); setEqFilterPriceMax('');
                            setEqFilterConsumableMin(''); setEqFilterConsumableMax('');
                          }} className="text-xs text-neutral-500 hover:text-neutral-700 mr-3">重置</button>
                          <button onClick={() => setShowEqPricePopup(false)} className="px-3 py-1 bg-black text-white text-xs rounded hover:bg-neutral-800">确定</button>
                        </div>
                      </div>
                    )}
                  </div>
                </th>
                <th className="px-4 py-4 font-medium align-top">
                  <div className="mb-2">预约时段</div>
                  <div className="relative" ref={eqAdvanceDaysPopupRef}>
                    <button 
                      onClick={() => setShowEqAdvanceDaysPopup(!showEqAdvanceDaysPopup)}
                      className="w-full text-left px-2 py-1 text-xs rounded border border-neutral-300 bg-white hover:bg-neutral-50 flex items-center justify-between"
                    >
                      <span className="truncate">
                        {eqFilterDaysOfWeek.length > 0 || eqFilterTimeRangeStart || eqFilterTimeRangeEnd || eqFilterAdvanceDaysMin || eqFilterAdvanceDaysMax 
                          ? '已筛选'
                          : '全部'}
                      </span>
                      <ChevronDown className="w-3 h-3 ml-1 shrink-0" />
                    </button>
                    
                    {showEqAdvanceDaysPopup && (
                      <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-xl shadow-xl border border-neutral-200 p-4 z-50">
                        
                        <div className="mb-4">
                          <label className="block text-xs font-medium text-neutral-700 mb-2">周几</label>
                          <div className="flex flex-wrap gap-1">
                            {daysOfWeek.map(d => (
                              <button
                                key={d.value}
                                onClick={() => {
                                  if (eqFilterDaysOfWeek.includes(d.value)) {
                                    setEqFilterDaysOfWeek(eqFilterDaysOfWeek.filter(v => v !== d.value));
                                  } else {
                                    setEqFilterDaysOfWeek([...eqFilterDaysOfWeek, d.value]);
                                  }
                                }}
                                className={`px-2 py-1 text-xs rounded border transition-colors ${eqFilterDaysOfWeek.includes(d.value) ? 'bg-black border-black text-white' : 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:border-neutral-400'}`}
                              >
                                {d.label.replace('周', '')}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="mb-4">
                          <label className="block text-xs font-medium text-neutral-700 mb-2">时间段</label>
                          <div className="flex items-center gap-2">
                            <input type="time" value={eqFilterTimeRangeStart} onChange={e => setEqFilterTimeRangeStart(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none bg-white" />
                            <span className="text-neutral-400">-</span>
                            <input type="time" value={eqFilterTimeRangeEnd} onChange={e => setEqFilterTimeRangeEnd(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none bg-white" />
                          </div>
                        </div>

                        <div className="mb-4">
                          <label className="block text-xs font-medium text-neutral-700 mb-2">提前预约天数</label>
                          <div className="flex items-center gap-2">
                            <input type="number" placeholder="Min" value={eqFilterAdvanceDaysMin} onChange={e => setEqFilterAdvanceDaysMin(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none" />
                            <span className="text-neutral-400">-</span>
                            <input type="number" placeholder="Max" value={eqFilterAdvanceDaysMax} onChange={e => setEqFilterAdvanceDaysMax(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none" />
                          </div>
                          <div className="mt-2 px-1">
                            <input type="range" min="0" max="30" step="1" value={eqFilterAdvanceDaysMax || 30} onChange={e => setEqFilterAdvanceDaysMax(e.target.value)} className="w-full accent-red-600" />
                          </div>
                        </div>

                        <div className="mt-4 flex justify-end">
                          <button onClick={() => {
                            setEqFilterDaysOfWeek([]);
                            setEqFilterTimeRangeStart('');
                            setEqFilterTimeRangeEnd('');
                            setEqFilterAdvanceDaysMin(''); 
                            setEqFilterAdvanceDaysMax('');
                          }} className="text-xs text-neutral-500 hover:text-neutral-700 mr-3">重置</button>
                          <button onClick={() => setShowEqAdvanceDaysPopup(false)} className="px-3 py-1 bg-black text-white text-xs rounded hover:bg-neutral-800">确定</button>
                        </div>
                      </div>
                    )}
                  </div>
                </th>
                <th className="px-4 py-4 font-medium align-top">
                  <div className="mb-2">功能设置</div>
                  <div className="relative" ref={eqFeaturesPopupRef}>
                    <button 
                      onClick={() => setShowEqFeaturesPopup(!showEqFeaturesPopup)}
                      className="w-full text-left px-2 py-1 text-xs rounded border border-neutral-300 bg-white hover:bg-neutral-50 flex items-center justify-between"
                    >
                      <span className="truncate">
                        {(eqFilterOutOfHours !== 'all' || eqFilterWhitelist !== 'all' || eqFilterAutoApprove !== 'all' || eqFilterIsHidden !== 'all' || eqFilterReleaseNoshow !== 'all') ? '已筛选' : '全部'}
                      </span>
                      <ChevronDown className="w-3 h-3 ml-1 shrink-0" />
                    </button>
                  
                  {showEqFeaturesPopup && (
                    <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-xl shadow-xl border border-neutral-200 z-50 p-3 font-normal">
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs text-neutral-500 mb-1 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> 时段外预约
                          </label>
                          <select value={eqFilterOutOfHours} onChange={e => setEqFilterOutOfHours(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none bg-white">
                            <option value="all">全部</option>
                            <option value="true">允许</option>
                            <option value="false">不允许</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-neutral-500 mb-1 flex items-center gap-1">
                            <FileCheck className="w-3 h-3" /> 白名单
                          </label>
                          <select value={eqFilterWhitelist} onChange={e => setEqFilterWhitelist(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none bg-white">
                            <option value="all">全部</option>
                            <option value="true">已开启</option>
                            <option value="false">未开启</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-neutral-500 mb-1 flex items-center gap-1">
                            <Zap className="w-3 h-3" /> 自动审批
                          </label>
                          <select value={eqFilterAutoApprove} onChange={e => setEqFilterAutoApprove(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none bg-white">
                            <option value="all">全部</option>
                            <option value="true">是</option>
                            <option value="false">否</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-neutral-500 mb-1 flex items-center gap-1">
                            <EyeOff className="w-3 h-3" /> 隐藏仪器
                          </label>
                          <select value={eqFilterIsHidden} onChange={e => setEqFilterIsHidden(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none bg-white">
                            <option value="all">全部</option>
                            <option value="true">是</option>
                            <option value="false">否</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-neutral-500 mb-1 flex items-center gap-1">
                            <TimerReset className="w-3 h-3" /> 释放爽约
                          </label>
                          <select value={eqFilterReleaseNoshow} onChange={e => setEqFilterReleaseNoshow(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-neutral-300 focus:ring-1 focus:ring-red-600 outline-none bg-white">
                            <option value="all">全部</option>
                            <option value="true">是</option>
                            <option value="false">否</option>
                          </select>
                        </div>
                        <div className="pt-2 border-t border-neutral-100 flex justify-end">
                          <button onClick={() => {
                            setEqFilterOutOfHours('all');
                            setEqFilterWhitelist('all');
                            setEqFilterAutoApprove('all');
                            setEqFilterIsHidden('all');
                            setEqFilterReleaseNoshow('all');
                          }} className="text-xs text-neutral-500 hover:text-neutral-700 mr-3">重置</button>
                          <button onClick={() => setShowEqFeaturesPopup(false)} className="px-3 py-1 bg-black text-white text-xs rounded hover:bg-neutral-800">确定</button>
                        </div>
                      </div>
                    </div>
                  )}
                  </div>
                </th>
                <th className="px-4 py-4 font-medium text-right align-top">操作</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group divide-y divide-neutral-100 md:divide-y-0 p-4 md:p-0">
              {filteredEquipmentList.map(eq => {
                let advanceDays = 7;
                let allowOutOfHours = false;
                try {
                  const avail = JSON.parse(eq.availability_json || '{}');
                  advanceDays = avail.advanceDays || 7;
                  allowOutOfHours = avail.allowOutOfHours === true;
                } catch (e) {}
                
                return (
                <tr key={eq.id} className="block md:table-row hover:bg-neutral-50/50 border border-neutral-200 md:border-b md:border-x-0 md:border-t-0 rounded-xl md:rounded-none mb-4 md:mb-0 bg-white shadow-sm md:shadow-none">
                  <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                    <div className="flex justify-between items-center md:block">
                      <span className="md:hidden font-medium text-neutral-500 text-xs">名称</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{eq.name}</span>
                        {eq.is_hidden ? (
                          <span className="px-2 py-0.5 bg-neutral-100 text-neutral-500 text-xs rounded-full border border-neutral-200">已隐藏</span>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                    <div className="flex justify-between items-center md:block">
                      <span className="md:hidden font-medium text-neutral-500 text-xs">位置</span>
                      <span className="text-neutral-500">{eq.location || '-'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                    <div className="flex justify-between items-center md:block">
                      <span className="md:hidden font-medium text-neutral-500 text-xs">计费</span>
                      <div className="text-right md:text-left">
                        <div>¥{eq.price}/{eq.price_type === 'hour' ? '小时' : '次'}</div>
                        {eq.consumable_fee > 0 && <div className="text-xs text-neutral-500 mt-1">+¥{eq.consumable_fee}/个 耗材费</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                    <div className="flex justify-between items-start md:block">
                      <span className="md:hidden font-medium text-neutral-500 text-xs mt-0.5">预约时段</span>
                      <div className="text-right md:text-left">
                        {(() => {
                          let rules: any[] = [];
                          try {
                            const avail = JSON.parse(eq.availability_json || '{}');
                            rules = avail.rules || [];
                          } catch (e) {}
                          
                          if (!rules || rules.length === 0) return <div className="text-neutral-500 text-xs">未设置</div>;
                          
                          const daySlots: Record<number, string[]> = {};
                          rules.forEach(r => {
                            if (!daySlots[r.day]) daySlots[r.day] = [];
                            daySlots[r.day].push(`${r.start}~${r.end}`);
                          });
                          
                          Object.keys(daySlots).forEach(day => {
                            daySlots[Number(day)].sort();
                          });
                          
                          const slotsToDays: Record<string, number[]> = {};
                          Object.entries(daySlots).forEach(([day, slots]) => {
                            const slotsStr = slots.join(', ');
                            if (!slotsToDays[slotsStr]) slotsToDays[slotsStr] = [];
                            slotsToDays[slotsStr].push(Number(day));
                          });
                          
                          const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
                          const formatDays = (days: number[]) => {
                            days.sort((a, b) => a - b);
                            let ranges = [];
                            let j = 0;
                            while (j < days.length) {
                              let start = j;
                              while (j + 1 < days.length && days[j + 1] === days[j] + 1) {
                                j++;
                              }
                              ranges.push(days.slice(start, j + 1));
                              j++;
                            }
                            
                            let parts = ranges.map(range => {
                              if (range.length >= 3) {
                                return `${dayNames[range[0]]}～${dayNames[range[range.length - 1]]}`;
                              } else {
                                return range.map(d => dayNames[d]).join('、');
                              }
                            });
                            
                            return parts.join('、').replace(/、周/g, '、');
                          };

                          return (
                            <div className="space-y-2 text-xs">
                              {Object.entries(slotsToDays).map(([slotsStr, days], idx) => (
                                <div key={idx}>
                                  <div className="font-medium text-neutral-700">{formatDays(days)}</div>
                                  <div className="text-neutral-500">{slotsStr}</div>
                                </div>
                              ))}
                              <div className="text-red-600 font-medium pt-1">提前{advanceDays}天</div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 md:py-4 block md:table-cell border-b border-neutral-100 md:border-none">
                    <div className="flex justify-between items-center md:block">
                      <span className="md:hidden font-medium text-neutral-500 text-xs">功能设置</span>
                      <div className="flex items-center gap-1 flex-wrap">
                        <div title="时段外预约" className={`p-1 rounded-full ${allowOutOfHours ? 'bg-red-100 text-red-600' : 'bg-neutral-100 text-neutral-400'}`}>
                          <Clock className="w-4 h-4" />
                        </div>
                        <div title="白名单" className={`p-1 rounded-full ${eq.whitelist_enabled ? 'bg-red-100 text-red-600' : 'bg-neutral-100 text-neutral-400'}`}>
                          <FileCheck className="w-4 h-4" />
                        </div>
                        <div title="自动审批" className={`p-1 rounded-full ${eq.auto_approve ? 'bg-red-100 text-red-600' : 'bg-neutral-100 text-neutral-400'}`}>
                          <Zap className="w-4 h-4" />
                        </div>
                        <div title="隐藏仪器" className={`p-1 rounded-full ${eq.is_hidden ? 'bg-red-100 text-red-600' : 'bg-neutral-100 text-neutral-400'}`}>
                          <EyeOff className="w-4 h-4" />
                        </div>
                        <div title="释放爽约" className={`p-1 rounded-full ${eq.release_noshow_slots ? 'bg-red-100 text-red-600' : 'bg-neutral-100 text-neutral-400'}`}>
                          <TimerReset className="w-4 h-4" />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 md:py-4 block md:table-cell">
                    <div className="flex justify-end md:justify-end items-center space-x-1">
                      <button onClick={() => {
                        setEditingEquipment(eq);
                        setIsDrawerOpen(true);
                      }} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Settings2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleteEquipmentConfirmId(eq.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              )})}
              {filteredEquipmentList.length === 0 && (
                <tr className="block md:table-row">
                  <td colSpan={8} className="px-4 py-12 text-center text-neutral-500 block md:table-cell">暂无仪器记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {deleteEquipmentConfirmId !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl">
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
            </div>
            <h3 className="text-xl font-bold text-center mb-2">确认删除仪器？</h3>
            <p className="text-neutral-500 text-center mb-6">
              删除后将无法恢复，且相关的预约记录可能会受到影响。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteEquipmentConfirmId(null)}
                className="flex-1 py-3 rounded-xl font-medium border border-neutral-200 hover:bg-neutral-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => deleteEquipment(deleteEquipmentConfirmId)}
                className="flex-1 py-3 rounded-xl font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

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
          <h2 className="text-lg font-bold text-neutral-900">{editingEquipment ? '编辑仪器' : '添加新仪器'}</h2>
          <button 
            onClick={() => setIsDrawerOpen(false)}
            className="p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 sm:p-6">
          {isDrawerOpen && (
            <EquipmentForm 
              token={token}
              editingEquipment={editingEquipment}
              setEditingEquipment={setEditingEquipment}
              onSuccess={() => {
                setIsDrawerOpen(false);
                fetchEquipment();
              }}
            />
          )}
        </div>
      </div>

      {/* Batch Edit Drawer Overlay */}
      <div 
        className={`fixed inset-0 bg-black/50 z-50 transition-opacity duration-300 ${isBatchDrawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsBatchDrawerOpen(false)}
      />

      {/* Batch Edit Drawer Panel */}
      <div 
        className={`fixed top-0 right-0 h-full w-full sm:w-[500px] md:w-[600px] bg-white z-50 shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col ${isBatchDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {isBatchDrawerOpen && (
          <BatchEditEquipmentForm
            token={token}
            equipmentIds={filteredEquipmentList.map(eq => eq.id)}
            onClose={() => setIsBatchDrawerOpen(false)}
            onSuccess={() => {
              setIsBatchDrawerOpen(false);
              fetchEquipment();
            }}
          />
        )}
      </div>
    </>
  );
}
