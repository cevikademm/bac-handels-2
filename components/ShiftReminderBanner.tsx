// =============================================================
// ShiftReminderBanner — personele mesai hatırlatma kartı
// =============================================================
// İki durum gösterir (ikisi aynı anda değil; açık vardiya önceliklidir):
//
//  (A) AÇIK VARDİYA — planlanan bitiş geçti, QR çıkışı hâlâ yok.
//      "Mesain hâlâ açık · Giriş 16:32 · planlanan bitiş 03:00.
//       Çıkarken QR ile çıkış yap." + [QR ile çıkış yap] [Sonra]
//      "Sonra" 30 dk erteler. QR sekmesindeyken gizlenir.
//
//  (B) OTOMATİK KAPATILDI — son 3 günde sistemin kapattığı, hâlâ
//      'Bekliyor' ve fazla mesai bildirilmemiş kendi kaydı.
//      [Fazla mesai bildir] → Bordro açılır ve bildirim penceresi
//      doğrudan o kayıt için gelir. Kapat → o kayıt için bir daha
//      gösterilmez. Bordro sekmesindeyken gizlenir.
//
// Sunucu tarafında send_checkout_reminders() aynı kuralla push da atar
// (personel bildirimlere izin verdiyse). Bu kart, push izni olmayan
// cihazlarda da uygulama açıldığı an hatırlatmayı garanti eder.
// =============================================================

import React, { useCallback, useEffect, useState } from 'react';
import { AlarmClock, AlarmClockOff, QrCode, X, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../lib/i18n';
import { Employee } from '../types';
import { fmtBerlinHm } from '../lib/berlinTime';
import { SHIFT_CHANGED_EVENT } from '../lib/geofence';
import { computeExpectedEnd, weekKeyForCheckIn, ShiftRowLite, OPEN_OVERTIME_KEY } from '../lib/checkoutReminder';

const SNOOZE_PREFIX = 'bac:checkout-reminder-snooze:';
const DISMISS_CLOSED_PREFIX = 'bac:auto-closed-dismissed:';
const SNOOZE_MS = 30 * 60 * 1000;
const REFRESH_MS = 3 * 60 * 1000;
const CLOSED_LOOKBACK_MS = 72 * 60 * 60 * 1000;
const OPEN_LOOKBACK_MS = 24 * 60 * 60 * 1000;

type Reminder =
  | { kind: 'open'; logId: string; checkInAt: string; endMs: number; fromPlan: boolean }
  | { kind: 'closed'; logId: string; checkInAt: string; endTime: string; date: string };

// t() metnindeki {yer tutucu}ları doldur (aynı yer tutucu birden çok kez geçebilir)
const fill = (tpl: string, vars: Record<string, string>): string =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), tpl);

const safeGet = (k: string): string | null => {
  try { return localStorage.getItem(k); } catch { return null; }
};
const safeSet = (k: string, v: string) => {
  try { localStorage.setItem(k, v); } catch { /* özel mod */ }
};

interface Props {
  currentUser: Employee | null;
  activeTab: string;
  onNavigate: (tab: string) => void;
}

