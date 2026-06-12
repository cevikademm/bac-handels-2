import { Branch, Employee, Role, Task, Message, TimeLog } from './types';

// Bildirim Sesi (Kısa 'ding' sesi) - Geçerli MP3 Base64 formatı
export const NOTIFICATION_SOUND = "data:audio/mpeg;base64,//uQZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIwAHCwsVFRkZISwsMTExPT0/P0tLV1dZZWVsbG11dYKCjIySkpucnKioq7y8wsLKytaoqc7O1NTd3d/f5OTs7O7y8v////8AAAAATGF2YzU5LjM3AAAAAAAAAAAAAAAAJAAAAAAAAAAAASCCIQ8AAAAAAAEjvU+C8QAAAAAAAAAAAAAAAAAAAAAAAAAA//uQZAAAAAAAABAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/7kGQAAAAAAAABAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/+5BkAAAAAAAAEAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/7kGQAAAAAAAABAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8AAf4AAH+AA//uQZAAP8AAAf4AAAAgAAAABAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAL/gA/wAAf4AD/+5BkAA/wAAB/gAAACAAAAAEAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAv+AD/AAB/gAP/7kGQAD/AAAH+AAAAIAAAAAQAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC/4AP8AAH+AA//uQZAAP8AAAf4AAAAgAAAABAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAL/gA/wAAf4AD/+5BkAA/wAAB/gAAACAAAAAEAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAv+AD/AAB/gAP/7kGQAD/AAAH+AAAAIAAAAAQAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC/4AP8AAH+AA//uQZAAP8AAAf4AAAAgAAAABAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAL/gA/wAAf4AD/+5BkAA/wAAB/gAAACAAAAAEAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAv+AD/AAB/gAP/7kGQAD/AAAH+AAAAIAAAAAQAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC/4AP8AAH+AA//uQZAAP8AAAf4AAAAgAAAABAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAL/gA/wAAf4AD/+5BkAA/wAAB/gAAACAAAAAEAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAv+AD/AAB/gAP/7kGQAD/AAAH+AAAAIAAAAAQAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC/4AP8AAH+AA//uQZAAP8AAAf4AAAAgAAAABAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAL/gA/wAAf4AD/+5BkAA/wAAB/gAAACAAAAAEAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAv+AD/AAB/gAP/7kGQAD/AAAH+AAAAIAAAAAQAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC/4AP8AAH+AA//uQZAAP8AAAf4AAAAgAAAABAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAL/gA/wAAf4AD/+5BkAA/wAAB/gAAACAAAAAEAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAv+AD/AAB/gAP/7kGQAD/AAAH+AAAAIAAAAAQAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC/4AP8AAH+AA";

// Çift rollü adminler: Hem admin yetkisine sahip hem de personel listelerinde
// (görev ataması, vardiya, takvim, bordro) görünmesi gereken kullanıcılar.
// Ad eşleşmesi küçük/büyük harf duyarsız ve "içerir" mantığıyla yapılır.
export const DUAL_ROLE_ADMIN_NAMES: string[] = ['Apo', 'Malik'];

export const isDualRoleAdmin = (emp: { name?: string | null; role?: Role | string | null } | null | undefined): boolean => {
    if (!emp || !emp.name) return false;
    if (emp.role !== Role.ADMIN && emp.role !== 'Admin') return false;
    const lower = emp.name.toLowerCase();
    return DUAL_ROLE_ADMIN_NAMES.some(n => lower.includes(n.toLowerCase()));
};

// Profil satırı (DB'den gelen snake_case veya mapped Employee) için personel filtresi.
// Admin değilse içeride kalır; admin ise sadece dual-role olanlar kalır.
export const includeAsPersonnel = (profile: any): boolean => {
    const role = profile?.role;
    const name = profile?.name ?? profile?.full_name;
    if (role !== Role.ADMIN && role !== 'Admin') return true;
    return isDualRoleAdmin({ name, role });
};

// "Kısıtlanmış admin": Admin yetkisi var ama personel listesinde sadece
// kendi verilerini görür (Apo, Malik gibi şube sorumluları).
// isDualRoleAdmin ile aynı listeyi paylaşır — Dual-role olanlar otomatik kısıtlıdır.
export const isRestrictedAdmin = (user: { name?: string | null; email?: string | null; role?: Role | string | null } | null | undefined): boolean => {
    if (!user) return false;
    if (user.role !== Role.ADMIN && user.role !== 'Admin') return false;
    const name = (user.name || '').toLowerCase();
    return DUAL_ROLE_ADMIN_NAMES.some(n => name.includes(n.toLowerCase()));
};

