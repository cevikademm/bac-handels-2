import React, { useState, useEffect, useMemo } from 'react';
import { Employee, Branch, Role, TimeLog, AppNotification } from '../types';
import { Search, Plus, Filter, Calculator, Save, Trash2, Phone, Mail, X, MapPin, Briefcase, Link as LinkIcon, ThumbsUp, ThumbsDown, Clock, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Wallet, Banknote, Map, Timer, Edit2, Loader2, ArrowRightLeft, Building2, CalendarRange, Lock, Rocket, PieChart, Upload, Shield, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../lib/i18n';
import { GlowingEffect } from './ui/glowing-effect';


// Yeni sekme yapısı: FINANCIAL eklendi
type Tab = 'STAFF' | 'MONTHLY' | 'FINANCIAL';

interface PayrollProps {
    currentUser: Employee;
    onNotify: (notification: AppNotification) => void;
}

const Payroll: React.FC<PayrollProps> = ({ currentUser, onNotify }) => {
  // LOGIC CHANGE: If Staff, default to MONTHLY (Time Logs), else STAFF list
  const [currentTab, setCurrentTab] = useState<Tab>(currentUser.role === Role.ADMIN ? 'STAFF' : 'MONTHLY');
  const [employees, setEmployees] = useState<Employee[]>([]); 
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const { t, formatDate, language } = useLanguage();

  // Tüm adminler aynı paneli görür

  // Şube Seçimi kaldırıldı - tüm personel havuzda
  const selectedBranch: 'ALL' = 'ALL';
  
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(
      currentUser.role === Role.ADMIN ? null : currentUser.id
  );
  
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Employee>>({});

  // Transfer Modal
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [targetBranch, setTargetBranch] = useState<Branch>(Branch.DOM);
  // Transfer Date Range State
  const [transferDates, setTransferDates] = useState({
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      startTime: '08:00',
      endTime: '18:00'
  });
  const [transferHistory, setTransferHistory] = useState<any[]>([]);
  const [selectedTransferDay, setSelectedTransferDay] = useState<string | null>(null);

  const [showTimeModal, setShowTimeModal] = useState(false);
  const [timeForm, setTimeForm] = useState({
      date: new Date().toISOString().split('T')[0],
      startTime: '09:00',
      endTime: '17:00',
      breakDuration: 0,
      branch: Branch.DOM
  });

  const [currentMonth, setCurrentMonth] = useState<string>(new Date().toISOString().slice(0, 7));

  // Arama state'i
  const [searchQuery, setSearchQuery] = useState('');

  // Admin personel listesi
  const [adminEmployees, setAdminEmployees] = useState<Employee[]>([]);
  const [showAdminList, setShowAdminList] = useState(false);

  // --- SUPABASE VERİ ÇEKME & REALTIME ---
  useEffect(() => {
    fetchData();

    // SUBSCRIBE TO REALTIME CHANGES
    const channel = supabase.channel('payroll-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
             fetchData(); // Refresh list on transfer or update
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'time_logs' }, () => {
             fetchData(); // Refresh logs
        })
        .subscribe();

    return () => {
        supabase.removeChannel(channel);
    };
  }, [currentUser]); // currentUser değişirse tekrar çek

  const fetchData = async () => {
    setIsLoading(true);
    try {
        // 1. Personelleri Çek
        // GÜVENLİK GÜNCELLEMESİ: Adminler listelenmemeli. .neq('role', 'Admin') ile filtrelendi.
        let empQuery = supabase.from('profiles').select('*').neq('role', 'Admin').limit(1000);
        
        // Veritabanı bağlantısı yoksa veya hata olursa mock veriye düşülecek
        const { data: empData, error: empError } = await empQuery;
        
        if (empError) throw empError;

        // DB verisini Frontend formatına çevir (snake_case -> camelCase)
        const formattedEmployees: Employee[] = (empData || []).map((e: any) => ({
            id: e.id,
            name: e.full_name,
            email: e.email,
            role: e.role as Role,
            branch: e.branch as Branch,
            hourlyRate: e.hourly_rate,
            taxClass: e.tax_class,
            avatarUrl: e.avatar_url || `https://ui-avatars.com/api/?name=${e.full_name}`,
            advances: 0, 
            phone: e.phone,
            bio: e.bio,
        }));

        // KURAL: Adminler personel listesinde gösterilmez (Çift kontrol).
        const visibleEmployees = formattedEmployees.filter(e => e.role !== Role.ADMIN);
        
        // Eğer DB boşsa Mock veriyi kullan, yoksa DB'yi kullan
        if(visibleEmployees.length > 0) {
            setEmployees(visibleEmployees);
        } else {
             // Mock veriyi de filtrele
             setEmployees([]);
        }

        // 1.5 Admin Personelleri Çek (Sadece admin kullanıcı için)
        if (currentUser.role === Role.ADMIN) {
            const { data: adminData } = await supabase.from('profiles').select('*').eq('role', 'Admin').order('full_name');
            if (adminData) {
                const formattedAdmins: Employee[] = adminData.map((e: any) => ({
                    id: e.id,
                    name: e.full_name,
                    email: e.email,
                    role: e.role as Role,
                    branch: e.branch as Branch,
                    hourlyRate: e.hourly_rate,
                    taxClass: e.tax_class,
                    avatarUrl: e.avatar_url || `https://ui-avatars.com/api/?name=${e.full_name}`,
                    advances: 0,
                    phone: e.phone,
                    bio: e.bio,
                }));
                setAdminEmployees(formattedAdmins);
            }
        }

        // 2. Zaman Loglarını Çek
        let logQuery = supabase.from('time_logs').select('*');
        
        // GÜVENLİK: Admin değilse sadece kendi loglarını gör
        if (currentUser.role !== Role.ADMIN) {
             logQuery = logQuery.eq('employee_id', currentUser.id);
        }

        const { data: logData, error: logError } = await logQuery;
        
        const formattedLogs: TimeLog[] = (logData || []).map((l: any) => {
            // FALLBACK HESAPLAMA (0 SAAT HATASI İÇİN)
            // Eğer DB'den gelen total_hours 0 veya null ise, burada manuel hesaplıyoruz.
            let displayHours = Number(l.total_hours);
            
            if (!displayHours || displayHours <= 0) {
                const s = new Date(`1970-01-01T${l.start_time}:00`);
                const e = new Date(`1970-01-01T${l.end_time}:00`);
                let diffMs = e.getTime() - s.getTime();
                if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000;
                
                const breakMins = l.break_duration || 0;
                const netMins = (diffMs / 60000) - breakMins;
                displayHours = Math.max(0, Number((netMins / 60).toFixed(2)));
            }

            return {
                id: l.id,
                employeeId: l.employee_id,
                date: l.date,
                startTime: l.start_time.slice(0, 5),
                endTime: l.end_time.slice(0, 5),
                breakDuration: l.break_duration,
                totalHours: displayHours,
                branch: l.branch || 'Bilinmiyor', // Şube verisi
                status: l.status
            };
        });
        
        setTimeLogs(formattedLogs);

    } catch (error) {
        console.error("Veri çekme hatası (Mock Kullanılıyor):", error);
        // Hata durumunda mock veriyi filtreleyip bas
        setEmployees([]);
    } finally {
        setIsLoading(false);
    }
  };


  // --- HESAPLAMALAR ---
  const filteredEmployees = useMemo(() => {
    // KURAL: Eğer Admin değilse, listede sadece kendisini görmeli.
    if (currentUser.role !== Role.ADMIN) {
        return employees.filter(e => e.id === currentUser.id);
    }
    // Tüm personel havuzda - sadece arama filtresi
    return employees.filter(e => {
        const searchMatch = !searchQuery || e.name.toLowerCase().includes(searchQuery.toLowerCase()) || e.email.toLowerCase().includes(searchQuery.toLowerCase());
        return searchMatch;
    });
  }, [employees, currentUser, searchQuery]);

  // Tüm çalışanlar (personel + admin) birleşik listesi - detay görüntüleme için
  const allEmployees = useMemo(() => [...employees, ...adminEmployees], [employees, adminEmployees]);

  const targetEmployeeId = selectedEmployeeId || (currentUser.role === Role.ADMIN ? null : currentUser.id);
  const targetEmployee = allEmployees.find(e => e.id === targetEmployeeId);

  const selectedEmployeeForDetail = selectedEmployeeId === 'NEW'
    ? (editForm as Employee)
    : allEmployees.find(e => e.id === selectedEmployeeId);

  const monthlyLogs = useMemo(() => {
    if (!targetEmployeeId) return [];
    return timeLogs.filter(log => 
        log.employeeId === targetEmployeeId && 
        log.date.startsWith(currentMonth)
    ).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [timeLogs, targetEmployeeId, currentMonth]);

  const payrollStats = useMemo(() => {
      const totalHours = monthlyLogs.reduce((acc, log) => acc + (log.totalHours || 0), 0);
      const approvedHours = monthlyLogs.filter(l => l.status === 'Onaylandı').reduce((acc, log) => acc + (log.totalHours || 0), 0);
      const hourlyRate = targetEmployee?.hourlyRate || 0;
      const grossPay = approvedHours * hourlyRate;
      const estimatedTax = grossPay * 0.19; 
      const netPay = grossPay - estimatedTax;
      
      return { totalHours, approvedHours, grossPay, estimatedTax, netPay };
  }, [monthlyLogs, targetEmployee]);


  // --- CRUD İŞLEMLERİ ---

  useEffect(() => {
    if (selectedEmployeeForDetail && !isEditing && selectedEmployeeId !== 'NEW') {
        setEditForm(JSON.parse(JSON.stringify(selectedEmployeeForDetail)));
    }
  }, [selectedEmployeeForDetail, isEditing, selectedEmployeeId]);

  // Transfer geçmişini yükle
  useEffect(() => {
    if (!selectedEmployeeId || selectedEmployeeId === 'NEW') { setTransferHistory([]); return; }
    const fetchTransferHistory = async () => {
        const { data } = await supabase
            .from('personnel_transfers')
            .select('*')
            .eq('employee_id', selectedEmployeeId)
            .order('start_date', { ascending: false })
            .order('start_time', { ascending: true });
        setTransferHistory(data || []);
    };
    fetchTransferHistory();
  }, [selectedEmployeeId]);

  const handleSelectEmployee = (id: string) => {
    if(isEditing && selectedEmployeeId !== id) {
        if (!window.confirm("Kaydedilmemiş değişiklikler var. Devam et?")) return;
    }
    setIsEditing(false);
    setEditForm({});
    setSelectedEmployeeId(id);
  };

  const handleAddNew = () => {
      setIsEditing(true);
      setSelectedEmployeeId('NEW');
      setCurrentTab('STAFF');
      setEditForm({
          name: '', email: '', role: Role.STAFF, hourlyRate: 15.0,
          avatarUrl: `https://ui-avatars.com/api/?name=Yeni+Personel&background=random`,
          bio: ''
      });
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsLoading(true);
      try {
          const fileExt = file.name.split('.').pop();
          const fileName = `${Math.random()}.${fileExt}`;
          const filePath = `${fileName}`;

          const { error: uploadError } = await supabase.storage
              .from('avatars')
              .upload(filePath, file);

          if (uploadError) {
              throw uploadError;
          }

          const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
          
          // Delete old avatar if it exists and is from supabase storage
          if (editForm.avatarUrl && editForm.avatarUrl.includes('/storage/v1/object/public/avatars/')) {
              try {
                  const oldFileName = editForm.avatarUrl.split('/avatars/').pop();
                  if (oldFileName) {
                      await supabase.storage.from('avatars').remove([oldFileName]);
                  }
              } catch (e) {
                  console.error('Eski fotoğraf silinirken hata oluştu:', e);
              }
          }

          setEditForm({ ...editForm, avatarUrl: data.publicUrl });
      } catch (error: any) {
          console.error('Error uploading avatar:', error);
          alert('Resim yüklenirken bir hata oluştu: ' + error.message);
      } finally {
          setIsLoading(false);
      }
  };

  const handleSave = async () => {
      if (!editForm.name?.trim() || !editForm.email?.trim()) {
          alert("Lütfen isim ve e-posta alanlarını doldurun.");
          return;
      }

      setIsLoading(true);
      const dbData = {
          full_name: editForm.name,
          email: editForm.email,
          role: editForm.role,
          hourly_rate: editForm.hourlyRate,
          avatar_url: editForm.avatarUrl,
          phone: editForm.phone,
          bio: editForm.bio
      };

      try {
          if (selectedEmployeeId === 'NEW') {
              // Supabase Insert Denemesi - varsayılan şifre ile
              const defaultPassword = 'Bac123+';
              const { data, error } = await supabase.from('profiles').insert([{ ...dbData, password: defaultPassword }]).select();

              if(error) throw error;

              if(data) {
                  const newEmp = { ...editForm, id: data[0].id } as Employee;
                  setEmployees([...employees, newEmp]);
                  setSelectedEmployeeId(data[0].id);

                  // Bildirim: Yeni personel eklendi ve şifre gösterildi
                  onNotify({
                      id: `notif_${Date.now()}`,
                      type: 'INFO',
                      title: 'Yeni Personel Eklendi',
                      message: `${editForm.name} (${editForm.email}) başarıyla eklendi. Varsayılan şifre: ${defaultPassword}`,
                      timestamp: new Date().toISOString(),
                  });
              }
          } else {
              // Supabase Update Denemesi
              const { error } = await supabase.from('profiles').update(dbData).eq('id', selectedEmployeeId);
              
              if(error) throw error;
              
              // Admin mi personel mi kontrol et ve doğru state'i güncelle
              const isAdminEmployee = adminEmployees.some(a => a.id === selectedEmployeeId);
              if (isAdminEmployee) {
                  setAdminEmployees(adminEmployees.map(e => e.id === selectedEmployeeId ? { ...e, ...editForm } as Employee : e));
              } else {
                  setEmployees(employees.map(e => e.id === selectedEmployeeId ? { ...e, ...editForm } as Employee : e));
              }
          }
          alert(t('common.success'));
      } catch (err: any) {
          console.warn("Veritabanı bağlantı hatası, yerel modda devam ediliyor:", err);

          // --- FALLBACK: YEREL KAYIT ---
          if (selectedEmployeeId === 'NEW') {
              const tempId = `local_${Date.now()}`;
              const defaultPassword = 'Bac123+';
              const newEmp = { ...editForm, id: tempId } as Employee;
              setEmployees([...employees, newEmp]);
              setSelectedEmployeeId(tempId);

              onNotify({
                  id: `notif_${Date.now()}`,
                  type: 'INFO',
                  title: 'Yeni Personel Eklendi (Yerel)',
                  message: `${editForm.name} (${editForm.email}) eklendi. Varsayılan şifre: ${defaultPassword}`,
                  timestamp: new Date().toISOString(),
              });
          } else {
              const isAdminEmployee = adminEmployees.some(a => a.id === selectedEmployeeId);
              if (isAdminEmployee) {
                  setAdminEmployees(adminEmployees.map(e => e.id === selectedEmployeeId ? { ...e, ...editForm } as Employee : e));
              } else {
                  setEmployees(employees.map(e => e.id === selectedEmployeeId ? { ...e, ...editForm } as Employee : e));
              }
          }
          alert("Veritabanı bağlantısı yok. Değişiklikler demo modunda yerel olarak kaydedildi.");
      } finally {
          setIsEditing(false);
          setIsLoading(false);
      }
  };

  const handleTransfer = async () => {
      if(!selectedEmployeeForDetail) return;
      if(!transferDates.startDate || !transferDates.endDate) {
          alert("Lütfen tarih aralığı belirtiniz.");
          return;
      }
      if(transferDates.endDate < transferDates.startDate) {
          alert("Bitiş tarihi başlangıç tarihinden önce olamaz.");
          return;
      }

      setIsLoading(true);

      try {
          // 1. personnel_transfers tablosuna atama kaydı ekle
          const { error: transferError } = await supabase.from('personnel_transfers').insert([{
              employee_id: selectedEmployeeForDetail.id,
              from_branch: 'Havuz',
              to_branch: targetBranch,
              start_date: transferDates.startDate,
              end_date: transferDates.endDate,
              start_time: transferDates.startTime || '08:00',
              end_time: transferDates.endTime || '18:00',
              status: 'active',
              created_by: currentUser.id
          }]);
          if (transferError) throw transferError;

          // 2. Takvimde görünürlük için calendar_events kaydı oluştur
          const transferEvent = {
              title: `${selectedEmployeeForDetail.name} -> ${targetBranch}`,
              type: 'Şube Transferi',
              date: transferDates.startDate,
              end_date: transferDates.endDate,
              start_time: transferDates.startTime || '08:00',
              end_time: transferDates.endTime || '18:00',
              attendees: [selectedEmployeeForDetail.id],
              description: `Yeni Çalışma Şubeniz: ${targetBranch}`
          };
          await supabase.from('calendar_events').insert([transferEvent]);

          // 3. Bildirim gönder
          onNotify({
              id: `notif_${Date.now()}`,
              type: 'TRANSFER',
              title: t('dash.transferAlert'),
              message: `${selectedEmployeeForDetail.name}: Yeni Çalışma Şubeniz: ${targetBranch} (${transferDates.startDate} - ${transferDates.endDate})`,
              timestamp: new Date().toISOString(),
              recipientId: selectedEmployeeForDetail.id
          });

          setShowTransferModal(false);

          // Transfer geçmişini yeniden yükle
          const { data: updatedHistory } = await supabase
              .from('personnel_transfers')
              .select('*')
              .eq('employee_id', selectedEmployeeForDetail.id)
              .order('start_date', { ascending: false });
          setTransferHistory(updatedHistory || []);

          alert(t('common.success'));

      } catch (err: any) {
          console.warn("Transfer hatası (Demo modunda devam):", err);
          // Fallback bildirim
          onNotify({
              id: `notif_${Date.now()}`,
              type: 'TRANSFER',
              title: 'Personel Transferi (Demo)',
              message: `${selectedEmployeeForDetail.name}: Yeni Çalışma Şubeniz: ${targetBranch} (Demo mod)`,
              timestamp: new Date().toISOString(),
              recipientId: selectedEmployeeForDetail.id
          });
          setShowTransferModal(false);
      } finally {
          setIsLoading(false);
      }
  };

  const handleDelete = async () => {
      if(!confirm("Bu personeli silmek istediğinize emin misiniz?")) return;
      setIsLoading(true);
      try {
          const { error } = await supabase.from('profiles').delete().eq('id', selectedEmployeeId);
          if(error) throw error;
          
          // Başarılı olursa state'den sil (admin veya personel)
          const isAdminDel = adminEmployees.some(a => a.id === selectedEmployeeId);
          if (isAdminDel) {
              setAdminEmployees(adminEmployees.filter(e => e.id !== selectedEmployeeId));
          } else {
              setEmployees(employees.filter(e => e.id !== selectedEmployeeId));
          }
          setSelectedEmployeeId(null);
          setIsEditing(false);
      } catch (err: any) {
          console.warn("Silme hatası, yerel modda devam ediliyor:", err);

          // --- FALLBACK: YEREL SİLME ---
          const isAdminDel = adminEmployees.some(a => a.id === selectedEmployeeId);
          if (isAdminDel) {
              setAdminEmployees(adminEmployees.filter(e => e.id !== selectedEmployeeId));
          } else {
              setEmployees(employees.filter(e => e.id !== selectedEmployeeId));
          }
          setSelectedEmployeeId(null);
          setIsEditing(false);
          
          alert("Veritabanı bağlantısı yok. Kayıt yerel olarak silindi.");
      } finally {
          setIsLoading(false);
      }
  };

  const handleSaveTimeLog = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!targetEmployeeId) return;

      setIsLoading(true);
      
      // Calculate Hours
      const start = new Date(`1970-01-01T${timeForm.startTime}:00`);
      const end = new Date(`1970-01-01T${timeForm.endTime}:00`);
      let diffMs = end.getTime() - start.getTime();
      if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000;
      const diffMins = Math.floor(diffMs / 60000);
      const netMins = diffMins - timeForm.breakDuration;
      const totalHours = Math.max(0, Number((netMins / 60).toFixed(2)));

      try {
          const newLogDb = {
              employee_id: targetEmployeeId,
              date: timeForm.date,
              start_time: timeForm.startTime,
              end_time: timeForm.endTime,
              break_duration: timeForm.breakDuration,
              status: currentUser.role === Role.ADMIN ? 'Onaylandı' : 'Bekliyor',
              // branch: timeForm.branch // DB şemasına branch eklendiyse açılabilir
          };

          const { data, error } = await supabase.from('time_logs').insert([newLogDb]).select();
          if(error) throw error;

          if(data) {
              const newLogFrontend: TimeLog = {
                  id: data[0].id,
                  employeeId: targetEmployeeId,
                  date: timeForm.date,
                  startTime: timeForm.startTime,
                  endTime: timeForm.endTime,
                  breakDuration: timeForm.breakDuration,
                  totalHours: totalHours,
                  status: newLogDb.status as any,
                  branch: timeForm.branch
              };
              setTimeLogs([newLogFrontend, ...timeLogs]);
              setShowTimeModal(false);
              alert(t('common.success'));
          }
      } catch (err: any) {
           console.warn("Saat kaydetme hatası (Yerel Mod Devrede):", err);
           
           // --- FALLBACK: Foreign Key veya Ağ Hatasında Yerel Ekleme ---
           const newLogFrontend: TimeLog = {
                id: `local_log_${Date.now()}`,
                employeeId: targetEmployeeId,
                date: timeForm.date,
                startTime: timeForm.startTime,
                endTime: timeForm.endTime,
                breakDuration: timeForm.breakDuration,
                totalHours: totalHours,
                status: currentUser.role === Role.ADMIN ? 'Onaylandı' : 'Bekliyor',
                branch: timeForm.branch
           };
           setTimeLogs([newLogFrontend, ...timeLogs]);
           setShowTimeModal(false);
           
           // Özel Hata Mesajı: Foreign Key Violation
           if (err.code === '23503') {
               alert("Uyarı: Seçilen personel veritabanında bulunamadığı için kayıt sadece yerel önbelleğe eklendi. (Demo Modu)");
           } else {
               alert("Veritabanı hatası. Kayıt yerel olarak eklendi.");
           }
      } finally {
          setIsLoading(false);
      }
  };

  const handleStatusChange = async (logId: string, newStatus: 'Onaylandı' | 'Reddedildi') => {
    try {
        const { error } = await supabase.from('time_logs').update({ status: newStatus }).eq('id', logId);
        if(error) throw error;
        setTimeLogs(prev => prev.map(log => log.id === logId ? { ...log, status: newStatus } : log));
    } catch (err: any) {
        // Fallback for status change
        setTimeLogs(prev => prev.map(log => log.id === logId ? { ...log, status: newStatus } : log));
    }
  };

  const handleDeleteTimeLog = async (logId: string) => {
    try {
        const { error } = await supabase.from('time_logs').delete().eq('id', logId);
        if(error) throw error;
        setTimeLogs(prev => prev.filter(log => log.id !== logId));
    } catch (err: any) {
        console.error('Error deleting time log:', err);
        // Fallback for delete
        setTimeLogs(prev => prev.filter(log => log.id !== logId));
    }
  };

  const handleMonthChange = (direction: 'prev' | 'next') => {
      const date = new Date(currentMonth + "-01");
      date.setMonth(date.getMonth() + (direction === 'next' ? 1 : -1));
      setCurrentMonth(date.toISOString().slice(0, 7));
  };
  
  const handleOpenTimeModal = () => {
      if (!targetEmployee && currentUser.role === Role.ADMIN) {
          alert("Lütfen önce listeden bir personel seçiniz.");
          return;
      }
      setTimeForm({
          date: new Date().toISOString().split('T')[0],
          startTime: '09:00',
          endTime: '17:00',
          breakDuration: 0,
          branch: Branch.DOM
      });
      setShowTimeModal(true);
  };

  // --- RENDERERS ---

  // 1. FINANCIAL CONTENT (NEW TAB)
  const renderFinancialContent = () => {
      if (!targetEmployee) return <div className="h-full flex items-center justify-center text-zinc-500"><p>{t('pay.selectStaff')}</p></div>;
      
      return (
          // MODIFIED: Changed justify-start md:justify-center to justify-start and items-stretch to force full width
          <div className="h-full flex flex-col items-stretch justify-start p-4 md:p-6 bg-zinc-950 overflow-y-auto">
              {/* MODIFIED: Removed max-w-lg to allow full width */}
              <div className="w-full bg-gradient-to-br from-zinc-900 to-black border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden relative">
                  {/* Decorative Background */}
                  <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-900/10 rounded-full blur-[80px] pointer-events-none"></div>
                  
                  <div className="p-8 relative z-10">
                      {/* Header */}
                      <div className="flex items-center gap-5 border-b border-zinc-800 pb-6 mb-6">
                          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-900/40">
                              <Wallet size={32} className="text-white" />
                          </div>
                          <div>
                              <h2 className="text-2xl font-bold text-white tracking-tight">{t('pay.tabFinancial')}</h2>
                              <p className="text-sm text-zinc-400 mt-1 flex items-center gap-2">
                                  <span className="text-emerald-400 font-medium">{formatDate(currentMonth + "-01", { month: 'long', year: 'numeric' })}</span>
                                  • {targetEmployee.name}
                              </p>
                          </div>
                      </div>

                      {/* Stats Grid */}
                      <div className="space-y-6">
                          <div className="grid grid-cols-2 gap-4">
                              <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
                                  <p className="text-xs text-zinc-500 mb-1">{t('pay.totalHours')}</p>
                                  <p className="text-xl font-bold text-white">{(payrollStats.totalHours || 0).toFixed(1)} s</p>
                              </div>
                              <div className="p-4 bg-emerald-900/10 rounded-xl border border-emerald-500/20">
                                  <p className="text-xs text-emerald-400/80 mb-1">{t('pay.approvedHours')}</p>
                                  <p className="text-xl font-bold text-emerald-400">{(payrollStats.approvedHours || 0).toFixed(1)} s</p>
                              </div>
                          </div>

                          <div className="p-5 bg-zinc-900/30 rounded-xl border border-zinc-800 space-y-3">
                              <div className="flex justify-between items-center text-sm">
                                  <span className="text-zinc-400">{t('pay.hourlyRate')}</span>
                                  <span className="text-white font-medium">€{(targetEmployee.hourlyRate || 0).toFixed(2)}</span>
                              </div>
                              
                              {/* --- DEĞİŞİKLİK: Vergi ve Kesintiler Gizlendi --- */}
                              {/* 
                              <div className="flex justify-between items-center text-sm">
                                  <span className="text-zinc-400">{t('pay.grossPay')}</span>
                                  <span className="text-white font-medium">€{(payrollStats.grossPay || 0).toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between items-center text-sm text-red-400">
                                  <span>{t('pay.tax')} (%19)</span>
                                  <span>-€{(payrollStats.estimatedTax || 0).toFixed(2)}</span>
                              </div> 
                              */}
                          </div>

                          <div className="border-t border-dashed border-zinc-800 pt-6">
                              <div className="flex justify-between items-end">
                                  {/* --- DEĞİŞİKLİK: Etiket "Net" yerine "Toplam Hakediş (Brüt)" yapıldı --- */}
                                  <span className="text-sm font-bold text-zinc-500 uppercase tracking-widest">{t('pay.totalGross')}</span>
                                  {/* --- DEĞİŞİKLİK: Net yerine Brüt Tutar gösteriliyor --- */}
                                  <span className="text-4xl font-bold text-white tracking-tight">€{(payrollStats.grossPay || 0).toFixed(2)}</span>
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      );
  };

  const renderStaffContent = () => {
    if (!selectedEmployeeForDetail) {
        return <div className="h-full flex flex-col items-center justify-center text-zinc-600"><p>Görüntülemek için bir profil seçin</p></div>;
    }
    return (
        <div className="flex h-full w-full flex-col bg-black relative overflow-hidden">
            <div className="absolute top-0 w-full h-64 bg-gradient-to-b from-zinc-900 to-black pointer-events-none z-0"></div>
            <div className="relative z-10 flex-1 w-full overflow-y-auto">
                <div className="sticky top-0 z-50 w-full flex items-center justify-between p-4 md:p-6 bg-gradient-to-b from-black/80 to-transparent backdrop-blur-[2px]">
                    {/* Back Button for Admin on Mobile */}
                    <button 
                        onClick={() => setSelectedEmployeeId(null)}
                        className={`md:hidden p-2 rounded-lg bg-zinc-800/50 text-white ${currentUser.role === Role.ADMIN ? 'block' : 'hidden'}`}
                    >
                        <ChevronLeft size={20} />
                    </button>
                    
                    <div className="flex gap-2 ml-auto">
                        {isEditing ? (
                            <>
                                <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-sm bg-black/50 rounded-lg text-zinc-400">{t('tasks.cancel')}</button>
                                <button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-500">
                                    {isLoading ? <Loader2 className="animate-spin" size={16}/> : <Save size={16} />} {t('pay.save')}
                                </button>
                            </>
                        ) : (
                            // Admin Actions - NOW VISIBLE TO ALL ADMINS
                            currentUser.role === Role.ADMIN && (
                                <>
                                    {/* DİKKAT ÇEKİCİ TRANSFER BUTONU */}
                                    <button 
                                        onClick={() => { setTargetBranch(Branch.DOM); setShowTransferModal(true); }} 
                                        className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-sm font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(249,115,22,0.4)] hover:shadow-[0_0_25px_rgba(249,115,22,0.6)] hover:scale-105 active:scale-95 border border-orange-400/20"
                                    >
                                        <ArrowRightLeft size={18} className="animate-pulse" /> 
                                        <span className="hidden md:inline uppercase tracking-wide">{t('pay.transferBtn')}</span>
                                        <span className="md:hidden">Transfer</span>
                                    </button>

                                    <div className="flex bg-zinc-900 rounded-lg p-1 border border-zinc-800 ml-2">
                                        <button onClick={() => setIsEditing(true)} className="flex items-center gap-2 px-3 py-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-md transition-colors">
                                            <Edit2 size={16} />
                                        </button>
                                        <div className="w-px bg-zinc-800 mx-1 my-1"></div>
                                        <button onClick={handleDelete} className="flex items-center gap-2 px-3 py-1.5 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded-md transition-colors">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </>
                            )
                        )}
                    </div>
                </div>

                <div className="px-4 md:px-8 pb-12 w-full -mt-4">
                     <div className="flex flex-col items-center mb-12">
                        <img src={isEditing ? editForm.avatarUrl : selectedEmployeeForDetail.avatarUrl} className="w-24 h-24 md:w-32 md:h-32 rounded-full border-4 border-black shadow-2xl object-cover" referrerPolicy="no-referrer" />
                        <div className="mt-6 text-center w-full space-y-2">
                            {isEditing ? (
                                <div className="flex flex-col gap-3 items-center w-full">
                                    <input value={editForm.name} onChange={(e) => setEditForm({...editForm, name: e.target.value})} className="text-3xl font-bold text-white bg-transparent border-b border-zinc-700 text-center w-full" placeholder="İsim" />
                                    <div className="flex gap-2">
                                        <select value={editForm.role} onChange={e=>setEditForm({...editForm, role: e.target.value as Role})} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-300">{Object.values(Role).map(r=><option key={r} value={r}>{r}</option>)}</select>
                                    </div>
                                    <div className="flex flex-col gap-2 w-full">
                                        <input value={editForm.avatarUrl} onChange={e => setEditForm({...editForm, avatarUrl: e.target.value})} className="text-xs text-zinc-400 bg-zinc-900/50 border border-zinc-800 rounded px-3 py-1.5 w-full" placeholder="Avatar URL"/>
                                        <label className={`flex items-center justify-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded cursor-pointer transition-colors w-full border border-zinc-700 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                                            <Upload size={14} /> {isLoading ? 'Yükleniyor...' : 'Fotoğraf Yükle'}
                                            <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={isLoading} />
                                        </label>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <h1 className="text-2xl md:text-4xl font-bold text-white text-center">{selectedEmployeeForDetail.name}</h1>
                                    <div className="flex justify-center gap-3 text-zinc-400">
                                        <span className="text-sm">{selectedEmployeeForDetail.role}</span>
                                        <span className="text-sm flex items-center gap-1 text-emerald-400 bg-emerald-900/20 px-2 py-0.5 rounded border border-emerald-500/30">
                                            Havuz
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>
                     </div>

                     {/* FULL WIDTH GRID LAYOUT */}
                     <div className="grid grid-cols-12 gap-6 w-full">
                        {/* LEFT COLUMN: Contact & About */}
                        <div className={`col-span-12 space-y-6 ${(currentUser.role === Role.ADMIN) ? 'xl:col-span-4' : 'xl:col-span-12 md:max-w-2xl md:mx-auto'}`}>
                            <div className="p-6 rounded-2xl bg-zinc-900/30 border border-zinc-800/50">
                                <h3 className="text-sm font-semibold text-white mb-4 opacity-50">{t('pay.contact')}</h3>
                                <div className="space-y-4">
                                    <div className="flex items-center gap-4"><Mail size={18} className="text-zinc-400 min-w-[18px]"/>{isEditing ? <input value={editForm.email} onChange={e=>setEditForm({...editForm, email:e.target.value})} className="bg-transparent border-b border-zinc-700 text-white w-full"/> : <span className="text-zinc-300 break-all">{selectedEmployeeForDetail.email}</span>}</div>
                                    <div className="flex items-center gap-4"><Phone size={18} className="text-zinc-400 min-w-[18px]"/>{isEditing ? <input value={editForm.phone} onChange={e=>setEditForm({...editForm, phone:e.target.value})} className="bg-transparent border-b border-zinc-700 text-white w-full"/> : <span className="text-zinc-300">{selectedEmployeeForDetail.phone || '-'}</span>}</div>
                                    {/* HOURLY RATE: NOW VISIBLE TO ALL ADMINS */}
                                    {currentUser.role === Role.ADMIN && (
                                        <div className="flex items-center gap-4"><Calculator size={18} className="text-zinc-400 min-w-[18px]"/>{isEditing ? <input type="number" value={editForm.hourlyRate} onChange={e=>setEditForm({...editForm, hourlyRate:parseFloat(e.target.value)})} className="bg-transparent border-b border-zinc-700 text-white w-full"/> : <span className="text-zinc-300">€{selectedEmployeeForDetail.hourlyRate}</span>}</div>
                                    )}
                                </div>
                            </div>
                             <div className="p-6 rounded-2xl bg-zinc-900/30 border border-zinc-800/50">
                                 <h3 className="text-sm font-semibold text-white mb-4 opacity-50">{t('pay.about')}</h3>
                                 {isEditing ? <textarea value={editForm.bio} onChange={e=>setEditForm({...editForm, bio:e.target.value})} className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-sm text-zinc-300 min-h-[100px]"/> : <p className="text-sm text-zinc-400">{selectedEmployeeForDetail.bio || '...'}</p>}
                            </div>
                        </div>
                        
                        {/* RIGHT COLUMN: Transfer Geçmişi + Super Admin Panelleri */}
                        {currentUser.role === Role.ADMIN && (
                            <div className="col-span-12 xl:col-span-8 space-y-6">

                                {/* TRANSFER GÜNLÜĞÜ - HAFTALIK PLAN + GÜNLÜK DETAY */}
                                {currentUser.role === Role.ADMIN && transferHistory.length > 0 && (() => {
                                    // Aktif transferlerin kapsadığı tüm günleri hesapla
                                    const dayNames = ['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct'];
                                    const today = new Date();
                                    // Haftanın başlangıcını bul (Pazartesi)
                                    const weekStart = new Date(today);
                                    const dayOfWeek = today.getDay();
                                    weekStart.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

                                    // Haftalık 7 gün oluştur
                                    const weekDays = Array.from({ length: 7 }, (_, i) => {
                                        const d = new Date(weekStart);
                                        d.setDate(weekStart.getDate() + i);
                                        return d.toISOString().split('T')[0];
                                    });

                                    // Her gün için o günü kapsayan transferleri bul
                                    const getTransfersForDay = (dateStr: string) => {
                                        return transferHistory.filter((tr: any) =>
                                            tr.status !== 'cancelled' && dateStr >= tr.start_date && dateStr <= tr.end_date
                                        );
                                    };

                                    // Günlük gruplandırma: Tüm transferleri tarihe göre grupla
                                    const allDates = new Set<string>();
                                    transferHistory.forEach((tr: any) => {
                                        const start = new Date(tr.start_date);
                                        const end = new Date(tr.end_date);
                                        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                                            allDates.add(d.toISOString().split('T')[0]);
                                        }
                                    });
                                    const sortedDates = Array.from(allDates).sort((a, b) => b.localeCompare(a));

                                    return (
                                    <div className="p-5 rounded-2xl bg-zinc-900/30 border border-orange-800/30 animate-in fade-in">
                                        <h3 className="text-xs font-semibold text-orange-400 mb-4 flex items-center gap-2 uppercase tracking-wider">
                                            <ArrowRightLeft size={14} className="text-orange-500"/> Transfer Günlüğü ({transferHistory.length})
                                        </h3>

                                        {/* HAFTALIK PLAN ÜST BÖLÜM - TIKLANABILIR */}
                                        <div className="mb-5 p-3 rounded-xl bg-zinc-950/50 border border-zinc-800/50">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Bu Hafta</span>
                                                {selectedTransferDay && (
                                                    <button onClick={() => setSelectedTransferDay(null)} className="text-[10px] text-orange-400 hover:text-orange-300 transition-colors">
                                                        Tümünü Göster
                                                    </button>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-7 gap-1">
                                                {weekDays.map((dateStr, i) => {
                                                    const dayTransfers = getTransfersForDay(dateStr);
                                                    const isToday = dateStr === today.toISOString().split('T')[0];
                                                    const hasTransfer = dayTransfers.length > 0;
                                                    const isSelected = selectedTransferDay === dateStr;
                                                    const dayNum = new Date(dateStr).getDate();
                                                    return (
                                                        <button
                                                            key={dateStr}
                                                            onClick={() => hasTransfer ? setSelectedTransferDay(isSelected ? null : dateStr) : null}
                                                            className={`flex flex-col items-center p-1.5 rounded-lg transition-all ${hasTransfer ? 'cursor-pointer hover:scale-105' : 'cursor-default'} ${isSelected ? 'ring-2 ring-orange-500 bg-orange-900/50 shadow-lg shadow-orange-900/30' : isToday ? 'ring-1 ring-orange-500/50' : ''} ${hasTransfer && !isSelected ? 'bg-orange-950/40 hover:bg-orange-950/60' : !hasTransfer ? 'bg-zinc-900/30' : ''}`}
                                                        >
                                                            <span className={`text-[9px] font-medium ${isSelected ? 'text-orange-300' : isToday ? 'text-orange-400' : 'text-zinc-500'}`}>{dayNames[(i + 1) % 7]}</span>
                                                            <span className={`text-xs font-bold mt-0.5 ${isSelected ? 'text-white' : isToday ? 'text-white' : hasTransfer ? 'text-orange-300' : 'text-zinc-600'}`}>{dayNum}</span>
                                                            {hasTransfer && (
                                                                <div className="flex gap-0.5 mt-1">
                                                                    {dayTransfers.slice(0, 3).map((tr: any) => (
                                                                        <div key={tr.id} className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-orange-300' : 'bg-orange-500'}`} title={`Yeni Çalışma Şubeniz: ${tr.to_branch}`}></div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* GÜNLÜK DETAY - Seçili güne göre filtrelenir */}
                                        <div className="relative overflow-y-auto max-h-[350px] pr-1">
                                            <div className="absolute left-3 top-0 bottom-0 w-px bg-orange-800/40"></div>
                                            <div className="space-y-0">
                                                {(selectedTransferDay ? [selectedTransferDay] : sortedDates).map(dateStr => {
                                                    const dayTransfers = transferHistory.filter((tr: any) =>
                                                        dateStr >= tr.start_date && dateStr <= tr.end_date
                                                    ).sort((a: any, b: any) => (a.start_time || '00:00').localeCompare(b.start_time || '00:00'));
                                                    if (dayTransfers.length === 0) return null;
                                                    const isToday = dateStr === today.toISOString().split('T')[0];
                                                    const dateObj = new Date(dateStr);
                                                    const dayLabel = dateObj.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

                                                    return (
                                                        <div key={dateStr} className="relative pl-8 pb-3">
                                                            {/* Timeline noktası */}
                                                            <div className={`absolute left-1.5 top-1.5 w-3 h-3 rounded-full border-2 ${isToday ? 'bg-orange-500 border-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.6)]' : 'bg-zinc-700 border-zinc-600'}`}></div>

                                                            {/* Gün başlığı */}
                                                            <div className={`text-[10px] font-bold mb-1.5 uppercase tracking-wider ${isToday ? 'text-orange-400' : 'text-zinc-500'}`}>
                                                                {isToday ? '● Bugün — ' : ''}{dayLabel}
                                                                <span className="text-zinc-600 normal-case ml-1">({dayTransfers.length} transfer)</span>
                                                            </div>

                                                            {/* O güne ait tüm transferler */}
                                                            <div className="space-y-1.5">
                                                                {dayTransfers.map((tr: any) => (
                                                                    <div key={tr.id} className={`p-2.5 rounded-lg border ${tr.status === 'active' ? 'bg-orange-950/30 border-orange-700/40' : 'bg-zinc-900/30 border-zinc-800/50'}`}>
                                                                        <div className="flex items-center justify-between">
                                                                            <div className="flex items-center gap-1.5">
                                                                                <span className="text-[11px] text-zinc-400">Yeni Çalışma Şubeniz:</span>
                                                                                <span className="text-[11px] text-white font-semibold bg-orange-600/20 px-1.5 py-0.5 rounded border border-orange-500/20">{tr.to_branch}</span>
                                                                            </div>
                                                                            <div className="flex items-center gap-1">
                                                                                <span className="text-[10px] text-zinc-500 flex items-center gap-0.5">
                                                                                    <Clock size={9}/> {tr.start_time}-{tr.end_time}
                                                                                </span>
                                                                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${tr.status === 'active' ? 'bg-orange-600/20 text-orange-400' : 'bg-zinc-700/30 text-zinc-400'}`}>
                                                                                    {tr.status === 'active' ? 'Aktif' : 'Bitti'}
                                                                                </span>
                                                                                <button
                                                                                    onClick={async () => {
                                                                                        if(!confirm('Bu transfer kalıcı olarak silinecek. Emin misiniz?')) return;
                                                                                        await supabase.from('personnel_transfers').delete().eq('id', tr.id);
                                                                                        // Takvimden de ilgili etkinliği sil
                                                                                        await supabase.from('calendar_events').delete()
                                                                                            .eq('type', 'Şube Transferi')
                                                                                            .eq('date', tr.start_date)
                                                                                            .contains('attendees', [selectedEmployeeForDetail!.id]);
                                                                                        setTransferHistory(prev => prev.filter((t: any) => t.id !== tr.id));
                                                                                    }}
                                                                                    className="text-zinc-600 hover:text-red-400 transition-colors"
                                                                                    title="Sil"
                                                                                >
                                                                                    <Trash2 size={11}/>
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                    );
                                })()}
                            </div>
                        )}
                     </div>
                </div>
            </div>
        </div>
    );
  };

  const renderMonthlyContent = () => {
       if (!targetEmployee) return <div className="h-full flex items-center justify-center text-zinc-500"><p>Personel seçiniz</p></div>;
       return (
        <div className="h-full flex flex-col bg-zinc-950/50">
            {/* MODIFIED HEADER: items-stretch to force height/width, removed w-full constraint to allow flex-1 to work properly */}
            <div className="p-4 md:p-6 border-b border-zinc-800 flex flex-col md:flex-row justify-between items-stretch md:items-center bg-zinc-900/50 backdrop-blur-md sticky top-0 z-20 gap-4">
                <div className="flex items-center gap-2 md:gap-4 w-full md:w-auto justify-between md:justify-start">
                     <div className="flex items-center gap-2 flex-1 md:flex-none">
                        {/* Back Button for Admin on Mobile */}
                        <button 
                            onClick={() => setSelectedEmployeeId(null)}
                            className={`md:hidden p-2 rounded-lg bg-zinc-800/50 text-white ${currentUser.role === Role.ADMIN ? 'block' : 'hidden'}`}
                        >
                            <ChevronLeft size={20} />
                        </button>

                        {/* MODIFIED: w-full added to ensure full width on mobile */}
                        <div className="flex flex-1 md:flex-none items-center justify-between bg-zinc-950 border border-zinc-800 rounded-lg p-1 w-full">
                            <button onClick={() => handleMonthChange('prev')} className="p-1 hover:bg-zinc-800 rounded text-zinc-400"><ChevronLeft size={20}/></button>
                            <span className="flex-1 text-center px-2 md:px-4 text-xs md:text-sm font-bold text-white min-w-[80px] md:min-w-[100px]">{formatDate(currentMonth + "-01", { month: 'long', year: 'numeric' })}</span>
                            <button onClick={() => handleMonthChange('next')} className="p-1 hover:bg-zinc-800 rounded text-zinc-400"><ChevronRight size={20}/></button>
                        </div>
                     </div>
                    <div className="hidden md:block"><h2 className="text-lg font-bold text-white">{targetEmployee.name}</h2></div>
                    {/* Mobile Only Name Display */}
                    <div className="md:hidden text-right ml-2"><h2 className="text-sm font-bold text-white">{targetEmployee.name.split(' ')[0]}</h2></div>
                </div>
                <button onClick={handleOpenTimeModal} className="w-full md:w-auto flex items-center justify-center gap-2 px-3 md:px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs md:text-sm font-medium rounded-lg"><Plus size={16} /> <span className="inline">{t('pay.addHours')}</span></button>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                <div className="flex-1 w-full overflow-y-auto p-4 md:p-6">
                    <h3 className="text-sm font-semibold text-zinc-400 mb-6 flex items-center gap-2"><Clock size={16}/> {t('pay.workHistory')}</h3>
                    <div className="relative ml-3 space-y-8 border-l border-zinc-800">
                        {monthlyLogs.length===0 ? <span className="ml-6 text-zinc-500 text-sm">{t('pay.noRecord')}</span> : monthlyLogs.map(log=>(
                            <div key={log.id} className="relative ml-6 group">
                                <span className={`absolute -left-[31px] top-1 w-4 h-4 rounded-full border-2 border-zinc-900 ${log.status==='Onaylandı'?'bg-green-500':log.status==='Reddedildi'?'bg-red-500':'bg-amber-500'}`}></span>
                                <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4">
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <span className="text-sm font-bold text-white">{formatDate(log.date, {day:'numeric',month:'long',weekday:'long'})}</span>
                                            {/* GÜNCELLEME: SAAT GÖSTERİMİ & ŞUBE DETAYI */}
                                            <div className="flex flex-col gap-1 mt-1">
                                                <div className="flex items-center gap-2 text-xs text-zinc-400">
                                                    <Clock size={12} />
                                                    <span>{log.startTime} - {log.endTime}</span>
                                                    <span className="text-zinc-600">•</span>
                                                    <span className="text-white font-medium">{log.totalHours} Saat</span>
                                                </div>
                                                {log.branch && (
                                                    <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                                                        <MapPin size={10} />
                                                        <span>{log.branch}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            <span className={`text-[10px] px-2 py-1 rounded ${log.status==='Onaylandı'?'bg-green-900/20 text-green-400':log.status==='Reddedildi'?'bg-red-900/20 text-red-400':'bg-amber-900/20 text-amber-400'}`}>{log.status}</span>
                                            {currentUser.role === Role.ADMIN && (
                                                <button onClick={() => handleDeleteTimeLog(log.id)} className="text-zinc-500 hover:text-red-400 p-1 rounded-md transition-colors" title="Sil">
                                                    <Trash2 size={18} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {currentUser.role === Role.ADMIN && log.status === 'Bekliyor' && (
                                        <div className="mt-3 pt-3 border-t border-zinc-800/50 flex justify-end gap-2">
                                            <button onClick={()=>handleStatusChange(log.id,'Reddedildi')} className="p-1.5 hover:bg-red-900/20 text-zinc-500 hover:text-red-400 rounded"><ThumbsDown size={14}/></button>
                                            <button onClick={()=>handleStatusChange(log.id,'Onaylandı')} className="px-3 py-1.5 bg-zinc-800 hover:bg-green-600 hover:text-white text-zinc-300 text-xs rounded flex gap-1"><ThumbsUp size={14}/> Onayla</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                {/* NOT: Finansal Özet buradan kaldırıldı ve ayrı bir 'FINANCIAL' sekmesine taşındı. */}
            </div>
        </div>
       )
  };

  return (
    <div className="h-full flex flex-col relative overflow-hidden bg-zinc-950">
        {/* TRANSFER MODAL — KREATIV TASARIM */}
        {showTransferModal && selectedEmployeeForDetail && (() => {
            // Çakışma hesaplayıcı
            const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
            const getConflictsForBranch = (branch: string) => transferHistory.filter((tr: any) => {
                if (tr.status === 'cancelled' || tr.to_branch === branch) return false;
                if (!transferDates.startDate || !transferDates.endDate) return false;
                const dateOverlap = tr.start_date <= transferDates.endDate && tr.end_date >= transferDates.startDate;
                if (!dateOverlap) return false;
                const trS = toMin(tr.start_time || '08:00'), trE = toMin(tr.end_time || '18:00');
                const nS = toMin(transferDates.startTime || '08:00'), nE = toMin(transferDates.endTime || '18:00');
                return nS < trE && trS < nE;
            });
            const allConflicts = getConflictsForBranch(targetBranch);
            const hasAnyConflict = allConflicts.length > 0;

            return (
            <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
                <div className="bg-gradient-to-b from-zinc-900 via-zinc-900 to-zinc-950 border border-zinc-700/50 rounded-3xl shadow-[0_0_80px_rgba(249,115,22,0.08)] w-full max-w-md max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95">

                    {/* HEADER — Gradient accent bar (sabit) */}
                    <div className="relative overflow-hidden shrink-0">
                        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-500 via-amber-400 to-orange-600"></div>
                        <div className="p-5 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-lg shadow-orange-900/30">
                                    <ArrowRightLeft size={18} className="text-white" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-white tracking-tight">Transfer Planla</h3>
                                    <p className="text-[10px] text-zinc-500 mt-0.5">Personel görevlendirme</p>
                                </div>
                            </div>
                            <button onClick={() => setShowTransferModal(false)} className="w-8 h-8 rounded-full bg-zinc-800/80 hover:bg-zinc-700 flex items-center justify-center transition-colors group">
                                <X size={16} className="text-zinc-400 group-hover:text-white" />
                            </button>
                        </div>
                    </div>

                    <div className="px-5 pb-5 space-y-5 overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
                        {/* PERSONEL KARTI */}
                        <div className="flex items-center gap-3 p-3 rounded-2xl bg-zinc-800/30 border border-zinc-800/50">
                            <div className="relative">
                                <div className="w-12 h-12 rounded-xl overflow-hidden ring-2 ring-zinc-700 shadow-lg">
                                    <img src={selectedEmployeeForDetail.avatarUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                </div>
                                <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-zinc-900"></div>
                            </div>
                            <div className="flex-1 min-w-0">
                                <h4 className="text-sm font-semibold text-white truncate">{selectedEmployeeForDetail.name}</h4>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">Havuzda</span>
                                    {transferHistory.filter((t: any) => t.status === 'active').length > 0 && (
                                        <span className="text-[10px] text-zinc-500">{transferHistory.filter((t: any) => t.status === 'active').length} aktif transfer</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* TARIH & SAAT — Kompakt grid */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <CalendarRange size={13} className="text-zinc-500" />
                                <span className="text-xs font-medium text-zinc-400">Tarih & Saat</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <span className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider">Başlangıç</span>
                                    <input type="date" value={transferDates.startDate} onChange={(e) => setTransferDates({...transferDates, startDate: e.target.value})}
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 transition-all" />
                                </div>
                                <div className="space-y-1">
                                    <span className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider">Bitiş</span>
                                    <input type="date" value={transferDates.endDate} onChange={(e) => setTransferDates({...transferDates, endDate: e.target.value})}
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 transition-all" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="relative">
                                    <Clock size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                                    <input type="time" value={transferDates.startTime} onChange={(e) => {
                                        const val = e.target.value;
                                        const [h, m] = val.split(':').map(Number);
                                        const endH = Math.min(h + 1, 23);
                                        const autoEnd = `${String(endH).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
                                        setTransferDates({...transferDates, startTime: val, endTime: autoEnd});
                                    }}
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-3 py-2 text-xs text-white focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 transition-all" />
                                </div>
                                <div className="relative">
                                    <Clock size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                                    <input type="time" value={transferDates.endTime} onChange={(e) => setTransferDates({...transferDates, endTime: e.target.value})}
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-3 py-2 text-xs text-white focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 transition-all" />
                                </div>
                            </div>
                        </div>

                        {/* HEDEF ŞUBE SEÇİMİ */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Building2 size={13} className="text-zinc-500" />
                                <span className="text-xs font-medium text-zinc-400">Hangi şubeye gönderilecek?</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {Object.values(Branch).map(branch => {
                                    const isActive = targetBranch === branch;
                                    return (
                                        <button key={branch} onClick={() => setTargetBranch(branch)}
                                            className={`relative flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all duration-200 ${
                                                isActive
                                                    ? 'bg-orange-500/15 border-orange-500 ring-1 ring-orange-500/30'
                                                    : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-600'
                                            }`}
                                        >
                                            <div className={`w-2.5 h-2.5 rounded-full shrink-0 transition-colors ${isActive ? 'bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.5)]' : 'bg-zinc-700'}`}></div>
                                            <span className={`text-xs font-semibold ${isActive ? 'text-orange-300' : 'text-zinc-400'}`}>{branch}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* GÜNLÜK PROGRAM TABLOSU */}
                        {(() => {
                            const activeTransfers = transferHistory.filter((tr: any) => {
                                if (tr.status === 'cancelled') return false;
                                if (!transferDates.startDate || !transferDates.endDate) return false;
                                return tr.start_date <= transferDates.endDate && tr.end_date >= transferDates.startDate;
                            });

                            const newStart = toMin(transferDates.startTime || '08:00');
                            const newEnd = toMin(transferDates.endTime || '18:00');
                            const formatTime = (m: number) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

                            // Tüm görevleri birleştir: mevcut + yeni
                            const allEntries = [
                                ...activeTransfers.map((tr: any) => ({
                                    id: tr.id,
                                    branch: tr.to_branch,
                                    start: toMin(tr.start_time || '08:00'),
                                    end: toMin(tr.end_time || '18:00'),
                                    isNew: false,
                                    overlaps: newStart < toMin(tr.end_time || '18:00') && toMin(tr.start_time || '08:00') < newEnd
                                })),
                                { id: 'new', branch: targetBranch, start: newStart, end: newEnd, isNew: true, overlaps: false }
                            ].sort((a, b) => a.start - b.start);

                            return (
                                <div className="space-y-2.5">
                                    <div className="flex items-center gap-2">
                                        <Clock size={13} className="text-zinc-500" />
                                        <span className="text-xs font-medium text-zinc-400">Günün programı</span>
                                        {activeTransfers.length > 0 && (
                                            <span className="text-[10px] text-zinc-600 ml-auto">{activeTransfers.length} mevcut görev</span>
                                        )}
                                    </div>
                                    <div className="rounded-xl border border-zinc-800 overflow-hidden">
                                        {allEntries.map((entry, i) => (
                                            <div key={entry.id} className={`flex items-center px-3 py-2.5 ${i > 0 ? 'border-t border-zinc-800/60' : ''} ${
                                                entry.isNew ? 'bg-orange-500/8' : entry.overlaps ? 'bg-red-500/8' : 'bg-zinc-900/30'
                                            }`}>
                                                {/* Saat aralığı */}
                                                <div className="w-[90px] shrink-0">
                                                    <span className={`text-xs font-mono font-semibold ${entry.isNew ? 'text-orange-400' : entry.overlaps ? 'text-red-400' : 'text-zinc-300'}`}>
                                                        {formatTime(entry.start)} - {formatTime(entry.end)}
                                                    </span>
                                                </div>
                                                {/* Şube adı */}
                                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                                    <div className={`w-1.5 h-6 rounded-full shrink-0 ${entry.isNew ? 'bg-orange-500' : entry.overlaps ? 'bg-red-500' : 'bg-zinc-600'}`}></div>
                                                    <span className={`text-xs font-medium truncate ${entry.isNew ? 'text-orange-300' : entry.overlaps ? 'text-red-300' : 'text-zinc-400'}`}>
                                                        {entry.branch}
                                                    </span>
                                                </div>
                                                {/* Durum etiketi */}
                                                <div className="shrink-0 ml-2">
                                                    {entry.isNew ? (
                                                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/20">YENİ</span>
                                                    ) : entry.overlaps ? (
                                                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/20 flex items-center gap-1">
                                                            <AlertTriangle size={9}/> ÇAKIŞMA
                                                        </span>
                                                    ) : (
                                                        <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500">MEVCUT</span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                        {allEntries.length === 1 && (
                                            <div className="px-3 py-2 border-t border-zinc-800/60 bg-zinc-900/20">
                                                <span className="text-[10px] text-zinc-600 italic">Bu tarihte başka görev bulunmuyor</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* ÇAKIŞMA UYARISI */}
                        {hasAnyConflict && (
                            <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-3.5 space-y-2.5">
                                <div className="flex items-center gap-2">
                                    <AlertTriangle size={14} className="text-red-400" />
                                    <span className="text-xs font-bold text-red-300">Dikkat: Saat çakışması var!</span>
                                </div>
                                <p className="text-[11px] text-red-300/70 leading-relaxed">
                                    Bu personelin seçtiğiniz saat aralığında başka şubelerde görevi bulunuyor. Yine de devam edebilirsiniz, ancak aynı saatte iki farklı şubede çalışması gerekeceğini unutmayın.
                                </p>
                            </div>
                        )}

                        {/* ONAYLA BUTONU */}
                        <button onClick={handleTransfer} disabled={isLoading}
                            className={`w-full py-3.5 rounded-2xl font-semibold text-sm transition-all duration-300 flex items-center justify-center gap-2.5 shadow-xl ${
                                hasAnyConflict
                                    ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white shadow-red-900/30'
                                    : 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white shadow-orange-900/30'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            {isLoading ? <Loader2 className="animate-spin" size={18}/> : (
                                <>
                                    {hasAnyConflict ? <AlertTriangle size={16}/> : <Rocket size={16}/>}
                                    {hasAnyConflict ? 'Çakışmaya Rağmen Onayla' : t('cal.confirmTransfer')}
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
            );
        })()}

        {/* ADD TIME LOG MODAL */}
        {showTimeModal && (
            <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                    <div className="p-6 border-b border-zinc-800 flex justify-between items-center"><h3 className="text-lg font-bold text-white flex items-center gap-2"><Clock size={20} className="text-indigo-500" /> {t('pay.addHours')}</h3><button onClick={() => setShowTimeModal(false)} className="text-zinc-500 hover:text-white"><X size={20} /></button></div>
                    <form onSubmit={handleSaveTimeLog} className="p-6 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                             <div className="space-y-1"><label className="text-xs text-zinc-400">{t('cal.startDate')}</label><input type="date" required value={timeForm.date} onChange={e => setTimeForm({...timeForm, date: e.target.value})} className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-white"/></div>
                             <div className="space-y-1"><label className="text-xs text-zinc-400">Şube</label><select value={timeForm.branch} onChange={e => setTimeForm({...timeForm, branch: e.target.value as Branch})} className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-white">{Object.values(Branch).map(b=><option key={b} value={b}>{b}</option>)}</select></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                             <div className="space-y-1"><label className="text-xs text-zinc-400">{t('cal.startTime')}</label><input type="time" required value={timeForm.startTime} onChange={e => setTimeForm({...timeForm, startTime: e.target.value})} className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-white"/></div>
                             <div className="space-y-1"><label className="text-xs text-zinc-400">{t('cal.endTime')}</label><input type="time" required value={timeForm.endTime} onChange={e => setTimeForm({...timeForm, endTime: e.target.value})} className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-white"/></div>
                        </div>
                        <div className="pt-4 flex gap-3">
                            <button type="button" onClick={() => setShowTimeModal(false)} className="flex-1 py-2 bg-zinc-800 text-white rounded">{t('tasks.cancel')}</button>
                            <button type="submit" className="flex-1 py-2 bg-indigo-600 text-white rounded">
                                {isLoading ? <Loader2 className="animate-spin mx-auto" size={16}/> : t('pay.save')}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        )}

        <header className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 md:px-6 md:py-4 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm shrink-0">
            <h2 className="text-lg font-bold text-white tracking-tight">{t('pay.title')}</h2>
            <div className="flex w-full md:w-auto bg-zinc-900 p-1 rounded-xl border border-zinc-800">
                {currentUser.role === Role.ADMIN && (
                    <button 
                        onClick={() => setCurrentTab('STAFF')} 
                        className={`flex-1 md:flex-none text-center px-4 py-1.5 text-xs font-medium rounded-lg transition-all ${currentTab === 'STAFF' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        {t('pay.tabStaff')}
                    </button>
                )}
                <button 
                    onClick={() => setCurrentTab('MONTHLY')} 
                    className={`flex-1 md:flex-none text-center px-4 py-1.5 text-xs font-medium rounded-lg transition-all ${currentTab === 'MONTHLY' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                    {currentUser.role === Role.ADMIN ? 'Bordro' : t('pay.tabMonthly')}
                </button>
                {/* NEW: FINANCIAL SUMMARY TAB BUTTON - VISIBLE TO ALL ADMINS */}
                {currentUser.role === Role.ADMIN && (
                    <button 
                        onClick={() => setCurrentTab('FINANCIAL')} 
                        className={`flex-1 md:flex-none text-center px-4 py-1.5 text-xs font-medium rounded-lg transition-all ${currentTab === 'FINANCIAL' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        {t('pay.tabFinancial')}
                    </button>
                )}
            </div>
        </header>

        <div className="flex-1 overflow-hidden flex flex-col md:flex-row relative">
            {/* SOL PANEL (LİSTE) - SADECE ADMIN GÖREBİLİR - GENİŞLİK AYARLANDI (480px) */}
             {currentUser.role === Role.ADMIN && (
                 <div className={`w-full md:w-[480px] border-r border-zinc-800 flex-col bg-zinc-950 h-full ${selectedEmployeeId ? 'hidden md:flex' : 'flex'}`}>
                  <div className="p-6 pb-4">
                     <div className="flex justify-between items-center mb-6">
                         <div><h3 className="text-xl font-bold text-white">{t('pay.tabStaff')}</h3><p className="text-xs text-zinc-500">{filteredEmployees.length} kişi</p></div>
                         <div className="flex items-center gap-2">
                             {/* ADMIN LİSTESİ BUTONU */}
                             {currentUser.role === Role.ADMIN && adminEmployees.length > 0 && (
                                 <div className="relative">
                                     <button
                                         onClick={() => setShowAdminList(!showAdminList)}
                                         className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${showAdminList ? 'bg-red-900/20 text-red-400 border-red-900/40' : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-red-400 hover:border-red-900/30'}`}
                                     >
                                         <Shield size={14} />
                                         <span>Admin</span>
                                         <span className="text-[10px] bg-red-900/30 text-red-400 px-1.5 py-0.5 rounded-full">{adminEmployees.length}</span>
                                         <ChevronRight size={12} className={`transition-transform duration-200 ${showAdminList ? 'rotate-90' : ''}`} />
                                     </button>
                                     {showAdminList && (
                                         <div className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] md:w-64 max-w-64 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-50 overflow-hidden">
                                             <div className="p-3 border-b border-zinc-800 flex items-center gap-2">
                                                 <Shield size={14} className="text-red-500" />
                                                 <span className="text-xs font-bold text-white">Admin Listesi</span>
                                             </div>
                                             <div className="max-h-64 overflow-y-auto p-2 space-y-1">
                                                 {adminEmployees.map(admin => (
                                                     <div
                                                         key={admin.id}
                                                         onClick={() => { handleSelectEmployee(admin.id); setCurrentTab('STAFF'); setShowAdminList(false); }}
                                                         className={`p-2.5 rounded-lg cursor-pointer transition-all border ${selectedEmployeeId === admin.id ? 'bg-red-900/20 border-red-500/30' : 'bg-zinc-950/50 border-zinc-800/50 hover:border-red-900/30 hover:bg-zinc-900/50'}`}
                                                     >
                                                         <div className="flex items-center gap-3">
                                                             <img src={admin.avatarUrl} className="w-8 h-8 rounded-full object-cover border border-red-900/30" referrerPolicy="no-referrer" />
                                                             <div className="flex-1 min-w-0">
                                                                 <h4 className="text-xs font-semibold text-white truncate">{admin.name}</h4>
                                                                 <p className="text-[10px] text-zinc-500 truncate">{admin.email}</p>
                                                             </div>
                                                             <ChevronRight size={14} className="text-zinc-600 shrink-0" />
                                                         </div>
                                                     </div>
                                                 ))}
                                             </div>
                                         </div>
                                     )}
                                 </div>
                             )}
                             {/* ADD BUTTON NOW FOR ALL ADMINS */}
                             {currentUser.role === Role.ADMIN && (<button onClick={handleAddNew} className="w-8 h-8 flex items-center justify-center bg-indigo-600 rounded-full text-white hover:bg-indigo-500 shadow-lg"><Plus size={18} /></button>)}
                         </div>
                     </div>
                     <div className="relative mb-4"><Search size={16} className="absolute left-3 top-3 text-zinc-500" /><input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t('pay.search')} className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-indigo-500"/></div>
                     
                     {/* ŞUBE FİLTRESİ KALDIRILDI - Tüm personel havuzda */}
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
                    {isLoading && employees.length === 0 ? <div className="text-center p-4 text-zinc-500">{t('common.loading')}</div> : filteredEmployees.map(emp => (
                        <div key={emp.id} onClick={() => handleSelectEmployee(emp.id)} className={`group p-3 rounded-xl cursor-pointer transition-all border ${selectedEmployeeId === emp.id ? 'bg-zinc-900 border-indigo-500/30 shadow' : 'bg-transparent border-transparent hover:bg-zinc-900 hover:border-zinc-800'}`}>
                            <div className="flex items-center gap-4">
                                <div className="relative">
                                    <img src={emp.avatarUrl} className="w-12 h-12 rounded-full object-cover" referrerPolicy="no-referrer" />
                                    <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-zinc-950 bg-emerald-500"></div>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className={`text-sm font-semibold truncate ${selectedEmployeeId === emp.id ? 'text-white' : 'text-zinc-300'}`}>{emp.name}</h4>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-[11px] text-zinc-500">{emp.role}</span>
                                    </div>
                                </div>
                                
                                {/* HIZLI TRANSFER BUTONU - LISTE İÇİNDE (TURUNCU GÜNCELLEMESİ) - ALL ADMINS */}
                                {currentUser.role === Role.ADMIN && (
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation(); // Detaya girmeyi engelle
                                            setSelectedEmployeeId(emp.id); // Modal için seçimi güncelle
                                            setTargetBranch(Branch.DOM); // Modal varsayılan şubesini ayarla
                                            setShowTransferModal(true);
                                        }}
                                        className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white hover:bg-orange-600 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 z-20 shadow-lg transform active:scale-95 border border-transparent hover:border-orange-400"
                                        title={t('cal.transfer')}
                                    >
                                        <ArrowRightLeft size={16} />
                                    </button>
                                )}

                                <div className="md:hidden text-zinc-600"><ChevronRight size={18} /></div>
                            </div>
                        </div>
                    ))}
                  </div>
                </div>
            )}

            {/* SAĞ PANEL (İÇERİK) - EĞER PERSONEL İSE TAM EKRAN */}
            <div className={`flex-1 w-full overflow-hidden ${selectedEmployeeId ? 'flex' : 'hidden md:flex'}`}>
                 {currentTab === 'STAFF' ? renderStaffContent() : currentTab === 'FINANCIAL' ? renderFinancialContent() : renderMonthlyContent()}
            </div>
        </div>
    </div>
  );
};

export default Payroll;