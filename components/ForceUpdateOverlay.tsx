// =============================================================
// ForceUpdateOverlay — Süper admin tetiklemeli zorunlu güncelleme
// =============================================================
// app_config.force_update nonce'unu polling + realtime ile dinler.
// Sunucudaki nonce, bu cihazın yerel "ack" değerinden farklıysa tam
// ekran engelleyici KREATİF bir kart gösterir (motion animasyonlu).
// Kullanıcı "Şimdi Güncelle" der demez (veya geri sayım biter bitmez)
// cache + SW temizlenir ve taze bir hard-reload yapılır.
//
// Tüm oturum açmış kullanıcılarda (admin + personel) çalışır; süper
// admin de dahil (tetikleyen muaf DEĞİL). Tablo yoksa hiçbir şey göstermez.
// =============================================================

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Rocket, DownloadCloud, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { useLanguage } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import {
  fetchForceUpdateSignal,
  getAckedNonce,
  applyForceUpdate,
  type ForceUpdateSignal,
} from '../lib/forceUpdate';

const AUTO_REFRESH_SECONDS = 8;
const POLL_INTERVAL_MS = 45_000;

// Geri sayım halkası geometrisi
const RING_R = 54;
const RING_C = 2 * Math.PI * RING_R;

// Sabit konumlu yüzen parçacıklar (deterministik — render'da random yok)
const PARTICLES = [
  { left: '12%', top: '22%', size: 6, delay: 0 },
  { left: '82%', top: '18%', size: 8, delay: 0.6 },
  { left: '20%', top: '74%', size: 5, delay: 1.2 },
  { left: '74%', top: '70%', size: 7, delay: 0.3 },
  { left: '50%', top: '12%', size: 4, delay: 0.9 },
  { left: '88%', top: '48%', size: 5, delay: 1.5 },
  { left: '8%', top: '50%', size: 6, delay: 0.45 },
];

