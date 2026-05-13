// =============================================================
// berlinTime.ts — Tüm zaman gösterimi ve karşılaştırması Europe/Berlin
// =============================================================
// Firma Almanya'da. Vardiya planları "17:00–03:00" gibi düz HH:MM
// string'leri olarak saklanıyor — bunlar Berlin yerel saati. Ancak
// time_logs.check_in_at / check_out_at gibi alanlar UTC TIMESTAMPTZ.
// Tarayıcı (admin Türkiye'den de bakabilir) yerel saatine göre render
// ederse plan ile gerçek saat arasında DST-saatleri kadar fark çıkar.
//
// Bu modül:
//   - fmtBerlinHm(iso)    : ISO string → "HH:MM" Berlin yerel
//   - berlinTimestamp(...): Berlin yerelinde Y/M/D + H:M → epoch ms (UTC)
//   - berlinDayStart(date): Berlin yerelinde gecenin başı (00:00) → epoch ms
//   - berlinYmd(date)     : Berlin yerelinde tarihin YYYY-MM-DD'si
// =============================================================

export const BERLIN_TZ = 'Europe/Berlin' as const;

// Bir epoch ms anının Berlin saatinde yıl/ay/gün/saat/dakika/saniye
// bileşenlerini sayı olarak döndürür. Intl.DateTimeFormat ile yapılır;
// DST geçişleri (mart son pazar / ekim son pazar) otomatik doğru yansır.
function berlinParts(dateMs: number): {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: BERLIN_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(dateMs));
  const o: Record<string, string> = {};
  parts.forEach(p => { if (p.type !== 'literal') o[p.type] = p.value; });
  // Intl bazen "hour: 24" döner gece yarısında — 00'a normalize et
  let h = parseInt(o.hour, 10);
  if (h === 24) h = 0;
  return {
    year:   parseInt(o.year,   10),
    month:  parseInt(o.month,  10),
    day:    parseInt(o.day,    10),
    hour:   h,
    minute: parseInt(o.minute, 10),
    second: parseInt(o.second, 10),
  };
}

// Berlin'in o tarih için UTC ofsetini (dakika cinsinden) hesaplar.
// CET = +60, CEST = +120. DST otomatik.
function berlinOffsetMin(dateMs: number): number {
  const p = berlinParts(dateMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - dateMs) / 60000);
}

/**
 * Berlin yerel saatinde verilen Y/M/D + H:M anının UTC epoch ms karşılığı.
 * Örn. berlinTimestamp(2026, 5, 13, 17, 0) → Berlin'de 13 May 2026 17:00
 * olduğu anın UTC epoch ms değeri (CEST'te 15:00 UTC).
 *
 * DST geçişlerinde (var olmayan saat / iki kez geçen saat) en yakın
 * geçerli ofsete sapmadan UTC değerini döner — bir vardiya 02:30'da
 * başlasa bile yaklaşımı bozulmaz.
 */
export function berlinTimestamp(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number = 0,
  minute: number = 0,
): number {
  // Önce "Berlin'de Y/M/D H:M" olduğu anı UTC olarak naif hesapla
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  // O ana Berlin'in ofsetini bul ve düzelt
  const offsetMin = berlinOffsetMin(naiveUtc);
  return naiveUtc - offsetMin * 60000;
}

/**
 * Berlin yerel saatinde verilen tarihin gece yarısı (00:00) epoch ms.
 */
export function berlinDayStart(date: Date | number = new Date()): number {
  const ms = typeof date === 'number' ? date : date.getTime();
  const p = berlinParts(ms);
  return berlinTimestamp(p.year, p.month, p.day, 0, 0);
}

/**
 * Berlin yerel saatinde verilen anın YYYY-MM-DD'si.
 */
export function berlinYmd(date: Date | number = new Date()): string {
  const ms = typeof date === 'number' ? date : date.getTime();
  const p = berlinParts(ms);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * ISO/Date → "HH:MM" Berlin yerel saatinde. Null/empty → '—'.
 * Tarayıcı nerede olursa olsun aynı sonucu döner.
 */
export function fmtBerlinHm(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BERLIN_TZ,
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * ISO/Date → "DD.MM.YYYY HH:MM" Berlin yerel saatinde. Almanca biçim.
 */
export function fmtBerlinDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: BERLIN_TZ,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(d);
}
