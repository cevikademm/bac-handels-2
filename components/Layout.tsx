import React from 'react';
import { 
  LayoutDashboard, 
  MessageSquare, 
  Calendar as CalendarIcon, 
  CheckSquare, 
  Users, 
  Settings as SettingsIcon,
  LogOut,
  User,
  Table,
  ShoppingBag
} from 'lucide-react';
import { useLanguage } from '../lib/i18n';
import { Role } from '../types';
import { GlowingEffect } from './ui/glowing-effect';


interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userRole: string;
  userName: string;
  userAvatar?: string;
  onLogout: () => void;
}

const BAC_LOGO_URL = "https://xbbzwitvlrdwnoushgpf.supabase.co/storage/v1/object/public/Bac_Logo/bac.jpeg";

// Desktop Sidebar Item
const SidebarItem = ({ icon: Icon, label, id, active, onClick }: any) => (
  <button
    onClick={() => onClick(id)}
    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group ${
      active 
        ? 'bg-primary-600/20 text-primary-500 border border-primary-600/30' 
        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
    }`}
  >
    <Icon size={20} className={active ? 'text-primary-500' : 'text-zinc-500 group-hover:text-zinc-300'} />
    <span className="font-medium text-sm">{label}</span>
  </button>
);

// Mobile Bottom Nav Item
const MobileNavItem = ({ icon: Icon, label, id, active, onClick }: any) => (
  <button
    onClick={() => onClick(id)}
    className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-all active:scale-90 ${
      active ? 'text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'
    }`}
  >
    <Icon size={18} strokeWidth={active ? 2.5 : 2} />
    <span className={`text-[9px] font-bold tracking-tight truncate max-w-full px-0.5 ${active ? 'text-indigo-400' : 'text-zinc-600'}`}>
      {label}
    </span>
  </button>
);

