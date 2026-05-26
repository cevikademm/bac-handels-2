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

// Bir vardiya hücresi (days[dayIdx]) tek bir personel ID'si veya CSV ("id1,id2,…")
// olabilir. Bu helper'lar formatı normalize eder; tek doğruluk kaynağı budur.
// Boş string veya null → boş dizi (mevcut "boş hücre" davranışı korunur).
export function parseCellIds(cell: string | null | undefined): string[] {
  if (!cell) return [];
  return String(cell).split(',').map(s => s.trim()).filter(Boolean);
}

// ID dizisini DB'ye yazmak için CSV string'ine çevirir. Set ile dedup yapar —
// aynı personel iki kez eklense bile hücrede tek satır görünür.
export function joinCellIds(ids: string[]): string {
  return Array.from(new Set(ids.filter(Boolean))).join(',');
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
    if (!Array.isArray(row.days)) continue;
    // Hücre CSV olabilir — tüm ID'leri kontrol et
    if (!parseCellIds(row.days[dayIdx]).includes(userId)) continue;
    const range = parseTimeRange(row.time_slot || '');
    if (!range) continue;
    if (minutesNow >= range.start && minutesNow < range.end) return true;
  }
  return false;
}

// Verilen anda kullanıcı hangi şubede çalışıyor? Personel havuzdan farklı
// şubelerde görev alabildiği için profiles.branch (ana şube) yanıltıcı olabilir
// — tek doğruluk kaynağı vardiya planıdır. schedules: shift_schedules satırları
// (week_start_date, branch, time_slot, days[7]).
// Bulunamazsa null döner; aralık dışında ise en yakın aynı-gün vardiyasına
// düşmeye çalışmaz (çağıran taraf fallback'i yönetir).
export function getUserBranchAt(userId: string, at: Date, schedules: any[]): string | null {
  if (!userId || !Array.isArray(schedules) || schedules.length === 0) return null;
  const dayIdx = (at.getDay() + 6) % 7;
  const minutesNow = at.getHours() * 60 + at.getMinutes();
  const monday = new Date(at);
  monday.setDate(monday.getDate() - dayIdx);
  const weekKey = formatLocalDate(monday);

  // 1) Tam saatte vardiyada olduğu satır
  for (const row of schedules) {
    if (row?.week_start_date !== weekKey) continue;
    if (!row?.branch) continue;
    if (!Array.isArray(row.days)) continue;
    if (!parseCellIds(row.days[dayIdx]).includes(userId)) continue;
    const range = parseTimeRange(row.time_slot || '');
    if (!range) continue;
    if (minutesNow >= range.start && minutesNow < range.end) return row.branch;
  }
  // 2) Aynı gün herhangi bir vardiyada (saat tutmasa bile) → tek atama varsa kullan
  const sameDay = schedules.filter(row =>
    row?.week_start_date === weekKey &&
    !!row?.branch &&
    Array.isArray(row.days) &&
    parseCellIds(row.days[dayIdx]).includes(userId)
  );
  if (sameDay.length === 1) return sameDay[0].branch;
  return null;
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

// Ondalık saati TR insan-okur kısa formata çevir. Örn. 7.87 -> "7sa 52dk".
// Bordro UI'sinde kullanıcılar "7.87 saat" diye okuyamıyordu (87 dakika sanıyorlardı).
export function formatHoursHumanTR(hours?: number | null): string {
  if (hours == null || isNaN(hours) || hours <= 0) return '0sa 00dk';
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}sa ${String(m).padStart(2, '0')}dk`;
}

// HH:mm formatı, Berlin yereli. Firma Almanya'da; admin Türkiye'den de
// baksa plan saatleriyle log saatleri tutarlı görünür.
export function formatTimeOfDay(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(d);
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

// Samsung SM-kodlarını insan-okur "Galaxy …" pazarlama adına çevirir.
// Eşleşme bölge eki ('B', 'U', 'N', 'F', '/DS' vb.) önemsemeden yapılır,
// böylece SM-S918B / SM-S918U / SM-S918N hepsi "Galaxy S23 Ultra" döner.
// Liste sadece sahada en sık karşılaşılan modelleri kapsar; eşleşme yoksa
// ham SM-kodu olduğu gibi gösterilir (bilgi kaybı olmasın diye).
const SAMSUNG_MODEL_MAP: Record<string, string> = {
  // Galaxy S serisi
  'S901': 'Galaxy S22', 'S906': 'Galaxy S22+', 'S908': 'Galaxy S22 Ultra',
  'S911': 'Galaxy S23', 'S916': 'Galaxy S23+', 'S918': 'Galaxy S23 Ultra',
  'S711': 'Galaxy S23 FE',
  'S921': 'Galaxy S24', 'S926': 'Galaxy S24+', 'S928': 'Galaxy S24 Ultra',
  'S931': 'Galaxy S25', 'S936': 'Galaxy S25+', 'S938': 'Galaxy S25 Ultra',
  // Galaxy A serisi (orta segment, en sık)
  'A146': 'Galaxy A14', 'A156': 'Galaxy A15', 'A166': 'Galaxy A16',
  'A256': 'Galaxy A25', 'A266': 'Galaxy A26',
  'A346': 'Galaxy A34', 'A356': 'Galaxy A35', 'A366': 'Galaxy A36',
  'A526': 'Galaxy A52', 'A536': 'Galaxy A53', 'A546': 'Galaxy A54',
  'A556': 'Galaxy A55', 'A566': 'Galaxy A56',
  'A736': 'Galaxy A73',
  // Galaxy Z (katlanabilir)
  'F711': 'Galaxy Z Flip3', 'F721': 'Galaxy Z Flip4', 'F731': 'Galaxy Z Flip5',
  'F741': 'Galaxy Z Flip6', 'F761': 'Galaxy Z Flip7',
  'F926': 'Galaxy Z Fold3', 'F936': 'Galaxy Z Fold4', 'F946': 'Galaxy Z Fold5',
  'F956': 'Galaxy Z Fold6', 'F966': 'Galaxy Z Fold7',
  // Note serisi (eski ama hâlâ sahada)
  'N970': 'Galaxy Note 10', 'N975': 'Galaxy Note 10+',
  'N980': 'Galaxy Note 20', 'N985': 'Galaxy Note 20 Ultra',
};

function samsungMarketingName(rawModel: string): string {
  // SM-S918B/DS, SM-S918B, SM-A546B → "S918", "S918", "A546"
  const m = rawModel.match(/^SM-([A-Z]\d{3})/i);
  if (m) {
    const friendly = SAMSUNG_MODEL_MAP[m[1].toUpperCase()];
    if (friendly) return `Samsung ${friendly}`;
  }
  return `Samsung ${rawModel}`;
}

// Tarayıcıda üretilip localStorage'a yazılan, MAC adresi formatında kalıcı
// cihaz kimliği. Web platformu gerçek hardware MAC/IMEI'ye erişemediği için
// (iOS Safari/Chrome/FF privacy nedeniyle blokluyor), random 6 byte üretip
// MAC görünümünde saklıyoruz. Aynı tarayıcı + aynı domain'de stabil; kullanıcı
// site verilerini silerse yenilenir — bu kabul edilebilir, çünkü amaç:
//   "Bu personel hep aynı cihazdan mı giriş yapıyor?" sorusuna cevap vermek.
// Birinci oktette locally-administered bit set ediliyor (gerçek üretici OUI
// ile karışmasın diye standart yaklaşım: bit 1 = 1, bit 0 = 0 → 'X2', 'X6',
// 'XA', 'XE' başlangıç).
const DEVICE_ID_KEY = 'bac_device_id';

function generatePseudoMac(): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // locally-administered + unicast: ilk oktetin alt 2 biti '10' olsun
  bytes[0] = (bytes[0] | 0x02) & 0xFE;
  return Array.from(bytes, b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing && /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(existing)) return existing;
    const fresh = generatePseudoMac();
    window.localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    // Private mode / storage disabled — kalıcı ID üretemeyiz.
    return '';
  }
}

// Android UA'da (veya UA-CH hint'inde) yakalanan ham model string'ini bilinen
// marka kalıplarına göre etiketler. Eşleşme yoksa modelin kendisi döner.
function brandifyAndroidModel(rawModel: string): string {
  const model = (rawModel || '').trim();
  if (!model) return '';
  if (/^SM-/i.test(model)) return samsungMarketingName(model);
  if (/^Pixel/i.test(model)) return `Google ${model}`;
  if (/^(Mi |Redmi|POCO|2\d{3}\w+)/i.test(model)) return `Xiaomi ${model}`;
  if (/HUAWEI|HONOR|^(ALP|EVA|VOG|ELS|NOH|LIO|TAS|ANA|JNY|MAR|JAD)-/i.test(model)) {
    return /HUAWEI|HONOR/i.test(model) ? model : `Huawei ${model}`;
  }
  if (/OnePlus|^(LE|GM|HD|IN|KB|CPH)\d{4}/i.test(model)) return `OnePlus ${model}`;
  if (/^(SO-|SOG|XQ-)/i.test(model)) return `Sony ${model}`;
  if (/^(RMX|realme)/i.test(model)) return `Realme ${model}`;
  if (/^(V\d{4}|vivo)/i.test(model)) return `vivo ${model}`;
  if (/^(CPH|OPPO)/i.test(model)) return `OPPO ${model}`;
  if (/^(Nokia|TA-)/i.test(model)) return `Nokia ${model}`;
  return model;
}

// Chrome 110+ (Android) User-Agent string'ini gizlilik amacıyla sabit "K"
// değerine indirgedi — gerçek model artık UA-CH (User-Agent Client Hints)
// API'siyle async olarak çekiliyor. Bu yüzden detectDeviceInfo() async oldu.
// iOS Safari hâlâ "iPhone" sabitini döner (Apple model bilgisini paylaşmaz),
// orada iOS sürümünü ekliyoruz ki en azından nesil ayırt edilebilsin.
//
// Çıktı formatı:
//   "Android · Samsung Galaxy S23 Ultra · 2A:DB:BA:59:A3:EF"
//   "Apple iPhone (iOS 17.4) · 62:4A:B4:F6:DD:59"
//   "Apple iPad (iPadOS 17.4) · 5E:11:08:…"
//   "Windows PC · …"  /  "Mac · …"
//
// MAC-benzeri kimlik localStorage'da saklanır; cihaz değişirse veya tarayıcı
// verileri silinirse değişir → şifre paylaşımı tespiti.
export async function detectDeviceInfo(): Promise<string> {
  const id = getOrCreateDeviceId();
  const idSuffix = id ? ` · ${id}` : '';
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';

  // iOS: Safari UA hiçbir zaman model adı içermez — sadece "iPhone" / "iPad".
  // En faydalı ek bilgi iOS sürümü ("CPU iPhone OS 17_4_1 like Mac OS X").
  const iosVer = (() => {
    const m = ua.match(/OS (\d+)[_.](\d+)(?:[_.](\d+))?/);
    if (!m) return '';
    const parts = [m[1], m[2]].concat(m[3] ? [m[3]] : []);
    return parts.join('.');
  })();
  if (/iPad/i.test(ua)) {
    return `Apple iPad${iosVer ? ` (iPadOS ${iosVer})` : ''}${idSuffix}`;
  }
  if (/iPhone/i.test(ua)) {
    return `Apple iPhone${iosVer ? ` (iOS ${iosVer})` : ''}${idSuffix}`;
  }

  // Android: önce UA-CH'den gerçek modeli çekmeyi dene (Chrome 90+).
  // navigator.userAgentData mevcut değilse veya hint reddedilirse UA fallback.
  const nav: any = typeof navigator !== 'undefined' ? navigator : null;
  if (nav?.userAgentData && /Android/i.test(ua)) {
    try {
      const hints = await nav.userAgentData.getHighEntropyValues(['model', 'platformVersion']);
      const model = (hints?.model || '').trim();
      const branded = brandifyAndroidModel(model);
      const verSuffix = hints?.platformVersion ? ` ${hints.platformVersion}` : '';
      if (branded) return `Android${verSuffix} · ${branded}${idSuffix}`;
      // Model boş döndüyse UA fallback'ine düş
    } catch {
      // izin reddi / desteklenmeyen tarayıcı — UA fallback'ine düş
    }
  }

  // UA fallback (Chrome <110 veya UA-CH yoksa)
  const androidMatch = ua.match(/Android\s*([\d.]+)?[^;]*;\s*([^;)]+?)(?:\s+Build|\))/i);
  if (androidMatch) {
    const verSuffix = androidMatch[1] ? ` ${androidMatch[1]}` : '';
    const rawModel = androidMatch[2].trim();
    // "K" Chrome 110+ placeholder'ı — anlamsız, gizle.
    const isPlaceholder = /^K$/i.test(rawModel) || rawModel.length < 2;
    if (isPlaceholder) {
      return `Android${verSuffix} cihaz${idSuffix}`;
    }
    const branded = brandifyAndroidModel(rawModel);
    return `Android${verSuffix} · ${branded || rawModel}${idSuffix}`;
  }

  if (/Windows/i.test(ua)) return `Windows PC${idSuffix}`;
  if (/Macintosh/i.test(ua)) return `Mac${idSuffix}`;
  return `Bilinmeyen cihaz${idSuffix}`;
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

// SHA-256 — sıkıştırılmış JPEG blob'unun bit-eşit parmak izi.
// Bir kullanıcının aynı dosyayı tekrar yüklemesini engellemek için kullanılır.
export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// dHash 64-bit — perceptual hash. Görüntüyü 9×8 grayscale'e küçültür,
// her satırda yatay komşu piksel farkını 1 bit olarak kodlar (toplam 8×8=64 bit).
// Aynı fişin screenshot'u, hafif kırpılmış veya re-encode edilmiş versiyonu
// için Hamming distance ≤ 6 çıkar; tamamen farklı görseller ≥ 20 olur.
// BigInt döner — Postgres BIGINT'e signed 64-bit olarak yazılır.
export async function computeDHash(bitmap: ImageBitmap): Promise<bigint> {
  const w = 9, h = 8;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context kullanılamıyor');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  let hash = 0n;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i1 = (y * w + x) * 4;
      const i2 = (y * w + x + 1) * 4;
      const g1 = 0.299 * px[i1] + 0.587 * px[i1 + 1] + 0.114 * px[i1 + 2];
      const g2 = 0.299 * px[i2] + 0.587 * px[i2 + 1] + 0.114 * px[i2 + 2];
      hash = (hash << 1n) | (g1 < g2 ? 1n : 0n);
    }
  }
  return hash;
}

// Postgres BIGINT signed 64-bit (-2^63..2^63-1). dHash unsigned 64-bit olabildiği
// için en yüksek bit set olunca signed'a sıkıştırılması gerekir. PG tarafında
// XOR + popcount aynı çalıştığı sürece eşleşme korunur.
export function dhashToPgBigint(hash: bigint): string {
  const MAX_U64 = 1n << 64n;
  const SIGNED_MAX = (1n << 63n) - 1n;
  let v = hash;
  if (v > SIGNED_MAX) v = v - MAX_U64;
  return v.toString();
}

// Tek adımda: sıkıştır + SHA-256 + dHash. SalesDashboard'da upload öncesi
// çağrılır; sonuç check_receipt_duplicate RPC'sine gider, temizse storage'a yüklenir.
export async function computeReceiptFingerprint(
  file: File
): Promise<{ blob: Blob; sha256: string; dhash: string }> {
  const blob = await compressImageToJpeg(file, { maxWidth: 800, quality: 0.6 });
  const sha256 = await sha256Hex(blob);
  // @ts-ignore — imageOrientation 'from-image' Chrome 79+ / Safari 13.4+
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const dhash = await computeDHash(bitmap);
    return { blob, sha256, dhash: dhashToPgBigint(dhash) };
  } finally {
    bitmap.close?.();
  }
}
