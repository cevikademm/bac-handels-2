// =============================================================
// checkoutReminder.ts — "Çıkış QR'ını unutma" hatırlatması için
// paylaşılan hesaplar.
// =============================================================
// auto_close_open_shifts() (sunucu) açık kalan vardiyayı 16 saat sonra
// kapatırken çıkışı PLANDAKİ bitiş saatine yazar (plan yoksa giriş+8sa).
// Buradaki hesap birebir aynı kuralı izler ki personele "sistem
// vardiyanı şu saatte kapatır" dediğimiz saat, sunucunun yazacağı saatle
// aynı olsun:
//   1) Girişin Berlin yerel günü → o haftanın pazartesisi + gün indeksi
//   2) O güne ait shift_schedules satırları içinde personelin id'si geçen
//      ve time_slot'unda rakam olan EN SON oluşturulmuş satır
//   3) Bitiş = o gün + time_slot bitişi; giriş anından önce/eşitse +1 gün
//   4) Plan yoksa giriş + 8 saat
// =============================================================

import { berlinTimestamp, berlinYmd } from './berlinTime';
import { getWeekStartYmd, parseTimeSlot } from './shiftStatus';

export const AUTO_CLOSE_FALLBACK_HOURS = 8;
// Hatırlatma kartından Bordro'ya geçerken "şu kayıt için fazla mesai
// penceresini aç" bilgisini taşıyan sessionStorage anahtarı.
export const OPEN_OVERTIME_KEY = 'bac:open-overtime-log';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ShiftRowLite {
  week_start_date: string;
  time_slot: string | null;
  days: (string | null)[] | null;
  created_at?: string | null;
}

export interface ExpectedEnd {
  endMs: number;          // sunucunun yazacağı çıkış anı (epoch ms)
  fromPlan: boolean;      // true → plandan, false → giriş + 8 sa
  slot: string | null;    // eşleşen time_slot (ör. "17-03")
}

/** Girişin Berlin yerel gününe ait haftanın pazartesisi (YYYY-MM-DD). */
export function weekKeyForCheckIn(checkInIso: string): string {
  return getWeekStartYmd(new Date(checkInIso));
}

/** Pazartesi=0 … Pazar=6 (Berlin yerel). */
export function dayIndexForCheckIn(checkInIso: string): number {
  const localYmd = berlinYmd(new Date(checkInIso));
  const monday = weekKeyForCheckIn(checkInIso);
  const [y, m, d] = localYmd.split('-').map(Number);
  const [my, mm, md] = monday.split('-').map(Number);
  // Gün ortası kullan — DST kenarından uzak
  const diff = berlinTimestamp(y, m, d, 12, 0) - berlinTimestamp(my, mm, md, 12, 0);
  return Math.round(diff / DAY_MS);
}

/**
 * Sunucudaki auto_close_open_shifts ile aynı kuralla, açık bir vardiyanın
 * sistem tarafından yazılacak çıkış anını hesaplar.
 */
export function computeExpectedEnd(
  checkInIso: string,
  employeeId: string,
  rows: ShiftRowLite[],
): ExpectedEnd {
  const checkInMs = new Date(checkInIso).getTime();
  const monday = weekKeyForCheckIn(checkInIso);
  const idx = dayIndexForCheckIn(checkInIso);
  const needle = employeeId.toLowerCase();

  const candidates = rows
    .filter(r => r.week_start_date === monday)
    .filter(r => /\d/.test(r.time_slot || ''))
    .filter(r => ((r.days || [])[idx] || '').toLowerCase().includes(needle))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const parsed = candidates.length ? parseTimeSlot(candidates[0].time_slot) : null;
  if (!parsed) {
    return {
      endMs: checkInMs + AUTO_CLOSE_FALLBACK_HOURS * 60 * 60 * 1000,
      fromPlan: false,
      slot: null,
    };
  }

  const [y, m, d] = berlinYmd(new Date(checkInIso)).split('-').map(Number);
  let endMs = berlinTimestamp(y, m, d, Math.floor(parsed.endMins / 60), parsed.endMins % 60);
  if (endMs <= checkInMs) endMs += DAY_MS;
  return { endMs, fromPlan: true, slot: candidates[0].time_slot };
}