const Layout: React.FC<LayoutProps> = ({ children, activeTab, setActiveTab, userRole, userName, userAvatar, onLogout }) => {
  const { t, language, setLanguage } = useLanguage();
  
  const isAdmin = userRole.includes('Admin');

  return (
    <div className="relative h-[100dvh] w-full bg-zinc-950 text-zinc-200 font-sans overflow-hidden flex flex-col md:flex-row">
      
      {/* --- MOBILE HEADER (Visible only on mobile) --- */}
      <header className="md:hidden h-[calc(4rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] bg-zinc-950 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0 z-30 relative shadow-sm">
          <div 
            className="flex items-center gap-3"
            onClick={() => setActiveTab('dashboard')}
          >
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-lg shadow-red-900/10">
                 <img src={BAC_LOGO_URL} alt="BAC Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                BAC Handels
              </h1>
          </div>
          
          <div className="flex items-center gap-2">
              <button 
                onClick={() => setLanguage(language === 'tr' ? 'de' : 'tr')}
                className="flex items-center justify-center h-9 px-2 bg-zinc-900/50 border border-zinc-800 rounded-lg text-xs font-bold text-zinc-400 hover:text-white transition-colors"
              >
                  {language === 'tr' ? '🇹🇷' : '🇩🇪'}
              </button>
              <button 
                onClick={() => setActiveTab('settings')}
                className={`p-2 rounded-full transition-colors ${activeTab === 'settings' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}
              >
                  <SettingsIcon size={20} />
              </button>
              <button 
                onClick={onLogout}
                className="p-2 text-zinc-400 hover:text-red-400 transition-colors"
              >
                  <LogOut size={20} />
              </button>
          </div>
      </header>

      {/* --- DESKTOP SIDEBAR (Hidden on mobile) --- */}
      <div className="hidden md:flex z-40 h-full w-64 bg-zinc-950 border-r border-zinc-800 flex-col transition-all duration-300">
        <div 
            className="p-6 border-b border-zinc-900/50 cursor-pointer group flex items-center gap-3"
            onClick={() => setActiveTab('dashboard')}
            title="Ana Sayfaya Dön"
        >
          <div className="w-12 h-12 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-lg shadow-red-900/20 group-hover:scale-105 transition-transform">
             <img src={BAC_LOGO_URL} alt="BAC Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-600 bg-clip-text text-transparent group-hover:opacity-80 transition-opacity">
                BAC Handels
            </h1>
            <p className="text-[10px] text-zinc-500 mt-0.5">Kurumsal Yönetim</p>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto custom-scrollbar">
          <SidebarItem icon={LayoutDashboard} label={t('nav.dashboard')} id="dashboard" active={activeTab === 'dashboard'} onClick={setActiveTab} />
          <SidebarItem icon={MessageSquare} label={t('nav.messages')} id="messages" active={activeTab === 'messages'} onClick={setActiveTab} />
          <SidebarItem icon={CalendarIcon} label={t('nav.calendar')} id="calendar" active={activeTab === 'calendar'} onClick={setActiveTab} />
          <SidebarItem icon={Table} label={t('nav.shifts')} id="shifts" active={activeTab === 'shifts'} onClick={setActiveTab} />
          <SidebarItem icon={CheckSquare} label={t('nav.tasks')} id="tasks" active={activeTab === 'tasks'} onClick={setActiveTab} />
          <SidebarItem icon={ShoppingBag} label={t('nav.sales')} id="sales" active={activeTab === 'sales'} onClick={setActiveTab} />
          <SidebarItem icon={Users} label={t('nav.payroll')} id="payroll" active={activeTab === 'payroll'} onClick={setActiveTab} />
          <div className="pt-4 mt-4 border-t border-zinc-900">
             <SidebarItem icon={SettingsIcon} label={t('nav.settings')} id="settings" active={activeTab === 'settings'} onClick={setActiveTab} />
          </div>
        </nav>

        <div className="mt-auto">
            <div className="px-4 pb-4">
                <div className="flex bg-zinc-900 rounded-lg p-1 border border-zinc-800">
                    <button
                        onClick={() => setLanguage('tr')}
                        className={`flex-1 py-1.5 text-xs font-bold rounded transition-all ${language === 'tr' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        🇹🇷 TR
                    </button>
                    <button
                        onClick={() => setLanguage('de')}
                        className={`flex-1 py-1.5 text-xs font-bold rounded transition-all ${language === 'de' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        🇩🇪 DE
                    </button>
                </div>
            </div>

            <div className="p-4 border-t border-zinc-900/50 bg-zinc-900/20">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-900/50 border border-indigo-500/30 flex items-center justify-center text-indigo-400 overflow-hidden">
                {userAvatar ? (
                    <img src={userAvatar} className="w-full h-full object-cover" alt="User" referrerPolicy="no-referrer" />
                ) : (
                    <User size={20} />
                )}
                </div>
                <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium text-white truncate" title={userName}>{userName}</p>
                <p className="text-xs text-zinc-500 uppercase">{userRole}</p>
                </div>
                <button onClick={onLogout} className="text-zinc-500 hover:text-red-400 transition-colors" title={t('nav.logout')}>
                <LogOut size={18} />
                </button>
            </div>
            </div>
        </div>
      </div>

      {/* --- MAIN CONTENT AREA --- */}
      <main 
        className="flex-1 relative overflow-hidden min-h-0 flex flex-col md:pb-0"
      >
         <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
             <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] bg-indigo-900/10 rounded-full blur-3xl"></div>
             <div className="absolute bottom-[-10%] left-[-10%] w-[600px] h-[600px] bg-blue-900/5 rounded-full blur-3xl"></div>
         </div>
         
         <div className="relative h-full flex flex-col">
            {children}
         </div>
      </main>

      {/* --- MOBILE BOTTOM NAVIGATION --- */}
      <div 
        className="md:hidden absolute bottom-0 left-0 right-0 z-50 px-4 pointer-events-none"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 5px)' }}
      >
        <nav className="w-full h-16 bg-zinc-900/90 backdrop-blur-xl border border-zinc-800/60 rounded-2xl flex justify-around items-center px-2 ml-0 -mb-6 shadow-[0_8px_30px_rgba(0,0,0,0.6)] pointer-events-auto">
            <MobileNavItem icon={LayoutDashboard} label={t('nav.dashboard')} id="dashboard" active={activeTab === 'dashboard'} onClick={setActiveTab} />
            <MobileNavItem icon={CalendarIcon} label={t('nav.calendar')} id="calendar" active={activeTab === 'calendar'} onClick={setActiveTab} />
            <MobileNavItem icon={ShoppingBag} label="Satış" id="sales" active={activeTab === 'sales'} onClick={setActiveTab} />
            <MobileNavItem icon={Table} label="Vardiya" id="shifts" active={activeTab === 'shifts'} onClick={setActiveTab} />
            <MobileNavItem icon={CheckSquare} label="Görev" id="tasks" active={activeTab === 'tasks'} onClick={setActiveTab} />
            <MobileNavItem icon={Users} label="Personel" id="payroll" active={activeTab === 'payroll'} onClick={setActiveTab} />
        </nav>
      </div>

    </div>
  );
};

export default Layout;