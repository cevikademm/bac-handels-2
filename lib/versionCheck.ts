// =============================================================
// versionCheck — Yeni deployment algılama
// =============================================================
// Build sırasında üretilen `/version.json` dosyasını periyodik
// olarak fetch eder. İlk çağrıda dönen değeri "boot version" olarak
// saklar; sonraki çağrılarda farklı bir değer dönerse yeni bir
// deployment vardır → registered callback'leri tetikler.
//
// Tetikleyiciler:
//   - Sayfa boot'unda 1 kez
//   - 60 saniyede bir interval
//   - `visibilitychange` (kullanıcı sekmeye geri döndü)
//   - `focus` (pencere odaklandı)
//   - `online` (offline → online geçişi)
// =============================================================

const VERSION_URL = '/version.json';
const POLL_INTERVAL_MS = 60_000;

// vite define ile bundle'a inject edilen build versiyonu. Dev modda
// undefined olabilir — fallback boş string.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __BAC_BUILD_VERSION__: string;
const BUNDLED_VERSION: string =
  // @ts-ignore — define ile inject ediliyor
  typeof __BAC_BUILD_VERSION__ === 'string' ? __BAC_BUILD_VERSION__ : '';

let bootVersion: string | null = BUNDLED_VERSION || null;
let listeners: Array<(latest: string) => void> = [];
let started = false;
let fired = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** `/version.json` içeriğini güvenli şekilde çeker; başarısızsa `null`. */
const fetchLatestVersion = async (): Promise<string | null> => {
  try {
    const resp = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
      credentials: 'omit',
    });
    if (!resp.ok) return null;
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    // Sunucu rewrite ile HTML dönerse (eski deployment'ta version.json yoksa)
    // false positive üretmemek için JSON olduğunu doğrula.
    if (!ct.includes('json')) return null;
    const data = (await resp.json()) as { version?: unknown };
    return typeof data.version === 'string' && data.version.length > 0
      ? data.version
      : null;
  } catch {
    return null;
  }
};

const fireUpdateAvailable = (latest: string): void => {
  if (fired) return;
  fired = true;
  for (const cb of listeners) {
    try { cb(latest); } catch { /* ignore */ }
  }
};

const checkOnce = async (): Promise<void> => {
  const latest = await fetchLatestVersion();
  if (!latest) return;
  if (bootVersion === null) {
    bootVersion = latest;
    return;
  }
  if (latest !== bootVersion) {
    fireUpdateAvailable(latest);
    // Daha fazla poll'a gerek yok
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
};

/** Yeni sürüm algılandığında çağrılacak callback'i kaydeder. */
export const onUpdateAvailable = (cb: (latest: string) => void): (() => void) => {
  listeners.push(cb);
  // Halihazırda tetiklendiyse, yeni subscriber'a anında bildir
  if (fired && bootVersion) {
    try { cb(bootVersion); } catch { /* ignore */ }
  }
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
};

/** Polling'i başlatır. Birden fazla çağrı no-op. */
export const startVersionCheck = (): void => {
  if (started) return;
  // Sadece production build'lerde anlamlı (dev'de version.json yok)
  if (typeof window === 'undefined') return;
  // @ts-ignore — Vite injects import.meta.env
  if (!(import.meta as any).env?.PROD) return;

  started = true;
  void checkOnce();
  pollTimer = setInterval(() => { void checkOnce(); }, POLL_INTERVAL_MS);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void checkOnce();
    });
  }
  window.addEventListener('focus', () => { void checkOnce(); });
  window.addEventListener('online', () => { void checkOnce(); });
};

/** Test/debug için: mevcut boot versiyonu. */
export const getBootVersion = (): string | null => bootVersion;

/** Test/debug için: bundle'a gömülü build versiyonu. */
export const getBundledVersion = (): string => BUNDLED_VERSION;

// ----------------------------------------------------------------------
// BOOT-TIME OTOMATİK GÜNCELLEME
// ----------------------------------------------------------------------
// Uygulama yüklendiğinde, bundle'a gömülü build version ile server'daki
// /version.json'u karşılaştırırız. Fark varsa kullanıcı modalı GÖRMEDEN
// önce arka planda cache + SW temizlenir ve hard-reload tetiklenir.
//
// Reload loop koruması: sessionStorage'a flag yazar; yeniden tetiklenmesi
// gerekirse aynı oturumda tekrar denemez (next page-load'ta zaten yeni
// bundle yüklü olacağı için ihtiyaç kalmaz).
// ----------------------------------------------------------------------

const AUTO_RELOAD_FLAG = 'bac:auto-reloaded';

const purgeCachesAndSw = async (): Promise<void> => {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* ignore */ }
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch { /* ignore */ }
};

/**
 * Uygulama boot'unda çağrılır. Bundle vs server version farkı tespit ederse
 * cache + SW temizleyip hard-reload yapar. Promise sadece reload başlatmazsa
 * resolve olur (reload başladıysa sayfa zaten yenileniyor).
 *
 * @returns true → reload tetiklendi (UI render'ı durdurulmalı), false → güncel.
 */
export const bootCheckAndReload = async (): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  // @ts-ignore — Vite env
  if (!(import.meta as any).env?.PROD) return false;
  // Bundle versiyonu yoksa karşılaştırma yapılamaz
  if (!BUNDLED_VERSION) return false;

  // Sonsuz reload korumasi
  try {
    if (sessionStorage.getItem(AUTO_RELOAD_FLAG)) {
      sessionStorage.removeItem(AUTO_RELOAD_FLAG);
      return false;
    }
  } catch { /* ignore */ }

  const latest = await fetchLatestVersion();
  if (!latest) return false;
  if (latest === BUNDLED_VERSION) return false;

  // Sürüm farklı → reload başlat
  try { sessionStorage.setItem(AUTO_RELOAD_FLAG, '1'); } catch { /* ignore */ }
  try { sessionStorage.removeItem('bac:chunk-reloaded'); } catch { /* ignore */ }

  await purgeCachesAndSw();

  const url = new URL(window.location.href);
  url.searchParams.set('_v', latest);
  window.location.replace(url.toString());
  return true;
};
