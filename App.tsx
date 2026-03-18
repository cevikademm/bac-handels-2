import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import Messages from './components/Messages';
import Tasks from './components/Tasks';
import Calendar from './components/Calendar';
import ShiftSchedule from './components/ShiftSchedule';
import Payroll from './components/Payroll';
import Login from './components/Login';
import SalesDashboard from './components/SalesDashboard'; // Import new component
import { Settings as SettingsIcon, Shield, Volume2, Upload, RefreshCw, Play, Loader2, KeyRound, Globe } from 'lucide-react';
import { MOCK_EMPLOYEES, NOTIFICATION_SOUND } from './constants';
import { Employee, Role, AppNotification } from './types';
import { supabase } from './lib/supabase';
import { LanguageProvider, useLanguage } from './lib/i18n';
import { validateFile, logAuditEvent, sanitizeInput, initProductionGuard } from './lib/security';

// Üretim modunda konsol çıktılarını koru
initProductionGuard();

// Fallback Settings Component
const Settings = ({ currentUser, onUpdateUser }: { currentUser: Employee | null, onUpdateUser?: (user: Employee) => void }) => {
    const [soundLoading, setSoundLoading] = useState(false);
    const [hasCustomSound, setHasCustomSound] = useState(false);
    const { language, setLanguage, t } = useLanguage();

    // Password State
    const [passForm, setPassForm] = useState({ current: '', new: '', confirm: '' });
    const [passLoading, setPassLoading] = useState(false);

    // Admin Password Reset State
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
    const [resetLoading, setResetLoading] = useState(false);

    // Avatar Upload State
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentUser) return;

        // GÜVENLİK: Dosya tipi, uzantı ve boyut doğrulaması
        const validation = validateFile(file, 'image');
        if (!validation.valid) {
            alert(validation.error);
            return;
        }

        setIsUploadingAvatar(true);
        try {
            const fileExt = validation.safeExtension;
            const fileName = `${currentUser.id}-${crypto.randomUUID()}.${fileExt}`;
            const filePath = `${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data } = supabase.storage
                .from('avatars')
                .getPublicUrl(filePath);

            const newAvatarUrl = data.publicUrl;

            // Delete old avatar if it exists and is from supabase storage
            if (currentUser.avatarUrl && currentUser.avatarUrl.includes('/storage/v1/object/public/avatars/')) {
                try {
                    const oldFileName = currentUser.avatarUrl.split('/avatars/').pop();
                    if (oldFileName) {
                        await supabase.storage.from('avatars').remove([oldFileName]);
                    }
                } catch (e) {
                    console.error('Eski fotoğraf silinirken hata oluştu:', e);
                }
            }

            const { error: updateError } = await supabase
                .from('profiles')
                .update({ avatar_url: newAvatarUrl })
                .eq('id', currentUser.id);

            if (updateError) throw updateError;

            if (onUpdateUser) {
                onUpdateUser({ ...currentUser, avatarUrl: newAvatarUrl });
            }
            alert('Profil fotoğrafı başarıyla güncellendi.');
        } catch (error) {
            console.error('Error uploading avatar:', error);
            alert('Fotoğraf yüklenirken bir hata oluştu.');
        } finally {
            setIsUploadingAvatar(false);
        }
    };

    useEffect(() => {
        // Bileşen yüklendiğinde kayıtlı özel ses var mı kontrol et
        const stored = localStorage.getItem('custom_notification_sound');
        setHasCustomSound(!!stored);
    }, []);

    useEffect(() => {
        if (currentUser?.role === Role.ADMIN) {
            const fetchEmployees = async () => {
                try {
                    const { data, error } = await supabase
                        .from('profiles')
                        .select('*')
                        .order('full_name');
                    
                    if (error) throw error;
                    if (data) {
                        const mapped = data.map(d => ({
                            id: d.id,
                            name: d.full_name,
                            email: d.email,
                            role: d.role as Role,
                            branch: d.branch,
                            hourlyRate: d.hourly_rate,
                            taxClass: d.tax_class,
                            avatarUrl: d.avatar_url,
                            advances: d.advances,
                            phone: d.phone,
                            bio: d.bio,
                            badges: d.badges,
                            tags: d.tags,
                            metrics: d.metrics
                        }));
                        setEmployees(mapped);
                    }
                } catch (err) {
                    console.error("Personel listesi çekilemedi:", err);
                }
            };
            fetchEmployees();
        }
    }, [currentUser]);

    const handleAdminPasswordReset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedEmployeeId) {
            alert("Lütfen bir personel seçin.");
            return;
        }

        if (!window.confirm("Bu personelin şifresini standart 'Bac2026!' olarak sıfırlamak istediğinize emin misiniz?")) {
            return;
        }

        setResetLoading(true);
        try {
            // GÜVENLİK: Güvenli RPC fonksiyonu ile bcrypt hashlenmiş şifre sıfırlama
            const { data, error } = await supabase.rpc('admin_reset_password', {
                p_admin_id: currentUser?.id,
                p_target_user_id: selectedEmployeeId,
                p_new_password: 'Bac2026!',
            });

            if (error) throw error;
            if (data === false) {
                alert("Yetkilendirme hatası. Bu işlemi sadece Admin yapabilir.");
                return;
            }
            alert("Personel şifresi başarıyla 'Bac2026!' olarak sıfırlandı.");
            setSelectedEmployeeId('');
        } catch (err) {
            alert("Şifre sıfırlanırken bir hata oluştu.");
        } finally {
            setResetLoading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('audio/')) {
            alert("Lütfen geçerli bir ses dosyası yükleyin (mp3, wav).");
            return;
        }

        if (file.size > 1 * 1024 * 1024) {
            alert("Dosya boyutu çok büyük (Max 1MB).");
            return;
        }

        setSoundLoading(true);

        const reader = new FileReader();
        reader.onload = async (event) => {
            const base64 = event.target?.result as string;
            
            try {
                localStorage.setItem('custom_notification_sound', base64);
                
                if (currentUser) {
                    try {
                        const newMetrics = { 
                            ...currentUser.metrics, 
                            custom_sound_enabled: true 
                        };
                        await supabase.from('profiles').update({ metrics: newMetrics }).eq('id', currentUser.id);
                    } catch (dbErr) {
                        console.warn("Supabase kayıt hatası (Kritik değil):", dbErr);
                    }
                }

                setHasCustomSound(true);
                const audio = new Audio(base64);
                audio.volume = 0.5;
                audio.play().catch(e => console.warn("Otomatik oynatma engellendi:", e)); 
                alert("Bildirim sesi başarıyla varsayılan olarak atandı ve kaydedildi.");
            } catch (err) {
                alert("Dosya işlenirken hata oluştu.");
                console.error(err);
            } finally {
                setSoundLoading(false);
            }
        };
        reader.readAsDataURL(file);
    };

    const handleResetSound = () => {
        localStorage.removeItem('custom_notification_sound');
        setHasCustomSound(false);
        try {
            const audio = new Audio(NOTIFICATION_SOUND);
            audio.volume = 0.5;
            audio.play().catch(() => {});
        } catch (e) {
            console.error("Varsayılan ses çalma hatası:", e);
        }
    };

    const handleTestSound = () => {
        try {
            const src = localStorage.getItem('custom_notification_sound') || NOTIFICATION_SOUND;
            const audio = new Audio(src);
            audio.volume = 0.5;
            audio.play().catch(e => {
                console.error("Ses çalma hatası:", e);
                alert("Ses çalınamadı. Tarayıcı izinlerini kontrol edin.");
            });
        } catch (error) {
            alert("Ses dosyası bozuk veya desteklenmiyor.");
        }
    };

    const handlePasswordUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!passForm.current || !passForm.new || !passForm.confirm) {
            alert("Lütfen tüm alanları doldurunuz.");
            return;
        }

        if (passForm.new !== passForm.confirm) {
            alert("Yeni şifreler birbiriyle uyuşmuyor.");
            return;
        }

        if (passForm.new.length < 6) {
            alert("Yeni şifre en az 6 karakter olmalıdır.");
            return;
        }

        if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(passForm.new)) {
            alert("Şifre en az bir büyük harf, bir küçük harf ve bir rakam içermelidir.");
            return;
        }

        setPassLoading(true);

        try {
            // GÜVENLİK: Güvenli RPC ile bcrypt şifre güncelleme
            if (currentUser) {
                const { data, error } = await supabase.rpc('update_user_password', {
                    p_user_id: currentUser.id,
                    p_current_password: passForm.current,
                    p_new_password: passForm.new,
                });

                if (error) throw error;

                if (data === false) {
                    alert("Mevcut şifreniz hatalı. Lütfen tekrar deneyin.");
                    setPassLoading(false);
                    return;
                }

                alert("Şifreniz başarıyla güncellendi.");
                setPassForm({ current: '', new: '', confirm: '' });
            }
        } catch (err) {
            alert("Şifre güncellenirken bir hata oluştu.");
        } finally {
            setPassLoading(false);
        }
    };

    // UPDATE: Settings container now fills height and scrolls internally
    // Added pb-32 to prevent content being hidden behind mobile nav
    return (
        <div className="h-full w-full overflow-y-auto custom-scrollbar p-8 pb-32">
            <div className="max-w-4xl mx-auto">
                <h2 className="text-3xl font-bold text-white mb-8">{t('set.title')}</h2>
                
                <div className="grid gap-6">
                    
                    {/* AVATAR UPLOAD SETTINGS */}
                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                        <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                            <Upload size={20} className="text-pink-500"/>
                            Profil Fotoğrafı
                        </h3>
                        <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <div className="w-16 h-16 rounded-full overflow-hidden bg-zinc-800 border-2 border-zinc-700">
                                    {currentUser?.avatarUrl ? (
                                        <img src={currentUser.avatarUrl} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-zinc-500">?</div>
                                    )}
                                </div>
                                <div>
                                    <p className="text-zinc-200 text-sm font-medium mb-1">
                                        Profil Fotoğrafınızı Güncelleyin
                                    </p>
                                    <p className="text-xs text-zinc-500">
                                        Maksimum 2MB boyutunda bir resim seçin.
                                    </p>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-2 w-full md:w-auto">
                                <label className={`flex-1 md:flex-none cursor-pointer px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20 ${isUploadingAvatar ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                    {isUploadingAvatar ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                    <span>{isUploadingAvatar ? t('common.loading') : 'Fotoğraf Yükle'}</span>
                                    <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={isUploadingAvatar} />
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* LANGUAGE SETTINGS */}
                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                        <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                            <Globe size={20} className="text-blue-500"/>
                            {t('set.language')}
                        </h3>
                        <div className="bg-zinc-900 rounded-lg p-1.5 border border-zinc-800/50 inline-flex gap-1">
                            <button 
                                onClick={() => setLanguage('tr')}
                                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${language === 'tr' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                                🇹🇷 Türkçe
                            </button>
                            <button 
                                onClick={() => setLanguage('de')}
                                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${language === 'de' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                                🇩🇪 Deutsch
                            </button>
                        </div>
                    </div>

                    {/* NOTIFICATION SOUND SETTINGS */}
                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                        <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                            <Volume2 size={20} className="text-amber-500"/>
                            {t('set.sound')}
                        </h3>
                        <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                            <div>
                                <p className="text-zinc-200 text-sm font-medium mb-1">
                                    {hasCustomSound ? t('set.soundDesc') : t('set.soundDef')}
                                </p>
                                <p className="text-xs text-zinc-500">
                                    {hasCustomSound 
                                        ? t('set.soundInfo')
                                        : t('set.soundDefInfo')}
                                </p>
                            </div>
                            
                            <div className="flex items-center gap-2 w-full md:w-auto">
                                <button 
                                    onClick={handleTestSound}
                                    className="p-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors border border-zinc-700"
                                    title={t('set.test')}
                                >
                                    <Play size={16} />
                                </button>
                                
                                <label className={`flex-1 md:flex-none cursor-pointer px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20 ${soundLoading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                    {soundLoading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                    <span>{soundLoading ? t('common.loading') : t('set.upload')}</span>
                                    <input type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} disabled={soundLoading} />
                                </label>

                                {hasCustomSound && (
                                    <button 
                                        onClick={handleResetSound}
                                        className="p-2.5 bg-zinc-800 hover:bg-red-900/30 text-zinc-400 hover:text-red-400 border border-zinc-700 hover:border-red-900/50 rounded-lg transition-all"
                                        title={t('set.reset')}
                                    >
                                        <RefreshCw size={16} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* PASSWORD CHANGE SECTION */}
                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                        <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                            <KeyRound size={20} className="text-indigo-500"/>
                            {t('set.password')}
                        </h3>
                        <p className="text-sm text-zinc-400 mb-6">{t('set.passDesc')}</p>
                        
                        <form onSubmit={handlePasswordUpdate} className="space-y-4 max-w-lg">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-zinc-400">{t('set.currentPass')}</label>
                                <input 
                                    type="password" 
                                    value={passForm.current}
                                    onChange={(e) => setPassForm({...passForm, current: e.target.value})}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 outline-none transition-all placeholder:text-zinc-700"
                                    placeholder="••••••••"
                                />
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-zinc-400">{t('set.newPass')}</label>
                                    <input 
                                        type="password" 
                                        value={passForm.new}
                                        onChange={(e) => setPassForm({...passForm, new: e.target.value})}
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 outline-none transition-all placeholder:text-zinc-700"
                                        placeholder="En az 6 karakter"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-zinc-400">{t('set.confirmPass')}</label>
                                    <input 
                                        type="password" 
                                        value={passForm.confirm}
                                        onChange={(e) => setPassForm({...passForm, confirm: e.target.value})}
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 outline-none transition-all placeholder:text-zinc-700"
                                        placeholder="••••••••"
                                    />
                                </div>
                            </div>

                            <div className="pt-2">
                                <button 
                                    type="submit" 
                                    disabled={passLoading}
                                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition-colors shadow-lg shadow-indigo-900/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {passLoading ? <Loader2 size={16} className="animate-spin" /> : t('set.update')}
                                </button>
                            </div>
                        </form>
                    </div>

                    {/* ADMIN PASSWORD RESET SECTION */}
                    {currentUser?.role === Role.ADMIN && (
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                            <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                                <Shield size={20} className="text-red-500"/>
                                Personel Şifre Sıfırlama
                            </h3>
                            <p className="text-sm text-zinc-400 mb-6">
                                Personellerin şifrelerini unuttuklarında standart "Bac2026!" olarak sıfırlayabilirsiniz.
                            </p>
                            
                            <form onSubmit={handleAdminPasswordReset} className="space-y-4 max-w-lg">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-zinc-400">Personel Seçin</label>
                                    <select 
                                        value={selectedEmployeeId}
                                        onChange={(e) => setSelectedEmployeeId(e.target.value)}
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 outline-none transition-all"
                                    >
                                        <option value="">-- Personel Seçin --</option>
                                        {employees.map(emp => (
                                            <option key={emp.id} value={emp.id}>{emp.name} ({emp.branch})</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="pt-2">
                                    <button 
                                        type="submit" 
                                        disabled={resetLoading || !selectedEmployeeId}
                                        className="px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm font-medium transition-colors shadow-lg shadow-red-900/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {resetLoading ? <Loader2 size={16} className="animate-spin" /> : "Şifreyi Sıfırla"}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                        <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                            <Shield size={20} className="text-emerald-500"/>
                            {t('set.security')}
                        </h3>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-3 bg-zinc-900 rounded-lg border border-zinc-800/50">
                                <span className="text-zinc-300 text-sm">RLS (Row Level Security)</span>
                                <span className="px-2 py-1 bg-emerald-900/20 text-emerald-400 text-xs rounded border border-emerald-900/30">Aktif</span>
                            </div>
                            <div className="flex items-center justify-between p-3 bg-zinc-900 rounded-lg border border-zinc-800/50">
                                <span className="text-zinc-300 text-sm">{t('set.dbEnc')}</span>
                                <span className="px-2 py-1 bg-emerald-900/20 text-emerald-400 text-xs rounded border border-emerald-900/30">AES-256</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

const AppContent: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  
  const [activeTab, setActiveTabState] = useState('dashboard');
  const { t } = useLanguage();
  
  // ADMIN MESAJLARINI DINLEME (Global)
  useEffect(() => {
    if (!currentUser) return;

    // GÜVENLİK: Realtime abonelik filtrelemesi - sadece ilgili mesajları dinle
    const channel = supabase.channel(`user-alerts-${currentUser.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${currentUser.id}` }, async (payload) => {
            try {
                const newMsg = payload.new;
                
                // Mesaj bana mı geldi veya Herkese mi?
                if (newMsg.receiver_id === currentUser.id || newMsg.receiver_id === 'ALL') {
                    // Gönderen ID'sinden rolünü kontrol et
                    const { data: senderProfile } = await supabase
                        .from('profiles')
                        .select('role, full_name')
                        .eq('id', newMsg.sender_id)
                        .single();
                    
                    // Eğer gönderen Admin ise, ALERT bildirimi oluştur
                    if (senderProfile && senderProfile.role === Role.ADMIN) {
                         addNotification({
                             id: `admin_msg_${newMsg.id}`,
                             type: 'ALERT',
                             title: t('dash.adminAlert'),
                             message: `${senderProfile.full_name}: ${newMsg.content.substring(0, 50)}${newMsg.content.length > 50 ? '...' : ''}`,
                             timestamp: new Date().toISOString(),
                             recipientId: currentUser.id
                         });
                    }
                }
            } catch (e) {
                console.error("Notification processing error:", e);
            }
        })
        .subscribe();

    return () => {
        supabase.removeChannel(channel);
    };
  }, [currentUser, t]);

  useEffect(() => {
      const handleHashChange = () => {
          const hash = window.location.hash.replace('#', '');
          if (hash) {
              setActiveTabState(hash);
          } else {
              setActiveTabState('dashboard');
              window.location.hash = 'dashboard';
          }
      };
      handleHashChange();
      window.addEventListener('hashchange', handleHashChange);
      return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const setActiveTab = (tab: string) => {
      window.location.hash = tab;
      setActiveTabState(tab);
  };
  
  const handleLogin = (user: Employee) => {
      setCurrentUser(user);
      setIsAuthenticated(true);
      // KESİN YÖNLENDİRME: Giriş yapınca dashboard'a at
      setActiveTabState('dashboard');
      window.location.hash = 'dashboard';
  };

  const handleLogout = () => {
      setIsAuthenticated(false);
      setCurrentUser(null);
      window.location.hash = '';
  };

  const addNotification = (notif: AppNotification) => {
      setNotifications(prev => [notif, ...prev]);
      try {
          const customSound = localStorage.getItem('custom_notification_sound');
          const src = customSound || NOTIFICATION_SOUND;
          if (src) {
              const audio = new Audio(src);
              audio.volume = 0.5;
              audio.play().catch(err => console.log('Audio playback blocked or failed:', err));
          }
      } catch (e) {
          console.error('Error handling notification sound:', e);
      }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard notifications={notifications} currentUser={currentUser || MOCK_EMPLOYEES[0]} onUpdateUser={setCurrentUser} />;
      case 'messages':
        return <Messages currentUser={currentUser || MOCK_EMPLOYEES[0]} />;
      case 'tasks':
        return <Tasks currentUser={currentUser || MOCK_EMPLOYEES[0]} />;
      case 'calendar':
        return <Calendar currentUser={currentUser || MOCK_EMPLOYEES[0]} />;
      case 'shifts':
        // MODIFIED: Pass currentUser to ShiftSchedule
        return <ShiftSchedule currentUser={currentUser || MOCK_EMPLOYEES[0]} />;
      case 'payroll':
        return <Payroll currentUser={currentUser || MOCK_EMPLOYEES[0]} onNotify={addNotification} />;
      // NEW ROUTE
      case 'sales':
        return <SalesDashboard currentUser={currentUser || MOCK_EMPLOYEES[0]} />;
      case 'settings':
        return <Settings currentUser={currentUser} onUpdateUser={setCurrentUser} />;
      default:
        return <Dashboard notifications={notifications} currentUser={currentUser || MOCK_EMPLOYEES[0]} onUpdateUser={setCurrentUser} />;
    }
  };

  if (!isAuthenticated) {
      return <Login onLogin={handleLogin} />;
  }

  return (
    <Layout 
      activeTab={activeTab} 
      setActiveTab={setActiveTab} 
      userRole={currentUser?.role === Role.ADMIN ? "Yönetici (Admin)" : "Personel"}
      userName={currentUser?.name || 'Kullanıcı'}
      userAvatar={currentUser?.avatarUrl}
      onLogout={handleLogout}
    >
      {renderContent()}
    </Layout>
  );
};

// Main App Wrapper for Provider
const App: React.FC = () => {
    return (
        <LanguageProvider>
            <AppContent />
        </LanguageProvider>
    );
};

export default App;