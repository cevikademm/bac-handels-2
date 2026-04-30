import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Yerel saatte YYYY-MM-DD üretir. shift_schedules.week_start_date alanı
// için tek doğru kaynak burası — toISOString() kullanmayın, çünkü UTC'ye
// kayar ve yerel saatle Pazartesi gibi görünen gün UTC'de Pazar olabilir
// (Almanya'da UTC+1/+2 nedeniyle). Tüm vardiya kayıt/okuma kodu bu
// helper'dan geçmeli, aksi halde Calendar/Payroll/ShiftSchedule arasında
// "atama hiç yapılmamış gibi" görünen uyuşmazlıklar oluşur.
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// "09:00-17:00" / "09-17" / "9:30 - 17:45" -> { start, end } (dakika)
export function parseTimeRange(label: string): { start: number; end: number } | null {
  if (!label) return null;
  const match = label.match(/(\d{1,2}):?(\d{2})?\s*[-–]\s*(\d{1,2}):?(\d{2})?/);
  if (!match) return null;
  return {
    start: parseInt(match[1]) * 60 + parseInt(match[2] || '0'),
    end: parseInt(match[3]) * 60 + parseInt(match[4] || '0'),
  };
}

// Verilen anda kullanıcı atanmış vardiya içinde mi? schedules: shift_schedules satırları
// (week_start_date, time_slot, days[7] — Pzt=0 ... Pzr=6).
export function isUserOnShiftAt(userId: string, now: Date, schedules: any[]): boolean {
  if (!userId || !Array.isArray(schedules) || schedules.length === 0) return false;
  // JS: Pazar=0..Cmt=6 -> Pzt=0..Pzr=6
  const dayIdx = (now.getDay() + 6) % 7;
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  // İçinde olduğumuz haftanın Pazartesi tarihi
  const monday = new Date(now);
  monday.setDate(monday.getDate() - dayIdx);
  const weekKey = formatLocalDate(monday);

  for (const row of schedules) {
    if (row?.week_start_date !== weekKey) continue;
    if (!Array.isArray(row.days) || row.days[dayIdx] !== userId) continue;
    const range = parseTimeRange(row.time_slot || '');
    if (!range) continue;
    if (minutesNow >= range.start && minutesNow < range.end) return true;
  }
  return false;
}

// Ondalık saat değerini "H:MM" string'ine çevir. Örn. 8.42 -> "8:25".
// time_logs.total_hours bu formatta tutulur (2 ondalıklı), insan-okur biçimi.
export function formatHoursAsHM(hours?: number | null): string {
  if (hours == null || isNaN(hours) || hours <= 0) return '0:00';
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// HH:mm formatı (yerel saat). created_at gibi ISO timestamp'ler için.
export function formatTimeOfDay(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

// Mesai dışı satış uyarılarını sadece bu emailler görür.
export const OFF_SHIFT_ALERT_EMAILS = ['cevikademm@gmail.com', 'gurcan@bac.de'];
export const canSeeOffShiftAlerts = (email?: string | null): boolean =>
  !!email && OFF_SHIFT_ALERT_EMAILS.includes(email.trim().toLowerCase());

// QR girişinde kaydedilen cihaz marka/modelini sadece bu adminler görebilir.
// Amaç: Bir personelin kendi şifresini başka birine verip QR okutmasını
// fark etmek — geçmişte "Apple iPhone" gösterirken aniden "Samsung SM-…"
// görünürse şüpheli durum yakalanır. Personeller bu bilgiyi göremez.
export const DEVICE_INFO_VISIBLE_EMAILS = [
  'cevikademm@gmail.com',
  'gurcan@bac.de',
  'hakan@bac.de',
  'seda@bac.de',
];
export const canSeeDeviceInfo = (email?: string | null): boolean =>
  !!email && DEVICE_INFO_VISIBLE_EMAILS.includes(email.trim().toLowerCase());

// QR check-in anında tarayıcının User-Agent'ından kısa bir cihaz etiketi üretir.
// "Apple iPhone (iOS 17.0)", "Samsung SM-S918B", "Xiaomi Redmi Note 11" gibi.
// Kütüphanesiz, izin gerektirmez. UA reduction altında bile marka kelimeleri
// (iPhone, SM-…, Pixel, Redmi, OnePlus) korunduğu için yeterince güvenilir.
export function detectDeviceInfo(): string {
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
  if (/iPad/i.test(ua)) return 'Apple iPad';
  if (/iPhone/i.test(ua)) {
    const m = ua.match(/iPhone OS (\d+)[_.](\d+)/i);
    return m ? `Apple iPhone (iOS ${m[1]}.${m[2]})` : 'Apple iPhone';
  }
  const android = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/i);
  if (android) {
    const model = android[1].trim();
    if (/^SM-/i.test(model)) return `Samsung ${model}`;
    if (/Pixel/i.test(model)) return `Google ${model}`;
    if (/Mi |Redmi|POCO/i.test(model)) return `Xiaomi ${model}`;
    if (/HUAWEI|HONOR/i.test(model)) return `Huawei ${model}`;
    if (/OnePlus/i.test(model)) return `OnePlus ${model}`;
    return model || 'Android cihaz';
  }
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Macintosh/i.test(ua)) return 'Mac';
  return 'Bilinmeyen cihaz';
}

// Fiş fotoğrafı için kanvas tabanlı sıkıştırma. Mobilde ham foto 3-5 MB
// olabiliyor — okunaklı kalan 800px genişlik + JPEG q=0.6 ~30-80 KB üretir.
// EXIF orientation 'from-image' ile otomatik düzeltilir (modern Chrome/Safari).
export async function compressImageToJpeg(
  file: File,
  opts: { maxWidth?: number; quality?: number } = {}
): Promise<Blob> {
  const { maxWidth = 800, quality = 0.6 } = opts;
  // @ts-ignore — imageOrientation 'from-image' Chrome 79+ / Safari 13.4+
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const ratio = Math.min(1, maxWidth / bitmap.width);
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context kullanılamıyor');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('Resim sıkıştırılamadı'))),
      'image/jpeg',
      quality
    );
  });
}
