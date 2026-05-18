import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import UpdateGuard from './components/UpdateGuard';
import { registerServiceWorker } from './lib/push';
import { bootCheckAndReload } from './lib/versionCheck';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// ─────────────────────────────────────────────────────────────────────
// BOOT-TIME OTOMATİK GÜNCELLEME
// Render'dan ÖNCE bundle versiyonunu server'dakiyle karşılaştır;
// fark varsa cache + SW temizle, hard-reload yap. Reload tetiklenirse
// aşağıdaki render kodu yine yürür ama window.location.replace zaten
// sayfayı değiştirdiği için kullanıcı bunu görmez (kısa flash).
// async non-blocking: 800ms timeout — version.json yavaşsa render'ı
// daha fazla geciktirme.
// ─────────────────────────────────────────────────────────────────────
const renderApp = (): void => {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <UpdateGuard>
          <App />
        </UpdateGuard>
      </ErrorBoundary>
    </React.StrictMode>
  );
};

const bootTimeout = new Promise<boolean>((resolve) =>
  setTimeout(() => resolve(false), 800)
);
Promise.race([bootCheckAndReload(), bootTimeout]).then((reloading) => {
  if (!reloading) renderApp();
  // reloading=true ise window.location.replace zaten çalıştı; render etmeye gerek yok.
});

// PWA / Web Push: Service Worker kaydı (HTTPS veya localhost gereklidir)
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    registerServiceWorker().catch((err) =>
      console.error('[SW] Kayıt başarısız:', err)
    );
  });

  // SW notificationclick → ana pencereye NAVIGATE mesajı gönderir
  navigator.serviceWorker?.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'NAVIGATE' && typeof data.url === 'string') {
      try {
        const url = new URL(data.url, window.location.origin);
        if (url.hash) {
          window.location.hash = url.hash;
        } else if (url.pathname && url.pathname !== window.location.pathname) {
          window.location.assign(url.toString());
        }
      } catch {
        /* ignore */
      }
    }
  });
}
