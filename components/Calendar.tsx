import React, { useState, useMemo, useEffect } from 'react';
import { Branch, Employee, Role, CalendarEvent, Task } from '../types';
import { Plus, X, Calendar as CalendarIcon, Clock, MapPin, Users, Save, Building2, CheckCircle2, AlignLeft, Trash2, ChevronLeft, ChevronRight, AlertTriangle, CheckSquare, Loader2, Rocket, ArrowRightLeft, CalendarRange, MoreHorizontal, Filter, List } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../lib/i18n';
import { GlowingEffect } from './ui/glowing-effect';


interface CalendarProps {
    currentUser: Employee;
}

interface DisplayEvent extends CalendarEvent {
    isTask?: boolean;
    isShift?: boolean;
    status?: string;
}

type CalendarTab = 'EVENTS' | 'SHIFTS';

const Calendar: React.FC<CalendarProps> = ({ currentUser }) => {
  // --- STATE ---
  const [viewDate, setViewDate] = useState(new Date()); // Haftanın referans günü
  const [activeTab, setActiveTab] = useState<CalendarTab>('EVENTS');
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { t, formatDate, language } = useLanguage();

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [shifts, setShifts] = useState<any[]>([]); // New Shift State
  const [employees, setEmployees] = useState<Employee[]>([]); // New Employee State for Attendees

  // Modal & Selection
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<DisplayEvent | null>(null);
  
  // Filters
  const [selectedBranches, setSelectedBranches] = useState<Branch[]>([]);
  const [targetBranch, setTargetBranch] = useState<Branch>(Branch.DOM);

  // Form
  const [newEventForm, setNewEventForm] = useState<Partial<CalendarEvent>>({
      title: '',
      type: 'Toplantı',
      date: new Date().toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0], 
      startTime: '09:00',
      endTime: '10:00',
      attendees: [],
      description: ''
  });

  // --- DATA FETCHING ---
  useEffect(() => {
    const fetchData = async () => {
        setIsLoading(true);
        try {
            // 1. Events
            let eventQuery = supabase.from('calendar_events').select('*');
            if (currentUser.role !== Role.ADMIN) {
                eventQuery = eventQuery.contains('attendees', [currentUser.id]);
            }
            const { data: eventData } = await eventQuery;
            if (eventData) {
                const today = new Date().toISOString().split('T')[0];
                const dbEvents: CalendarEvent[] = eventData
                    .filter((e: any) => {
                        // Eski tarihli transfer kayıtlarını gösterme
                        if (e.type === 'Şube Transferi') {
                            const endDate = e.end_date || e.date;
                            return endDate >= today;
                        }
                        return true;
                    })
                    .map((e: any) => ({
                        id: e.id, title: e.title, type: e.type, date: e.date,
                        endDate: e.end_date || e.date, startTime: e.start_time, endTime: e.end_time,
                        attendees: e.attendees || [], description: e.description
                    }));
                setEvents(dbEvents);
            }

            // 2. Tasks
            let taskQuery = supabase.from('tasks').select('*');
            if (currentUser.role !== Role.ADMIN) {
                taskQuery = taskQuery.contains('assigned_to', [currentUser.id]);
            }
            const { data: taskData } = await taskQuery;
            if(taskData) {
                 const dbTasks: Task[] = taskData.map((t: any) => ({
                    id: t.id, title: t.title, description: t.description,
                    assignedTo: t.assigned_to || [], dueDate: t.due_date,
                    priority: t.priority, status: t.status, progress: t.progress, checklist: t.checklist || []
                }));
                setTasks(dbTasks);
            }

            // 3. Shifts (Vardiyalar)
            const { data: shiftData } = await supabase
                .from('shift_schedules')
                .select('*');

            if (shiftData) {
                setShifts(shiftData);
            }

            // 4. Employees (For Attendees Selector) - EXCLUDE ADMINS
            const { data: empData } = await supabase.from('profiles').select('*').neq('role', 'Admin');
            if (empData) {
                const fetchedEmployees: Employee[] = empData.map((e: any) => ({
                    id: e.id,
                    name: e.full_name,
                    email: e.email,
                    role: e.role,
                    branch: e.branch,
                    hourlyRate: e.hourly_rate,
                    taxClass: e.tax_class,
                    avatarUrl: e.avatar_url || `https://ui-avatars.com/api/?name=${e.full_name}`,
                    advances: 0,
                    metrics: e.metrics
                }));
                setEmployees(fetchedEmployees);
            }

        } catch (e) {
            console.log("Error:", e);
        } finally {
            setIsLoading(false);
        }
    };
    fetchData();
  }, [currentUser]); 

  // --- LOGIC ---
  const combinedEvents = useMemo((): DisplayEvent[] => {
      const filteredEvents = currentUser.role === Role.ADMIN ? events : events.filter(evt => evt.attendees.includes(currentUser.id));
      const filteredTasks = currentUser.role === Role.ADMIN ? tasks : tasks.filter(t => t.assignedTo.includes(currentUser.id));

      const taskEvents: DisplayEvent[] = filteredTasks.map(t => ({
          id: t.id, title: t.title, type: 'Diğer', date: t.dueDate, endDate: t.dueDate,
          startTime: '09:00', endTime: '18:00', attendees: t.assignedTo, description: t.description,
          isTask: true, status: t.status
      }));

      // Generate Shift Events from Roster Data (UPDATED for Transposed Table)
      const shiftEvents: DisplayEvent[] = shifts.flatMap(schedule => {
          const start = new Date(schedule.week_start_date);
          const timeLabel = schedule.time_slot || "09:00 - 17:00";
          
          return schedule.days.map((assignedEmpId: string, index: number) => {
              // Filter: Only create event if this slot is assigned to the current user
              if (assignedEmpId !== currentUser.id) return null;
              
              const eventDate = new Date(start);
              eventDate.setDate(eventDate.getDate() + index);
              const dateStr = eventDate.toISOString().split('T')[0];
              
              // Basit parse (örn: "09:00 - 17:00" veya "09-17")
              // Handle "9-15" format from screenshot
              let sTime = '08:00';
              let eTime = '18:00';
              
              if (timeLabel.includes('-')) {
                  const parts = timeLabel.split('-');
                  sTime = parts[0].trim();
                  eTime = parts[1].trim();
                  // Normalize "9" to "09:00" if needed
                  if (!sTime.includes(':') && sTime.length <= 2) sTime = sTime.padStart(2, '0') + ":00";
                  if (!eTime.includes(':') && eTime.length <= 2) eTime = eTime.padStart(2, '0') + ":00";
              }

              return {
                  id: `shift_${schedule.id}_${index}`,
                  title: `Vardiya: ${timeLabel}`,
                  type: 'Diğer', 
                  date: dateStr,
                  endDate: dateStr,
                  startTime: sTime,
                  endTime: eTime,
                  attendees: [currentUser.id],
                  description: `Şube: ${schedule.branch}`,
                  isShift: true
              } as DisplayEvent;
          }).filter(Boolean) as DisplayEvent[];
      });

      return [...(filteredEvents as DisplayEvent[]), ...taskEvents, ...shiftEvents];
  }, [events, tasks, shifts, currentUser]);

  // WEEK LOGIC
  const getStartOfWeek = (d: Date) => {
      const date = new Date(d);
      const day = date.getDay(); 
      const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
      return new Date(date.setDate(diff));
  };

  const currentWeekStart = useMemo(() => getStartOfWeek(viewDate), [viewDate]);
  
  const weekDays = useMemo(() => {
      const days = [];
      for (let i = 0; i < 7; i++) {
          const d = new Date(currentWeekStart);
          d.setDate(d.getDate() + i);
          days.push(d);
      }
      return days;
  }, [currentWeekStart]);

  // --- SHIFT GRID (for Working Hours tab) ---
  const shiftGrid = useMemo(() => {
      const weekStartStr = currentWeekStart.toISOString().split('T')[0];

      // employeeId -> { dayIndex -> timeSlot[] }
      const employeeShiftMap = new Map<string, Map<number, string[]>>();

      shifts.forEach((schedule: any) => {
          if (schedule.week_start_date !== weekStartStr) return;

          schedule.days.forEach((empId: string, dayIndex: number) => {
              if (!empId) return;
              if (currentUser.role !== Role.ADMIN && empId !== currentUser.id) return;

              if (!employeeShiftMap.has(empId)) {
                  employeeShiftMap.set(empId, new Map());
              }
              const dayMap = employeeShiftMap.get(empId)!;
              if (!dayMap.has(dayIndex)) {
                  dayMap.set(dayIndex, []);
              }
              dayMap.get(dayIndex)!.push(schedule.time_slot || '09:00-17:00');
          });
      });

      // Group by branch
      const branchGroups = new Map<string, { employee: Employee; days: Map<number, string[]> }[]>();

      employeeShiftMap.forEach((dayMap, empId) => {
          const emp = employees.find(e => e.id === empId);
          if (!emp) return;
          const branch = emp.branch || 'Havuz';
          if (!branchGroups.has(branch)) branchGroups.set(branch, []);
          branchGroups.get(branch)!.push({ employee: emp, days: dayMap });
      });

      return branchGroups;
  }, [shifts, employees, currentWeekStart, currentUser]);

  const changeWeek = (direction: 'prev' | 'next') => {
      const newDate = new Date(viewDate);
      newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
      setViewDate(newDate);
  };

  const isToday = (d: Date) => {
      const today = new Date();
      return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  };

  const getText = (text?: string) => {
    if (!text) return '';
    return text.startsWith('task.mock') ? t(text) : text;
  };

  // Handlers
  const handleSaveEvent = async (e: React.FormEvent) => {
      e.preventDefault();
      const isTransfer = newEventForm.type === 'Şube Transferi';
      if (!newEventForm.title && !isTransfer) return alert(t('cal.warnTitle'));
      
      setIsSaving(true);
      try {
          const finalTitle = isTransfer ? `${newEventForm.attendees?.length} Personel -> ${targetBranch}` : newEventForm.title!;
          const dbPayload = {
              title: finalTitle, type: newEventForm.type, date: newEventForm.date,
              end_date: newEventForm.endDate || newEventForm.date, start_time: newEventForm.startTime,
              end_time: newEventForm.endTime, attendees: newEventForm.attendees || [], description: newEventForm.description
          };
          const { data, error } = await supabase.from('calendar_events').insert([dbPayload]).select();
          if (error) throw error;
          
          // Transfer kayıtlarını personnel_transfers tablosuna ekle (profiles.branch DEĞİŞMEZ!)
          if(isTransfer && currentUser.role === Role.ADMIN && (newEventForm.attendees || []).length > 0) {
               const transferRecords = (newEventForm.attendees || []).map(empId => {
                   const emp = employees.find(e => e.id === empId);
                   return {
                       employee_id: empId,
                       from_branch: 'Havuz',
                       to_branch: targetBranch,
                       start_date: newEventForm.date,
                       end_date: newEventForm.endDate || newEventForm.date,
                       start_time: newEventForm.startTime || '08:00',
                       end_time: newEventForm.endTime || '18:00',
                       status: 'active',
                       created_by: currentUser.id
                   };
               });
               await supabase.from('personnel_transfers').insert(transferRecords);
          }

          if (data && data[0]) {
              // FIX: Convert DB response (snake_case) to Frontend Type (camelCase) to prevent crash
              const newEvent: CalendarEvent = {
                  id: data[0].id,
                  title: data[0].title,
                  type: data[0].type,
                  date: data[0].date,
                  endDate: data[0].end_date,
                  startTime: data[0].start_time,
                  endTime: data[0].end_time,
                  attendees: data[0].attendees || [],
                  description: data[0].description
              };
              setEvents(prev => [...prev, newEvent]);
              setShowAddModal(false);
              alert(t('common.success'));
          }
      } catch (err: any) {
          alert("Error: " + err.message);
      } finally {
          setIsSaving(false);
      }
  };

  const handleDeleteEvent = async () => {
      if (!selectedEvent || selectedEvent.isTask || selectedEvent.isShift) return;
      if (confirm('Silmek istediğinize emin misiniz?')) {
          const { error } = await supabase.from('calendar_events').delete().eq('id', selectedEvent.id);
          if (!error) {
              setEvents(events.filter(e => e.id !== selectedEvent.id));
              setSelectedEvent(null);
          }
      }
  };

  const toggleBranchSelection = (branch: Branch) => {
    setSelectedBranches(prev => prev.includes(branch) ? prev.filter(b => b !== branch) : [...prev, branch]);
  };
  
  const toggleAttendee = (id: string) => {
    setNewEventForm(prev => {
        const cur = prev.attendees || [];
        return cur.includes(id) ? { ...prev, attendees: cur.filter(x => x !== id) } : { ...prev, attendees: [...cur, id] };
    });
  };

  // --- WEEK STATS ---
  const weekStats = useMemo(() => {
      const startStr = weekDays[0].toISOString().split('T')[0];
      const endStr = weekDays[6].toISOString().split('T')[0];
      
      const eventsInWeek = combinedEvents.filter(e => e.date >= startStr && e.date <= endStr);
      
      return {
          total: eventsInWeek.length,
          meetings: eventsInWeek.filter(e => e.type === 'Toplantı').length,
          transfers: eventsInWeek.filter(e => e.type === 'Şube Transferi').length,
          tasks: eventsInWeek.filter(e => e.isTask).length
      };
  }, [combinedEvents, weekDays]);

  return (
    <div className="flex h-full relative overflow-hidden bg-zinc-950">
        
        {/* ADD EVENT MODAL */}
        {showAddModal && (
            <div className="fixed inset-0 z-[100] flex justify-center items-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                    <div className="p-5 border-b border-zinc-800 flex justify-between items-center bg-zinc-950/80 backdrop-blur">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            {newEventForm.type === 'Şube Transferi' ? <Rocket size={20} className="text-orange-500"/> : <CalendarIcon size={20} className="text-indigo-500"/>}
                            {t('cal.newEvent')}
                        </h3>
                        <button onClick={() => setShowAddModal(false)}><X size={20} className="text-zinc-500 hover:text-white"/></button>
                    </div>
                    <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                        <form onSubmit={handleSaveEvent} className="space-y-5">
                            {/* Type */}
                            <div>
                                <label className="text-xs text-zinc-400 block mb-1.5">{t('cal.type')}</label>
                                <div className="flex gap-2 overflow-x-auto pb-1">
                                    {['Toplantı', 'Montaj', 'Teslim Tarihi', 'Şube Transferi', 'Diğer'].map(type => (
                                        <button key={type} type="button" onClick={() => setNewEventForm({...newEventForm, type: type as any})}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap transition-all ${newEventForm.type === type ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}>
                                            {type === 'Şube Transferi' ? t('cal.type.transfer') : type}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            
                            {/* Title (If not transfer) */}
                            {newEventForm.type !== 'Şube Transferi' && (
                                <div>
                                    <label className="text-xs text-zinc-400 block mb-1.5">{t('cal.eventTitle')}</label>
                                    <input type="text" required value={newEventForm.title} onChange={e => setNewEventForm({...newEventForm, title: e.target.value})} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-white focus:border-indigo-500 outline-none" />
                                </div>
                            )}

                            {/* Transfer Logic */}
                            {newEventForm.type === 'Şube Transferi' && (
                                <div className="p-3 bg-orange-950/20 border border-orange-500/20 rounded-lg">
                                    <label className="text-xs font-bold text-orange-400 block mb-2">{t('cal.targetBranch')}</label>
                                    <div className="flex flex-wrap gap-2">
                                        {Object.values(Branch).map(branch => (
                                            <button key={branch} type="button" onClick={() => setTargetBranch(branch)} className={`px-2 py-1 text-xs rounded border ${targetBranch === branch ? 'bg-orange-600 text-white border-orange-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}>{branch}</button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Dates */}
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="text-xs text-zinc-400 block mb-1.5">{t('cal.startDate')}</label><input type="date" value={newEventForm.date} onChange={e => setNewEventForm({...newEventForm, date: e.target.value})} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm"/></div>
                                <div><label className="text-xs text-zinc-400 block mb-1.5">{t('cal.startTime')}</label><input type="time" value={newEventForm.startTime} onChange={e => setNewEventForm({...newEventForm, startTime: e.target.value})} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm"/></div>
                            </div>

                            {/* Attendees Selector */}
                            <div className="p-4 bg-zinc-950/50 border border-zinc-800 rounded-xl space-y-3">
                                <label className="text-xs font-medium text-zinc-400 block">{t('cal.branchFilter')}</label>
                                <div className="flex gap-2 flex-wrap">
                                    {Object.values(Branch).map(b => (
                                        <button key={b} type="button" onClick={() => toggleBranchSelection(b)} className={`px-2 py-1 text-[10px] rounded border ${selectedBranches.includes(b) ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-zinc-900 text-zinc-500 border-zinc-800'}`}>{b}</button>
                                    ))}
                                </div>
                                <div className="h-px bg-zinc-800"></div>
                                <label className="text-xs font-medium text-zinc-400 block">{t('cal.attendees')}</label>
                                <div className="flex gap-2 overflow-x-auto pb-1">
                                    {employees.map(emp => (
                                        <div key={emp.id} onClick={() => toggleAttendee(emp.id)} className={`cursor-pointer flex flex-col items-center gap-1 min-w-[50px] p-2 rounded-lg border transition-all ${newEventForm.attendees?.includes(emp.id) ? 'bg-indigo-500/20 border-indigo-500' : 'bg-zinc-900 border-zinc-800'}`}>
                                            <img src={emp.avatarUrl} className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
                                            <span className="text-[9px] text-zinc-400 truncate w-full text-center">{emp.name.split(' ')[0]}</span>
                                        </div>
                                    ))}
                                    {employees.length === 0 && <div className="text-xs text-zinc-500">{t('cal.loadingStaff')}</div>}
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="pt-4 flex gap-3">
                                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 py-3 bg-zinc-800 text-zinc-400 rounded-xl text-sm">{t('tasks.cancel')}</button>
                                <button type="submit" disabled={isSaving} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-lg">
                                    {isSaving ? '...' : t('cal.saveEvent')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        )}

        {/* --- LEFT PANEL: SUMMARY & NAV (HIDDEN ON MOBILE) --- */}
        <div className="w-full md:w-80 bg-zinc-950 border-b md:border-b-0 md:border-r border-zinc-800 flex-col hidden md:flex">
            <div className="p-6 border-b border-zinc-900">
                <h2 className="text-xl font-bold text-white mb-1">Ajanda</h2>
                <p className="text-xs text-zinc-500">Haftalık Planlama</p>
            </div>
            
            <div className="p-6 space-y-6 flex-1 overflow-y-auto">
                {/* Stats Card */}
                <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4 space-y-4">
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{t('cal.week')}</h3>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800">
                            <span className="text-2xl font-bold text-white block">{weekStats.total}</span>
                            <span className="text-[10px] text-zinc-500">{t('cal.totalEvent')}</span>
                        </div>
                        <div className="p-3 bg-indigo-950/30 rounded-lg border border-indigo-500/20">
                            <span className="text-2xl font-bold text-indigo-400 block">{weekStats.meetings}</span>
                            <span className="text-[10px] text-indigo-300/70">{t('cal.type.meeting')}</span>
                        </div>
                        <div className="p-3 bg-orange-950/30 rounded-lg border border-orange-500/20">
                            <span className="text-2xl font-bold text-orange-400 block">{weekStats.transfers}</span>
                            <span className="text-[10px] text-orange-300/70">Transfer</span>
                        </div>
                        <div className="p-3 bg-blue-950/30 rounded-lg border border-blue-500/20">
                            <span className="text-2xl font-bold text-blue-400 block">{weekStats.tasks}</span>
                            <span className="text-[10px] text-blue-300/70">Görev</span>
                        </div>
                    </div>
                </div>

                <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-2 h-2 rounded-full bg-green-500"></div>
                        <span className="text-xs text-zinc-300">{t('cal.today')}</span>
                    </div>
                    <div className="text-sm font-medium text-white">{formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                </div>
            </div>

            {currentUser.role === Role.ADMIN && (
                <div className="p-6 border-t border-zinc-900">
                    <button 
                        onClick={() => { setNewEventForm(p => ({...p, date: new Date().toISOString().split('T')[0]})); setShowAddModal(true); }}
                        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95"
                    >
                        <Plus size={18} /> {t('cal.newEvent')}
                    </button>
                </div>
            )}
        </div>

        {/* --- MAIN CONTENT: WEEKLY AGENDA LIST --- */}
        <div className="flex-1 flex flex-col h-full bg-zinc-950 relative">
            
            {/* Header / Week Nav */}
            <div className="p-4 md:p-6 border-b border-zinc-800 flex flex-col md:flex-row md:items-center gap-3 bg-zinc-950/90 backdrop-blur z-20 sticky top-0">
                <div className="flex items-center justify-between md:justify-start gap-4">
                    <div className="flex items-center gap-2">
                        <button onClick={() => changeWeek('prev')} className="p-2 hover:bg-zinc-900 rounded-lg text-zinc-400 hover:text-white transition-colors"><ChevronLeft size={20}/></button>
                        <h2 className="text-lg md:text-xl font-bold text-white text-center min-w-[150px]">
                            {formatDate(weekDays[0], {day: 'numeric', month: 'short'})} - {formatDate(weekDays[6], {day: 'numeric', month: 'short', year: 'numeric'})}
                        </h2>
                        <button onClick={() => changeWeek('next')} className="p-2 hover:bg-zinc-900 rounded-lg text-zinc-400 hover:text-white transition-colors"><ChevronRight size={20}/></button>
                    </div>

                    {/* Mobile Add Button */}
                    {activeTab === 'EVENTS' && (
                        <button
                            onClick={() => { setNewEventForm(p => ({...p, date: new Date().toISOString().split('T')[0]})); setShowAddModal(true); }}
                            className="md:hidden w-10 h-10 flex items-center justify-center bg-indigo-600 rounded-full text-white shadow-lg"
                        >
                            <Plus size={20} />
                        </button>
                    )}
                </div>

                {/* Tab Switcher */}
                <div className="flex bg-zinc-900 p-1 rounded-xl border border-zinc-800 md:ml-auto">
                    <button
                        onClick={() => setActiveTab('EVENTS')}
                        className={`flex-1 md:flex-none px-4 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                            activeTab === 'EVENTS'
                                ? 'bg-zinc-800 text-white shadow'
                                : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                    >
                        <List size={14} /> {t('cal.tabEvents')}
                    </button>
                    <button
                        onClick={() => setActiveTab('SHIFTS')}
                        className={`flex-1 md:flex-none px-4 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                            activeTab === 'SHIFTS'
                                ? 'bg-indigo-600 text-white shadow'
                                : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                    >
                        <Clock size={14} /> {t('cal.tabShifts')}
                    </button>
                </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-8">
                {activeTab === 'EVENTS' ? (
                    /* --- EVENTS TAB (mevcut haftalık ajanda) --- */
                    <div className="space-y-6">
                        {weekDays.map(day => {
                            const dateStr = day.toISOString().split('T')[0];
                            const isCurrentDay = isToday(day);

                            const dayEvents = combinedEvents.filter(e => {
                                if (!e.isTask && !e.isShift && e.endDate) return dateStr >= e.date && dateStr <= e.endDate;
                                return e.date === dateStr;
                            }).sort((a,b) => a.startTime.localeCompare(b.startTime));

                            return (
                                <div key={dateStr} className={`flex flex-col md:flex-row gap-4 md:gap-8 group ${dayEvents.length === 0 ? 'opacity-50 hover:opacity-80 transition-opacity' : ''}`}>
                                    <div className="md:w-32 flex-shrink-0 pt-2 flex md:flex-col items-center md:items-start gap-2 md:gap-0">
                                        <span className={`text-xs font-bold uppercase tracking-wider ${isCurrentDay ? 'text-indigo-400' : 'text-zinc-500'}`}>
                                            {formatDate(day, {weekday: 'long'})}
                                        </span>
                                        <div className={`text-2xl font-light ${isCurrentDay ? 'text-white' : 'text-zinc-400'}`}>
                                            {day.getDate()}
                                        </div>
                                        {isCurrentDay && <div className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded mt-1 hidden md:block">{t('cal.today')}</div>}
                                    </div>

                                    <div className="flex-1 space-y-3 pb-6 border-b border-zinc-800/50 group-last:border-none">
                                        {dayEvents.length === 0 ? (
                                            <div className="py-2 text-sm text-zinc-600 italic">{t('cal.noEvents')}</div>
                                        ) : (
                                            dayEvents.map(evt => (
                                                <div
                                                    key={evt.id}
                                                    onClick={() => setSelectedEvent(evt)}
                                                    className="bg-zinc-900/40 hover:bg-zinc-900 border border-zinc-800/60 hover:border-zinc-700 rounded-xl p-4 cursor-pointer transition-all hover:translate-x-1 group/card relative overflow-hidden"
                                                >
                                                    <div className={`absolute top-0 bottom-0 left-0 w-1 ${
                                                        evt.isTask ? 'bg-blue-500' :
                                                        evt.isShift ? 'bg-zinc-500' :
                                                        evt.type === 'Şube Transferi' ? 'bg-orange-500' :
                                                        evt.type === 'Toplantı' ? 'bg-indigo-500' : 'bg-zinc-500'
                                                    }`}></div>

                                                    <div className="flex justify-between items-start pl-3">
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className="text-xs font-mono text-zinc-500 flex items-center gap-1">
                                                                    <Clock size={12}/> {evt.startTime} - {evt.endTime}
                                                                </span>
                                                                {evt.type === 'Şube Transferi' && <span className="text-[10px] bg-orange-500/20 text-orange-400 px-1.5 rounded font-bold">TRANSFER</span>}
                                                                {evt.isShift && <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 rounded font-bold">VARDİYA</span>}
                                                            </div>
                                                            <h4 className="text-base font-bold text-zinc-200 group-hover/card:text-white transition-colors">{getText(evt.title)}</h4>
                                                            {evt.description && <p className="text-xs text-zinc-500 mt-1 line-clamp-1">{getText(evt.description)}</p>}
                                                        </div>

                                                        <div className="flex -space-x-2 pl-2">
                                                            {evt.attendees.slice(0, 3).map(id => {
                                                                const emp = employees.find(e => e.id === id);
                                                                return emp ? <img key={id} src={emp.avatarUrl} className="w-8 h-8 rounded-full border-2 border-zinc-900 bg-zinc-800" title={emp.name} referrerPolicy="no-referrer" /> : null;
                                                            })}
                                                            {evt.attendees.length > 3 && <div className="w-8 h-8 rounded-full bg-zinc-800 border-2 border-zinc-900 flex items-center justify-center text-[10px] text-zinc-400">+{evt.attendees.length-3}</div>}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        <div className="h-20"></div>
                    </div>
                ) : (
                    /* --- SHIFTS TAB (Çalışma Saatleri grid) --- */
                    <div>
                        {shiftGrid.size === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
                                <Clock size={48} className="mb-4 opacity-30" />
                                <p className="text-sm">{t('cal.noShifts')}</p>
                            </div>
                        ) : (
                            <div className="space-y-8">
                                {Array.from(shiftGrid.entries()).map(([branch, empList]) => (
                                    <div key={branch} className="bg-zinc-900/30 rounded-xl border border-zinc-800 overflow-hidden">
                                        {/* Branch Header */}
                                        <div className="px-4 py-3 bg-zinc-900/50 border-b border-zinc-800 flex items-center gap-2">
                                            <Building2 size={16} className="text-indigo-400" />
                                            <span className="text-sm font-bold text-white">{branch}</span>
                                            <span className="text-xs text-zinc-500 ml-auto">{empList.length} {t('cal.personnel')}</span>
                                        </div>

                                        {/* Grid Table */}
                                        <div className="overflow-x-auto custom-scrollbar">
                                            <table className="w-full min-w-[640px]">
                                                <thead>
                                                    <tr className="border-b border-zinc-800/50">
                                                        <th className="text-left px-4 py-2.5 text-xs text-zinc-500 font-medium w-44">{t('cal.personnel')}</th>
                                                        {weekDays.map((day, i) => (
                                                            <th key={i} className={`text-center px-2 py-2.5 text-xs font-medium ${isToday(day) ? 'text-indigo-400' : 'text-zinc-500'}`}>
                                                                <div>{formatDate(day, {weekday: 'short'})}</div>
                                                                <div className={`text-[10px] mt-0.5 ${isToday(day) ? 'text-indigo-300' : 'text-zinc-600'}`}>{day.getDate()}</div>
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {empList.map(({ employee, days }) => (
                                                        <tr key={employee.id} className="border-b border-zinc-800/30 hover:bg-zinc-900/40 transition-colors">
                                                            <td className="px-4 py-3">
                                                                <div className="flex items-center gap-2.5">
                                                                    <img src={employee.avatarUrl} className="w-7 h-7 rounded-full border border-zinc-700" referrerPolicy="no-referrer" />
                                                                    <span className="text-sm text-zinc-200 font-medium truncate max-w-[120px]">{employee.name}</span>
                                                                </div>
                                                            </td>
                                                            {weekDays.map((day, dayIndex) => {
                                                                const slots = days.get(dayIndex);
                                                                const isCurrent = isToday(day);
                                                                return (
                                                                    <td key={dayIndex} className={`text-center px-2 py-3 ${isCurrent ? 'bg-indigo-950/20' : ''}`}>
                                                                        {slots ? (
                                                                            slots.map((slot, si) => (
                                                                                <div key={si} className="text-[11px] bg-indigo-500/15 text-indigo-300 rounded-md px-2 py-1 mb-0.5 font-mono whitespace-nowrap">
                                                                                    {slot}
                                                                                </div>
                                                                            ))
                                                                        ) : (
                                                                            <span className="text-zinc-700 text-xs">--</span>
                                                                        )}
                                                                    </td>
                                                                );
                                                            })}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="h-20"></div>
                    </div>
                )}
            </div>
        </div>

        {/* --- DETAIL PANEL (SLIDE OVER) --- */}
        {selectedEvent && (
            <div className="fixed inset-0 z-[200] flex justify-end bg-black/50 backdrop-blur-sm animate-in fade-in" onClick={() => setSelectedEvent(null)}>
                <div className="w-full md:w-[400px] h-full bg-zinc-950 border-l border-zinc-800 p-6 flex flex-col shadow-2xl animate-in slide-in-from-right duration-300" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-start mb-8">
                        <div>
                            <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{selectedEvent.isTask ? t('cal.taskDetail') : selectedEvent.isShift ? t('cal.shiftDetail') : t('cal.eventDetail')}</span>
                            <h2 className="text-2xl font-bold text-white mt-2 leading-tight">{getText(selectedEvent.title)}</h2>
                        </div>
                        <button onClick={() => setSelectedEvent(null)} className="p-2 bg-zinc-900 rounded-lg text-zinc-400 hover:text-white"><X size={20}/></button>
                    </div>

                    <div className="space-y-6 flex-1 overflow-y-auto">
                        <div className="flex items-center gap-4 text-zinc-300">
                            <div className="w-10 h-10 rounded-lg bg-zinc-900 flex items-center justify-center border border-zinc-800"><CalendarIcon size={20}/></div>
                            <div>
                                <p className="text-xs text-zinc-500">Tarih</p>
                                <p className="font-medium">{formatDate(selectedEvent.date, {day:'numeric', month:'long', year: 'numeric'})}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4 text-zinc-300">
                            <div className="w-10 h-10 rounded-lg bg-zinc-900 flex items-center justify-center border border-zinc-800"><Clock size={20}/></div>
                            <div>
                                <p className="text-xs text-zinc-500">Saat</p>
                                <p className="font-medium">{selectedEvent.startTime} - {selectedEvent.endTime}</p>
                            </div>
                        </div>
                        
                        <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
                            <h4 className="text-xs font-bold text-zinc-500 uppercase mb-2">Açıklama</h4>
                            <p className="text-sm text-zinc-300 leading-relaxed">{getText(selectedEvent.description) || 'Açıklama yok.'}</p>
                        </div>

                        <div>
                            <h4 className="text-xs font-bold text-zinc-500 uppercase mb-3">Katılımcılar ({selectedEvent.attendees.length})</h4>
                            <div className="space-y-2">
                                {selectedEvent.attendees.map(id => {
                                    const emp = employees.find(e => e.id === id);
                                    return emp ? (
                                        <div key={id} className="flex items-center gap-3 p-2 rounded-lg bg-zinc-900/30 border border-zinc-800/50">
                                            <img src={emp.avatarUrl} className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
                                            <div>
                                                <p className="text-sm font-bold text-zinc-200">{emp.name}</p>
                                                <p className="text-[10px] text-zinc-500">Havuz</p>
                                            </div>
                                        </div>
                                    ) : null;
                                })}
                            </div>
                        </div>
                    </div>

                    {!selectedEvent.isTask && !selectedEvent.isShift && (
                        <div className="pt-6 border-t border-zinc-800">
                            <button onClick={handleDeleteEvent} className="w-full py-3 bg-red-900/20 text-red-400 border border-red-900/30 rounded-xl text-sm font-bold hover:bg-red-900/40 transition-colors flex items-center justify-center gap-2">
                                <Trash2 size={16}/> {t('cal.deleteEvent')}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        )}
    </div>
  );
};

export default Calendar;