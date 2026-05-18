import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../lib/i18n';
import { Employee, Role } from '../types';
import { canSeeDeviceInfo, formatTimeOfDay, formatHoursHumanTR } from '../lib/utils';
import {
  Clock, LogIn, LogOut, ShoppingBag, Shield, Smartphone,
  MapPin, AlertTriangle, Loader2, Filter, RefreshCw, KeyRound
} from 'lucide-react';

// time_logs · sales_logs · audit_logs'tan birleşik aktivite zaman çizgisi.
// Personel: yalnız kendi kayıtlarını görür (RLS: employee_id eşleşmesi).
// Admin: seçtiği personelin kayıtlarını görür.
// MAC adresleri: kendi logları her zaman gözükür; admin başka personelin
// MAC'ini sadece canSeeDeviceInfo() izinliyse görür.

interface LogActivityProps {
  currentUser: Employee;
  targetEmployeeId: string;
  targetEmployeeName?: string;
}

type LogKind = 'check_in' | 'check_out' | 'sale' | 'audit';
type LogFilter = 'ALL' | 'SHIFT' | 'SALES' | 'SECURITY';

interface UnifiedLog {
  id: string;
  kind: LogKind;
  // Sıralama anahtarı (ISO timestamp). Eski time_logs satırlarında check_in_at
  // yoksa date+start_time'dan üretilir.
  at: string;
  title: string;
  subtitle?: string;
  branch?: string;
  status?: string;
  deviceInfo?: string; // marka + MAC ("Apple iPhone · 2A:DB:…")
  meta?: Record<string, string>;
  // Konum bilgisi (check-in/out için)
  lat?: number;
  lng?: number;
}

// "Apple iPhone · 2A:DB:BA:59:A3:EF" → { brand: "Apple iPhone", mac: "2A:DB:…" }
function splitDeviceInfo(info: string): { brand: string; mac: string } {
  if (!info) return { brand: '', mac: '' };
  const parts = info.split('·').map(s => s.trim());
  if (parts.length >= 2) {
    const macLike = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
    if (macLike.test(parts[1])) return { brand: parts[0], mac: parts[1] };
  }
  return { brand: info, mac: '' };
}

// audit_logs.action → okunabilir başlık (TR).
function auditActionTitle(action: string): string {
  switch (action) {
    case 'LOGIN': return 'Giriş yapıldı';
    case 'LOGOUT': return 'Çıkış yapıldı';
    case 'LOGIN_FAILED': return 'Başarısız giriş denemesi';
    case 'PASSWORD_CHANGE': return 'Şifre değiştirildi';
    case 'ADMIN_PASSWORD_RESET': return 'Şifre admin tarafından sıfırlandı';
    case 'PHONE_UPDATED': return 'Telefon numarası güncellendi';
    case 'PROFILE_UPDATED': return 'Profil güncellendi';
    case 'DELETE': return 'Kayıt silindi';
    case 'UPDATE': return 'Kayıt güncellendi';
    default: return action;
  }
}

