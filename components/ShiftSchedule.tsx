import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../lib/i18n';
import { Branch, Employee, Role } from '../types';
import { Save, ChevronLeft, ChevronRight, Copy, Plus, Trash2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { GlowingEffect } from './ui/glowing-effect';


const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

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
  
  const [activeBranch, setActiveBranch] = useState<string>(isAdmin ? Branch.MULHEIM : currentUser.branch);
  
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(getMonday(new Date()));
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const [rosterData, setRosterData] = useState<RosterRow[]>([]);
  const [availableEmployees, setAvailableEmployees] = useState<Employee[]>([]);
  const [transferredEmpIds, setTransferredEmpIds] = useState<string[]>([]); 

  const weekKey = `${currentWeekStart.getFullYear()}-${String(currentWeekStart.getMonth() + 1).padStart(2, '0')}-${String(currentWeekStart.getDate()).padStart(2, '0')}`;
  const currentWeekEnd = new Date(currentWeekStart);
  currentWeekEnd.setDate(currentWeekEnd.getDate() + 6);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);
  
  useEffect(() => {
      fetchEmployeesAndTransfers();
  }, [currentWeekStart]); 

  useEffect(() => {
      fetchWeekData();
  }, [activeBranch, weekKey]); 

  const fetchEmployeesAndTransfers = async () => {
      try {
          const { data: empData } = await supabase.from('profiles').select('*').neq('role', 'Admin');
          if (!isMounted.current) return;

          let currentEmployees: Employee[] = [];
          if (empData) {
              currentEmployees = empData.map((e: any) => ({
                  id: e.id, name: e.full_name, email: e.email, role: e.role, branch: e.branch,
                  hourlyRate: e.hourly_rate, taxClass: e.tax_class, avatarUrl: e.avatar_url, advances: 0, metrics: e.metrics
              }));
          }
          const startStr = currentWeekStart.toISOString().split('T')[0];
          const endStr = currentWeekEnd.toISOString().split('T')[0];
          const { data: transferData } = await supabase.from('personnel_transfers').select('employee_id').eq('status', 'active').lte('start_date', endStr).gte('end_date', startStr);

          if (!isMounted.current) return;
          if (transferData) setTransferredEmpIds(transferData.map((t: any) => t.employee_id));
          setAvailableEmployees(currentEmployees);
      } catch (err) { console.error(err); }
  };

  const fetchWeekData = async () => {
      setIsLoading(true);
      try {
          const { data, error } = await supabase.from('shift_schedules').select('*').eq('week_start_date', weekKey).eq('branch', activeBranch).order('created_at', { ascending: true });
          if (!isMounted.current) return;
          if (data) setRosterData(data.map((r: any) => ({ id: r.id, timeLabel: r.time_slot || '', assignments: r.days || Array(7).fill('') })));
      } catch (err: any) { console.error(err); } finally { if (isMounted.current) setIsLoading(false); }
  };

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
      if(!confirm("Silmek istediğinize emin misiniz?")) return;
      setRosterData(prev => prev.filter(r => r.id !== rowId));
      if (rowId && !rowId.startsWith('temp_')) await supabase.from('shift_schedules').delete().eq('id', rowId);
  };

  const handleManualSave = async () => {
      await fetchWeekData();
  };

  const handleCopyNextWeek = async () => {
      if (!isAdmin) return;
      const nextWeekDate = new Date(currentWeekStart); nextWeekDate.setDate(nextWeekDate.getDate() + 7);
      const nextWeekKey = `${nextWeekDate.getFullYear()}-${String(nextWeekDate.getMonth() + 1).padStart(2, '0')}-${String(nextWeekDate.getDate()).padStart(2, '0')}`;
      if (confirm(`${formatDate(nextWeekDate)} haftasına kopyalamak istiyor musunuz?`)) {
          setIsLoading(true);
          try {
              await supabase.from('shift_schedules').delete().eq('week_start_date', nextWeekKey).eq('branch', String(activeBranch));
              const payload = rosterData.map(row => ({ week_start_date: nextWeekKey, branch: String(activeBranch), time_slot: row.timeLabel, days: row.assignments }));
              if(payload.length > 0) await supabase.from('shift_schedules').insert(payload);
              if (isMounted.current) setCurrentWeekStart(nextWeekDate);
          } catch (err: any) { console.error(err); } finally { if (isMounted.current) setIsLoading(false); }
      }
  };

  const filteredEmployees = availableEmployees;
  const displayedRows = isAdmin ? rosterData : rosterData.filter(row => row.assignments.includes(currentUser.id));

  return (
    <div className="h-full w-full flex flex-col bg-[#09090b] relative overflow-hidden">
      
      {/* HEADER */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-30 shrink-0">
          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
              <div className="flex items-center gap-2 overflow-x-auto max-w-full pb-1 xl:pb-0">
                  {isAdmin ? (
                      <>
                        {Object.values(Branch).map(b => (
                            <button key={b} onClick={() => setActiveBranch(b)} className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all border whitespace-nowrap ${activeBranch === b ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-zinc-900 text-zinc-500 border-zinc-800'}`}>{b}</button>
                        ))}
                      </>
                  ) : (
                      <div className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-sm font-bold text-white">{activeBranch}</div>
                  )}
              </div>

              <div className="flex flex-col md:flex-row items-center gap-4 w-full xl:w-auto">
                  <div className="flex items-center bg-zinc-900 rounded-xl border border-zinc-800 p-1">
                        <button onClick={() => handleWeekChange('prev')} className="p-2 text-zinc-400 hover:text-white"><ChevronLeft size={20}/></button>
                        <div className="px-4 text-center min-w-[140px] text-sm font-bold text-white">{formatDate(currentWeekStart, { day: 'numeric', month: 'short' })} - {formatDate(currentWeekEnd, { day: 'numeric', month: 'short' })}</div>
                        <button onClick={() => handleWeekChange('next')} className="p-2 text-zinc-400 hover:text-white"><ChevronRight size={20}/></button>
                  </div>

                  {isAdmin && (
                      <div className="flex items-center gap-2">
                            <button onClick={handleCopyNextWeek} className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white"><Copy size={18} /></button>
                            <button onClick={addNewRow} className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg"><Plus size={18} /></button>
                            <button onClick={handleManualSave} className="px-6 py-3 bg-green-600 text-white rounded-xl font-bold shadow-lg">{isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}</button>
                      </div>
                  )}
              </div>
          </div>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar bg-zinc-950 p-4">
            <div className="min-w-[1200px] h-full pb-20"> 
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden shadow-2xl relative">
<GlowingEffect spread={40} glow={true} disabled={false} proximity={64} inactiveZone={0.01} />
                    {isLoading && (<div className="absolute inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center"><Loader2 size={40} className="text-blue-500 animate-spin" /></div>)}
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="bg-zinc-950 border-b border-zinc-800">
                                <th className="p-4 w-32 border-r border-zinc-800 sticky left-0 z-20 bg-zinc-950 text-indigo-400 text-xs uppercase font-black">Uhrzeit</th>
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
                                <tr><td colSpan={9} className="p-20 text-center text-zinc-600 italic">Kayıt bulunamadı.</td></tr>
                            ) : (
                                displayedRows.map((row) => (
                                    <tr key={row.id} className="group hover:bg-zinc-800/20">
                                        <td className="p-2 border-r border-zinc-800 sticky left-0 z-10 bg-zinc-950">
                                            {isAdmin ? (<input type="text" value={row.timeLabel} onChange={(e) => handleTimeLabelChange(row.id, e.target.value)} onBlur={() => saveRowToDb(row)} className="w-full bg-transparent text-center font-bold text-zinc-200 outline-none" placeholder="00-00"/>) : (<div className="text-center font-bold text-white">{row.timeLabel}</div>)}
                                        </td>
                                        {row.assignments.map((empId, dayIdx) => (
                                            <td key={dayIdx} className="p-2 border-r border-zinc-800/30">
                                                <div className="flex justify-center h-8">
                                                    {isAdmin ? (
                                                        <select value={empId} onChange={(e) => handleAssignmentChange(row.id, dayIdx, e.target.value)} className={`w-full bg-transparent text-center text-xs outline-none cursor-pointer ${empId ? 'text-white font-black' : 'text-zinc-800'}`}>
                                                            <option value="" className="bg-zinc-900 text-white">-</option>
                                                            {filteredEmployees.map(emp => (<option key={emp.id} value={emp.id} className="bg-zinc-900 text-white">{emp.name}</option>))}
                                                        </select>
                                                    ) : (<span className={`text-sm ${empId === currentUser.id ? 'text-green-500 font-black' : 'text-zinc-900'}`}>{empId === currentUser.id ? currentUser.name : '-'}</span>)}
                                                </div>
                                            </td>
                                        ))}
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