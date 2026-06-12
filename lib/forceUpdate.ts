// =============================================================
// forceUpdate — Süper admin tetiklemeli "zorunlu güncelleme"
// =============================================================
// Süper admin (cevikademm) Ayarlar > "Tüm kullanıcıları güncellemeye
// zorla" butonuna bastığında `app_config.force_update` satırının
// value->>nonce değeri yenilenir. Tüm açık istemciler bu nonce'u
// dinler; kendi yerel "ack" değerinden farklıysa engelleyici
// güncelleme kartı gösterilir. Kart "Şimdi Güncelle" der demez nonce
// ack'lenir, cache + SW temizlenir ve hard-reload yapılır.
//
// Bu mekanizma versionCheck'ten BAĞIMSIZDIR: yeni bir deploy olup
// olmadığına bakmaksızın admin tüm cihazları taze yüklemeye zorlar.
// (Admin genelde yeni deploy sonrası bu butona basar.)
// =============================================================

import { supabase } from './supabase';

const CONFIG_KEY = 'force_update';
const ACK_STORAGE_KEY = 'bac:force-update-ack';

export interface ForceUpdateSignal {
  nonce: string;
  triggeredBy?: string | null;
  triggeredAt?: string | null;
}

/** app_config.force_update satırını okur. Tablo/satır yoksa null döner (sessiz degrade). */
export const fetchForceUpdateSignal = async (): Promise<ForceUpdateSignal | null> => {
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', CONFIG_KEY)
      .maybeSingle();
    if (error) return null;
    const value = (data?.value || {}) as Partial<ForceUpdateSignal>;
    if (!value || typeof value.nonce !== 'string' || value.nonce.length === 0) {
      return null;
    }
    return {
      nonce: value.nonce,
      triggeredBy: value.triggeredBy ?? null,
      triggeredAt: value.triggeredAt ?? null,
    };
  } catch {
    return null;
  }
};

/** Süper admin: yeni bir nonce yazarak tüm istemcileri güncellemeye zorlar. */
export const triggerForceUpdate = async (triggeredByName?: string | null): Promise<ForceUpdateSignal> => {
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const signal: ForceUpdateSignal = {
    nonce,
    triggeredBy: triggeredByName || null,
    triggeredAt: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('app_config')
    .upsert(
      {
        key: CONFIG_KEY,
        value: signal,
        updated_at: new Date().toISOString(),
        updated_by: triggeredByName || null,
      },
      { onConflict: 'key' }
    );
  if (error) throw error;
  // Tetikleyen cihaz kendini güncellemeye zorlamasın — nonce'u ack'le.
  setAckedNonce(nonce);
  return signal;
};

/** Bu cihazda en son uygulanan (onaylanan) nonce. */
export const getAckedNonce = (): string | null => {
  try {
    return localStorage.getItem(ACK_STORAGE_KEY);
  } catch {
    return null;
  }
};

/** Bir nonce'u "uygulandı" olarak işaretle (reload döngüsünü kırar). */
export const setAckedNonce = (nonce: string): void => {
  try {
    localStorage.setItem(ACK_STORAGE_KEY, nonce);
  } catch {
    /* ignore */
  }
};

/** SW kayıtlarını + tüm cache'leri temizler (versionCheck ile aynı davranış). */
export const purgeCachesAndSw = async (): Promise<void> => {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* ignore */
  }
};

/** Nonce'u ack'le, cache + SW temizle ve taze bir hard-reload başlat. */
export const applyForceUpdate = async (nonce: string): Promise<void> => {
  setAckedNonce(nonce);
  await purgeCachesAndSw();
  try { sessionStorage.removeItem('bac:chunk-reloaded'); } catch { /* ignore */ }
  const url = new URL(window.location.href);
  url.searchParams.set('_v', Date.now().toString(36));
  window.location.replace(url.toString());
};