const ForceUpdateOverlay: React.FC = () => {
  const { t } = useLanguage();
  const [signal, setSignal] = useState<ForceUpdateSignal | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [countdown, setCountdown] = useState<number>(AUTO_REFRESH_SECONDS);
  const triggeredRef = useRef(false);
  const isMounted = useRef(true);

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

    const channel = supabase
      .channel('app-config-force-update')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_config', filter: 'key=eq.force_update' },
        () => { void evaluate(); }
      )
      .subscribe();

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

  useEffect(() => {
    if (!signal) return;
    if (countdown <= 0) {
      void handleUpdate();
      return;
    }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown, signal]);

  const progress = Math.max(0, Math.min(1, countdown / AUTO_REFRESH_SECONDS));
  const ringOffset = RING_C * (1 - progress);

  return (
    <AnimatePresence>
      {signal && (
        <motion.div
          key="force-update"
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4 overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="force-update-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ background: 'rgba(6,6,10,0.86)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
        >
          {/* ── Animasyonlu mesh-gradient orblar ── */}
          <motion.div
            className="pointer-events-none absolute -top-32 -left-24 w-[28rem] h-[28rem] rounded-full blur-[90px]"
            style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.55), transparent 70%)' }}
            animate={{ x: [0, 40, 0], y: [0, 30, 0], scale: [1, 1.15, 1] }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="pointer-events-none absolute -bottom-32 -right-24 w-[30rem] h-[30rem] rounded-full blur-[100px]"
            style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.5), transparent 70%)' }}
            animate={{ x: [0, -50, 0], y: [0, -20, 0], scale: [1, 1.2, 1] }}
            transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="pointer-events-none absolute top-1/3 right-1/4 w-72 h-72 rounded-full blur-[80px]"
            style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.35), transparent 70%)' }}
            animate={{ x: [0, 30, 0], y: [0, 40, 0] }}
            transition={{ duration: 13, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* ── Yüzen parçacıklar ── */}
          {PARTICLES.map((p, i) => (
            <motion.span
              key={i}
              className="pointer-events-none absolute rounded-full"
              style={{
                left: p.left,
                top: p.top,
                width: p.size,
                height: p.size,
                background: 'rgba(255,255,255,0.7)',
                boxShadow: '0 0 8px rgba(255,255,255,0.7)',
              }}
              animate={{ y: [0, -16, 0], opacity: [0.2, 0.9, 0.2] }}
              transition={{ duration: 3 + (i % 3), repeat: Infinity, ease: 'easeInOut', delay: p.delay }}
            />
          ))}

          {/* ── Kart ── */}
          <motion.div
            className="relative w-full max-w-md"
            initial={{ scale: 0.85, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 22 }}
          >
            {/* Dönen konik gradient kenar */}
            <motion.div
              className="absolute -inset-[1.5px] rounded-[28px]"
              style={{
                background:
                  'conic-gradient(from 0deg, #6366f1, #8b5cf6, #ec4899, #f59e0b, #6366f1)',
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
              aria-hidden="true"
            />
            <div className="relative rounded-[27px] bg-zinc-950/90 border border-white/10 px-7 py-8 sm:px-9 text-center overflow-hidden">
              {/* iç üst parıltı */}
              <div
                className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full blur-3xl opacity-50"
                style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)' }}
                aria-hidden="true"
              />

              {/* ── Geri sayım halkası + yüzen ikon ── */}
              <div className="relative mx-auto mb-6 w-[132px] h-[132px]">
                <svg className="absolute inset-0 -rotate-90" width="132" height="132" viewBox="0 0 132 132">
                  <circle cx="66" cy="66" r={RING_R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
                  <defs>
                    <linearGradient id="fu-ring" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#6366f1" />
                      <stop offset="50%" stopColor="#a855f7" />
                      <stop offset="100%" stopColor="#ec4899" />
                    </linearGradient>
                  </defs>
                  <circle
                    cx="66" cy="66" r={RING_R} fill="none"
                    stroke="url(#fu-ring)" strokeWidth="6" strokeLinecap="round"
                    strokeDasharray={RING_C}
                    strokeDashoffset={ringOffset}
                    style={{ transition: 'stroke-dashoffset 1s linear' }}
                  />
                </svg>
                {/* glow orb + ikon */}
                <motion.div
                  className="absolute inset-[18px] rounded-full flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(236,72,153,0.25))', border: '1px solid rgba(255,255,255,0.12)' }}
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Rocket size={42} className="text-white drop-shadow-[0_0_10px_rgba(99,102,241,0.8)]" />
                </motion.div>
                {/* countdown rakamı */}
                {!refreshing && (
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-zinc-900 border border-white/10 text-[11px] font-black text-indigo-300 font-mono">
                    {countdown}s
                  </div>
                )}
              </div>

              {/* yeni sürüm rozeti */}
              <div className="inline-flex items-center gap-1.5 mb-3 px-3 py-1 rounded-full bg-white/5 border border-white/10">
                <Sparkles size={12} className="text-amber-300" />
                <span className="text-[11px] font-bold tracking-wide text-amber-200/90 uppercase">{t('forceUpdate.badge')}</span>
              </div>

              <h1
                id="force-update-title"
                className="text-2xl font-black mb-2 tracking-tight bg-clip-text text-transparent"
                style={{ backgroundImage: 'linear-gradient(135deg,#fff,#c7d2fe 60%,#fbcfe8)' }}
              >
                {t('forceUpdate.title')}
              </h1>
              <p className="text-zinc-300 text-sm leading-relaxed mb-1">{t('forceUpdate.desc')}</p>
              <p className="text-zinc-500 text-xs mb-5">{t('forceUpdate.subDesc')}</p>

              <div className="flex items-center justify-center gap-1.5 text-[11px] text-emerald-400/90 mb-6">
                <ShieldCheck size={14} />
                <span>{t('forceUpdate.safeNote')}</span>
              </div>

              {/* CTA — parlama sweep'li */}
              <motion.button
                onClick={handleUpdate}
                disabled={refreshing}
                whileTap={{ scale: 0.97 }}
                className="group relative w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-bold text-white shadow-xl shadow-indigo-900/50 disabled:opacity-70 disabled:cursor-not-allowed overflow-hidden"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed 50%,#db2777)' }}
              >
                {/* shine */}
                <motion.span
                  className="pointer-events-none absolute inset-0"
                  style={{ background: 'linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.45) 50%, transparent 65%)' }}
                  initial={{ x: '-120%' }}
                  animate={{ x: refreshing ? '-120%' : '120%' }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.6 }}
                  aria-hidden="true"
                />
                {refreshing ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> {t('forceUpdate.updating')}
                  </>
                ) : (
                  <>
                    <DownloadCloud size={18} /> {t('forceUpdate.cta')}
                  </>
                )}
              </motion.button>

              {signal.triggeredBy && (
                <p className="text-zinc-600 text-[10px] mt-4">
                  {t('forceUpdate.triggeredBy').replace('{name}', signal.triggeredBy)}
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ForceUpdateOverlay;
