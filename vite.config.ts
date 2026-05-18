import path from 'path';
import { writeFileSync } from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import mkcert from 'vite-plugin-mkcert';

/**
 * Build sırasında üretilen deterministik versiyon. Hem bundle'a __BAC_BUILD_VERSION__
 * olarak inject edilir hem de dist/version.json'a yazılır. İstemci ikisini
 * karşılaştırarak yeni deployment'ı boot sırasında algılayıp cache'i temizler
 * ve hard-reload yapar (UpdateGuard ek olarak çalışan oturumlarda da modal gösterir).
 */
const BUILD_VERSION = Date.now().toString(36);

function writeVersionJsonPlugin() {
  return {
    name: 'bac-write-version-json',
    apply: 'build' as const,
    closeBundle() {
      try {
        writeFileSync(
          path.resolve(__dirname, 'dist', 'version.json'),
          JSON.stringify({ version: BUILD_VERSION, builtAt: new Date().toISOString() }, null, 2),
          'utf-8'
        );
      } catch (err) {
        console.warn('[version-json] yazılamadı:', err);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      define: {
        // Bundle'a gömülü build versiyonu — boot sırasında /version.json ile
        // karşılaştırılır; fark varsa cache temizlenip hard-reload yapılır.
        __BAC_BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
      },
      server: {
        port: 3000,
        host: '0.0.0.0',
        // GÜVENLİK: HTTP Güvenlik Başlıkları
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'X-XSS-Protection': '1; mode=block',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(self)',
        },
      },
      plugins: [
        react(),
        // HTTPS dev server — kamera/GPS telefonda LAN IP üzerinden çalışsın
        mkcert(),
        // dist/version.json — yeni deployment algılama için
        writeVersionJsonPlugin(),
      ],
      // GÜVENLİK: Gemini API key artık Supabase Edge Function secrets'ta saklanır.
      // Client bundle'a hiçbir API key dahil edilmez.
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      optimizeDeps: {
        // @zxing/browser CommonJS-ESM karisimi; prebundle ile minify hatasi onlenir
        include: ['@zxing/browser', '@zxing/library'],
      },
      esbuild: {
        // Class/function isimlerini koru — minify hatalarini debug etmeyi kolaylastirir
        keepNames: true,
      },
      build: {
        // GUVENLIK: Kaynak haritalari uretim moduda kapali
        sourcemap: mode !== 'production',
        commonjsOptions: {
          transformMixedEsModules: true,
        },
      }
    };
});
