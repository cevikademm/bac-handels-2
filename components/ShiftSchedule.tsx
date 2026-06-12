import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useLanguage } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { Branch, Employee, Role } from '../types';
import { Save, ChevronLeft, ChevronRight, Copy, Plus, Trash2, Loader2, AlertTriangle, CheckCircle2, Lock, Send, Undo2, X } from 'lucide-react';
import { includeAsPersonnel, canEditShiftSchedule, canViewShiftDraft } from '../constants';
import { supabase } from '../lib/supabase';
import { formatLocalDate, parseCellIds, joinCellIds } from '../lib/utils';
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

// Vardiya satırlarını başlangıç saatine göre artan sırada diz.
// Adminler için kritik: kopyalama/oluşturma sırası ne olursa olsun tablo
// her zaman erken saatten geç saate doğru görünmeli. Aynı başlangıçta bitiş
// saatine bakılır; saati parse edilemeyen / boş satırlar (henüz doldurulmamış
// yeni satırlar) en sona alınır.
const sortRosterByTime = (rows: RosterRow[]): RosterRow[] => {
    return [...rows].sort((a, b) => {
        const ra = parseTimeRange(a.timeLabel);
        const rb = parseTimeRange(b.timeLabel);
        if (!ra && !rb) return 0;
        if (!ra) return 1;
        if (!rb) return -1;
        if (ra.start !== rb.start) return ra.start - rb.start;
        return ra.end - rb.end;
    });
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
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  // Mobil header inline-style paleti — light'ta BAC marka kırmızı/beyaz, dark'ta indigo/zinc
  const mobilePalette = isDark
    ? {
        cellBg: '#18181b', cellBorder: '#27272a', cellText: '#71717a',
        activeBg: '#4f46e5', activeBorder: '#6366f1', activeText: '#ffffff',
        primaryBg: '#4f46e5', primaryText: '#ffffff',
        successBg: '#16a34a', successText: '#ffffff',
        muted: '#a1a1aa', strong: '#ffffff', divider: '#71717a',
        badgeBg: '#10b981', badgeShadow: '0 0 0 2px #09090b',
        activeBadgeBg: '#ffffff', activeBadgeText: '#4f46e5',
      }
    : {
        cellBg: '#ffffff', cellBorder: '#ffe4e9', cellText: '#7a4855',
        activeBg: '#dd2d4a', activeBorder: '#dd2d4a', activeText: '#ffffff',
        primaryBg: '#dd2d4a', primaryText: '#ffffff',
        successBg: '#16a34a', successText: '#ffffff',
        muted: '#7a4855', strong: '#1a0a0e', divider: '#a47480',
        badgeBg: '#10b981', badgeShadow: '0 0 0 2px #ffffff',
        activeBadgeBg: '#ffffff', activeBadgeText: '#dd2d4a',
      };
  // Görüntüleme yetkisi: tüm adminler planın tamamını (tüm satır + isimler) görür.
  const isAdmin = currentUser.role === Role.ADMIN;
  // Düzenleme yetkisi: yalnızca süper adminler (seda + cevikademm) değişiklik yapar.
  // Diğer adminler salt-okunur görür; mutasyon fonksiyonları ve edit UI'ı kapalıdır.
  const canEdit = isAdmin && canEditShiftSchedule(currentUser.email);
  // Taslak görüntüleme yetkisi: yalnızca cevikadem, seda, hakan, gurcan
  // yayınlanmamış (taslak) planı görür. Diğer herkes (personel + Apo/Malik gibi
  // şube adminleri) yalnızca "Yayınla" sonrası yayınlanmış satırları görür.
  // DB tarafında shift_get_week_rows + shift_can_view_draft ile zorlanır;
  // bu yüzden taslak satırları yetkisiz cihaza REST/realtime ile hiç ulaşmaz.
  const canViewDraft = isAdmin && canViewShiftDraft(currentUser.email);

  // Personel artık şubeye bağlı değil - admin tüm şubeleri görür, personel de tüm şubeleri görebilir
  const [activeBranch, setActiveBranch] = useState<string>(Branch.MULHEIM);

  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(getMonday(new Date()));
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [rosterData, setRosterData] = useState<RosterRow[]>([]);
  const [availableEmployees, setAvailableEmployees] = useState<Employee[]>([]);

  // Diğer şubelerdeki tüm atamalar - çakışma kontrolü için
  const [otherBranchSchedules, setOtherBranchSchedules] = useState<{ branch: string; timeLabel: string; assignments: string[] }[]>([]);

  // Onay/yayınlama durumu — week_start_date + branch için tek kayıt
  // Yayında değilse personeller boş tablo + uyarı görür.
  const [publication, setPublication] = useState<{ id: string; publishedAt: string; publishedByName: string | null } | null>(null);
  const [publishLoading, setPublishLoading] = useState(false);
  const isPublished = publication !== null;

  // Hangi hücrede "+ Kişi ekle" dropdown'ı açık? Format: `${row.id}_${dayIdx}`
  // Aynı anda yalnızca bir hücre açıktır; seçim sonrası veya blur'da kapanır.
  const [openAddCell, setOpenAddCell] = useState<string | null>(null);

  const weekKey = formatLocalDate(currentWeekStart);
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
      fetchPublication();
  }, [activeBranch, weekKey]);

  // Mobil: uygulama/sekme odağa gelince veriyi yenile
  useEffect(() => {
      const handleVisibility = () => {
          if (document.visibilityState === 'visible') {
              fetchWeekData();
              fetchOtherBranchData();
              fetchPublication();
          }
      };
      const handleFocus = () => {
          fetchWeekData();
          fetchOtherBranchData();
          fetchPublication();
      };
      document.addEventListener('visibilitychange', handleVisibility);
      window.addEventListener('focus', handleFocus);
      // Realtime düşerse savunma katmanı: 45 saniyede bir yayın durumunu yenile.
      // Personel cihazında admin yayını geri çektikten en geç 45sn sonra tablo gizlenir.
      // Taslak görüntüleyiciler için satırları da yenile: yayın-bazlı RLS sonrası
      // realtime taslak satır değişikliklerini iletmez, bu süper-adminler arası
      // canlı taslak senkronunu (en geç 45sn) korur.
      const intervalId = window.setInterval(() => {
          fetchPublication();
          if (canViewDraft) fetchWeekData();
      }, 45_000);
      return () => {
          document.removeEventListener('visibilitychange', handleVisibility);
          window.removeEventListener('focus', handleFocus);
          window.clearInterval(intervalId);
      };
  }, [activeBranch, weekKey]);

  // Realtime: bu hafta + şube için yayın durumu ve vardiya satırları
  // değişiklikleri tüm cihazlara anlık yansısın. Admin1 onaylar, Admin2 ve
  // personel cihazında banner ve liste sayfa yenilenmeden güncellenir.
  useEffect(() => {
      const branchStr = String(activeBranch);
      const channel = supabase
          .channel(`shift-live-${weekKey}-${branchStr}`)
          .on(
              'postgres_changes',
              {
                  event: '*',
                  schema: 'public',
                  table: 'shift_publications',
                  filter: `week_start_date=eq.${weekKey}`,
              },
              (payload: any) => {
                  const row = payload.new || payload.old;
                  // Aynı şube olmayan kayıtları ele alma (filter date bazlı,
                  // şube ek olarak burada doğrulanır)
                  if (row?.branch !== branchStr) return;
                  if (!isMounted.current) return;

                  if (payload.eventType === 'DELETE') {
                      setPublication(null);
                      // Şube rozet sayımı: bu şubenin yayın listesinden çıkar
                      setPublishedBranches(prev => {
                          const next = new Set(prev);
                          next.delete(branchStr);
                          return next;
                      });
                  } else if (payload.new) {
                      setPublication({
                          id: payload.new.id,
                          publishedAt: payload.new.published_at,
                          publishedByName: payload.new.published_by_name,
                      });
                      setPublishedBranches(prev => new Set(prev).add(branchStr));
                  }
              }
          )
          .on(
              'postgres_changes',
              {
                  event: '*',
                  schema: 'public',
                  table: 'shift_schedules',
                  filter: `week_start_date=eq.${weekKey}`,
              },
              (payload: any) => {
                  const row = payload.new || payload.old;
                  if (!isMounted.current) return;
                  // Mevcut şubedeki değişiklikse rosterData yenilensin;
                  // diğer şubedeki değişiklikse çakışma kontrol verisi yenilensin.
                  if (row?.branch === branchStr) {
                      fetchWeekData();
                  } else {
                      fetchOtherBranchData();
                  }
              }
          )
          .subscribe();

      return () => {
          supabase.removeChannel(channel);
      };
  }, [weekKey, activeBranch]);

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

  // Vardiya satırları yalnızca shift_get_week_rows RPC'si üzerinden okunur.
  // RPC, caller_id'yi doğrular: taslak görme yetkisi yoksa SADECE yayınlanmış
  // satırları döner. Doğrudan .from('shift_schedules') artık taslağı sızdırmaz.
  const fetchWeekData = async () => {
      setIsLoading(true);
      try {
          const { data, error } = await supabase.rpc('shift_get_week_rows', {
              p_caller_id: currentUser.id,
              p_week: weekKey,
              p_branch: String(activeBranch),
          });
          if (!isMounted.current) return;
          if (error) { console.error('fetchWeekData error:', error); }
          if (data) setRosterData(sortRosterByTime(data.map((r: any) => ({ id: r.id, timeLabel: r.time_slot || '', assignments: Array.isArray(r.days) ? r.days : Array(7).fill('') }))));
      } catch (err: any) { console.error(err); } finally { if (isMounted.current) setIsLoading(false); }
  };

  // Diğer şubelerin aynı hafta verilerini çek - çakışma kontrolü için.
  // RPC ile tüm haftayı (taslak yetkisine göre) çekip mevcut şubeyi ayıkla.
  const fetchOtherBranchData = async () => {
      try {
          const { data } = await supabase.rpc('shift_get_week_rows', {
              p_caller_id: currentUser.id,
              p_week: weekKey,
              p_branch: null,
          });
          if (!isMounted.current) return;
          if (data) {
              setOtherBranchSchedules(
                  data
                      .filter((r: any) => String(r.branch) !== String(activeBranch))
                      .map((r: any) => ({
                          branch: r.branch,
                          timeLabel: r.time_slot || '',
                          assignments: r.days || Array(7).fill('')
                      }))
              );
          }
      } catch (err) { console.error(err); }
  };

  // Bu hafta + şube için onay/yayın kaydını çek. Yoksa null kalır = taslak.
  const fetchPublication = async () => {
      try {
          const { data } = await supabase
              .from('shift_publications')
              .select('id, published_at, published_by_name')
              .eq('week_start_date', weekKey)
              .eq('branch', String(activeBranch))
              .maybeSingle();
          if (!isMounted.current) return;
          if (data) {
              setPublication({
                  id: data.id,
                  publishedAt: data.published_at,
                  publishedByName: data.published_by_name,
              });
          } else {
              setPublication(null);
          }
      } catch (err) {
          // Tablo henüz oluşturulmamış olabilir — sessizce taslak say
          if (isMounted.current) setPublication(null);
      }
  };

  // Tablo henüz Supabase'de oluşturulmamışsa PostgREST "Could not find the table"
  // veya "schema cache" mesajı döndürür. Bu durumu yakalayıp kullanıcıya net
  // talimat veren bir mesaj gösteririz (log'a değil — admin SQL'i bilmeyebilir).
  const isMissingTableError = (err: any): boolean => {
      const msg = String(err?.message || err?.code || '').toLowerCase();
      return msg.includes('shift_publications') &&
             (msg.includes('could not find') || msg.includes('schema cache') || msg.includes('does not exist'));
  };

  const publishWeek = async () => {
      if (!canEdit) return;
      if (rosterData.length === 0) {
          alert(t('shift.publishEmptyError'));
          return;
      }
      if (!confirm(t('shift.publishConfirm'))) return;
      setPublishLoading(true);
      try {
          const { data, error } = await supabase.rpc('shift_publish', {
              p_caller_id: currentUser.id,
              p_week: weekKey,
              p_branch: String(activeBranch),
              p_published_by: currentUser.id,
              p_published_by_name: currentUser.name,
          });
          if (error) throw error;
          if (isMounted.current && data) {
              setPublication({
                  id: data.id,
                  publishedAt: data.published_at,
                  publishedByName: data.published_by_name,
              });
          }
      } catch (err: any) {
          console.error('publishWeek error:', err);
          if (isMissingTableError(err)) {
              alert(t('shift.missingTableHelp'));
          } else {
              alert(t('shift.publishError') + (err?.message || ''));
          }
      } finally {
          if (isMounted.current) setPublishLoading(false);
      }
  };

  const unpublishWeek = async () => {
      if (!canEdit || !publication) return;
      if (!confirm(t('shift.unpublishConfirm'))) return;
      setPublishLoading(true);
      try {
          const { error } = await supabase.rpc('shift_unpublish', {
              p_caller_id: currentUser.id,
              p_id: publication.id,
          });
          if (error) throw error;
          if (isMounted.current) setPublication(null);
      } catch (err: any) {
          console.error('unpublishWeek error:', err);
          if (isMissingTableError(err)) {
              alert(t('shift.missingTableHelp'));
          } else {
              alert(t('shift.unpublishError') + (err?.message || ''));
          }
      } finally {
          if (isMounted.current) setPublishLoading(false);
      }
  };

  // Çakışma kontrolü: Bir personelin belirli bir günde diğer şubelerde çakışan vardiyası var mı?
  // Diğer şubedeki hücre artık CSV olabilir — parseCellIds ile tüm ID'leri kontrol ederiz.
  const getConflict = (employeeId: string, dayIndex: number, currentTimeLabel: string): string | null => {
      if (!employeeId) return null;
      const currentRange = parseTimeRange(currentTimeLabel);
      if (!currentRange) return null;

      for (const schedule of otherBranchSchedules) {
          const otherRange = parseTimeRange(schedule.timeLabel);
          if (!otherRange) continue;
          if (parseCellIds(schedule.assignments[dayIndex]).includes(employeeId) && timeRangesOverlap(currentRange, otherRange)) {
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
                      if (parseCellIds(otherSchedule.assignments[dayIdx]).includes(emp.id) && timeRangesOverlap(currentRange, otherRange)) {
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
      if (!canEdit) return;
      setIsSaving(true);
      try {
          const isExisting = !!row.id && !row.id.startsWith('temp_');
          // Yazma artık SECURITY DEFINER RPC üzerinden — yetki DB'de doğrulanır,
          // eski sürümdeki adminlerin doğrudan REST yazması engellenir.
          const { data, error } = await supabase.rpc('shift_save_row', {
              p_caller_id: currentUser.id,
              p_id: isExisting ? row.id : null,
              p_week: weekKey,
              p_branch: String(activeBranch),
              p_time_slot: row.timeLabel,
              p_days: row.assignments,
          });
          if (error) throw error;
          // Yeni satır → geçici temp_ id'yi gerçek DB id'siyle değiştir.
          if (!isExisting && data && isMounted.current) {
              setRosterData(prev => prev.map(r => r.id === row.id ? { ...r, id: (data as any).id } : r));
          }
      } catch (err) { console.error(err); } finally { if (isMounted.current) setIsSaving(false); }
  };

  // Ortak hücre mutasyon helper'ı — yeni ID dizisini hesaplayıp CSV olarak
  // assignments[dayIndex]'e yazar ve DB'ye kaydeder. Aşağıdaki add/remove/replace
  // handler'ları bunu kullanır; "tek hücre = tek string" olarak ham veri kalır.
  const mutateCell = (rowId: string | undefined, dayIndex: number, mutator: (currentIds: string[]) => string[]) => {
      if (!canEdit) return;
      const updatedRows = rosterData.map(row => {
          if (row.id !== rowId) return row;
          const currentIds = parseCellIds(row.assignments[dayIndex]);
          const nextIds = mutator(currentIds);
          const newAssignments = [...row.assignments];
          newAssignments[dayIndex] = joinCellIds(nextIds);
          return { ...row, assignments: newAssignments };
      });
      setRosterData(updatedRows);
      const rowToSave = updatedRows.find(r => r.id === rowId);
      if (rowToSave) saveRowToDb(rowToSave);
  };

  // Çakışma uyarısı + onay; kullanıcı reddederse false dön.
  const confirmIfConflict = (employeeId: string, dayIndex: number, timeLabel: string): boolean => {
      if (!employeeId) return true;
      const conflict = getConflict(employeeId, dayIndex, timeLabel);
      if (!conflict) return true;
      const empName = availableEmployees.find(e => e.id === employeeId)?.name || '';
      return confirm(t('shift.conflictWarn').replace('{name}', empName).replace('{conflict}', conflict));
  };

  // Hücreye yeni kişi ekle (zaten varsa eklemez)
  const addAssignment = (rowId: string | undefined, dayIndex: number, employeeId: string) => {
      if (!canEdit || !employeeId) return;
      const row = rosterData.find(r => r.id === rowId);
      if (!row) return;
      if (!confirmIfConflict(employeeId, dayIndex, row.timeLabel)) return;
      mutateCell(rowId, dayIndex, ids => ids.includes(employeeId) ? ids : [...ids, employeeId]);
  };

  // Hücreden bir kişiyi çıkar
  const removeAssignment = (rowId: string | undefined, dayIndex: number, employeeId: string) => {
      if (!canEdit || !employeeId) return;
      mutateCell(rowId, dayIndex, ids => ids.filter(id => id !== employeeId));
  };

  // Hücredeki bir kişiyi başka biriyle değiştir (mevcut select onChange için)
  const replaceAssignment = (rowId: string | undefined, dayIndex: number, oldId: string, newId: string) => {
      if (!canEdit) return;
      const row = rosterData.find(r => r.id === rowId);
      if (!row) return;
      if (newId && !confirmIfConflict(newId, dayIndex, row.timeLabel)) return;
      mutateCell(rowId, dayIndex, ids => {
          if (!newId) return ids.filter(id => id !== oldId); // boş seçilirse kaldır
          // Sırayı koruyarak swap; yeni ID zaten varsa dedup için filtre
          const seen = new Set<string>();
          const result: string[] = [];
          for (const id of ids) {
              const candidate = id === oldId ? newId : id;
              if (!seen.has(candidate)) { result.push(candidate); seen.add(candidate); }
          }
          return result;
      });
  };

  const handleTimeLabelChange = (rowId: string | undefined, newLabel: string) => {
      if (!canEdit) return;
      setRosterData(prev => prev.map(row => row.id === rowId ? { ...row, timeLabel: newLabel } : row));
  };

  const addNewRow = async () => {
      if (!canEdit) return;
      const newRow: RosterRow = { id: `temp_${Date.now()}`, timeLabel: '', assignments: Array(7).fill('') };
      setRosterData([...rosterData, newRow]);
  };

  const deleteRow = async (rowId: string) => {
      if (!canEdit) return;
      if(!confirm(t('shift.deleteConfirm'))) return;
      setRosterData(prev => prev.filter(r => r.id !== rowId));
      if (rowId && !rowId.startsWith('temp_')) {
          const { error } = await supabase.rpc('shift_delete_row', { p_caller_id: currentUser.id, p_id: rowId });
          if (error) console.error('deleteRow error:', error);
      }
  };

  const handleManualSave = async () => {
      await fetchWeekData();
      await fetchOtherBranchData();
  };

  const handleCopyNextWeek = async () => {
      if (!canEdit || isLoading) return;
      // Boş roster ile kopyalama → hedef haftanın delete'i çalışır ama insert
      // çalışmaz, sessizce veri kaybı olur. publishWeek aynı pattern'i blokluyor.
      if (rosterData.length === 0) {
          alert(t('shift.copyEmptyError'));
          return;
      }
      const nextWeekDate = new Date(currentWeekStart);
      nextWeekDate.setDate(nextWeekDate.getDate() + 7);
      const nextWeekKey = formatLocalDate(nextWeekDate);

      // Hedef hafta zaten yayındaysa içerik ezildiğinde personel eski
      // "yayında" banner'ını yeni içerikle görür. İkinci onay al ve başarılı
      // kopya sonrası yayın kaydını düşür — taze onay gerekiyor.
      let existingPubId: string | null = null;
      try {
          const { data: pub } = await supabase
              .from('shift_publications')
              .select('id')
              .eq('week_start_date', nextWeekKey)
              .eq('branch', String(activeBranch))
              .maybeSingle();
          if (pub) existingPubId = pub.id;
      } catch {
          // shift_publications tablosu henüz yoksa eski davranışa düş
      }
      if (existingPubId && !confirm(t('shift.copyOverridePublishedConfirm').replace('{date}', formatDate(nextWeekDate)))) {
          return;
      }

      if (!confirm(t('shift.copyConfirm').replace('{date}', formatDate(nextWeekDate)))) return;

      setIsLoading(true);
      try {
          // Saat sırasına göre kopyala — hedef haftada da erken→geç düzeninde insert et.
          // (Hedef hafta fetch'i ayrıca sortRosterByTime uygular; bu insert sırası
          //  created_at sırasının da doğru olmasını garantiler.)
          // Tek RPC: hedef hafta+şube satırlarını siler, yeniden ekler ve hedef
          // haftanın yayın kaydını düşürür (taze onay gerekir). Yetki DB'de kontrol edilir.
          const rows = sortRosterByTime(rosterData).map(row => ({
              time_slot: row.timeLabel,
              days: row.assignments,
          }));

          const { error: rpcErr } = await supabase.rpc('shift_replace_week', {
              p_caller_id: currentUser.id,
              p_week: nextWeekKey,
              p_branch: String(activeBranch),
              p_rows: rows,
          });
          if (rpcErr) throw rpcErr;

          if (isMounted.current) setCurrentWeekStart(nextWeekDate);
      } catch (err: any) {
          console.error('handleCopyNextWeek error:', err);
          alert(t('shift.copyError') + (err?.message || ''));
      } finally {
          if (isMounted.current) setIsLoading(false);
      }
  };

  // Tüm personel havuzdan gösterilir - şube filtresi yok
  const filteredEmployees = availableEmployees;
  // Personel: sadece yayınlanmış haftalarda kendine ait satırları görür.
  // Yayınlanmamışsa boş tablo + uyarı (ayrı render edilir).
  const displayedRows = isAdmin
      ? rosterData
      : (isPublished
          ? rosterData.filter(row => row.assignments.some(cell => parseCellIds(cell).includes(currentUser.id)))
          : []);


  // --- Şube başına kullanıcının haftalık vardiya sayısı (badge için) ---
  const [allWeekSchedules, setAllWeekSchedules] = useState<any[]>([]);
  // Bu hafta yayında olan şubeler — personel için badge'lerin yayınlanmamış
  // şubeleri saymaması gerekir, yoksa onaylanmamış vardiyayı sızdırırız.
  const [publishedBranches, setPublishedBranches] = useState<Set<string>>(new Set());

  useEffect(() => {
      const fetchAllWeekSchedules = async () => {
          // RPC: taslak yetkisi yoksa yalnızca yayınlanmış satırlar döner →
          // personel rozet sayımı onaylanmamış vardiyayı asla saymaz.
          const { data } = await supabase.rpc('shift_get_week_rows', {
              p_caller_id: currentUser.id,
              p_week: weekKey,
              p_branch: null,
          });
          if (data && isMounted.current) setAllWeekSchedules(data);
      };
      const fetchPublishedBranches = async () => {
          try {
              const { data } = await supabase
                  .from('shift_publications')
                  .select('branch')
                  .eq('week_start_date', weekKey);
              if (!isMounted.current) return;
              setPublishedBranches(new Set((data || []).map((r: any) => r.branch)));
          } catch {
              if (isMounted.current) setPublishedBranches(new Set());
          }
      };
      fetchAllWeekSchedules();
      fetchPublishedBranches();
      // Yayın durumu değişince (publish/unpublish) mevcut şube satırlarını da
      // yenile: taslak görme yetkisi olmayan kullanıcılar yayınlanan satırları
      // RLS'ten artık okuyabildiği için tablonun anında dolması/boşalması gerekir.
      fetchWeekData();
  }, [weekKey, publication]);

  const branchShiftCounts = useMemo((): Map<string, number> => {
      const counts = new Map<string, number>();
      allWeekSchedules.forEach((schedule: any) => {
          const branch = schedule.branch;
          // Taslak görme yetkisi olmayan herkes için onaylanmamış şube sayımı sızmasın.
          // (allWeekSchedules zaten RPC'den yetkiye göre süzülü gelir; bu ek savunma katmanı.)
          if (!canViewDraft && !publishedBranches.has(branch)) return;
          const days: string[] = schedule.days || [];
          // Hücre CSV olabilir — her hücredeki ID'leri ayrı kontrol et
          const userDays = days.filter((cell: string) => parseCellIds(cell).includes(currentUser.id)).length;
          if (userDays > 0) {
              counts.set(branch, (counts.get(branch) || 0) + userDays);
          }
      });
      return counts;
  }, [allWeekSchedules, currentUser, canViewDraft, publishedBranches]);

  return (
    <div className="h-full w-full flex flex-col bg-[#09090b] relative overflow-hidden">

      {/* HEADER */}
      <div className="p-2 xl:p-4 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/80 backdrop-blur-md sticky top-0 z-30 shrink-0">

          {/* ── MOBİL HEADER ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 4px' }} className="xl:hidden">
              {/* 3x2 Grid: 5 şube + 1 tarih — tüm hücreler eşit */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                  {Object.values(Branch).map(b => {
                      const count = branchShiftCounts.get(b) || 0;
                      return (
                          <button key={b} onClick={() => setActiveBranch(b)} style={{ position: 'relative', minHeight: '48px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', border: '1px solid', transition: 'all 0.2s', borderColor: activeBranch === b ? mobilePalette.activeBorder : mobilePalette.cellBorder, backgroundColor: activeBranch === b ? mobilePalette.activeBg : mobilePalette.cellBg, color: activeBranch === b ? mobilePalette.activeText : mobilePalette.cellText }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 4px' }}>{b}</span>
                              {count > 0 && (
                                  <span style={{ position: 'absolute', top: '-8px', right: '-8px', minWidth: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '9999px', fontSize: '10px', fontWeight: 900, padding: '0 6px', boxShadow: mobilePalette.badgeShadow, backgroundColor: activeBranch === b ? mobilePalette.activeBadgeBg : mobilePalette.badgeBg, color: activeBranch === b ? mobilePalette.activeBadgeText : '#fff' }}>
                                      {count}
                                  </span>
                              )}
                          </button>
                      );
                  })}
                  {/* Tarih sekmesi — 6. hücre, şubelerle aynı boyut */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: mobilePalette.cellBg, borderRadius: '12px', border: `1px solid ${mobilePalette.cellBorder}`, minHeight: '48px' }}>
                      <button onClick={() => handleWeekChange('prev')} style={{ padding: '6px', color: mobilePalette.muted, flexShrink: 0 }}><ChevronLeft size={16}/></button>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: mobilePalette.strong, textAlign: 'center', flex: 1, lineHeight: 1.3 }}>
                          <span>{formatDate(currentWeekStart, { day: 'numeric', month: 'short' })}</span>
                          <span style={{ color: mobilePalette.divider, margin: '0 2px' }}>-</span>
                          <span>{formatDate(currentWeekEnd, { day: 'numeric', month: 'short' })}</span>
                      </div>
                      <button onClick={() => handleWeekChange('next')} style={{ padding: '6px', color: mobilePalette.muted, flexShrink: 0 }}><ChevronRight size={16}/></button>
                  </div>
              </div>

              {/* Admin butonları — yalnızca düzenleme yetkisi olan süper adminlere */}
              {canEdit && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                      <button onClick={handleCopyNextWeek} disabled={isLoading} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: mobilePalette.cellBg, border: `1px solid ${mobilePalette.cellBorder}`, borderRadius: '12px', color: mobilePalette.muted, minHeight: '44px', opacity: isLoading ? 0.5 : 1, cursor: isLoading ? 'not-allowed' : 'pointer' }} title={t('shift.copyTitle')}>{isLoading ? <Loader2 size={18} className="animate-spin" /> : <Copy size={18} />}</button>
                      <button onClick={addNewRow} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: mobilePalette.primaryBg, border: 'none', borderRadius: '12px', color: mobilePalette.primaryText, fontWeight: 700, minHeight: '44px' }} title={t('shift.newRow')}><Plus size={18} /></button>
                      <button onClick={handleManualSave} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: mobilePalette.successBg, border: 'none', borderRadius: '12px', color: mobilePalette.successText, fontWeight: 700, minHeight: '44px' }} title={t('shift.saveTitle')}>{isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}</button>
                  </div>
              )}
          </div>

          {/* ── MASAÜSTÜ HEADER ── */}
          <div className="hidden xl:flex justify-between items-center gap-6">
              <div className="flex items-center gap-4">
                  {Object.values(Branch).map(b => {
                      const count = branchShiftCounts.get(b) || 0;
                      return (
                          <button key={b} onClick={() => setActiveBranch(b)} className={`relative px-5 py-2.5 rounded-xl text-sm font-bold transition-all border flex items-center justify-center min-h-[44px] ${activeBranch === b ? 'bg-indigo-600 text-slate-900 dark:text-white border-indigo-500' : 'bg-white dark:bg-zinc-900 text-slate-500 dark:text-zinc-500 border-slate-200 dark:border-zinc-800'}`}>
                              <span>{b}</span>
                              {count > 0 && (
                                  <span className={`absolute -top-2 -right-2 min-w-[20px] h-5 flex items-center justify-center rounded-full text-[10px] font-black px-1.5 shadow-lg ring-2 ring-zinc-950 ${activeBranch === b ? 'bg-white text-indigo-600' : 'bg-emerald-500 text-slate-900 dark:text-white shadow-emerald-500/30'}`}>
                                      {count}
                                  </span>
                              )}
                          </button>
                      );
                  })}
              </div>
              <div className="flex items-center gap-2">
                  <div className="flex items-center bg-white dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800 p-1">
                      <button onClick={() => handleWeekChange('prev')} className="p-2 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"><ChevronLeft size={20}/></button>
                      <div className="px-4 text-center min-w-[140px] text-sm font-bold text-slate-900 dark:text-white">{formatDate(currentWeekStart, { day: 'numeric', month: 'short' })} - {formatDate(currentWeekEnd, { day: 'numeric', month: 'short' })}</div>
                      <button onClick={() => handleWeekChange('next')} className="p-2 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"><ChevronRight size={20}/></button>
                  </div>
                  {canEdit && (
                      <div className="flex items-center gap-2">
                          <button onClick={handleCopyNextWeek} disabled={isLoading} className="p-3 flex items-center justify-center bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed" title={t('shift.copyTitle')}>{isLoading ? <Loader2 size={18} className="animate-spin" /> : <Copy size={18} />}</button>
                          <button onClick={addNewRow} className="px-6 py-3 flex items-center justify-center bg-indigo-600 text-slate-900 dark:text-white rounded-xl font-bold shadow-lg min-h-[44px]" title={t('shift.newRow')}><Plus size={18} /></button>
                          <button onClick={handleManualSave} className="px-6 py-3 flex items-center justify-center bg-green-600 text-slate-900 dark:text-white rounded-xl font-bold shadow-lg min-h-[44px]" title={t('shift.saveTitle')}>{isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}</button>
                      </div>
                  )}
              </div>
          </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50 dark:bg-zinc-950 p-2 xl:p-4">

            {/* ── ONAY/YAYIN DURUMU BANNER'I ──
                Admin: durum + Yayınla / Yayını Geri Çek butonları
                Personel: yayında değilse buraya "henüz onaylanmadı" gösterilmez,
                          tablo yerine büyük kutu çıkar (aşağıda).  */}
            {isAdmin && (
                <div className={`mb-3 p-3 rounded-xl border flex items-center gap-3 flex-wrap ${
                    isPublished
                        ? 'bg-emerald-950/30 border-emerald-800/50'
                        : 'bg-amber-950/30 border-amber-800/50'
                }`}>
                    {isPublished
                        ? <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                        : <Lock size={18} className="text-amber-400 shrink-0" />}
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                            {isPublished ? t('shift.statusPublished') : t('shift.statusDraft')}
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-zinc-400 mt-0.5">
                            {isPublished
                                ? t('shift.statusPublishedDesc')
                                    .replace('{by}', publication?.publishedByName || '—')
                                    .replace('{at}', publication ? formatDate(publication.publishedAt, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
                                : t('shift.statusDraftDesc')}
                        </div>
                    </div>
                    {canEdit && (isPublished ? (
                        <button
                            onClick={unpublishWeek}
                            disabled={publishLoading}
                            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-slate-100 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-200 border border-slate-300 dark:border-zinc-700 disabled:opacity-50"
                        >
                            {publishLoading ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
                            {t('shift.unpublish')}
                        </button>
                    ) : (
                        <button
                            onClick={publishWeek}
                            disabled={publishLoading || rosterData.length === 0}
                            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-900 dark:text-white shadow-lg shadow-emerald-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {publishLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            {t('shift.publish')}
                        </button>
                    ))}
                </div>
            )}

            {/* Taslak görme yetkisi yok + yayında değil → büyük "henüz onaylanmadı" kutusu.
                Personel ve taslak yetkisi olmayan adminler (Apo/Malik) bu kutuyu görür. */}
            {!canViewDraft && !isPublished && !isLoading && (
                <div className="mt-2 mb-4 mx-auto max-w-2xl bg-white dark:bg-zinc-900/50 border border-amber-900/40 rounded-2xl p-8 text-center">
                    <Lock size={32} className="text-amber-400 mx-auto mb-3" />
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">{t('shift.notPublishedTitle')}</h3>
                    <p className="text-sm text-slate-600 dark:text-zinc-400">{t('shift.notPublishedDesc')}</p>
                </div>
            )}

            {/* ══════════════════════════════════════════════════
                TABLO GÖRÜNÜMÜ — Yatay kaydırmalı (mobil + masaüstü)
               ══════════════════════════════════════════════════ */}
            <div className={`${!canViewDraft && !isPublished ? 'hidden' : ''}`}>
                <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-x-auto shadow-2xl relative" style={{ WebkitOverflowScrolling: 'touch' }}>
<GlowingEffect spread={40} glow={true} disabled={false} proximity={64} inactiveZone={0.01} />
                    {isLoading && (<div className="absolute inset-0 z-50 bg-slate-50 dark:bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center"><Loader2 size={40} className="text-blue-500 animate-spin" /></div>)}
                    <table className="w-full border-collapse min-w-[800px]">
                        <thead>
                            <tr className="bg-slate-50 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-800">
                                <th className="p-4 w-32 border-r border-slate-200 dark:border-zinc-800 sticky left-0 z-20 bg-slate-50 dark:bg-zinc-950 text-indigo-400 text-xs uppercase font-black after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-slate-100 dark:bg-zinc-800">{t('common.timeLabel')}</th>
                                {DAYS.map((day, idx) => {
                                    const d = new Date(currentWeekStart); d.setDate(d.getDate() + idx);
                                    const isToday = new Date().toDateString() === d.toDateString();
                                    return (<th key={day} className={`p-4 text-center border-r border-slate-200 dark:border-zinc-800/50 ${isToday ? 'bg-red-600/10 text-red-500' : 'text-slate-500 dark:text-zinc-500'}`}><span className="text-xs font-black uppercase">{day}</span></th>);
                                })}
                                {canEdit && <th className="w-16"></th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/50">
                            {displayedRows.length === 0 ? (
                                <tr><td colSpan={9} className="p-20 text-center text-slate-400 dark:text-zinc-600 italic">{t('common.noRecord')}</td></tr>
                            ) : (
                                displayedRows.map((row) => (
                                    <tr key={row.id} className="group hover:bg-slate-200 dark:hover:bg-slate-100 dark:hover:bg-zinc-800/20">
                                        <td className="p-2 border-r border-slate-200 dark:border-zinc-800 sticky left-0 z-10 bg-slate-50 dark:bg-zinc-950 shadow-[2px_0_8px_rgba(0,0,0,0.5)]">
                                            {canEdit ? (<input type="text" value={row.timeLabel} onChange={(e) => handleTimeLabelChange(row.id, e.target.value)} onBlur={() => { saveRowToDb(row); fetchOtherBranchData(); setRosterData(prev => sortRosterByTime(prev)); }} className="w-full bg-transparent text-center font-bold text-slate-800 dark:text-zinc-200 outline-none" placeholder="00:00-00:00"/>) : (<div className="text-center font-bold text-slate-900 dark:text-white">{row.timeLabel}</div>)}
                                        </td>
                                        {row.assignments.map((cellRaw, dayIdx) => {
                                            // Hücre artık CSV: birden çok personel olabilir.
                                            const cellIds = parseCellIds(cellRaw);
                                            // Hücredeki herhangi bir kişide çakışma varsa hücre arka planı kırmızı tonlu.
                                            const cellHasConflict = cellIds.some(id => !!getConflict(id, dayIdx, row.timeLabel));
                                            // Bu hücrede zaten atanmış ID'leri "+ Kişi ekle" dropdown'ından çıkar.
                                            const assignedSet = new Set(cellIds);
                                            return (
                                            <td key={dayIdx} className={`p-2 border-r border-slate-200 dark:border-zinc-800/30 align-top ${cellHasConflict ? 'bg-red-900/10' : ''}`}>
                                                <div className="flex flex-col items-stretch gap-1 min-w-[120px]">
                                                    {cellIds.length === 0 ? (
                                                        // Boş hücre: düzenleyen süper admin için dropdown, diğerlerine "-"
                                                        canEdit ? (
                                                            <div className="flex justify-center h-8 w-full">
                                                                <select
                                                                    value=""
                                                                    onChange={(e) => addAssignment(row.id, dayIdx, e.target.value)}
                                                                    className="w-full bg-transparent text-center text-xs outline-none cursor-pointer text-slate-400 dark:text-zinc-600"
                                                                >
                                                                    <option value="" className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white">-</option>
                                                                    {filteredEmployees.map(emp => {
                                                                        const empConflict = getEmployeeConflicts.get(`${row.id}_${emp.id}`)?.get(dayIdx);
                                                                        return (<option key={emp.id} value={emp.id} className={`bg-white dark:bg-zinc-900 ${empConflict ? 'text-red-400' : 'text-slate-900 dark:text-white'}`}>{emp.name}{empConflict ? ' ⚠️' : ''}</option>);
                                                                    })}
                                                                </select>
                                                            </div>
                                                        ) : (
                                                            <span className="text-sm text-zinc-900">-</span>
                                                        )
                                                    ) : (
                                                        <>
                                                            {cellIds.map(id => {
                                                                const conflict = getConflict(id, dayIdx, row.timeLabel);
                                                                if (!isAdmin) {
                                                                    // Personel: sadece kendi adını görür, diğer isimler gizli
                                                                    if (id !== currentUser.id) return null;
                                                                    return (
                                                                        <span key={id} className="text-sm text-green-500 font-black text-center">{currentUser.name}</span>
                                                                    );
                                                                }
                                                                if (!canEdit) {
                                                                    // Salt-okunur admin: tüm isimleri görür ama düzenleyemez
                                                                    const empName = availableEmployees.find(e => e.id === id)?.name || id;
                                                                    return (
                                                                        <span key={id} className={`text-xs font-black text-center ${conflict ? 'text-red-400' : 'text-slate-900 dark:text-white'}`}>{empName}</span>
                                                                    );
                                                                }
                                                                // Düzenleyen süper admin: select + X
                                                                return (
                                                                    <div key={id} className="flex items-center gap-1 w-full">
                                                                        <select
                                                                            value={id}
                                                                            onChange={(e) => replaceAssignment(row.id, dayIdx, id, e.target.value)}
                                                                            className={`flex-1 min-w-0 bg-transparent text-center text-xs outline-none cursor-pointer ${conflict ? 'text-red-400 font-black' : 'text-slate-900 dark:text-white font-black'}`}
                                                                        >
                                                                            <option value="" className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white">— kaldır —</option>
                                                                            {filteredEmployees.map(emp => {
                                                                                // Bu mini-satırın mevcut ID'si HARİÇ, hücrede zaten olan diğerlerini opt-out
                                                                                if (emp.id !== id && assignedSet.has(emp.id)) return null;
                                                                                const empConflict = getEmployeeConflicts.get(`${row.id}_${emp.id}`)?.get(dayIdx);
                                                                                return (<option key={emp.id} value={emp.id} className={`bg-white dark:bg-zinc-900 ${empConflict ? 'text-red-400' : 'text-slate-900 dark:text-white'}`}>{emp.name}{empConflict ? ' ⚠️' : ''}</option>);
                                                                            })}
                                                                        </select>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => removeAssignment(row.id, dayIdx, id)}
                                                                            className="shrink-0 p-0.5 text-zinc-500 hover:text-red-500 transition-colors"
                                                                            title={t('common.delete')}
                                                                        >
                                                                            <X size={12} />
                                                                        </button>
                                                                    </div>
                                                                );
                                                            })}
                                                            {/* Admin için "+ Kişi ekle": varsayılan olarak küçük "+" butonu;
                                                                tıklanınca dropdown'a dönüşür, seçim/blur sonrası kapanır. */}
                                                            {canEdit && (() => {
                                                                const cellKey = `${row.id}_${dayIdx}`;
                                                                const isOpen = openAddCell === cellKey;
                                                                const availableEmps = filteredEmployees.filter(emp => !assignedSet.has(emp.id));
                                                                if (availableEmps.length === 0) return null;
                                                                return isOpen ? (
                                                                    <select
                                                                        autoFocus
                                                                        value=""
                                                                        onChange={(e) => {
                                                                            if (e.target.value) addAssignment(row.id, dayIdx, e.target.value);
                                                                            setOpenAddCell(null);
                                                                        }}
                                                                        onBlur={() => setOpenAddCell(null)}
                                                                        className="w-full bg-transparent text-center text-[11px] outline-none cursor-pointer text-slate-400 dark:text-zinc-500 italic border-t border-dashed border-zinc-700/40 pt-1"
                                                                    >
                                                                        <option value="" className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white">{t('shift.addPerson')}</option>
                                                                        {availableEmps.map(emp => {
                                                                            const empConflict = getEmployeeConflicts.get(`${row.id}_${emp.id}`)?.get(dayIdx);
                                                                            return (<option key={emp.id} value={emp.id} className={`bg-white dark:bg-zinc-900 ${empConflict ? 'text-red-400' : 'text-slate-900 dark:text-white'}`}>{emp.name}{empConflict ? ' ⚠️' : ''}</option>);
                                                                        })}
                                                                    </select>
                                                                ) : (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setOpenAddCell(cellKey)}
                                                                        className="self-center mt-0.5 w-5 h-5 inline-flex items-center justify-center rounded-full text-slate-400 dark:text-zinc-600 hover:text-cyan-500 hover:bg-cyan-500/10 transition-all opacity-50 hover:opacity-100"
                                                                        title={t('shift.addPerson')}
                                                                        aria-label={t('shift.addPerson')}
                                                                    >
                                                                        <Plus size={12} />
                                                                    </button>
                                                                );
                                                            })()}
                                                        </>
                                                    )}
                                                    {cellHasConflict && (
                                                        <div className="flex items-center justify-center gap-1 mt-0.5" title={t('shift.conflictTitle')}>
                                                            <AlertTriangle size={10} className="text-red-500"/>
                                                            <span className="text-[9px] text-red-400 truncate max-w-[100px]">
                                                                {cellIds.map(id => getConflict(id, dayIdx, row.timeLabel)).filter(Boolean).join(', ')}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            );
                                        })}
                                        {canEdit && (<td className="p-2 text-center opacity-0 group-hover:opacity-100"><button onClick={() => deleteRow(row.id!)} className="text-slate-300 dark:text-zinc-700 hover:text-red-500"><Trash2 size={16} /></button></td>)}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Mobil alt navigasyon (fixed, ~64px + 12px + safe-area) tablonun
                    son satırlarını kapatmasın diye gerçek spacer. Padding yerine
                    eleman kullanılıyor: iOS Safari kaydırma kabının padding-bottom'ını
                    bazen kaydırma alanına dahil etmiyor, eleman her zaman dahil edilir.
                    Masaüstünde (md+) bottom-nav yok, spacer küçük tutulur. */}
                <div
                    aria-hidden="true"
                    className="h-[calc(env(safe-area-inset-bottom,0px)+7rem)] md:h-6"
                />

            </div>
      </div>
    </div>
  );
};

export default ShiftSchedule;