const ShiftReminderBanner: React.FC<Props> = ({ currentUser, activeTab, onNavigate }) => {
  const { t } = useLanguage();
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [tick, setTick] = useState(0);

  const userId = currentUser?.id || null;

  const refresh = useCallback(async () => {
    if (!userId) { setReminder(null); return; }
    const now = Date.now();
    try {
      // (A) Açık vardiya
      const { data: openRows } = await supabase
        .from('time_logs')
        .select('id, check_in_at')
        .eq('employee_id', userId)
        .is('check_out_at', null)
        .not('check_in_at', 'is', null)
        .gte('check_in_at', new Date(now - OPEN_LOOKBACK_MS).toISOString())
        .order('check_in_at', { ascending: false })
        .limit(1);

      const open = (openRows || [])[0] as { id: string; check_in_at: string } | undefined;
      if (open) {
        const { data: planRows } = await supabase.rpc('shift_get_rows_for_viewer', {
          p_caller_id: userId,
          p_weeks: [weekKeyForCheckIn(open.check_in_at)],
        });
        const exp = computeExpectedEnd(open.check_in_at, userId, (planRows || []) as ShiftRowLite[]);
        const snoozedUntil = Number(safeGet(SNOOZE_PREFIX + open.id) || 0);
        if (now >= exp.endMs && now >= snoozedUntil) {
          setReminder({ kind: 'open', logId: open.id, checkInAt: open.check_in_at, endMs: exp.endMs, fromPlan: exp.fromPlan });
          return;
        }
        // Vardiya açık ama henüz zamanı gelmedi / ertelendi → (B)'ye bakmaya gerek yok
        setReminder(null);
        return;
      }

      // (B) Son 3 günde otomatik kapatılan, fazla mesai bildirilmemiş kayıt
      const { data: closedRows } = await supabase
        .from('time_logs')
        .select('id, date, check_in_at, end_time, status, overtime_minutes, auto_closed_at')
        .eq('employee_id', userId)
        .eq('status', 'Bekliyor')
        .is('overtime_minutes', null)
        .gte('auto_closed_at', new Date(now - CLOSED_LOOKBACK_MS).toISOString())
        .order('auto_closed_at', { ascending: false })
        .limit(5);

      const closed = (closedRows || []).find((r: any) => !safeGet(DISMISS_CLOSED_PREFIX + r.id)) as any;
      if (closed && closed.check_in_at) {
        setReminder({ kind: 'closed', logId: closed.id, checkInAt: closed.check_in_at, endTime: closed.end_time || '', date: closed.date });
        return;
      }
      setReminder(null);
    } catch (err) {
      // Hatırlatma kritik değil — sessizce gizle
      console.warn('[ShiftReminderBanner] okunamadı:', err);
      setReminder(null);
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh, tick]);

  useEffect(() => {
    if (!userId) return;
    const bump = () => setTick(x => x + 1);
    const onVisible = () => { if (document.visibilityState === 'visible') bump(); };
    const id = window.setInterval(bump, REFRESH_MS);
    window.addEventListener(SHIFT_CHANGED_EVENT, bump);
    window.addEventListener('focus', bump);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(SHIFT_CHANGED_EVENT, bump);
      window.removeEventListener('focus', bump);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId]);

  // Sekme değişince (ör. QR'dan dönünce) yeniden kontrol et
  useEffect(() => { setTick(x => x + 1); }, [activeTab]);

  if (!reminder) return null;
  if (reminder.kind === 'open' && activeTab === 'qr') return null;
  if (reminder.kind === 'closed' && activeTab === 'payroll') return null;

  const wrapClass =
    'fixed left-0 right-0 z-[85] px-3 pointer-events-none top-[calc(env(safe-area-inset-top)+4.5rem)] md:top-4 md:left-auto md:right-6 md:w-[420px] md:px-0';

  if (reminder.kind === 'open') {
    const body = fill(reminder.fromPlan ? t('reminder.openBody') : t('reminder.openBodyNoPlan'), {
      in: fmtBerlinHm(reminder.checkInAt),
      end: fmtBerlinHm(new Date(reminder.endMs)),
    });
    return (
      <div className={wrapClass} role="alert" data-testid="checkout-reminder">
        <div className="max-w-md mx-auto pointer-events-auto rounded-2xl border border-amber-300 dark:border-amber-500/40 bg-amber-50/95 dark:bg-zinc-900/95 backdrop-blur-xl shadow-2xl p-3.5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
              <AlarmClock size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-900 dark:text-white">{t('reminder.openTitle')}</div>
              <p className="text-xs text-slate-700 dark:text-zinc-300 mt-0.5 leading-relaxed">{body}</p>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => onNavigate('qr')}
              className="flex-1 px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <QrCode size={16} /> {t('reminder.openCta')}
            </button>
            <button
              onClick={() => { safeSet(SNOOZE_PREFIX + reminder.logId, String(Date.now() + SNOOZE_MS)); setReminder(null); }}
              className="px-3 py-2 rounded-xl bg-white/70 dark:bg-zinc-800 hover:bg-white dark:hover:bg-zinc-700 border border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 text-sm font-medium transition-colors"
            >
              {t('reminder.later')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const [, mm, dd] = (reminder.date || '').split('-');
  const body = fill(t('reminder.closedBody'), {
    date: dd && mm ? `${dd}.${mm}` : reminder.date,
    in: fmtBerlinHm(reminder.checkInAt),
    end: reminder.endTime || '—',
  });
  return (
    <div className={wrapClass} role="status" data-testid="auto-closed-reminder">
      <div className="max-w-md mx-auto pointer-events-auto rounded-2xl border border-rose-300 dark:border-rose-500/40 bg-rose-50/95 dark:bg-zinc-900/95 backdrop-blur-xl shadow-2xl p-3.5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/40 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
            <AlarmClockOff size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-900 dark:text-white">{t('reminder.closedTitle')}</div>
            <p className="text-xs text-slate-700 dark:text-zinc-300 mt-0.5 leading-relaxed">{body}</p>
          </div>
          <button
            onClick={() => { safeSet(DISMISS_CLOSED_PREFIX + reminder.logId, '1'); setReminder(null); }}
            className="text-slate-500 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-white p-1 -mr-1 -mt-1 rounded-lg"
            aria-label={t('reminder.dismiss')}
          >
            <X size={16} />
          </button>
        </div>
        <button
          onClick={() => {
            try { sessionStorage.setItem(OPEN_OVERTIME_KEY, reminder.logId); } catch { /* */ }
            onNavigate('payroll');
          }}
          className="w-full mt-3 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
        >
          <Zap size={16} /> {t('reminder.closedCta')}
        </button>
      </div>
    </div>
  );
};

export default ShiftReminderBanner;
