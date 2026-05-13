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

let bootVersion: string | null = null;
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
