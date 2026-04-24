import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useLanguage } from '../lib/i18n';
import { Branch, Employee, Role } from '../types';
import { Save, ChevronLeft, ChevronRight, Copy, Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { includeAsPersonnel } from '../constants';
import { supabase } from '../lib/supabase';
import { GlowingEffect } from './ui/glowing-effect';


const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

// Saat aralığı parse helper: "09:00-17:00" veya "09-17" -> { start: 540, end: 1020 } (dakika cinsinden)
const parseTimeRange = (label: string): { start: number; end: number } | null => {
    const match = label.match(/(\d{1,2}):?(\d{2})?\s*[-–]\s*(\d{1,2}):?(\d{2})?/);
    if (!match) return null;
    const startH = parseInt(match[1]);
    const startM = parseInt(match[2] || '0');
    const endH = parseInt(match[3]);
    const endM = parseInt(match[4] || '0');
    return { start: startH * 60 + startM, end: endH * 60 + endM };
};

// İki zaman aralığı çakışıyor mu?
const timeRangesOverlap = (a: { start: number; end: number }, b: { start: number; end: number }): boolean => {
    return a.start < b.end && b.start < a.end;
};

interface RosterRow {
    id?: string;
    timeLabel: string;
    assignments: string[];
}

interface ShiftScheduleProps {
    currentUser: Employee;
}

const getMonday = (d: Date) => {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
};

const ShiftSchedule: React.FC<ShiftScheduleProps> = ({ currentUser }) => {
  const { t, formatDate } = useLanguage();
  const isAdmin = currentUser.role === Role.ADMIN;

  // Personel artık şubeye bağlı değil - admin tüm şubeleri görür, personel de tüm şubeleri görebilir
  const [activeBranch, setActiveBranch] = useState<string>(Branch.MULHEIM);

  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(getMonday(new Date()));
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [rosterData, setRosterData] = useState<RosterRow[]>([]);
  const [availableEmployees, setAvailableEmployees] = useState<Employee[]>([]);

  // Diğer şubelerdeki tüm atamalar - çakışma kontrolü için
  const [otherBranchSchedules, setOtherBranchSchedules] = useState<{ branch: string; timeLabel: string; assignments: string[] }[]>([]);

  const weekKey = `${currentWeekStart.getFullYear()}-${String(currentWeekStart.getMonth() + 1).padStart(2, '0')}-${String(currentWeekStart.getDate()).padStart(2, '0')}`;
  const currentWeekEnd = new Date(currentWeekStart);
  currentWeekEnd.setDate(currentWeekEnd.getDate() + 6);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
      fetchEmployees();
  }, [currentWeekStart]);

  useEffect(() => {
      fetchWeekData();
      fetchOtherBranchData();
  }, [activeBranch, weekKey]);

  // Mobil: uygulama/sekme odağa gelince veriyi yenile
  useEffect(() => {
      const handleVisibility = () => {
          if (document.visibilityState === 'visible') {
              fetchWeekData();
              fetchOtherBranchData();
          }
      };
      document.addEventListener('visibilitychange', handleVisibility);
      return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [activeBranch, weekKey]);

  const fetchEmployees = async () => {
      try {
          // Çift rollü adminler (Apo, Malik) vardiya listesinde kalır, diğer adminler filtrelenir.
          const { data: empData } = await supabase.from('profiles').select('*');
          if (!isMounted.current) return;

          let currentEmployees: Employee[] = [];
          if (empData) {
              currentEmployees = empData.filter(includeAsPersonnel).map((e: any) => ({
                  id: e.id, name: e.full_name, email: e.email, role: e.role, branch: e.branch,
                  hourlyRate: e.hourly_rate, taxClass: e.tax_class, avatarUrl: e.avatar_url, advances: 0, metrics: e.metrics
              }));
          }
          setAvailableEmployees(currentEmployees);
      } catch (err) { console.error(err); }
  };

  const fetchWeekData = async () => {
      setIsLoading(true);
      try {
          const { data, error } = await supabase.from('shift_schedules').select('*').eq('week_start_date', weekKey).eq('branch', activeBranch).order('created_at', { ascending: true });
          if (!isMounted.current) return;
          if (error) { console.error('fetchWeekData error:', error); }
          if (data) setRosterData(data.map((r: any) => ({ id: r.id, timeLabel: r.time_slot || '', assignments: Array.isArray(r.days) ? r.days : Array(7).fill('') })));
      } catch (err: any) { console.error(err); } finally { if (isMounted.current) setIsLoading(false); }
  };

  // Diğer şubelerin aynı hafta verilerini çek - çakışma kontrolü için
  const fetchOtherBranchData = async () => {
      try {
          const { data } = await supabase.from('shift_schedules').select('*').eq('week_start_date', weekKey).neq('branch', activeBranch);
          if (!isMounted.current) return;
          if (data) {
              setOtherBranchSchedules(data.map((r: any) => ({
                  branch: r.branch,
                  timeLabel: r.time_slot || '',
                  assignments: r.days || Array(7).fill('')
              })));
          }
      } catch (err) { console.error(err); }
  };

  // Çakışma kontrolü: Bir personelin belirli bir günde diğer şubelerde çakışan vardiyası var mı?
  const getConflict = (employeeId: string, dayIndex: number, currentTimeLabel: string): string | null => {
      if (!employeeId) return null;
      const currentRange = parseTimeRange(currentTimeLabel);
      if (!currentRange) return null;

      for (const schedule of otherBranchSchedules) {
          const otherRange = parseTimeRange(schedule.timeLabel);
          if (!otherRange) continue;
          if (schedule.assignments[dayIndex] === employeeId && timeRangesOverlap(currentRange, otherRange)) {
              return `${schedule.branch} (${schedule.timeLabel})`;
          }
      }
      return null;
  };

  // Dropdown'da çakışan personeli işaretle
  const getEmployeeConflicts = useMemo(() => {
      const conflicts: Map<string, Map<number, string>> = new Map(); // empId -> dayIndex -> conflict info

      for (const row of rosterData) {
          const currentRange = parseTimeRange(row.timeLabel);
          if (!currentRange) continue;

          for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
              for (const emp of availableEmployees) {
                  for (const otherSchedule of otherBranchSchedules) {
                      const otherRange = parseTimeRange(otherSchedule.timeLabel);
                      if (!otherRange) continue;
                      if (otherSchedule.assignments[dayIdx] === emp.id && timeRangesOverlap(currentRange, otherRange)) {
                          if (!conflicts.has(`${row.id}_${emp.id}`)) conflicts.set(`${row.id}_${emp.id}`, new Map());
                          conflicts.get(`${row.id}_${emp.id}`)!.set(dayIdx, `${otherSchedule.branch} ${otherSchedule.timeLabel}`);
                      }
                  }
              }
          }
      }
      return conflicts;
  }, [rosterData, otherBranchSchedules, availableEmployees]);

  const handleWeekChange = (direction: 'prev' | 'next') => {
      const newDate = new Date(currentWeekStart);
      newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
      setCurrentWeekStart(newDate);
  };

  const saveRowToDb = async (row: RosterRow) => {
      if (!isAdmin) return;
      setIsSaving(true);
      try {
          const payload = { week_start_date: weekKey, branch: String(activeBranch), time_slot: row.timeLabel, days: row.assignments };
          if (row.id && !row.id.startsWith('temp_')) {
              await supabase.from('shift_schedules').update(payload).eq('id', row.id);
          } else {
              const { data, error } = await supabase.from('shift_schedules').insert([payload]).select().single();
              if(!error && data && isMounted.current) setRosterData(prev => prev.map(r => r.id === row.id ? { ...r, id: data.id } : r));
          }
      } catch (err) { console.error(err); } finally { if (isMounted.current) setIsSaving(false); }
  };

  const handleAssignmentChange = (rowId: string | undefined, dayIndex: number, employeeId: string) => {
      if (!isAdmin) return;

      // Çakışma kontrolü
      if (employeeId) {
          const currentRow = rosterData.find(r => r.id === rowId);
          if (currentRow) {
              const conflict = getConflict(employeeId, dayIndex, currentRow.timeLabel);
              if (conflict) {
                  const empName = availableEmployees.find(e => e.id === employeeId)?.name || '';
                  if (!confirm(t('shift.conflictWarn').replace('{name}', empName).replace('{conflict}', conflict))) {
                      return;
                  }
              }
          }
      }

      const updatedRows = rosterData.map(row => {
          if (row.id !== rowId) return row;
          const newAssignments = [...row.assignments];
          newAssignments[dayIndex] = employeeId;
          return { ...row, assignments: newAssignments };
      });
      setRosterData(updatedRows);
      const rowToSave = updatedRows.find(r => r.id === rowId);
      if (rowToSave) saveRowToDb(rowToSave);
  };

  const handleTimeLabelChange = (rowId: string | undefined, newLabel: string) => {
      if (!isAdmin) return;
      setRosterData(prev => prev.map(row => row.id === rowId ? { ...row, timeLabel: newLabel } : row));
  };

  const addNewRow = async () => {
      if (!isAdmin) return;
      const newRow: RosterRow = { id: `temp_${Date.now()}`, timeLabel: '', assignments: Array(7).fill('') };
      setRosterData([...rosterData, newRow]);
  };

  const deleteRow = async (rowId: string) => {
      if (!isAdmin) return;
      if(!confirm(t('shift.deleteConfirm'))) return;
      setRosterData(prev => prev.filter(r => r.id !== rowId));
      if (rowId && !rowId.startsWith('temp_')) await supabase.from('shift_schedules').delete().eq('id', rowId);
  };

  const handleManualSave = async () => {
      await fetchWeekData();
      await fetchOtherBranchData();
  };

  const handleCopyNextWeek = async () => {
      if (!isAdmin) return;
      const nextWeekDate = new Date(currentWeekStart); nextWeekDate.setDate(nextWeekDate.getDate() + 7);
      const nextWeekKey = `${nextWeekDate.getFullYear()}-${String(nextWeekDate.getMonth() + 1).padStart(2, '0')}-${String(nextWeekDate.getDate()).padStart(2, '0')}`;
      if (confirm(t('shift.copyConfirm').replace('{date}', formatDate(nextWeekDate)))) {
          setIsLoading(true);
          try {
              await supabase.from('shift_schedules').delete().eq('week_start_date', nextWeekKey).eq('branch', String(activeBranch));
              const payload = rosterData.map(row => ({ week_start_date: nextWeekKey, branch: String(activeBranch), time_slot: row.timeLabel, days: row.assignments }));
              if(payload.length > 0) await supabase.from('shift_schedules').insert(payload);
              if (isMounted.current) setCurrentWeekStart(nextWeekDate);
          } catch (err: any) { console.error(err); } finally { if (isMounted.current) setIsLoading(false); }
      }
  };

  // Tüm personel havuzdan gösterilir - şube filtresi yok
  const filteredEmployees = availableEmployees;
  const displayedRows = isAdmin ? rosterData : rosterData.filter(row => row.assignments.includes(currentUser.id));


  // --- Şube başına kullanıcının haftalık vardiya sayısı (badge için) ---
  const [allWeekSchedules, setAllWeekSchedules] = useState<any[]>([]);

  useEffect(() => {
      const fetchAllWeekSchedules = async () => {
          const { data } = await supabase.from('shift_schedules').select('*').eq('week_start_date', weekKey);
          if (data && isMounted.current) setAllWeekSchedules(data);
      };
      fetchAllWeekSchedules();
  }, [weekKey]);

  const branchShiftCounts = useMemo((): Map<string, number> => {
      const counts = new Map<string, number>();
      allWeekSchedules.forEach((schedule: any) => {
          const branch = schedule.branch;
          const days: string[] = schedule.days || [];
          const userDays = days.filter((empId: string) => empId === currentUser.id).length;
          if (userDays > 0) {
              counts.set(branch, (counts.get(branch) || 0) + userDays);
          }
      });
      return counts;
  }, [allWeekSchedules, currentUser]);

  return (
    <div className="h-full w-full flex flex-col bg-[#09090b] relative overflow-hidden">

      {/* HEADER */}
      <div className="p-2 xl:p-4 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-30 shrink-0">

          {/* ── MOBİL HEADER ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 4px' }} className="xl:hidden">
              {/* 3x2 Grid: 5 şube + 1 tarih — tüm hücreler eşit */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                  {Object.values(Branch).map(b => {
                      const count = branchShiftCounts.get(b) || 0;
                      return (
                          <button key={b} onClick={() => setActiveBranch(b)} style={{ position: 'relative', minHeight: '48px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', border: '1px solid', transition: 'all 0.2s', borderColor: activeBranch === b ? '#6366f1' : '#27272a', backgroundColor: activeBranch === b ? '#4f46e5' : '#18181b', color: activeBranch === b ? '#fff' : '#71717a' }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 4px' }}>{b}</span>
                              {count > 0 && (
                                  <span style={{ position: 'absolute', top: '-8px', right: '-8px', minWidth: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '9999px', fontSize: '10px', fontWeight: 900, padding: '0 6px', boxShadow: '0 0 0 2px #09090b', backgroundColor: activeBranch === b ? '#fff' : '#10b981', color: activeBranch === b ? '#4f46e5' : '#fff' }}>
                                      {count}
                                  </span>
                              )}
                          </button>
                      );
                  })}
                  {/* Tarih sekmesi — 6. hücre, şubelerle aynı boyut */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#18181b', borderRadius: '12px', border: '1px solid #27272a', minHeight: '48px' }}>
                      <button onClick={() => handleWeekChange('prev')} style={{ padding: '6px', color: '#a1a1aa', flexShrink: 0 }}><ChevronLeft size={16}/></button>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#fff', textAlign: 'center', flex: 1, lineHeight: 1.3 }}>
                          <span>{formatDate(currentWeekStart, { day: 'numeric', month: 'short' })}</span>
                          <span style={{ color: '#71717a', margin: '0 2px' }}>-</span>
                          <span>{formatDate(currentWeekEnd, { day: 'numeric', month: 'short' })}</span>
                      </div>
                      <button onClick={() => handleWeekChange('next')} style={{ padding: '6px', color: '#a1a1aa', flexShrink: 0 }}><ChevronRight size={16}/></button>
                  </div>
              </div>

              {/* Admin butonları */}
              {isAdmin && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                      <button onClick={handleCopyNextWeek} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '12px', color: '#a1a1aa', minHeight: '44px' }} title="Kopyala"><Copy size={18} /></button>
                      <button onClick={addNewRow} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#4f46e5', border: 'none', borderRadius: '12px', color: '#fff', fontWeight: 700, minHeight: '44px' }} title="Yeni Satır"><Plus size={18} /></button>
                      <button onClick={handleManualSave} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#16a34a', border: 'none', borderRadius: '12px', color: '#fff', fontWeight: 700, minHeight: '44px' }} title="Kaydet">{isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}</button>
                  </div>
              )}
          </div>

          {/* ── MASAÜSTÜ HEADER ── */}
          <div className="hidden xl:flex justify-between items-center gap-6">
              <div className="flex items-center gap-4">
                  {Object.values(Branch).map(b => {
                      const count = branchShiftCounts.get(b) || 0;
                      return (
                          <button key={b} onClick={() => setActiveBranch(b)} className={`relative px-5 py-2.5 rounded-xl text-sm font-bold transition-all border flex items-center justify-center min-h-[44px] ${activeBranch === b ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-zinc-900 text-zinc-500 border-zinc-800'}`}>
                              <span>{b}</span>
                              {count > 0 && (
                                  <span className={`absolute -top-2 -right-2 min-w-[20px] h-5 flex items-center justify-center rounded-full text-[10px] font-black px-1.5 shadow-lg ring-2 ring-zinc-950 ${activeBranch === b ? 'bg-white text-indigo-600' : 'bg-emerald-500 text-white shadow-emerald-500/30'}`}>
                                      {count}
                                  </span>
                              )}
                          </button>
                      );
                  })}
              </div>
              <div className="flex items-center gap-2">
                  <div className="flex items-center bg-zinc-900 rounded-xl border border-zinc-800 p-1">
                      <button onClick={() => handleWeekChange('prev')} className="p-2 text-zinc-400 hover:text-white"><ChevronLeft size={20}/></button>
                      <div className="px-4 text-center min-w-[140px] text-sm font-bold text-white">{formatDate(currentWeekStart, { day: 'numeric', month: 'short' })} - {formatDate(currentWeekEnd, { day: 'numeric', month: 'short' })}</div>
                      <button onClick={() => handleWeekChange('next')} className="p-2 text-zinc-400 hover:text-white"><ChevronRight size={20}/></button>
                  </div>
                  {isAdmin && (
                      <div className="flex items-center gap-2">
                          <button onClick={handleCopyNextWeek} className="p-3 flex items-center justify-center bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white min-h-[44px]" title="Kopyala"><Copy size={18} /></button>
                          <button onClick={addNewRow} className="px-6 py-3 flex items-center justify-center bg-indigo-600 text-white rounded-xl font-bold shadow-lg min-h-[44px]" title="Yeni Satır"><Plus size={18} /></button>
                          <button onClick={handleManualSave} className="px-6 py-3 flex items-center justify-center bg-green-600 text-white rounded-xl font-bold shadow-lg min-h-[44px]" title="Kaydet">{isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}</button>
                      </div>
                  )}
              </div>
          </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-zinc-950 p-2 xl:p-4">

            {/* ══════════════════════════════════════════════════
                TABLO GÖRÜNÜMÜ — Yatay kaydırmalı (mobil + masaüstü)
               ══════════════════════════════════════════════════ */}
            <div className="h-full pb-20">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-x-auto shadow-2xl relative" style={{ WebkitOverflowScrolling: 'touch' }}>
<GlowingEffect spread={40} glow={true} disabled={false} proximity={64} inactiveZone={0.01} />
                    {isLoading && (<div className="absolute inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center"><Loader2 size={40} className="text-blue-500 animate-spin" /></div>)}
                    <table className="w-full border-collapse min-w-[800px]">
                        <thead>
                            <tr className="bg-zinc-950 border-b border-zinc-800">
                                <th className="p-4 w-32 border-r border-zinc-800 sticky left-0 z-20 bg-zinc-950 text-indigo-400 text-xs uppercase font-black after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-zinc-800">{t('common.timeLabel')}</th>
                                {DAYS.map((day, idx) => {
                                    const d = new Date(currentWeekStart); d.setDate(d.getDate() + idx);
                                    const isToday = new Date().toDateString() === d.toDateString();
                                    return (<th key={day} className={`p-4 text-center border-r border-zinc-800/50 ${isToday ? 'bg-red-600/10 text-red-500' : 'text-zinc-500'}`}><span className="text-xs font-black uppercase">{day}</span></th>);
                                })}
                                {isAdmin && <th className="w-16"></th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/50">
                            {displayedRows.length === 0 ? (
                                <tr><td colSpan={9} className="p-20 text-center text-zinc-600 italic">{t('common.noRecord')}</td></tr>
                            ) : (
                                displayedRows.map((row) => (
                                    <tr key={row.id} className="group hover:bg-zinc-800/20">
                                        <td className="p-2 border-r border-zinc-800 sticky left-0 z-10 bg-zinc-950 shadow-[2px_0_8px_rgba(0,0,0,0.5)]">
                                            {isAdmin ? (<input type="text" value={row.timeLabel} onChange={(e) => handleTimeLabelChange(row.id, e.target.value)} onBlur={() => { saveRowToDb(row); fetchOtherBranchData(); }} className="w-full bg-transparent text-center font-bold text-zinc-200 outline-none" placeholder="00:00-00:00"/>) : (<div className="text-center font-bold text-white">{row.timeLabel}</div>)}
                                        </td>
                                        {row.assignments.map((empId, dayIdx) => {
                                            const conflict = empId ? getConflict(empId, dayIdx, row.timeLabel) : null;
                                            return (
                                            <td key={dayIdx} className={`p-2 border-r border-zinc-800/30 ${conflict ? 'bg-red-900/10' : ''}`}>
                                                <div className="flex flex-col items-center">
                                                    <div className="flex justify-center h-8 w-full">
                                                        {isAdmin ? (
                                                            <select value={empId} onChange={(e) => handleAssignmentChange(row.id, dayIdx, e.target.value)} className={`w-full bg-transparent text-center text-xs outline-none cursor-pointer ${conflict ? 'text-red-400 font-black' : empId ? 'text-white font-black' : 'text-zinc-800'}`}>
                                                                <option value="" className="bg-zinc-900 text-white">-</option>
                                                                {filteredEmployees.map(emp => {
                                                                    const empConflict = getEmployeeConflicts.get(`${row.id}_${emp.id}`)?.get(dayIdx);
                                                                    return (<option key={emp.id} value={emp.id} className={`bg-zinc-900 ${empConflict ? 'text-red-400' : 'text-white'}`}>{emp.name}{empConflict ? ' ⚠️' : ''}</option>);
                                                                })}
                                                            </select>
                                                        ) : (<span className={`text-sm ${empId === currentUser.id ? 'text-green-500 font-black' : 'text-zinc-900'}`}>{empId === currentUser.id ? currentUser.name : '-'}</span>)}
                                                    </div>
                                                    {conflict && (
                                                        <div className="flex items-center gap-1 mt-0.5" title={`Çakışma: ${conflict}`}>
                                                            <AlertTriangle size={10} className="text-red-500"/>
                                                            <span className="text-[9px] text-red-400 truncate max-w-[80px]">{conflict}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            );
                                        })}
                                        {isAdmin && (<td className="p-2 text-center opacity-0 group-hover:opacity-100"><button onClick={() => deleteRow(row.id!)} className="text-zinc-700 hover:text-red-500"><Trash2 size={16} /></button></td>)}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>


            </div>
      </div>
    </div>
  );
};

export default ShiftSchedule;