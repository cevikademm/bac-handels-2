// =============================================================
// UpdateStatusCard — "Kim son sürümü aldı / almadı?"
// =============================================================
// Yalnızca süper admin (cevikademm) Ayarlar'da görür. Tüm kullanıcı
// profillerini app_update_status satırlarıyla eşleştirir; her cihazın
// çalıştığı build sürümünü / uyguladığı zorunlu güncelleme nonce'unu
// güncel değerlerle karşılaştırıp "Aldı / Bekliyor" rozetiyle listeler.
//
// "Aldı" tanımı:
//  - Aktif bir zorunlu güncelleme varsa  → acked_nonce === güncel nonce
//  - Yoksa (sadece deploy)               → app_version === en son sürüm
// =============================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Loader2, CheckCircle2, Clock, HelpCircle } from 'lucide-react';
import { useLanguage } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import { Employee } from '../types';
import {
  fetchUpdateStatuses,
  fetchForceUpdateSignal,
  fetchLatestPublishedVersion,
  type UpdateStatusRow,
} from '../lib/forceUpdate';

interface Props {
  currentUser: Employee | null;
}

interface MergedRow {
  userId: string;
  name: string;
  role?: string | null;
  avatarUrl?: string | null;
  appVersion: string | null;
  lastSeenAt: string | null;
  took: boolean | null; // null = belirsiz (karşılaştırma yapılamadı)
  seen: boolean;        // hiç rapor verdi mi
}

// Son 10 dk içinde görülen cihaz "çevrimiçi" sayılır.
const ONLINE_WINDOW_MS = 10 * 60 * 1000;

const UpdateStatusCard: React.FC<Props> = ({ currentUser }) => {
  const { t, formatDate } = useLanguage();
  const [rows, setRows] = useState<MergedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const isMounted = useRef(true);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: profiles }, statuses, signal, latestVersion] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role, avatar_url'),
        fetchUpdateStatuses(),
        fetchForceUpdateSignal(),
        fetchLatestPublishedVersion(),
      ]);
      if (!isMounted.current) return;

      const currentNonce = signal?.nonce || null;
      const statusByUser = new Map<string, UpdateStatusRow>();
      statuses.forEach((s) => statusByUser.set(s.user_id, s));

      const merged: MergedRow[] = (profiles || []).map((p: any) => {
        const st = statusByUser.get(p.id);
        let took: boolean | null = null;
        if (st) {
          if (currentNonce) took = st.acked_nonce === currentNonce;
          else if (latestVersion) took = st.app_version === latestVersion;
          else took = null;
        } else {
          took = false; // hiç rapor yoksa "almadı" say
        }
        return {
          userId: p.id,
          name: p.full_name || '—',
          role: p.role,
          avatarUrl: p.avatar_url,
          appVersion: st?.app_version || null,
          lastSeenAt: st?.last_seen_at || null,
          took,
          seen: !!st,
        };
      });

      // Sıralama: bekleyenler (almadı) önce, sonra belirsiz, sonra alanlar;
      // her grup içinde son görülme yenisi üstte.
      const rank = (r: MergedRow) => (r.took === false ? 0 : r.took === null ? 1 : 2);
      merged.sort((a, b) => {
        const rk = rank(a) - rank(b);
        if (rk !== 0) return rk;
        const ta = a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0;
        const tb = b.lastSeenAt ? Date.parse(b.lastSeenAt) : 0;
        return tb - ta;
      });

      setRows(merged);
    } catch {
      /* sessiz degrade */
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    isMounted.current = true;
    void load();
    // Realtime: cihazlar durum bildirdikçe liste canlı güncellensin.
    const channel = supabase
      .channel('app-update-status-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_update_status' }, () => {
        void load();
      })
      .subscribe();
    return () => {
      isMounted.current = false;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    let took = 0, pending = 0, online = 0;
    const nowOnline = (r: MergedRow) =>
      r.lastSeenAt && Date.now() - Date.parse(r.lastSeenAt) < ONLINE_WINDOW_MS;
    rows.forEach((r) => {
      if (r.took === true) took++;
      else pending++;
      if (nowOnline(r)) online++;
    });
    return { took, pending, online };
  }, [rows]);

  const isOnline = (r: MergedRow) =>
    !!r.lastSeenAt && Date.now() - Date.parse(r.lastSeenAt) < ONLINE_WINDOW_MS;

  return (
    <div className="bg-white dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-xl p-6">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="text-lg font-medium text-slate-900 dark:text-white flex items-center gap-2">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'linear-gradient(135deg,#0ea5e9,#6366f1)' }}>
            <RefreshCw size={18} className="text-white" />
          </span>
          {t('updateStatus.cardTitle')}
        </h3>
        <button
          onClick={() => load()}
          disabled={loading}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 border border-slate-200 dark:border-zinc-700 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {t('updateStatus.refresh')}
        </button>
      </div>
      <p className="text-sm text-slate-600 dark:text-zinc-400 mb-4">{t('updateStatus.cardDesc')}</p>

      {/* Özet rozetleri */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-center">
          <div className="text-xl font-black text-emerald-500">{counts.took}</div>
          <div className="text-[11px] font-semibold text-emerald-600/80 dark:text-emerald-400/80">{t('updateStatus.took')}</div>
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-center">
          <div className="text-xl font-black text-amber-500">{counts.pending}</div>
          <div className="text-[11px] font-semibold text-amber-600/80 dark:text-amber-400/80">{t('updateStatus.pending')}</div>
        </div>
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-center">
          <div className="text-xl font-black text-sky-500">{counts.online}</div>
          <div className="text-[11px] font-semibold text-sky-600/80 dark:text-sky-400/80">{t('updateStatus.online')}</div>
        </div>
      </div>

      {/* Liste */}
      {loading && rows.length === 0 ? (
        <div className="py-10 flex items-center justify-center text-slate-500 dark:text-zinc-500">
          <Loader2 size={20} className="animate-spin mr-2" /> {t('common.loading')}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500 dark:text-zinc-500 italic">{t('updateStatus.empty')}</p>
      ) : (
        <div className="space-y-1.5 max-h-[28rem] overflow-y-auto custom-scrollbar pr-1">
          {rows.map((r) => (
            <div
              key={r.userId}
              className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 dark:border-zinc-800/60 bg-slate-50 dark:bg-zinc-900/40"
            >
              {/* Avatar + online noktası */}
              <div className="relative shrink-0">
                {r.avatarUrl ? (
                  <img src={r.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-zinc-700 flex items-center justify-center text-xs font-bold text-slate-600 dark:text-zinc-300">
                    {r.name.charAt(0).toUpperCase()}
                  </div>
                )}
                {isOnline(r) && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-900" title={t('updateStatus.online')} />
                )}
              </div>

              {/* İsim + son görülme */}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{r.name}</div>
                <div className="text-[11px] text-slate-500 dark:text-zinc-500 truncate">
                  {r.lastSeenAt
                    ? `${t('updateStatus.lastSeen')}: ${formatDate(r.lastSeenAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                    : t('updateStatus.neverSeen')}
                  {r.appVersion ? ` • v:${r.appVersion}` : ''}
                </div>
              </div>

              {/* Durum rozeti */}
              {r.took === true ? (
                <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                  <CheckCircle2 size={12} /> {t('updateStatus.took')}
                </span>
              ) : r.took === false ? (
                <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30">
                  <Clock size={12} /> {t('updateStatus.pending')}
                </span>
              ) : (
                <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-500/15 text-slate-500 border border-slate-500/30">
                  <HelpCircle size={12} /> {t('updateStatus.unknown')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UpdateStatusCard;
