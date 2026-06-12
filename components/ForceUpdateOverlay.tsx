// =============================================================
// ForceUpdateOverlay — Süper admin tetiklemeli zorunlu güncelleme
// =============================================================
// app_config.force_update nonce'unu polling + realtime ile dinler.
// Sunucudaki nonce, bu cihazın yerel "ack" değerinden farklıysa tam
// ekran engelleyici şık bir kart gösterir. Kullanıcı "Şimdi Güncelle"
// der demez (veya geri sayım biter bitmez) cache + SW temizlenir ve
// taze bir hard-reload yapılır.
//
// Tüm oturum açmış kullanıcılarda (admin + personel) çalışır.
// Tablo/satır yoksa sessizce hiçbir şey göstermez.
// =============================================================

import React, { useEffect, useRef, useState } from 'react';
import { Rocket, DownloadCloud, Loader2, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import {
  fetchForceUpdateSignal,
  getAckedNonce,
  applyForceUpdate,
  type ForceUpdateSignal,
} from '../lib/forceUpdate';

// Kart göründükten kaç saniye sonra otomatik güncelleme tetiklensin
const AUTO_REFRESH_SECONDS = 8;
const POLL_INTERVAL_MS = 45_000;

const ForceUpdateOverlay: React.FC = () => {
  const { t } = useLanguage();
  const [signal, setSignal] = useState<ForceUpdateSignal | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [countdown, setCountdown] = useState<number>(AUTO_REFRESH_SECONDS);
  const triggeredRef = useRef(false);
  const isMounted = useRef(true);

  // Sunucu nonce'u ack'ten farklıysa kartı göster.
  const evaluate = async () => {
    const next = await fetchForceUpdateSignal();
    if (!isMounted.current) return;
    if (next && next.nonce !== getAckedNonce()) {
      setSignal((prev) => (prev?.nonce === next.nonce ? prev : next));
    }
  };

  useEffect(() => {
    isMounted.current = true;
    void evaluate();

    // Realtime: nonce değişikliği anında yansısın.
    const channel = supabase
      .channel('app-config-force-update')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_config', filter: 'key=eq.force_update' },
        () => { void evaluate(); }
      )
      .subscribe();

    // Realtime düşerse savunma katmanı: periyodik polling + odak/online.
    const intervalId = window.setInterval(() => { void evaluate(); }, POLL_INTERVAL_MS);
    const onFocus = () => { void evaluate(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void evaluate(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      isMounted.current = false;
      supabase.removeChannel(channel);
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const handleUpdate = async () => {
    if (triggeredRef.current || !signal) return;
    triggeredRef.current = true;
    setRefreshing(true);
    await applyForceUpdate(signal.nonce);
  };

  // Geri sayım → 0 olunca otomatik tetikle.
  useEffect(() => {
    if (!signal) return;
    if (countdown <= 0) {
      void handleUpdate();
      return;
    }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown, signal]);

  if (!signal) return null;

  const progressPct = Math.max(0, Math.min(100, (countdown / AUTO_REFRESH_SECONDS) * 100));

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 text-center animate-[fadeIn_0.2s_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="force-update-title"
      style={{
        background:
          'radial-gradient(1200px 600px at 50% -10%, rgba(79,70,229,0.25), transparent 60%), rgba(9,9,11,0.92)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
      }}
    >
      {/* Gradient kenarlı kart */}
      <div className="relative w-full max-w-md">
        {/* Dış parıltı halkası */}
        <div
          className="absolute -inset-[1px] rounded-[26px] opacity-80 blur-[2px]"
          style={{
            background:
              'linear-gradient(140deg, #6366f1 0%, #8b5cf6 35%, #ec4899 70%, #f59e0b 100%)',
          }}
          aria-hidden="true"
        />
        <div className="relative rounded-[25px] bg-zinc-950/95 border border-white/10 p-7 sm:p-8 shadow-2xl overflow-hidden">
          {/* Üstte hareketli ışık şeridi */}
          <div
            className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full opacity-40 blur-3xl"
            style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)' }}
            aria-hidden="true"
          />

          {/* İkon rozeti */}
          <div className="relative mx-auto mb-5 w-20 h-20">
            <div
              className="absolute inset-0 rounded-2xl opacity-70 blur-md"
              style={{ background: 'linear-gradient(135deg,#6366f1,#ec4899)' }}
              aria-hidden="true"
            />
            <div className="relative w-20 h-20 rounded-2xl bg-zinc-900 border border-white/10 flex items-center justify-center">
              <span className="animate-bounce">
                <Rocket size={36} className="text-indigo-300" />
              </span>
            </div>
          </div>

          <h1
            id="force-update-title"
            className="text-2xl font-black text-white mb-2 tracking-tight"
          >
            {t('forceUpdate.title')}
          </h1>
          <p className="text-zinc-300 text-sm leading-relaxed mb-1">
            {t('forceUpdate.desc')}
          </p>
          <p className="text-zinc-500 text-xs mb-5">
            {t('forceUpdate.subDesc')}
          </p>

          {/* Güvenlik mührü */}
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-emerald-400/90 mb-5">
            <ShieldCheck size={14} />
            <span>{t('forceUpdate.safeNote')}</span>
          </div>

          {/* Geri sayım barı */}
          {!refreshing && countdown > 0 && (
            <div className="mb-5">
              <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-1000 ease-linear"
                  style={{
                    width: `${progressPct}%`,
                    background: 'linear-gradient(90deg,#6366f1,#ec4899)',
                  }}
                />
              </div>
              <p className="text-indigo-300/80 text-[11px] mt-2 font-mono">
                {t('forceUpdate.countdown').replace('{s}', String(countdown))}
              </p>
            </div>
          )}

          <button
            onClick={handleUpdate}
            disabled={refreshing}
            className="group relative w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl font-bold text-white shadow-lg shadow-indigo-900/40 disabled:opacity-70 disabled:cursor-not-allowed transition-transform active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed 55%,#db2777)' }}
          >
            {refreshing ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                {t('forceUpdate.updating')}
              </>
            ) : (
              <>
                <DownloadCloud size={18} />
                {t('forceUpdate.cta')}
              </>
            )}
          </button>

          {signal.triggeredBy && (
            <p className="text-zinc-600 text-[10px] mt-4">
              {t('forceUpdate.triggeredBy').replace('{name}', signal.triggeredBy)}
            </p>
          )}
        </div>
      </div>

      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  );
};

export default ForceUpdateOverlay;
