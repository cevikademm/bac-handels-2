import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  QrCode, Camera, MapPin, CheckCircle, AlertTriangle, XCircle, Loader2, LogIn, LogOut
} from 'lucide-react';
import { BrowserQRCodeReader, IScannerControls } from '@zxing/browser';
import { Employee } from '../types';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../lib/i18n';

type Phase = 'idle' | 'requesting' | 'scanning' | 'posting' | 'result' | 'error';

type RpcResponse = {
  ok: boolean;
  error?: 'invalid_qr';
  action?: 'in' | 'out';
  status?: 'Onaylandı' | 'Bekliyor';
  branch?: string;
  start_time?: string;
  end_time?: string;
  total_hours?: number;
  in_range?: boolean;
  log_id?: string;
};

type ErrorKind = 'camera' | 'network' | 'invalid_qr';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  currentUser: Employee;
}

const QrCheckIn: React.FC<Props> = ({ currentUser }) => {
  const { t } = useLanguage();
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [result, setResult] = useState<RpcResponse | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const decodedRef = useRef<boolean>(false);

  // Cleanup camera on unmount / phase change
  useEffect(() => {
    return () => {
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'scanning') {
      controlsRef.current?.stop();
      controlsRef.current = null;
    }
  }, [phase]);

  const getLocation = (): Promise<GeolocationPosition | null> =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    });

  const handleStart = async () => {
    setErrorKind(null);
    setResult(null);
    decodedRef.current = false;
    setPhase('requesting');

    // Kick off geolocation in parallel; don't block camera on it
    const locPromise = getLocation();

    // Camera + scanner
    try {
      const reader = new BrowserQRCodeReader(undefined, {
        delayBetweenScanAttempts: 150,
      });
      if (!videoRef.current) {
        // Switch to scanning phase first so <video> mounts, then start
        setPhase('scanning');
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      } else {
        setPhase('scanning');
      }
      // Wait a tick for ref
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (!videoRef.current) throw new Error('no_video');

      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (res, err, ctrls) => {
          if (res && !decodedRef.current) {
            const text = res.getText().trim();
            if (!UUID_RE.test(text)) return; // ignore non-UUID QRs, keep scanning
            decodedRef.current = true;
            ctrls.stop();
            controlsRef.current = null;
            submit(text, locPromise);
          }
        }
      );
      controlsRef.current = controls;
    } catch (e) {
      setErrorKind('camera');
      setPhase('error');
    }
  };

  const submit = async (token: string, locPromise: Promise<GeolocationPosition | null>) => {
    setPhase('posting');
    const pos = await locPromise;
    const lat = pos?.coords.latitude ?? null;
    const lng = pos?.coords.longitude ?? null;

    try {
      const { data, error } = await supabase.rpc('qr_check_in_out', {
        p_employee_id: currentUser.id,
        p_qr_token: token,
        p_lat: lat,
        p_lng: lng,
      });
      if (error) throw error;

      const resp = data as RpcResponse;
      if (!resp?.ok) {
        setErrorKind('invalid_qr');
        setPhase('error');
        return;
      }
      setResult(resp);
      setPhase('result');
    } catch (err) {
      console.warn('qr_check_in_out RPC error:', err);
      setErrorKind('network');
      setPhase('error');
    }
  };

  const reset = () => {
    setPhase('idle');
    setResult(null);
    setErrorKind(null);
    decodedRef.current = false;
  };

  // ----- Renders -----

  const Header = (
    <div className="mb-6">
      <h2 className="text-2xl font-bold text-white flex items-center gap-2">
        <QrCode size={24} /> {t('qr.title')}
      </h2>
      <p className="text-sm text-zinc-400 mt-1">{t('qr.subtitle')}</p>
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      {Header}

      <AnimatePresence mode="wait">
        {phase === 'idle' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8 text-center"
          >
            <div className="mx-auto w-20 h-20 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6">
              <QrCode size={40} className="text-emerald-400" />
            </div>
            <button
              onClick={handleStart}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
            >
              <Camera size={18} />
              {t('qr.scanBtn')}
            </button>
            <p className="text-xs text-zinc-500 mt-4 flex items-center justify-center gap-1">
              <MapPin size={12} /> {t('qr.gettingLocation')}
            </p>
          </motion.div>
        )}

        {(phase === 'requesting' || phase === 'scanning') && (
          <motion.div
            key="scanning"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl border border-zinc-800 bg-black overflow-hidden relative aspect-square"
          >
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              muted
              playsInline
            />
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 1.6, repeat: Infinity }}
                className="w-64 h-64 border-2 border-emerald-400/80 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
              />
            </div>
            <div className="absolute bottom-4 left-0 right-0 text-center">
              <p className="text-white text-sm bg-black/60 inline-block px-4 py-2 rounded-full">
                {phase === 'requesting' ? t('qr.requestingPerms') : t('qr.scanning')}
              </p>
            </div>
            <button
              onClick={reset}
              className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center"
              aria-label={t('qr.close')}
            >
              <XCircle size={20} />
            </button>
          </motion.div>
        )}

        {phase === 'posting' && (
          <motion.div
            key="posting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-2xl border border-zinc-800 bg-zinc-950 p-10 text-center"
          >
            <Loader2 className="animate-spin mx-auto text-emerald-400 mb-3" size={32} />
            <p className="text-zinc-300">{t('qr.gettingLocation')}</p>
          </motion.div>
        )}

        {phase === 'result' && result && (
          <ResultCard result={result} onClose={reset} t={t} />
        )}

        {phase === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-red-900/60 bg-red-950/40 p-8 text-center"
          >
            <XCircle size={40} className="text-red-400 mx-auto mb-3" />
            <p className="text-red-200 mb-4">
              {errorKind === 'camera' && t('qr.cameraDenied')}
              {errorKind === 'network' && t('qr.networkError')}
              {errorKind === 'invalid_qr' && t('qr.invalidQr')}
            </p>
            <button
              onClick={reset}
              className="px-5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white"
            >
              {t('qr.tryAgain')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const ResultCard: React.FC<{ result: RpcResponse; onClose: () => void; t: (k: string) => string }> = ({ result, onClose, t }) => {
  const isCheckin = result.action === 'in';
  const isApproved = result.status === 'Onaylandı';
  const outOfRange = result.in_range === false;

  const toneClass = isApproved
    ? 'border-emerald-800/60 bg-emerald-950/30'
    : 'border-amber-800/60 bg-amber-950/30';
  const Icon = isApproved ? CheckCircle : AlertTriangle;
  const iconColor = isApproved ? 'text-emerald-400' : 'text-amber-400';

  return (
    <motion.div
      key="result"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className={`rounded-2xl border ${toneClass} p-8 text-center`}
    >
      <Icon className={`${iconColor} mx-auto mb-3`} size={48} />
      <h3 className="text-xl font-bold text-white mb-2 flex items-center justify-center gap-2">
        {isCheckin ? <LogIn size={20} /> : <LogOut size={20} />}
        {isCheckin ? t('qr.checkinSuccess') : t('qr.checkoutSuccess')}
      </h3>

      <div className="mt-4 space-y-1 text-sm text-zinc-200">
        <div><span className="text-zinc-400">{t('qr.branch')}:</span> <span className="font-semibold">{result.branch}</span></div>
        {result.start_time && (
          <div><span className="text-zinc-400">{t('qr.start')}:</span> <span className="font-mono">{result.start_time}</span></div>
        )}
        {result.end_time && (
          <div><span className="text-zinc-400">{t('qr.end')}:</span> <span className="font-mono">{result.end_time}</span></div>
        )}
        {typeof result.total_hours === 'number' && result.total_hours > 0 && (
          <div>
            <span className="text-zinc-400">{t('qr.totalHours')}:</span>{' '}
            <span className="font-semibold">{result.total_hours.toFixed(2)} {t('qr.hours')}</span>
          </div>
        )}
      </div>

      {outOfRange && (
        <div className="mt-4 p-3 rounded-lg bg-amber-900/30 border border-amber-800/50 text-amber-200 text-xs">
          {t('qr.outOfRange')}
        </div>
      )}

      <button
        onClick={onClose}
        className="mt-6 px-5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white"
      >
        {t('qr.close')}
      </button>
    </motion.div>
  );
};

export default QrCheckIn;