// Bildirim Merkezi yetkisi — header'daki Bell ikonunu ve dropdown'u
// yalnızca bu e-posta listesindekiler görür.
export const NOTIFICATION_CENTER_ALLOWED_EMAILS: string[] = [
    'cevikademm@gmail.com',
    'gurcan@bac.de',
    'hakan@bac.de',
    'seda@bac.de',
];

export const canSeeNotificationCenter = (email?: string | null): boolean =>
    !!email && NOTIFICATION_CENTER_ALLOWED_EMAILS.includes(email.trim().toLowerCase());

// Manuel mesai girişi yetkisi — "Saat Ekle" butonu yalnızca bu süper adminlere
// gösterilir. Diğer tüm kullanıcılar (personel + Apo/Malik gibi şube adminleri)
// sadece QR check-in/out ile mesai kaydı oluşturabilir.
export const MANUAL_TIME_ENTRY_ALLOWED_EMAILS: string[] = [
    'cevikademm@gmail.com',
    'gurcan@bac.de',
    'hakan@bac.de',
    'seda@bac.de',
];

export const canUseManualTimeEntry = (email?: string | null): boolean =>
    !!email && MANUAL_TIME_ENTRY_ALLOWED_EMAILS.includes(email.trim().toLowerCase());

// Vardiya planı düzenleme yetkisi — satır ekleme/silme/düzenleme, kişi atama,
// haftayı kopyalama ve yayınlama yalnızca bu süper adminlere açıktır. Diğer tüm
// adminler (Apo/Malik gibi şube adminleri dahil) planı YALNIZCA görüntüler.
export const SHIFT_EDIT_ALLOWED_EMAILS: string[] = [
    'cevikademm@gmail.com',
    'seda@bac.de',
];

export const canEditShiftSchedule = (email?: string | null): boolean =>
    !!email && SHIFT_EDIT_ALLOWED_EMAILS.includes(email.trim().toLowerCase());

// Vardiya TASLAĞINI görüntüleme yetkisi — yayınlanmamış (taslak) planı yalnızca
// bu süper adminler görebilir. Düzenleme yetkisinden (yalnızca cevikadem+seda)
// ayrıdır ve daha geniştir: hakan ve gurcan taslağı görür ama düzenleyemez.
// Personel + diğer adminler taslağı HİÇ göremez; yalnızca admin "Yayınla"
// dedikten sonra kendi yayınlanmış satırlarını görür.
// NOT: Bu liste DB tarafında shift_can_view_draft() ile bire bir eşleşmelidir.
export const SHIFT_DRAFT_VIEW_ALLOWED_EMAILS: string[] = [
    'cevikademm@gmail.com',
    'seda@bac.de',
    'hakan@bac.de',
    'gurcan@bac.de',
];

export const canViewShiftDraft = (email?: string | null): boolean =>
    !!email && SHIFT_DRAFT_VIEW_ALLOWED_EMAILS.includes(email.trim().toLowerCase());

// Zorunlu güncelleme tetikleme yetkisi — "Tüm kullanıcıları güncellemeye zorla"
// butonu YALNIZCA bu süper admine gösterilir. Buton, app_config.force_update
// satırının nonce'unu yeniler ve tüm açık istemcilerde engelleyici güncelleme
// kartını tetikler (cache + SW temizleyip hard-reload).
export const FORCE_UPDATE_ADMIN_EMAILS: string[] = [
    'cevikademm@gmail.com',
];

export const canTriggerForceUpdate = (email?: string | null): boolean =>
    !!email && FORCE_UPDATE_ADMIN_EMAILS.includes(email.trim().toLowerCase());

export const MOCK_EMPLOYEES: Employee[] = [];

// NOTE: Titles and descriptions use i18n keys (e.g., task.mock.1.title) to support dynamic translation
export const MOCK_TASKS: Task[] = [];

export const MOCK_MESSAGES: Message[] = [];

export const MOCK_TIMELOGS: TimeLog[] = [];