const LogActivity: React.FC<LogActivityProps> = ({ currentUser, targetEmployeeId, targetEmployeeName }) => {
  const { t, formatDate } = useLanguage();
  const [logs, setLogs] = useState<UnifiedLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<LogFilter>('ALL');
  const [reloadKey, setReloadKey] = useState(0);

  // MAC görünürlüğü: kendi loglarını görüyorsa daima; admin başkasını
  // görüyorsa canSeeDeviceInfo() izniyle.
  const isOwn = currentUser.id === targetEmployeeId;
  const canShowMac = isOwn || canSeeDeviceInfo(currentUser.email);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    const fetchAll = async () => {
      const results: UnifiedLog[] = [];

      // 1) time_logs (QR check-in/out + manuel mesai)
      const { data: timeRows } = await supabase
        .from('time_logs')
        .select('id, date, start_time, end_time, total_hours, branch, status, entry_method, check_in_at, check_out_at, device_info, check_in_lat, check_in_lng, check_out_lat, check_out_lng, created_at')
        .eq('employee_id', targetEmployeeId)
        .order('date', { ascending: false })
        .limit(200);

      (timeRows || []).forEach((r: any) => {
        const isQr = r.entry_method === 'qr';
        // Check-in event
        const checkInAt = r.check_in_at || `${r.date}T${(r.start_time || '00:00')}:00`;
        results.push({
          id: `${r.id}-in`,
          kind: 'check_in',
          at: checkInAt,
          title: isQr ? 'QR check-in' : 'Mesai başlangıcı (manuel)',
          subtitle: r.branch || undefined,
          branch: r.branch || undefined,
          status: r.status || undefined,
          deviceInfo: r.device_info || undefined,
          lat: r.check_in_lat,
          lng: r.check_in_lng,
          meta: {
            yontem: isQr ? 'QR' : 'Manuel',
            baslangic: r.start_time || '—',
          },
        });
        // Check-out event (sadece kapanmış mesailer)
        if (r.check_out_at || (r.end_time && r.end_time !== '00:00')) {
          const checkOutAt = r.check_out_at || `${r.date}T${r.end_time}:00`;
          results.push({
            id: `${r.id}-out`,
            kind: 'check_out',
            at: checkOutAt,
            title: isQr ? 'QR check-out' : 'Mesai bitişi (manuel)',
            subtitle: r.branch || undefined,
            branch: r.branch || undefined,
            status: r.status || undefined,
            // Çıkışta da aynı cihaz bilgisini göster — şüpheli durum yakalansın
            deviceInfo: r.device_info || undefined,
            lat: r.check_out_lat,
            lng: r.check_out_lng,
            meta: {
              yontem: isQr ? 'QR' : 'Manuel',
              bitis: r.end_time || '—',
              toplam: r.total_hours ? formatHoursHumanTR(r.total_hours) : '—',
            },
          });
        }
      });

      // 2) sales_logs (satış aktivitesi)
      const { data: salesRows } = await supabase
        .from('sales_logs')
        .select('id, branch, product_name, quantity, sale_date, status, is_off_shift, created_at')
        .eq('employee_id', targetEmployeeId)
        .order('created_at', { ascending: false })
        .limit(200);

      (salesRows || []).forEach((r: any) => {
        results.push({
          id: `sale-${r.id}`,
          kind: 'sale',
          at: r.created_at || r.sale_date,
          title: `Satış: ${r.product_name} × ${r.quantity}`,
          subtitle: r.branch || undefined,
          branch: r.branch || undefined,
          status: r.status || undefined,
          meta: r.is_off_shift ? { uyari: 'Mesai dışı giriş' } : undefined,
        });
      });

      // 3) audit_logs (giriş, şifre, vb.)
      const { data: auditRows } = await supabase
        .from('audit_logs')
        .select('id, action, target_table, target_id, details, created_at')
        .eq('user_id', targetEmployeeId)
        .order('created_at', { ascending: false })
        .limit(200);

      (auditRows || []).forEach((r: any) => {
        const sub = r.target_table ? `${r.target_table}${r.target_id ? ` · ${r.target_id.slice(0, 8)}` : ''}` : undefined;
        results.push({
          id: `audit-${r.id}`,
          kind: 'audit',
          at: r.created_at,
          title: auditActionTitle(r.action),
          subtitle: sub,
          meta: r.details && Object.keys(r.details || {}).length > 0 ? Object.fromEntries(
            Object.entries(r.details).slice(0, 3).map(([k, v]) => [k, String(v)])
          ) : undefined,
        });
      });

      // Tarihe göre azalan sırala
      results.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

      if (!cancelled) {
        setLogs(results);
        setIsLoading(false);
      }
    };

    fetchAll().catch(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => { cancelled = true; };
  }, [targetEmployeeId, reloadKey]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return logs;
    if (filter === 'SHIFT') return logs.filter(l => l.kind === 'check_in' || l.kind === 'check_out');
    if (filter === 'SALES') return logs.filter(l => l.kind === 'sale');
    if (filter === 'SECURITY') return logs.filter(l => l.kind === 'audit');
    return logs;
  }, [logs, filter]);

  // Aktivite başına ikon + renk
  const iconFor = (kind: LogKind) => {
    switch (kind) {
      case 'check_in': return { Icon: LogIn, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/30' };
      case 'check_out': return { Icon: LogOut, color: 'text-orange-500', bg: 'bg-orange-500/10 border-orange-500/30' };
      case 'sale': return { Icon: ShoppingBag, color: 'text-indigo-500', bg: 'bg-indigo-500/10 border-indigo-500/30' };
      case 'audit': return { Icon: Shield, color: 'text-cyan-500', bg: 'bg-cyan-500/10 border-cyan-500/30' };
    }
  };

  // İstatistik özet
  const summary = useMemo(() => {
    const last30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = logs.filter(l => new Date(l.at).getTime() >= last30);
    return {
      total: logs.length,
      checkIns: recent.filter(l => l.kind === 'check_in').length,
      sales: recent.filter(l => l.kind === 'sale').length,
      security: recent.filter(l => l.kind === 'audit').length,
    };
  }, [logs]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* HEADER */}
      <div className="px-4 py-4 md:px-6 md:py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Clock size={18} className="text-indigo-500" />
              {t('logs.title')}
            </h3>
            <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">
              {isOwn ? t('logs.subtitleOwn') : `${targetEmployeeName || '—'} · ${t('logs.subtitleAdmin')}`}
            </p>
          </div>
          <button
            onClick={() => setReloadKey(k => k + 1)}
            className="p-2 rounded-lg border border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors"
            title={t('logs.refresh')}
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* SUMMARY CARDS (son 30 gün) */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <div className="p-2 rounded-lg bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
            <div className="text-[10px] text-slate-500 dark:text-zinc-500 uppercase">{t('logs.statTotal')}</div>
            <div className="text-base font-bold text-slate-900 dark:text-white">{summary.total}</div>
          </div>
          <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40">
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase">{t('logs.statCheckin')}</div>
            <div className="text-base font-bold text-emerald-700 dark:text-emerald-300">{summary.checkIns}</div>
          </div>
          <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/40">
            <div className="text-[10px] text-indigo-600 dark:text-indigo-400 uppercase">{t('logs.statSales')}</div>
            <div className="text-base font-bold text-indigo-700 dark:text-indigo-300">{summary.sales}</div>
          </div>
          <div className="p-2 rounded-lg bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-900/40">
            <div className="text-[10px] text-cyan-600 dark:text-cyan-400 uppercase">{t('logs.statSecurity')}</div>
            <div className="text-base font-bold text-cyan-700 dark:text-cyan-300">{summary.security}</div>
          </div>
        </div>

        {/* FILTER TABS */}
        <div className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-1">
          {([
            ['ALL', t('logs.filterAll')],
            ['SHIFT', t('logs.filterShift')],
            ['SALES', t('logs.filterSales')],
            ['SECURITY', t('logs.filterSecurity')],
          ] as [LogFilter, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border whitespace-nowrap transition-all ${
                filter === key
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow'
                  : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border-slate-200 dark:border-zinc-800 hover:border-indigo-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* LIST */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 md:px-6 md:py-5 space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-slate-500 dark:text-zinc-500">
            <Loader2 size={20} className="animate-spin mr-2" />
            <span className="text-sm">{t('common.loading')}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-zinc-600">
            <Clock size={32} className="mb-2 opacity-50" />
            <span className="text-sm italic">{t('logs.empty')}</span>
          </div>
        ) : (
          filtered.map(log => {
            const { Icon, color, bg } = iconFor(log.kind);
            const device = log.deviceInfo ? splitDeviceInfo(log.deviceInfo) : null;
            const timeStr = formatTimeOfDay(log.at);
            return (
              <div
                key={log.id}
                className="flex items-start gap-3 p-3 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:border-slate-300 dark:hover:border-zinc-700 transition-colors"
              >
                <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center border ${bg}`}>
                  <Icon size={16} className={color} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">{log.title}</span>
                    <span className="text-[10px] font-mono text-slate-500 dark:text-zinc-500 shrink-0">
                      {formatDate(log.at)} {timeStr && <span className="ml-1">{timeStr}</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {log.branch && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <MapPin size={9} /> {log.branch}
                      </span>
                    )}
                    {log.status && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        log.status === 'Onaylandı' ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' :
                        log.status === 'Reddedildi' ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' :
                        'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20'
                      }`}>
                        {log.status}
                      </span>
                    )}
                    {device && canShowMac && device.mac && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700"
                        title={device.brand}
                      >
                        <Smartphone size={9} />
                        {device.brand ? `${device.brand} · ` : ''}{device.mac}
                      </span>
                    )}
                    {device && !canShowMac && device.brand && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700">
                        <Smartphone size={9} /> {device.brand}
                      </span>
                    )}
                    {log.meta && Object.entries(log.meta).map(([k, v]) => (
                      <span
                        key={k}
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                          k === 'uyari'
                            ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
                            : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 border-slate-200 dark:border-zinc-700'
                        }`}
                      >
                        {k === 'uyari' && <AlertTriangle size={9} className="mr-0.5" />}
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default LogActivity;
