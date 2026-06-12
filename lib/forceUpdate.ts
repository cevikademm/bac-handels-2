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
import { getBundledVersion } from './versionCheck';

const CONFIG_KEY = 'force_update';
const ACK_STORAGE_KEY = 'bac:force-update-ack';
const STATUS_TABLE = 'app_update_status';

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
  // NOT: Tetikleyen cihaz BİLEREK ack'lenmiyor — süper admin de güncelleme
  // kartını görsün ("tüm kullanıcıları zorla" gerçekten herkesi kapsasın).
  // Kart "Şimdi Güncelle" deyince ack'lenir, reload sonrası "Aldı" olur.
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

// ---------------------------------------------------------------------------
// GÜNCELLEME DURUMU TAKİBİ — kim son sürümü aldı / almadı?
// ---------------------------------------------------------------------------

export interface UpdateStatusRow {
  user_id: string;
  user_name: string | null;
  app_version: string | null;
  acked_nonce: string | null;
  last_seen_at: string | null;
}

/**
 * Bu cihazın güncel durumunu app_update_status'a yazar: çalıştığı build
 * sürümü + uyguladığı zorunlu güncelleme nonce'u + şimdiki zaman. Açılışta,
 * pencere odaklanınca ve periyodik olarak çağrılır. Tablo yoksa sessiz degrade.
 */
export const reportUpdateStatus = async (
  userId?: string | null,
  userName?: string | null
): Promise<void> => {
  if (!userId) return;
  try {
    const now = new Date().toISOString();
    await supabase.from(STATUS_TABLE).upsert(
      {
        user_id: userId,
        user_name: userName || null,
        app_version: getBundledVersion() || null,
        acked_nonce: getAckedNonce(),
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: 'user_id' }
    );
  } catch {
    /* tablo yok / ağ hatası — sessizce yok say */
  }
};

/**
 * Tüm cihazların güncelleme durumu satırlarını çeker (süper admin listesi için).
 * Tablo henüz oluşturulmadıysa `null` döner (migration gerekli) — boş `[]`
 * (tablo var ama kayıt yok) ile karıştırılmamalı, UI ayrı uyarı gösterir.
 */
export const fetchUpdateStatuses = async (): Promise<UpdateStatusRow[] | null> => {
  try {
    const { data, error } = await supabase
      .from(STATUS_TABLE)
      .select('user_id, user_name, app_version, acked_nonce, last_seen_at');
    if (error) {
      const msg = String(error.message || error.code || '').toLowerCase();
      const tableMissing =
        msg.includes(STATUS_TABLE) &&
        (msg.includes('does not exist') || msg.includes('could not find') || msg.includes('schema cache'));
      return tableMissing ? null : [];
    }
    return (data || []) as UpdateStatusRow[];
  } catch {
    return [];
  }
};

/** /version.json'daki en güncel yayınlanmış sürümü çeker (yoksa null). */
export const fetchLatestPublishedVersion = async (): Promise<string | null> => {
  try {
    const resp = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
      credentials: 'omit',
    });
    if (!resp.ok) return null;
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('json')) return null;
    const data = (await resp.json()) as { version?: unknown };
    return typeof data.version === 'string' && data.version.length > 0 ? data.version : null;
  } catch {
    return null;
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
