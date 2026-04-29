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
