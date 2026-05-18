import React, { useEffect, useMemo, useState } from 'react';
import {
  Smartphone, Loader2, Search, ShieldAlert, Copy, Check, User as UserIcon, AlertTriangle,
  UserX, XCircle, Camera, Wifi, Lock, QrCode, Calendar as CalendarIcon, Clock,
  LogIn, LogOut, CalendarDays, MapPin, Info, StickyNote, Save, Trash2, Flag
} from 'lucide-react';
import { Employee, Role } from '../types';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../lib/i18n';
import { canSeeDeviceInfo } from '../lib/utils';
import { fetchShiftsForDate, ShiftWithStatus, STATUS_META } from '../lib/shiftStatus';
import { fmtBerlinHm } from '../lib/berlinTime';

interface RawLog {
  id: string;
  employee_id: string;
  device_info: string | null;
  check_in_at: string | null;
  date: string;
  start_time: string | null;
  branch: string | null;
}

// Alışılmış cihaz eşikleri — DeviceTrustCard.tsx ile birebir aynı kalmalı.
// 2026-05-17: Eşik gevşetildi (3+2x → 2+1.5x). Sebep: az QR girişi olan
// personellerde bile sahip tespiti yapılabilsin, gerçek telefon çakışmaları
// yakalanabilsin. Tek tek girişlerde sahte sahip atamasını önlemek için
// MIN_COUNT 1'e indirilmedi.
const DOMINANT_MIN_COUNT = 2;
const DOMINANCE_RATIO = 1.5;

// "Telefon çakışması" grubu: bir kullanıcının alışılmış cihazından farklı
// bir cihazla yaptığı TÜM QR girişleri tek bir satırda toplanır.
//
// ownerActivity — bu girişin saatinde (±30 dk) cihazın "asıl sahibi"
// neredeydi?
//   'different' = sahip o saatte BAŞKA bir cihazdan giriş yapmıştı
//                 (sahip telefonunu vermiş, kendisi başka cihaz kullanıyor —
//                  en güçlü sinyal)
//   'same'      = sahip de aynı cihazdan giriş yaptı (ardışık tarama;
//                 sahip cihazını uzatmış, kullanıcı kendi hesabını okuttu)
//   'absent'    = sahip o gün hiç giriş yapmamış (sahip o gün çalışmıyor,
//                 cihaz ödünç verilmiş olabilir)
//   'unknown'   = sahip dominant değil veya hesaplanamadı
type OwnerActivity = 'different' | 'same' | 'absent' | 'unknown';

interface PhoneConflictOccurrence {
  logId: string;
  date: string;
  time: string;
  branch: string;
  checkInAt: string | null;
  ownerActivity: OwnerActivity;
  // owner 'different' olduğunda hangi cihazdan giriş yaptıysa onun MAC'i —
  // tek bir occurrence'a tooltip/etiket göstermek için.
  ownerOtherDeviceMac?: string;
}

// Aynı cihazı kullanan diğer kullanıcılar (dominant eşiğini geçmemiş olsalar
// dahi, kim kaç kez kullanmış görelim).
interface DeviceUser {
  employeeId: string;
  employeeName: string;
  count: number;
  isDominant: boolean;
}

interface PhoneConflictRow {
  employeeId: string;
  employeeName: string;
  deviceUsed: string;
  expectedDevice: string;
  // expectedDevice'tan en son giriş zamanı — "kendi telefonundan son giriş"
  // satırı için (mazeret değerlendirmesinde önemli: kendi telefonunu hiç mi
  // kullanmıyor, yoksa arada bir kullanıyor mu?)
  expectedDeviceLastSeen: string;
  // Bu cihazı kullanan diğer kişiler (kendisi hariç) — kim kaç kez:
  otherUsers: DeviceUser[];
  // Cihazın "asıl sahibi" varsa (dominant device olarak başkasının kaydı):
  dominantOwnerName: string | null;
  dominantOwnerId: string | null;
  occurrences: PhoneConflictOccurrence[];
  firstSeen: string;
  lastSeen: string;
  // occurrences içindeki ownerActivity dağılımı — kart üzerinde özet rozet:
  ownerCrossCheck: {
    different: number; // sahibi başka cihazdan girmişti
    same: number;      // sahibi de aynı cihazdan girmişti
    absent: number;    // sahibi o gün girmemişti
    unknown: number;
  };
}

// Bir çakışma kartı için yönetici notu (Supabase'den yüklenen)
interface ConflictNote {
  employeeId: string;
  deviceUsed: string;
  note: string;
  updatedAt: string;
  updatedByName: string | null;
}

// "Apple iPhone · 62:4A:B4:F6:DD:59" → "62:4A:B4:F6:DD:59"
function extractMac(deviceInfo: string): string {
  const parts = deviceInfo.split('·');
  return (parts[1] || '').trim();
}

// "Apple iPhone · 62:4A:B4:F6:DD:59" → "Apple iPhone"
// Ayraç yoksa veya ilk parça MAC görünümlüyse (":" içeriyor) marka yok say.
function extractBrand(deviceInfo: string): string {
  if (!deviceInfo.includes('·')) return '';
  const first = (deviceInfo.split('·')[0] || '').trim();
  if (!first || first.includes(':')) return '';
  return first;
}

// i18n çevirileri içine basit `{var}` yerleştirme — t() interpolation
// desteklemediği için string'i alıp manuel replace ediyoruz.
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

interface MacUsage {
  mac: string;
  brand: string; // En son görülen cihaz markası ("Apple iPhone", "Samsung Galaxy", ...)
  count: number;
  lastSeen: string;
}

interface PersonRow {
  employeeId: string;
  employeeName: string;
  macs: MacUsage[]; // benzersiz, kullanım sayısı azalan
}

interface MacConflictUser {
  employeeId: string;
  employeeName: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

interface MacConflict {
  mac: string;
  users: MacConflictUser[];
  totalCount: number;
  firstSeen: string;
  lastSeen: string;
}

// Sayfa başı çekilen kayıt sayısı (Supabase JS varsayılanı 1000).
// Hardcap güvenlik için: pratikte hiç ulaşılmamalı ama sonsuz loop'a karşı sigorta.
const PAGE_SIZE = 1000;
const HARD_CAP = 100000;

type TabView = 'people' | 'conflicts' | 'shifts' | 'errors';

// Tarihi YYYY-MM-DD'ye normalize et (lokal TZ)
const toYmd = (d: Date): string => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fromYmd = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d: Date, n: number): Date => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  r.setHours(0, 0, 0, 0);
  return r;
};

// QR scan hata kaydı (qr_scan_attempts tablosu)
interface ErrorRow {
  id: string;
  employeeId: string | null;
  employeeName: string;
  errorKind: string;
  errorDetail: string | null;
  action: string | null;
  branch: string | null;
  deviceInfo: string | null;
  attemptedAt: string;
}

