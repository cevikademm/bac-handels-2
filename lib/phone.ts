/**
 * Telefon numarası yardımcıları — WhatsApp link üretimi için.
 *
 * Sorun: personel numarayı çoğu zaman yerel formatta kaydediyor
 * ("0151 12345678"). `wa.me/0151...` yanlış gider çünkü WhatsApp
 * uluslararası format ister (ülke kodu, başında "+" veya "00" YOK).
 *
 * Örnekler (DE varsayılan):
 *   "+49 151 12345678"  → "4915112345678"
 *   "0049 151 12345678" → "4915112345678"
 *   "0151 12345678"     → "4915112345678"
 *   "+90 532 1234567"   → "905321234567"
 */

export const DEFAULT_COUNTRY_CODE = '49'; // BAC Handels — Almanya

export const normalizePhoneForWhatsApp = (
    raw: string | null | undefined,
    defaultCC: string = DEFAULT_COUNTRY_CODE
): string => {
    if (!raw) return '';
    const trimmed = String(raw).trim();
    const hasPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return '';
    if (hasPlus) return digits;
    if (digits.startsWith('00')) return digits.slice(2);
    if (digits.startsWith('0')) return defaultCC + digits.slice(1);
    return defaultCC + digits;
};

export const isValidWhatsAppPhone = (raw: string | null | undefined): boolean => {
    const n = normalizePhoneForWhatsApp(raw);
    return n.length >= 8 && n.length <= 15;
};

/**
 * Personel numarası için wa.me URL'i. Numara normalize edilir,
 * geçerli değilse boş string döner.
 */
export const buildEmployeeWhatsAppUrl = (
    phone: string | null | undefined,
    message?: string
): string => {
    if (!isValidWhatsAppPhone(phone)) return '';
    const num = normalizePhoneForWhatsApp(phone);
    const base = `https://wa.me/${num}`;
    return message ? `${base}?text=${encodeURIComponent(message)}` : base;
};
