// =============================================================
// UpdateRequiredModal — "Yeni Sürüm Mevcut" engelleyici ekran
// =============================================================
// versionCheck yeni bir deployment algıladığında render edilir.
// Tam ekran overlay; kullanıcı "Programı Güncelle" demeden devam
// edemez. Buton: SW + cache temizle + tam reload.
// =============================================================

import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Sparkles, Loader2 } from 'lucide-react';

interface Props {
  /** Modal'ı tetikleyen yeni sürüm değeri (opsiyonel görsel ipucu). */
  latestVersion?: string | null;
}

/** SW kayıtlarını + tüm cache'leri temizler. */
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

// Modal göründükten kaç saniye sonra otomatik güncelleme tetiklensin
const AUTO_REFRESH_SECONDS = 5;

const UpdateRequiredModal: React.FC<Props> = ({ latestVersion }) => {
  const [refreshing, setRefreshing] = useState(false);
  const [countdown, setCountdown] = useState<number>(AUTO_REFRESH_SECONDS);
  const triggeredRef = useRef(false);

  const handleRefresh = async (): Promise<void> => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    setRefreshing(true);
    await purgeCachesAndSw();
    try { sessionStorage.removeItem('bac:chunk-reloaded'); } catch { /* ignore */ }
    const url = new URL(window.location.href);
    url.searchParams.set('_v', Date.now().toString(36));
    window.location.replace(url.toString());
  };

  // Geri sayım → 0 olunca otomatik tetikle. Kullanıcı butona basarsa
  // handleRefresh zaten triggeredRef ile çift tetiklemeyi engeller.
  useEffect(() => {
    if (countdown <= 0) {
      void handleRefresh();
      return;
    }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-zinc-950/95 backdrop-blur-md flex flex-col items-center justify-center p-4 text-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-required-title"
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-md w-full shadow-2xl flex flex-col items-center">
        <div className="w-16 h-16 bg-indigo-900/30 text-indigo-400 rounded-full flex items-center justify-center mb-4 border border-indigo-500/30">
          <Sparkles size={32} />
        </div>
        <h1 id="update-required-title" className="text-xl font-bold text-white mb-2">
          Yeni Sürüm Mevcut
        </h1>
        <p className="text-zinc-400 text-sm mb-2">
          Programın yeni bir sürümü yayınlandı. Önbellek otomatik temizlenip uygulama yenilenecek.
        </p>
        <p className="text-zinc-500 text-xs mb-4">
          Mevcut oturumunuz korunur. Şimdi yenilemek için butona basabilirsiniz.
        </p>
        {!refreshing && countdown > 0 && (
          <p className="text-indigo-400 text-xs mb-4 font-mono">
            {countdown} saniye sonra otomatik güncelleniyor…
          </p>
        )}

        {latestVersion ? (
          <div className="bg-black/30 px-3 py-2 rounded-lg border border-zinc-800 w-full mb-6">
            <p className="text-[10px] text-zinc-500 font-mono break-all">
              build: {latestVersion}
            </p>
          </div>
        ) : null}

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-6 py-3 bg-white text-black hover:bg-zinc-200 disabled:opacity-60 disabled:cursor-not-allowed font-bold rounded-xl transition-colors w-full justify-center"
        >
          {refreshing ? (
            <>
              <Loader2 size={18} className="animate-spin" /> Güncelleniyor…
            </>
          ) : (
            <>
              <RefreshCw size={18} /> Programı Güncelle
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default UpdateRequiredModal;