// QR hatası türü → renkli rozet metaverisi
const ERROR_META: Record<string, { color: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  camera_denied:      { color: 'text-orange-400 bg-orange-500/10 border-orange-500/40',  icon: Camera },
  no_camera:          { color: 'text-orange-400 bg-orange-500/10 border-orange-500/40',  icon: Camera },
  insecure_context:   { color: 'text-amber-400 bg-amber-500/10 border-amber-500/40',     icon: Lock },
  network:            { color: 'text-sky-400 bg-sky-500/10 border-sky-500/40',           icon: Wifi },
  invalid_qr:         { color: 'text-red-400 bg-red-500/10 border-red-500/40',           icon: QrCode },
  already_checked_in: { color: 'text-violet-400 bg-violet-500/10 border-violet-500/40',  icon: AlertTriangle },
  not_checked_in:     { color: 'text-violet-400 bg-violet-500/10 border-violet-500/40',  icon: AlertTriangle },
  other:              { color: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/40',        icon: XCircle },
};

interface DeviceBrandsProps {
  currentUser: Employee;
}

const DeviceBrands: React.FC<DeviceBrandsProps> = ({ currentUser }) => {
  const { t, formatDate } = useLanguage();
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [conflicts, setConflicts] = useState<MacConflict[]>([]);
  const [phoneConflicts, setPhoneConflicts] = useState<PhoneConflictRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Yönetici notları — key: `${employeeId}|${deviceUsed}`
  const [notes, setNotes] = useState<Map<string, ConflictNote>>(new Map());
  // Hangi kartta not düzenleme açık? key aynı format
  const [editingNoteKey, setEditingNoteKey] = useState<string | null>(null);
  const [editingNoteDraft, setEditingNoteDraft] = useState<string>('');
  const [savingNoteKey, setSavingNoteKey] = useState<string | null>(null);

  // Çakışma kayıtları için başlangıç eşiği (ISO string, dahil) — bu tarihten
  // sonra yapılan QR girişleri analize girer. localStorage'da kalıcıdır.
  // null = "tüm geçmişi göster". Cihazın asıl sahibi tespiti yine tüm
  // verilerden yapılır; sadece phone-conflict satırları bu filtreye tâbidir.
  const [conflictsSinceTs, setConflictsSinceTs] = useState<string | null>(() => {
    try { return localStorage.getItem('phoneConflictsSinceTs'); } catch { return null; }
  });
  const updateConflictsSince = (iso: string | null) => {
    setConflictsSinceTs(iso);
    try {
      if (iso) localStorage.setItem('phoneConflictsSinceTs', iso);
      else localStorage.removeItem('phoneConflictsSinceTs');
    } catch { /* ignore */ }
  };
  const startFromTodayMidnight = () => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    updateConflictsSince(d.toISOString());
  };
  const startFromNow = () => {
    updateConflictsSince(new Date().toISOString());
  };
  const [search, setSearch] = useState('');
  const [copiedMac, setCopiedMac] = useState<string | null>(null);
  const [tab, setTab] = useState<TabView>('people');
  const [scannedCount, setScannedCount] = useState<number>(0);
  const [oldestSeen, setOldestSeen] = useState<string>('');

  // "Vardiyalar" ve "Hatalar" sekmesi verileri
  const [shiftDateYmd, setShiftDateYmd] = useState<string>(() => toYmd(new Date()));
  const [shiftRows, setShiftRows] = useState<ShiftWithStatus[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState<boolean>(false);
  const [errors, setErrors] = useState<ErrorRow[]>([]);

  const allowed = currentUser?.role === Role.ADMIN && canSeeDeviceInfo(currentUser?.email);

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    // Tüm QR check-in kayıtlarını sayfalı olarak çek (geçmişteki çakışmaları da
    // yakalayabilmek için). Profiles paralel çekilir, loglar sıralı.
    const fetchAllLogs = async (): Promise<RawLog[]> => {
      const all: RawLog[] = [];
      let offset = 0;
      while (offset < HARD_CAP) {
        const { data, error } = await supabase
          .from('time_logs')
          .select('id, employee_id, device_info, check_in_at, date, start_time, branch')
          .eq('entry_method', 'qr')
          .not('device_info', 'is', null)
          .order('check_in_at', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error || !data || data.length === 0) break;
        all.push(...(data as RawLog[]));
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      return all;
    };

    Promise.all([
      fetchAllLogs(),
      supabase
        .from('profiles')
        .select('id, full_name')
        .limit(1000),
      supabase
        .from('qr_scan_attempts')
        .select('id, employee_id, employee_name, error_kind, error_detail, action, branch, device_info, attempted_at')
        .eq('status', 'error')
        .order('attempted_at', { ascending: false })
        .limit(200),
      // Yönetici notları — tablo henüz uygulanmadıysa hata yutulur,
      // notlar boş bir Map ile akar (özellik degrade çalışır).
      supabase.rpc('dcn_list_notes', { p_caller_id: currentUser.id }),
    ]).then(([logs, profilesRes, errorsRes, notesRes]) => {
      if (cancelled) return;

      // Notları haritaya yaz (RPC hatası varsa sessizce boş bırak)
      const notesMap = new Map<string, ConflictNote>();
      if (!('error' in notesRes) || !notesRes.error) {
        const rows = ((notesRes as any).data || []) as any[];
        rows.forEach(r => {
          if (!r?.employee_id || !r?.device_used) return;
          notesMap.set(`${r.employee_id}|${r.device_used}`, {
            employeeId: r.employee_id,
            deviceUsed: r.device_used,
            note: r.note || '',
            updatedAt: r.updated_at,
            updatedByName: r.updated_by_name || null,
          });
        });
      }
      setNotes(notesMap);

      const nameMap = new Map<string, string>();
      (profilesRes.data || []).forEach((p: any) => {
        nameMap.set(p.id, p.full_name || '—');
      });

      // === Hata listesi ====================================================
      const errorList: ErrorRow[] = (errorsRes.data || []).map((r: any) => ({
        id: r.id,
        employeeId: r.employee_id,
        employeeName: r.employee_name || nameMap.get(r.employee_id) || '—',
        errorKind: r.error_kind || 'other',
        errorDetail: r.error_detail,
        action: r.action,
        branch: r.branch,
        deviceInfo: r.device_info,
        attemptedAt: r.attempted_at,
      }));

      // employee_id → MAC → { count, lastSeen, brand }
      // brand: aynı MAC için en son görülen marka kazanır (lastSeen güncellenirken yenilenir).
      const perUser = new Map<string, Map<string, { count: number; lastSeen: string; brand: string }>>();
      // MAC → employee_id → { count, firstSeen, lastSeen }  (çakışma hesabı için)
      const perMac = new Map<string, Map<string, { count: number; firstSeen: string; lastSeen: string }>>();

      let oldest = '';
      logs.forEach(l => {
        if (!l.device_info) return;
        const mac = extractMac(l.device_info).toUpperCase();
        if (!mac) return;
        const brand = extractBrand(l.device_info);
        const ts = l.check_in_at || '';
        if (ts && (oldest === '' || ts < oldest)) oldest = ts;

        // perUser
        if (!perUser.has(l.employee_id)) perUser.set(l.employee_id, new Map());
        const userMap = perUser.get(l.employee_id)!;
        const u = userMap.get(mac) || { count: 0, lastSeen: ts, brand };
        u.count += 1;
        // En son görülen check-in'in markası kazanır
        if (ts >= u.lastSeen) {
          u.lastSeen = ts;
          if (brand) u.brand = brand;
        }
        userMap.set(mac, u);

        // perMac
        if (!perMac.has(mac)) perMac.set(mac, new Map());
        const macMap = perMac.get(mac)!;
        const m = macMap.get(l.employee_id) || { count: 0, firstSeen: ts, lastSeen: ts };
        m.count += 1;
        if (ts && (m.firstSeen === '' || ts < m.firstSeen)) m.firstSeen = ts;
        if (ts > m.lastSeen) m.lastSeen = ts;
        macMap.set(l.employee_id, m);
      });

      // PersonRow listesi
      const list: PersonRow[] = [];
      perUser.forEach((macMap, employeeId) => {
        const macs: MacUsage[] = Array.from(macMap.entries())
          .map(([mac, v]) => ({ mac, brand: v.brand, count: v.count, lastSeen: v.lastSeen }))
          .sort((a, b) => b.count - a.count);
        list.push({
          employeeId,
          employeeName: nameMap.get(employeeId) || '—',
          macs,
        });
      });
      list.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'tr'));

      // === Telefon Çakışmaları (kişinin alışılmış cihazından farklı cihaz) ===
      // Önce her kullanıcı için device_info bazında alışılmış cihazı çıkar.
      // Eşik DeviceTrustCard.tsx ile birebir aynı: ≥3 kullanım VE ikincinin
      // en az iki katı (ya da ikinci hiç yoksa).
      const perUserDevice = new Map<string, Map<string, number>>();
      logs.forEach(l => {
        if (!l.device_info) return;
        if (!perUserDevice.has(l.employee_id)) perUserDevice.set(l.employee_id, new Map());
        const c = perUserDevice.get(l.employee_id)!;
        c.set(l.device_info, (c.get(l.device_info) || 0) + 1);
      });
      const dominantDevice = new Map<string, string>();
      perUserDevice.forEach((counts, userId) => {
        const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
        if (sorted[0] && sorted[0][1] >= DOMINANT_MIN_COUNT) {
          const second = sorted[1]?.[1] || 0;
          if (sorted[0][1] >= second * DOMINANCE_RATIO || second === 0) {
            dominantDevice.set(userId, sorted[0][0]);
          }
        }
      });
      // device_info → asıl sahip (bu cihaz dominant olan ilk kullanıcı)
      const deviceOwner = new Map<string, string>();
      dominantDevice.forEach((device, userId) => {
        if (!deviceOwner.has(device)) deviceOwner.set(device, userId);
      });

      // === Owner cross-check indeksleri ===
      // 1) ownerLogsByDate: ownerId → date(YMD) → log listesi (saatli)
      //    Her occurrence için sahibin aynı tarihte/saatte ne yaptığını sorgular.
      // 2) ownLastSeen: employeeId → expectedDevice'tan SON giriş zamanı (ISO).
      const ownerLogsByDate = new Map<string, Map<string, RawLog[]>>();
      const ownLastSeen = new Map<string, string>();
      logs.forEach(l => {
        if (!l.device_info) return;
        // ownLastSeen — sadece kullanıcının kendi dominant cihazı için
        const own = dominantDevice.get(l.employee_id);
        if (own && l.device_info === own) {
          const ts = l.check_in_at || '';
          if (ts) {
            const prev = ownLastSeen.get(l.employee_id) || '';
            if (ts > prev) ownLastSeen.set(l.employee_id, ts);
          }
        }
        // ownerLogsByDate — sadece dominant kullanıcılar için indeks
        if (!dominantDevice.has(l.employee_id)) return;
        const date = (l.check_in_at || l.date || '').slice(0, 10);
        if (!date) return;
        if (!ownerLogsByDate.has(l.employee_id)) ownerLogsByDate.set(l.employee_id, new Map());
        const dayMap = ownerLogsByDate.get(l.employee_id)!;
        if (!dayMap.has(date)) dayMap.set(date, []);
        dayMap.get(date)!.push(l);
      });

      // Verilen occurrence için sahibin aynı saatlerde ne yaptığını döndür.
      // ±30 dk pencere; pencere dışında "absent" — pencere içinde aynı
      // cihazsa 'same', farklı cihazsa 'different'.
      const CROSS_CHECK_WINDOW_MS = 30 * 60 * 1000;
      function computeOwnerActivity(
        ownerId: string,
        ownerDevice: string,
        occurrenceTs: string,
      ): { activity: OwnerActivity; otherDeviceMac?: string } {
        if (!occurrenceTs) return { activity: 'unknown' };
        const date = occurrenceTs.slice(0, 10);
        const target = new Date(occurrenceTs).getTime();
        if (isNaN(target)) return { activity: 'unknown' };
        const dayLogs = ownerLogsByDate.get(ownerId)?.get(date);
        if (!dayLogs || dayLogs.length === 0) return { activity: 'absent' };
        // Pencere içindeki en yakın log
        let closest: RawLog | null = null;
        let closestDelta = Infinity;
        for (const dl of dayLogs) {
          if (!dl.check_in_at) continue;
          const delta = Math.abs(new Date(dl.check_in_at).getTime() - target);
          if (delta <= CROSS_CHECK_WINDOW_MS && delta < closestDelta) {
            closest = dl;
            closestDelta = delta;
          }
        }
        if (!closest) return { activity: 'absent' };
        if (closest.device_info === ownerDevice) {
          return { activity: 'same' };
        }
        return {
          activity: 'different',
          otherDeviceMac: extractMac(closest.device_info || '').toUpperCase() || undefined,
        };
      }

      // device_info → her kullanıcının bu cihazla yaptığı toplam giriş sayısı
      // (her cihaz için "kim kaç kez kullandı" haritasını çıkarmak için).
      const deviceUserCounts = new Map<string, Map<string, number>>();
      logs.forEach(l => {
        if (!l.device_info) return;
        if (!deviceUserCounts.has(l.device_info)) deviceUserCounts.set(l.device_info, new Map());
        const m = deviceUserCounts.get(l.device_info)!;
        m.set(l.employee_id, (m.get(l.employee_id) || 0) + 1);
      });

      // Çakışmaları (employeeId, deviceUsed) çiftine göre grupla.
      // Aynı personelin aynı yabancı cihazla yaptığı tüm girişler tek karta düşer.
      // Cutoff: conflictsSinceTs varsa bu tarihten ÖNCEKİ kayıtlar listelenmez.
      // (Sahip tespiti yine tüm geçmişten yapılır — yukarıdaki dominantDevice.)
      const groupKey = (uid: string, dev: string) => `${uid} ${dev}`;
      const groups = new Map<string, PhoneConflictRow>();
      logs.forEach(l => {
        if (!l.device_info) return;
        const expected = dominantDevice.get(l.employee_id);
        if (!expected || expected === l.device_info) return;
        // Cutoff filtresi — eski kayıtları yok say
        if (conflictsSinceTs) {
          const ts = l.check_in_at || l.date;
          if (!ts || ts < conflictsSinceTs) return;
        }
        // YENİ KURAL: Çakışma sayılması için kullanılan cihazın sistemde başka
        // bir kişinin alışılmış telefonu olarak kayıtlı olması gerekir. Aksi
        // halde kişinin ikinci/yedek telefonu olabilir, alarm üretmiyoruz.
        const ownerOfUsedDevice = deviceOwner.get(l.device_info);
        if (!ownerOfUsedDevice || ownerOfUsedDevice === l.employee_id) return;

        const key = groupKey(l.employee_id, l.device_info);
        let g = groups.get(key);
        if (!g) {
          // Bu cihazı kullanan diğer kişiler — sahibinin kendisi dışındakiler hariç tutulur
          // (kendisi zaten "kullanan" kişi, "kimin telefonu" değil).
          const userCounts = deviceUserCounts.get(l.device_info) || new Map();
          const otherUsers: DeviceUser[] = Array.from(userCounts.entries())
            .filter(([uid]) => uid !== l.employee_id)
            .map(([uid, count]) => ({
              employeeId: uid,
              employeeName: nameMap.get(uid) || '—',
              count,
              isDominant: dominantDevice.get(uid) === l.device_info,
            }))
            .sort((a, b) => {
              if (a.isDominant !== b.isDominant) return a.isDominant ? -1 : 1;
              return b.count - a.count;
            });
          const ownerId = deviceOwner.get(l.device_info) || null;
          g = {
            employeeId: l.employee_id,
            employeeName: nameMap.get(l.employee_id) || '—',
            deviceUsed: l.device_info,
            expectedDevice: expected,
            expectedDeviceLastSeen: ownLastSeen.get(l.employee_id) || '',
            otherUsers,
            dominantOwnerName: ownerId ? (nameMap.get(ownerId) || null) : null,
            dominantOwnerId: ownerId,
            occurrences: [],
            firstSeen: '',
            lastSeen: '',
            ownerCrossCheck: { different: 0, same: 0, absent: 0, unknown: 0 },
          };
          groups.set(key, g);
        }
        const ts = l.check_in_at || l.date;
        // Owner cross-check — sadece sahip dominant ise hesaplanır
        const ownerId = g.dominantOwnerId;
        const ownerDevice = ownerId ? dominantDevice.get(ownerId) : undefined;
        const cross = (ownerId && ownerDevice)
          ? computeOwnerActivity(ownerId, ownerDevice, l.check_in_at || '')
          : { activity: 'unknown' as OwnerActivity };
        g.occurrences.push({
          logId: l.id,
          date: l.date,
          time: (l.start_time || '').slice(0, 5),
          branch: l.branch || '—',
          checkInAt: l.check_in_at,
          ownerActivity: cross.activity,
          ownerOtherDeviceMac: cross.otherDeviceMac,
        });
        g.ownerCrossCheck[cross.activity] += 1;
        if (!g.firstSeen || ts < g.firstSeen) g.firstSeen = ts;
        if (ts > g.lastSeen) g.lastSeen = ts;
      });
      // Her grubun tarihlerini yeni → eski sırala
      groups.forEach(g => {
        g.occurrences.sort((a, b) => (b.checkInAt || b.date).localeCompare(a.checkInAt || a.date));
      });
      const phoneConfList: PhoneConflictRow[] = Array.from(groups.values())
        .sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));

      // Çakışma listesi: sadece 2+ farklı kişinin kullandığı MAC'ler
      const confs: MacConflict[] = [];
      perMac.forEach((userMap, mac) => {
        if (userMap.size < 2) return;
        const users: MacConflictUser[] = Array.from(userMap.entries())
          .map(([uid, v]) => ({
            employeeId: uid,
            employeeName: nameMap.get(uid) || '—',
            count: v.count,
            firstSeen: v.firstSeen,
            lastSeen: v.lastSeen,
          }))
          .sort((a, b) => b.count - a.count);
        const totalCount = users.reduce((s, u) => s + u.count, 0);
        const firstSeen = users.reduce(
          (min, u) => (u.firstSeen && (min === '' || u.firstSeen < min)) ? u.firstSeen : min,
          ''
        );
        const lastSeen = users.reduce((max, u) => u.lastSeen > max ? u.lastSeen : max, '');
        confs.push({ mac, users, totalCount, firstSeen, lastSeen });
      });
      // Çok kişili olanlar üstte, sonra son kullanım yeniliği
      confs.sort((a, b) => {
        if (b.users.length !== a.users.length) return b.users.length - a.users.length;
        return (b.lastSeen || '').localeCompare(a.lastSeen || '');
      });

      setRows(list);
      setConflicts(confs);
      setPhoneConflicts(phoneConfList);
      setScannedCount(logs.length);
      setOldestSeen(oldest);
      setErrors(errorList);
      setLoading(false);
    });

    // Realtime: yeni QR hatası anında "Hatalar" sekmesine düşsün
    const channel = supabase
      .channel('qr_scan_attempts_errors')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'qr_scan_attempts', filter: 'status=eq.error' },
        (payload: any) => {
          const r = payload.new;
          if (!r) return;
          setErrors(prev => {
            // Duplicate guard
            if (prev.some(x => x.id === r.id)) return prev;
            const row: ErrorRow = {
              id: r.id,
              employeeId: r.employee_id,
              employeeName: r.employee_name || '—',
              errorKind: r.error_kind || 'other',
              errorDetail: r.error_detail,
              action: r.action,
              branch: r.branch,
              deviceInfo: r.device_info,
              attemptedAt: r.attempted_at,
            };
            return [row, ...prev].slice(0, 200);
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      try { supabase.removeChannel(channel); } catch { /* ignore */ }
    };
  }, [allowed, conflictsSinceTs]);

  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.employeeName.toLowerCase().includes(q) ||
      r.macs.some(m => m.mac.toLowerCase().includes(q))
    );
  }, [rows, search]);

  const filteredConflicts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conflicts;
    return conflicts.filter(c =>
      c.mac.toLowerCase().includes(q) ||
      c.users.some(u => u.employeeName.toLowerCase().includes(q))
    );
  }, [conflicts, search]);

  const filteredPhoneConflicts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return phoneConflicts;
    return phoneConflicts.filter(c =>
      c.employeeName.toLowerCase().includes(q) ||
      (c.dominantOwnerName || '').toLowerCase().includes(q) ||
      c.deviceUsed.toLowerCase().includes(q) ||
      c.expectedDevice.toLowerCase().includes(q) ||
      c.otherUsers.some(u => u.employeeName.toLowerCase().includes(q)) ||
      c.occurrences.some(o => (o.branch || '').toLowerCase().includes(q))
    );
  }, [phoneConflicts, search]);

  const totalConflicts = phoneConflicts.length + conflicts.length;

  // shiftDateYmd değişince ilgili günü çek
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setShiftsLoading(true);
    fetchShiftsForDate(fromYmd(shiftDateYmd))
      .then(rs => { if (!cancelled) setShiftRows(rs); })
      .catch(err => { if (!cancelled) { console.warn('[Vardiyalar] fetch error:', err); setShiftRows([]); } })
      .finally(() => { if (!cancelled) setShiftsLoading(false); });
    return () => { cancelled = true; };
  }, [shiftDateYmd, allowed]);

  const filteredShifts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return shiftRows;
    return shiftRows.filter(s =>
      s.employeeName.toLowerCase().includes(q) ||
      (s.branch || '').toLowerCase().includes(q) ||
      s.status.toLowerCase().includes(q)
    );
  }, [shiftRows, search]);

  // Özet sayaç
  const shiftSummary = useMemo(() => {
    return {
      total: shiftRows.length,
      complete: shiftRows.filter(s => s.status === 'complete').length,
      active: shiftRows.filter(s => s.status === 'active').length,
      missing: shiftRows.filter(s => s.status === 'no_show').length,
      pending: shiftRows.filter(s => s.status === 'pending').length,
      missingOut: shiftRows.filter(s => s.status === 'missing_out').length,
    };
  }, [shiftRows]);

  // Tarih navigasyon yardımcıları
  const todayYmd = toYmd(new Date());
  const tomorrowYmd = toYmd(addDays(new Date(), 1));
  const yesterdayYmd = toYmd(addDays(new Date(), -1));
  const shiftDate = fromYmd(shiftDateYmd);
  const shiftDateLabel = formatDate(shiftDate.toISOString(), {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });
  const isToday = shiftDateYmd === todayYmd;
  const isTomorrow = shiftDateYmd === tomorrowYmd;
  const isYesterday = shiftDateYmd === yesterdayYmd;

  const filteredErrors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return errors;
    return errors.filter(e =>
      e.employeeName.toLowerCase().includes(q) ||
      e.errorKind.toLowerCase().includes(q) ||
      (e.branch || '').toLowerCase().includes(q)
    );
  }, [errors, search]);

  const copyMac = async (mac: string) => {
    try {
      await navigator.clipboard.writeText(mac);
      setCopiedMac(mac);
      setTimeout(() => setCopiedMac(null), 1500);
    } catch {
      // sessizce yut
    }
  };

  // Yönetici notunu kaydet / sil (boş not → silme). RPC mevcut değilse
  // (migration uygulanmadıysa) hata UI'a yansır, kayıt yapılmaz.
  const saveConflictNote = async (employeeId: string, deviceUsed: string, noteText: string) => {
    const key = `${employeeId}|${deviceUsed}`;
    setSavingNoteKey(key);
    try {
      const { data, error } = await supabase.rpc('dcn_save_note', {
        p_caller_id: currentUser.id,
        p_employee_id: employeeId,
        p_device_used: deviceUsed,
        p_note: noteText,
      });
      if (error) {
        console.warn('[ConflictNote] save failed:', error);
        alert(t('devices.noteSaveFailed') + (error.message ? ` (${error.message})` : ''));
        return;
      }
      // Boş not → kayıt silindi, RPC null döner
      setNotes(prev => {
        const next = new Map(prev);
        if (!data) {
          next.delete(key);
        } else {
          next.set(key, {
            employeeId: data.employee_id,
            deviceUsed: data.device_used,
            note: data.note,
            updatedAt: data.updated_at,
            updatedByName: data.updated_by_name || null,
          });
        }
        return next;
      });
      setEditingNoteKey(null);
      setEditingNoteDraft('');
    } finally {
      setSavingNoteKey(null);
    }
  };

  const totalMacs = rows.reduce((s, r) => s + r.macs.length, 0);

  if (!allowed) {
    return (
      <div className="h-full w-full overflow-y-auto custom-scrollbar p-4 md:p-8 pb-32">
        <div className="max-w-3xl mx-auto bg-white dark:bg-zinc-900/50 border border-red-900/30 rounded-xl p-8 text-center">
          <ShieldAlert size={32} className="text-red-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">{t('devices.deniedTitle')}</h2>
          <p className="text-sm text-slate-600 dark:text-zinc-400">{t('devices.deniedDesc')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar p-4 md:p-8 pb-32">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Smartphone size={26} className="text-cyan-400" />
            {t('devices.title')}
          </h2>
          {!loading && (
            <div className="text-[12px] text-slate-500 dark:text-zinc-500 tabular-nums">
              {rows.length} {t('devices.statUsers').toLowerCase()} · {totalMacs} MAC · {scannedCount.toLocaleString('tr')} {t('devices.recordsScanned')}
              {oldestSeen && (
                <span className="ml-1">
                  ({t('devices.sinceLabel')} {formatDate(oldestSeen, { day: '2-digit', month: 'short', year: 'numeric' })})
                </span>
              )}
            </div>
          )}
        </div>

        {/* Sekme seçimi: Kişiler / Çakışmalar / Okutmayanlar / Hatalar */}
        <div className="mt-4 inline-flex flex-wrap gap-1 bg-white dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 rounded-lg p-1">
          <button
            onClick={() => setTab('people')}
            className={`px-3 py-1.5 text-xs md:text-sm font-medium rounded-md transition-all inline-flex items-center gap-2 ${
              tab === 'people'
                ? 'bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-white shadow'
                : 'text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:text-zinc-300'
            }`}
          >
            <UserIcon size={14} />
            {t('devices.tabPeople')}
            <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-slate-50 dark:bg-zinc-950/60 text-slate-600 dark:text-zinc-400">
              {rows.length}
            </span>
          </button>
          <button
            onClick={() => setTab('conflicts')}
            className={`px-3 py-1.5 text-xs md:text-sm font-medium rounded-md transition-all inline-flex items-center gap-2 ${
              tab === 'conflicts'
                ? 'bg-red-950/60 text-red-200 shadow border border-red-900/40'
                : 'text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:text-zinc-300'
            }`}
          >
            <AlertTriangle size={14} />
            {t('devices.tabConflicts')}
            <span className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded ${
              totalConflicts > 0
                ? 'bg-red-900/50 text-red-200'
                : 'bg-slate-50 dark:bg-zinc-950/60 text-slate-600 dark:text-zinc-400'
            }`}>
              {totalConflicts}
            </span>
          </button>
          <button
            onClick={() => setTab('shifts')}
            className={`px-3 py-1.5 text-xs md:text-sm font-medium rounded-md transition-all inline-flex items-center gap-2 ${
              tab === 'shifts'
                ? 'bg-indigo-950/60 text-indigo-200 shadow border border-indigo-900/40'
                : 'text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:text-zinc-300'
            }`}
          >
            <CalendarDays size={14} />
            {t('devices.tabShifts')}
            <span className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded ${
              shiftRows.length > 0
                ? 'bg-indigo-900/50 text-indigo-200'
                : 'bg-slate-50 dark:bg-zinc-950/60 text-slate-600 dark:text-zinc-400'
            }`}>
              {shiftRows.length}
            </span>
          </button>
          <button
            onClick={() => setTab('errors')}
            className={`px-3 py-1.5 text-xs md:text-sm font-medium rounded-md transition-all inline-flex items-center gap-2 ${
              tab === 'errors'
                ? 'bg-red-950/60 text-red-200 shadow border border-red-900/40'
                : 'text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:text-zinc-300'
            }`}
          >
            <XCircle size={14} />
            {t('devices.tabErrors')}
            <span className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded ${
              errors.length > 0
                ? 'bg-red-900/50 text-red-200'
                : 'bg-slate-50 dark:bg-zinc-950/60 text-slate-600 dark:text-zinc-400'
            }`}>
              {errors.length}
            </span>
          </button>
        </div>

        {/* Vardiyalar — tarih navigasyonu + özet rozet */}
        {tab === 'shifts' && (
          <div className="mt-3 space-y-2.5">
            {/* Tarih navigatörü */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setShiftDateYmd(toYmd(addDays(shiftDate, -1)))}
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-white dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 transition-colors"
                title={t('devices.shiftDatePrev')}
                aria-label={t('devices.shiftDatePrev')}
              >‹</button>

              {/* Tarih input — native picker. Native widget'ı kapatıp özel etiketi overlay olarak gösteriyoruz. */}
              <div className="relative inline-flex items-center">
                <input
                  type="date"
                  value={shiftDateYmd}
                  onChange={(e) => e.target.value && setShiftDateYmd(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  aria-label={t('devices.shiftDatePick')}
                />
                <span className="pointer-events-none inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 hover:border-cyan-600/40 transition-colors">
                  <CalendarIcon size={14} className="text-cyan-500 dark:text-cyan-400" />
                  <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 whitespace-nowrap">
                    {shiftDateLabel}
                  </span>
                </span>
              </div>

              <button
                onClick={() => setShiftDateYmd(toYmd(addDays(shiftDate, 1)))}
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-white dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 transition-colors"
                title={t('devices.shiftDateNext')}
                aria-label={t('devices.shiftDateNext')}
              >›</button>

              {/* Hızlı butonlar */}
              <div className="inline-flex bg-white dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 rounded-lg p-0.5">
                <button
                  onClick={() => setShiftDateYmd(yesterdayYmd)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                    isYesterday
                      ? 'bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-white shadow'
                      : 'text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:text-zinc-300'
                  }`}
                >{t('devices.dateYesterday')}</button>
                <button
                  onClick={() => setShiftDateYmd(todayYmd)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                    isToday
                      ? 'bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-white shadow'
                      : 'text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:text-zinc-300'
                  }`}
                >{t('devices.dateToday')}</button>
                <button
                  onClick={() => setShiftDateYmd(tomorrowYmd)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                    isTomorrow
                      ? 'bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-white shadow'
                      : 'text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:text-zinc-300'
                  }`}
                >{t('devices.dateTomorrow')}</button>
              </div>

              {!isToday && (
                <button
                  onClick={() => setShiftDateYmd(todayYmd)}
                  className="text-[11px] text-indigo-500 dark:text-indigo-400 hover:underline"
                >
                  {t('devices.backToToday')}
                </button>
              )}
            </div>

            {/* Özet sayaçlar */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-500 dark:text-zinc-500 mr-1">
                {shiftSummary.total} {t('devices.shiftCount')}:
              </span>
              {shiftSummary.complete > 0 && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_META.complete.tone}`}>
                  {STATUS_META.complete.emoji} {shiftSummary.complete} {t('shiftStatus.complete')}
                </span>
              )}
              {shiftSummary.active > 0 && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_META.active.tone}`}>
                  {STATUS_META.active.emoji} {shiftSummary.active} {t('shiftStatus.active')}
                </span>
              )}
              {shiftSummary.missing > 0 && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_META.no_show.tone}`}>
                  {STATUS_META.no_show.emoji} {shiftSummary.missing} {t('shiftStatus.noShow')}
                </span>
              )}
              {shiftSummary.missingOut > 0 && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_META.missing_out.tone}`}>
                  {STATUS_META.missing_out.emoji} {shiftSummary.missingOut} {t('shiftStatus.missingOut')}
                </span>
              )}
              {shiftSummary.pending > 0 && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_META.pending.tone}`}>
                  {STATUS_META.pending.emoji} {shiftSummary.pending} {t('shiftStatus.pending')}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('devices.searchSimple')}
            className="w-full bg-white dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 dark:text-white focus:border-cyan-600/60 outline-none transition-all placeholder:text-slate-400 dark:text-zinc-600"
          />
        </div>

        <div className="mt-6 space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 text-slate-500 dark:text-zinc-500 text-sm py-8 justify-center">
              <Loader2 size={16} className="animate-spin" /> {t('common.loading')}
            </div>
          ) : tab === 'shifts' ? (
            shiftsLoading ? (
              <div className="flex items-center gap-2 text-slate-500 dark:text-zinc-500 text-sm py-8 justify-center">
                <Loader2 size={16} className="animate-spin" /> {t('common.loading')}
              </div>
            ) : filteredShifts.length === 0 ? (
              <div className="p-6 bg-white dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-xl text-center text-sm text-slate-500 dark:text-zinc-500 italic">
                {t('devices.shiftsEmptyForDate')}
              </div>
            ) : (
              <>
                <div className="text-[11px] text-slate-500 dark:text-zinc-500 px-1 pb-1">
                  {isToday ? t('devices.shiftsHintToday') : isYesterday ? t('devices.shiftsHintYesterday') : isTomorrow ? t('devices.shiftsHintTomorrow') : t('devices.shiftsHintGeneric')}
                </div>
                {filteredShifts.map((s, idx) => {
                  const meta = STATUS_META[s.status];
                  // Berlin yerel — admin başka TZ'den baksa bile plan saatleri
                  // ile check-in/out tutarlı görünür.
                  const fmtTime = fmtBerlinHm;
                  return (
                    <div
                      key={`${s.employeeId}-${idx}`}
                      className="flex items-center gap-3 bg-white dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-xl px-3 py-2.5"
                    >
                      <div className="w-9 h-9 rounded-full bg-indigo-900/40 border border-indigo-700/40 flex items-center justify-center shrink-0">
                        <UserIcon size={14} className="text-indigo-300" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white truncate flex items-center gap-2">
                          {s.employeeName}
                          {s.spansMidnight && (
                            <span className="text-[9px] uppercase tracking-wider bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded border border-violet-200 dark:border-violet-700/40">
                              {t('devices.nightShift')}
                            </span>
                          )}
                          {s.hasError && (
                            <span className="text-[9px] uppercase tracking-wider bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded border border-red-200 dark:border-red-700/40 inline-flex items-center gap-0.5" title={s.errorKind || ''}>
                              <AlertTriangle size={9} /> {t('devices.errorBadge')}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-zinc-500 flex items-center gap-2 flex-wrap">
                          {s.branch && <span className="truncate">{s.branch}</span>}
                          {s.branch && <span className="opacity-40">·</span>}
                          <span className="font-mono">{s.startTime}–{s.endTime}</span>
                          {s.checkInAt && (
                            <>
                              <span className="opacity-40">·</span>
                              <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                                <LogIn size={10} /> {fmtTime(s.checkInAt)}
                              </span>
                            </>
                          )}
                          {s.checkOutAt && (
                            <span className="inline-flex items-center gap-0.5 text-orange-600 dark:text-orange-400">
                              <LogOut size={10} /> {fmtTime(s.checkOutAt)}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full border shrink-0 inline-flex items-center gap-1 ${meta.tone}`}>
                        <span aria-hidden="true">{meta.emoji}</span>
                        {t(meta.tKey)}
                      </span>
                    </div>
                  );
                })}
              </>
            )
          ) : tab === 'errors' ? (
            filteredErrors.length === 0 ? (
              <div className="p-6 bg-white dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-xl text-center text-sm text-emerald-600 dark:text-emerald-400 italic">
                {t('devices.errorsEmpty')}
              </div>
            ) : filteredErrors.map(e => {
              const meta = ERROR_META[e.errorKind] || ERROR_META.other;
              const Icon = meta.icon;
              return (
                <div
                  key={e.id}
                  className="bg-red-950/15 border border-red-900/40 rounded-xl p-3 md:p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${meta.color}`}>
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">{e.employeeName}</span>
                        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border font-mono ${meta.color}`}>
                          {t(`qr.err.${e.errorKind}`)}
                        </span>
                        {e.action && (
                          <span className="text-[10px] uppercase tracking-wider bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 px-2 py-0.5 rounded border border-slate-200 dark:border-zinc-700">
                            {e.action === 'in' ? t('qr.actionIn') : t('qr.actionOut')}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-zinc-500 flex items-center gap-2 flex-wrap">
                        {e.branch && <span>{e.branch}</span>}
                        {e.branch && <span>·</span>}
                        <span>{formatDate(e.attemptedAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        {e.deviceInfo && <><span>·</span><span className="font-mono truncate max-w-[200px]">{e.deviceInfo}</span></>}
                      </div>
                      {e.errorDetail && (
                        <pre className="mt-2 text-[10px] font-mono text-slate-600 dark:text-zinc-500 bg-slate-50 dark:bg-zinc-950/60 border border-slate-200 dark:border-zinc-800/60 rounded p-2 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
{e.errorDetail}
                        </pre>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : tab === 'people' ? (
            filteredPeople.length === 0 ? (
              <div className="p-6 bg-white dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-xl text-center text-sm text-slate-500 dark:text-zinc-500 italic">
                {t('devices.empty')}
              </div>
            ) : filteredPeople.map(r => (
              <div
                key={r.employeeId}
                className="bg-white dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-xl p-3 md:p-4"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-full bg-indigo-900/40 border border-indigo-700/40 flex items-center justify-center shrink-0">
                    <UserIcon size={14} className="text-indigo-300" />
                  </div>
                  <div className="text-sm md:text-base font-semibold text-slate-900 dark:text-white truncate">
                    {r.employeeName}
                  </div>
                  <div className="ml-auto text-[11px] text-slate-500 dark:text-zinc-500 tabular-nums shrink-0">
                    {r.macs.length} MAC
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.macs.map(({ mac, brand }) => (
                    <button
                      key={mac}
                      onClick={() => copyMac(mac)}
                      className="group inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 hover:border-cyan-700/60 transition-colors"
                      title={t('devices.copyMac')}
                    >
                      {brand && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-700 dark:text-cyan-300 pr-1.5 mr-0.5 border-r border-slate-200 dark:border-zinc-800">
                          <Smartphone size={10} className="text-cyan-500 dark:text-cyan-400" />
                          {brand}
                        </span>
                      )}
                      <span className="text-[12px] font-mono text-slate-800 dark:text-zinc-200 tabular-nums">{mac}</span>
                      {copiedMac === mac
                        ? <Check size={12} className="text-emerald-400" />
                        : <Copy size={12} className="text-slate-500 dark:text-zinc-500 group-hover:text-cyan-400" />}
                    </button>
                  ))}
                </div>
              </div>
            ))
          ) : (
            // Çakışma sekmesi — önce telefon çakışmaları (detaylı), sonra MAC çakışmaları
            (filteredPhoneConflicts.length === 0 && filteredConflicts.length === 0) ? (
              <div className="p-6 bg-white dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-xl text-center text-sm text-slate-500 dark:text-zinc-500 italic">
                {t('devices.conflictsEmpty')}
              </div>
            ) : (
              <>
                {/* TELEFON ÇAKIŞMALARI — alışılmış cihazından farklı telefonla QR mesai açma */}
                {filteredPhoneConflicts.length > 0 && (
                  <section className="bg-white dark:bg-zinc-900/40 border border-red-900/30 rounded-2xl p-3 md:p-4 mb-3">
                    <header className="flex items-start gap-2 mb-3">
                      <ShieldAlert size={18} className="text-red-500 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm md:text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                          {t('set.phoneConflictsTitle')}
                          <span className="text-[10px] uppercase tracking-wider bg-red-900/40 text-red-300 px-2 py-0.5 rounded-full border border-red-800/60 tabular-nums">
                            {filteredPhoneConflicts.length}
                          </span>
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-zinc-500 mt-0.5">
                          {t('set.phoneConflictsDesc')}
                        </p>

                        {/* DİSCLAIMER — haksız suçlamayı önlemek için */}
                        <div className="mt-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-700 dark:text-amber-200 flex items-start gap-2">
                          <Info size={13} className="text-amber-500 dark:text-amber-300 shrink-0 mt-0.5" />
                          <div className="leading-relaxed">
                            <strong>{t('devices.disclaimerTitle')}</strong>{' '}
                            {t('devices.disclaimerBody')}
                          </div>
                        </div>

                        {/* Cutoff kontrol satırı — geçmişi yok say / tümünü göster */}
                        <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
                          {conflictsSinceTs ? (
                            <>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-900/30 border border-emerald-800/50 text-emerald-200">
                                <Clock size={10} />
                                Sadece <strong>{formatDate(conflictsSinceTs, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong> sonrası gösteriliyor
                              </span>
                              <button
                                onClick={() => updateConflictsSince(null)}
                                className="px-2 py-0.5 rounded border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
                                title="Tüm geçmiş çakışmaları yeniden göster"
                              >
                                Tüm geçmişi göster
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="text-slate-500 dark:text-zinc-500">Tüm geçmiş kayıtlar dahil.</span>
                              <button
                                onClick={startFromTodayMidnight}
                                className="px-2 py-0.5 rounded border border-red-700/50 bg-red-900/20 text-red-200 hover:bg-red-900/40 transition-colors"
                                title="Bugünden önceki tüm çakışmaları listeden çıkarır (kayıtlar silinmez)"
                              >
                                Bugünden başlat
                              </button>
                              <button
                                onClick={startFromNow}
                                className="px-2 py-0.5 rounded border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
                                title="Şu andan itibaren oluşacak çakışmaları gösterir"
                              >
                                Şu andan başlat
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </header>

                    <ul className="space-y-2">
                      {filteredPhoneConflicts.map(c => {
                        const ownerLabel = c.dominantOwnerName || 'sahibi belirsiz';
                        const otherUsersExceptOwner = c.otherUsers.filter(u => !u.isDominant);
                        return (
                        <li key={`${c.employeeId}-${c.deviceUsed}`} className="p-4 rounded-xl bg-red-900/10 border border-red-900/40">
                          {/* ÜST: net cümle — X, Y'nin telefonunu kullandı */}
                          <div className="flex items-start gap-3 mb-3 pb-3 border-b border-red-900/30">
                            <AlertTriangle size={20} className="text-red-400 shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-2 flex-wrap">
                                <span className="text-base md:text-lg font-bold text-slate-900 dark:text-white">{c.employeeName}</span>
                                <span className="text-slate-500 dark:text-zinc-500">→</span>
                                <span className={`text-base md:text-lg font-bold ${c.dominantOwnerName ? 'text-amber-300' : 'text-slate-500 dark:text-zinc-500 italic'}`}>
                                  {ownerLabel}
                                </span>
                                <span className="text-sm text-slate-600 dark:text-zinc-400">
                                  adlı kişinin telefonunu <strong className="text-red-300">{c.occurrences.length}</strong> kez kullandı
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-zinc-500 mt-1 flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] uppercase tracking-wider bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 px-1.5 py-0.5 rounded border border-slate-200 dark:border-zinc-700">QR</span>
                                <span>İlk: <strong>{c.firstSeen && formatDate(c.firstSeen, { day: '2-digit', month: 'short', year: 'numeric' })}</strong></span>
                                <span>·</span>
                                <span>Son: <strong>{c.lastSeen && formatDate(c.lastSeen, { day: '2-digit', month: 'short', year: 'numeric' })}</strong></span>
                              </div>
                            </div>
                          </div>

                          {/* İKİ SÜTUN: kullandığı telefon vs olması gereken */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 text-xs">
                            <div className="p-2.5 rounded-lg bg-red-950/30 border border-red-700/40">
                              <div className="text-[10px] uppercase tracking-wider text-red-300 mb-1 flex items-center gap-1">
                                <Smartphone size={11} />
                                <strong>{c.employeeName}</strong>’in kullandığı telefon
                              </div>
                              <div className="text-slate-900 dark:text-white font-mono break-all text-[12px]">{c.deviceUsed}</div>
                              {c.dominantOwnerName && (
                                <div className="text-[11px] mt-1.5 text-amber-200 inline-flex items-center gap-1">
                                  <UserIcon size={10} className="text-amber-300" />
                                  Bu telefonun sahibi: <strong>{c.dominantOwnerName}</strong>
                                </div>
                              )}
                            </div>
                            <div className="p-2.5 rounded-lg bg-emerald-900/10 border border-emerald-800/40">
                              <div className="text-[10px] uppercase tracking-wider text-emerald-300 mb-1 flex items-center gap-1">
                                <Smartphone size={11} />
                                <strong>{c.employeeName}</strong>’in kendi telefonu (olması gereken)
                              </div>
                              <div className="text-slate-700 dark:text-zinc-200 font-mono break-all text-[12px]">{c.expectedDevice}</div>
                              {/* Kendi cihazından son giriş — mazeret değerlendirmesi için */}
                              {c.expectedDeviceLastSeen ? (
                                <div className="text-[11px] mt-1.5 text-emerald-600 dark:text-emerald-300 inline-flex items-center gap-1">
                                  <LogIn size={10} />
                                  {t('devices.ownLastSeen')}: <strong>{formatDate(c.expectedDeviceLastSeen, { day: '2-digit', month: 'short', year: 'numeric' })}</strong>
                                </div>
                              ) : (
                                <div className="text-[11px] mt-1.5 text-slate-500 dark:text-zinc-500 italic inline-flex items-center gap-1">
                                  <LogIn size={10} />
                                  {t('devices.ownLastSeenNever')}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* TARİH LİSTESİ — açıklayıcı başlıkla */}
                          <div className="mt-3">
                            <div className="text-[11px] text-slate-600 dark:text-zinc-400 mb-2 flex items-center gap-1.5">
                              <CalendarIcon size={12} className="text-red-400" />
                              <strong className="text-slate-700 dark:text-zinc-200">{c.employeeName}</strong>,
                              <strong className="text-amber-300">{ownerLabel}</strong>’in telefonunu şu zamanlarda kullandı:
                            </div>
                            <ul className="space-y-1 text-[11px] max-h-64 overflow-y-auto custom-scrollbar pr-1">
                              {c.occurrences.map(o => {
                                const dow = formatDate(o.date, { weekday: 'short' });
                                // Owner cross-check rozeti — bu girişin saatinde sahip neredeydi?
                                const xMeta: Record<OwnerActivity, { tone: string; label: string; icon: typeof Flag; title: string } | null> = {
                                  different: {
                                    tone: 'bg-red-900/40 border-red-700/60 text-red-200',
                                    label: t('devices.crossDifferent'),
                                    icon: Flag,
                                    title: interpolate(t('devices.crossDifferentTitle'), { owner: c.dominantOwnerName || '—', mac: o.ownerOtherDeviceMac || '—' }),
                                  },
                                  same: {
                                    tone: 'bg-amber-900/30 border-amber-700/50 text-amber-200',
                                    label: t('devices.crossSame'),
                                    icon: UserIcon,
                                    title: interpolate(t('devices.crossSameTitle'), { owner: c.dominantOwnerName || '—' }),
                                  },
                                  absent: {
                                    tone: 'bg-slate-800/40 border-slate-700/40 text-slate-300',
                                    label: t('devices.crossAbsent'),
                                    icon: UserX,
                                    title: interpolate(t('devices.crossAbsentTitle'), { owner: c.dominantOwnerName || '—' }),
                                  },
                                  unknown: null,
                                };
                                const x = xMeta[o.ownerActivity];
                                return (
                                  <li
                                    key={o.logId}
                                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white dark:bg-zinc-950/60 border border-red-900/30 hover:border-red-700/50 transition-colors flex-wrap"
                                  >
                                    <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-zinc-200 font-medium min-w-[110px]">
                                      <CalendarIcon size={11} className="text-red-400 shrink-0" />
                                      {formatDate(o.date, { day: '2-digit', month: 'short', year: 'numeric' })}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                                      {dow}
                                    </span>
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-900/20 border border-red-900/40 text-red-200 font-mono tabular-nums">
                                      <Clock size={10} />
                                      {o.time || '—:—'}
                                    </span>
                                    {x && (
                                      <span
                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${x.tone}`}
                                        title={x.title}
                                      >
                                        <x.icon size={10} />
                                        {x.label}
                                      </span>
                                    )}
                                    {o.branch && o.branch !== '—' && (
                                      <span className="inline-flex items-center gap-1 text-slate-500 dark:text-zinc-400 ml-auto">
                                        <MapPin size={10} className="shrink-0" />
                                        <span className="truncate max-w-[140px]">{o.branch}</span>
                                      </span>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>

                          {/* DİĞER KULLANANLAR — küçük dipnot */}
                          {otherUsersExceptOwner.length > 0 && (
                            <div className="mt-3 pt-2 border-t border-red-900/20 text-[11px] text-slate-500 dark:text-zinc-500">
                              <span className="text-[10px] uppercase tracking-wider mr-1">Aynı telefonu kullanan diğer kişiler:</span>
                              {otherUsersExceptOwner.map((u, i) => (
                                <span key={u.employeeId}>
                                  {i > 0 && ', '}
                                  <span className="text-slate-700 dark:text-zinc-300">{u.employeeName}</span>
                                  <span className="text-slate-500 dark:text-zinc-500"> ({u.count}×)</span>
                                </span>
                              ))}
                            </div>
                          )}

                          {/* ÇAPRAZ KONTROL ÖZETİ — sahibinin aynı saatlerde nerede olduğu dağılımı */}
                          {c.dominantOwnerName && (c.ownerCrossCheck.different + c.ownerCrossCheck.same + c.ownerCrossCheck.absent) > 0 && (
                            <div className="mt-3 pt-2 border-t border-red-900/20">
                              <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-zinc-500 mb-1.5 flex items-center gap-1">
                                <Flag size={11} className="text-red-400" />
                                {interpolate(t('devices.crossCheckSummary'), { owner: c.dominantOwnerName || '—' })}
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                                {c.ownerCrossCheck.different > 0 && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-red-900/40 border-red-700/60 text-red-200" title={t('devices.crossDifferentDesc')}>
                                    <Flag size={10} /> {c.ownerCrossCheck.different}× {t('devices.crossDifferent')}
                                  </span>
                                )}
                                {c.ownerCrossCheck.same > 0 && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-amber-900/30 border-amber-700/50 text-amber-200" title={t('devices.crossSameDesc')}>
                                    <UserIcon size={10} /> {c.ownerCrossCheck.same}× {t('devices.crossSame')}
                                  </span>
                                )}
                                {c.ownerCrossCheck.absent > 0 && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-slate-800/40 border-slate-700/40 text-slate-300" title={t('devices.crossAbsentDesc')}>
                                    <UserX size={10} /> {c.ownerCrossCheck.absent}× {t('devices.crossAbsent')}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* YÖNETİCİ NOTU — açıklama eklenir, kayıt silinmez */}
                          {(() => {
                            const noteKey = `${c.employeeId}|${c.deviceUsed}`;
                            const existing = notes.get(noteKey);
                            const isEditing = editingNoteKey === noteKey;
                            const isSaving = savingNoteKey === noteKey;
                            return (
                              <div className="mt-3 pt-3 border-t border-red-900/20">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  <StickyNote size={12} className="text-amber-400" />
                                  <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-zinc-500">
                                    {t('devices.adminNote')}
                                  </span>
                                  {existing && !isEditing && (
                                    <span className="text-[10px] text-slate-500 dark:text-zinc-500 ml-auto">
                                      {existing.updatedByName ? `${existing.updatedByName} · ` : ''}
                                      {formatDate(existing.updatedAt, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  )}
                                </div>
                                {isEditing ? (
                                  <div className="space-y-1.5">
                                    <textarea
                                      value={editingNoteDraft}
                                      onChange={(e) => setEditingNoteDraft(e.target.value)}
                                      placeholder={t('devices.adminNotePlaceholder')}
                                      rows={2}
                                      className="w-full bg-white dark:bg-zinc-950/60 border border-amber-700/40 rounded-lg px-2.5 py-1.5 text-[12px] text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:border-amber-500/70 outline-none resize-y"
                                      autoFocus
                                    />
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        disabled={isSaving}
                                        onClick={() => saveConflictNote(c.employeeId, c.deviceUsed, editingNoteDraft)}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[11px] bg-emerald-900/30 border-emerald-700/50 text-emerald-200 hover:bg-emerald-900/50 transition-colors disabled:opacity-50"
                                      >
                                        {isSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                                        {t('common.save')}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isSaving}
                                        onClick={() => { setEditingNoteKey(null); setEditingNoteDraft(''); }}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[11px] bg-slate-100 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
                                      >
                                        {t('common.cancel')}
                                      </button>
                                      {existing && (
                                        <button
                                          type="button"
                                          disabled={isSaving}
                                          onClick={() => saveConflictNote(c.employeeId, c.deviceUsed, '')}
                                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[11px] bg-red-900/20 border-red-800/40 text-red-300 hover:bg-red-900/40 transition-colors disabled:opacity-50 ml-auto"
                                          title={t('devices.noteDelete')}
                                        >
                                          <Trash2 size={11} />
                                          {t('devices.noteDelete')}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ) : existing ? (
                                  <button
                                    type="button"
                                    onClick={() => { setEditingNoteKey(noteKey); setEditingNoteDraft(existing.note); }}
                                    className="w-full text-left px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 hover:border-amber-500/50 transition-colors text-[12px] text-slate-700 dark:text-zinc-200 whitespace-pre-wrap"
                                  >
                                    {existing.note}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => { setEditingNoteKey(noteKey); setEditingNoteDraft(''); }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[11px] bg-slate-50 dark:bg-zinc-900/60 border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 hover:border-amber-500/50 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
                                  >
                                    <StickyNote size={11} />
                                    {t('devices.adminNoteAdd')}
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                        </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {/* MAC ÇAKIŞMALARI — aynı MAC iki ya da daha fazla kullanıcıda */}
                {filteredConflicts.length > 0 && (
                  <section className="space-y-2">
                    <header className="flex items-center gap-2 px-1">
                      <AlertTriangle size={14} className="text-red-400" />
                      <h3 className="text-xs uppercase tracking-wider font-semibold text-slate-600 dark:text-zinc-400">
                        {t('devices.tabConflicts')} · MAC
                      </h3>
                      <span className="text-[10px] tabular-nums bg-red-900/40 text-red-200 px-1.5 py-0.5 rounded">
                        {filteredConflicts.length}
                      </span>
                    </header>
                    {filteredConflicts.map(c => (
                      <div
                        key={c.mac}
                        className="bg-red-950/20 border border-red-900/40 rounded-xl p-3 md:p-4"
                      >
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <button
                    onClick={() => copyMac(c.mac)}
                    className="group inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-50 dark:bg-zinc-950 border border-red-900/50 hover:border-red-700 transition-colors"
                    title={t('devices.copyMac')}
                  >
                    <span className="text-[10px] uppercase tracking-wider text-red-400">MAC</span>
                    <span className="text-[12px] md:text-[13px] font-mono text-red-100 tabular-nums">{c.mac}</span>
                    {copiedMac === c.mac
                      ? <Check size={12} className="text-emerald-400" />
                      : <Copy size={12} className="text-slate-500 dark:text-zinc-500 group-hover:text-red-300" />}
                  </button>
                  <span className="text-[11px] uppercase tracking-wider bg-red-900/40 text-red-200 px-2 py-0.5 rounded border border-red-800/60 inline-flex items-center gap-1">
                    <AlertTriangle size={10} /> {c.users.length} {t('devices.peopleShort')}
                  </span>
                  <div className="ml-auto text-[11px] text-slate-500 dark:text-zinc-500">
                    {c.totalCount} {t('devices.useShort')}
                  </div>
                </div>
                {(c.firstSeen || c.lastSeen) && (
                  <div className="text-[11px] text-slate-500 dark:text-zinc-500 mb-3">
                    {c.firstSeen ? formatDate(c.firstSeen, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    <span className="mx-1.5">→</span>
                    {c.lastSeen ? formatDate(c.lastSeen, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                  </div>
                )}
                <ul className="space-y-1">
                  {c.users.map(u => (
                    <li
                      key={u.employeeId}
                      className="flex items-center justify-between gap-3 px-2 py-1.5 rounded bg-slate-50 dark:bg-zinc-950/40 border border-slate-200 dark:border-zinc-800/60"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <UserIcon size={12} className="text-indigo-300 shrink-0" />
                        <span className="text-sm text-slate-900 dark:text-white truncate">{u.employeeName}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-[11px]">
                        <span className="text-slate-500 dark:text-zinc-500 hidden sm:inline">
                          {u.firstSeen ? formatDate(u.firstSeen, { day: '2-digit', month: 'short' }) : '—'}
                          <span className="mx-1">→</span>
                          {u.lastSeen ? formatDate(u.lastSeen, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                        </span>
                        <span className="text-slate-500 dark:text-zinc-500 sm:hidden">
                          {u.lastSeen ? formatDate(u.lastSeen, { day: '2-digit', month: 'short' }) : '—'}
                        </span>
                        <span className="text-slate-900 dark:text-white font-bold tabular-nums w-8 text-right">{u.count}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
                    ))}
                  </section>
                )}
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
};

export default DeviceBrands;
