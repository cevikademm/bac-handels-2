import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
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
        // Class/function isimlerini koru — production'da "YO is not a constructor"
        // gibi mangled hatalari engeller, stack trace okunabilir kalir
        keepNames: true,
      },
      build: {
        // TESHIS: Production'da gercek hata kaynagini gormek icin gecici acik
        sourcemap: true,
        // TESHIS: Minify kapali — sinif/fonksiyon adlari korunur, gercek hata gorunur
        minify: false,
        commonjsOptions: {
          transformMixedEsModules: true,
        },
      }
    };
});
