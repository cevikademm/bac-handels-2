// =============================================================
// backfill-receipt-hashes — Mevcut sales_logs fişleri için
//   SHA-256 + dHash hesaplar ve sales_logs satırına yazar.
// =============================================================
// Tek seferlik manuel tetiklenir:
//   curl -X POST https://<project>.supabase.co/functions/v1/backfill-receipt-hashes \
//     -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
//     -H "Content-Type: application/json" -d '{}'
//
// İsteğe bağlı body:
//   { "limit": 100, "days": 365 }   - varsayılan değerler
//
// Idempotent: receipt_sha256 dolu satırları atlar. Hata alırsa o satırı
// atlayıp devam eder. Çağrı başına en fazla `limit` satır işler.
// Tüm 365 günü tamamlamak için çağrıyı response'taki processed=0 olana
// kadar tekrarla. Rate-limit: her batch arasında 1s bekler.
// =============================================================

// @ts-nocheck Deno
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), {
    status: s,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// SHA-256 hex — client'taki sha256Hex ile aynı algoritma
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// dHash 64-bit — client'taki computeDHash ile aynı algoritma
// (JPEG bytes → 9×8 grayscale → yatay komşu farkı bit'leri)
// Deno'da createImageBitmap yok; ImageMagick yerine pure-JS decoder gerekirdi.
// Bunun yerine: Supabase Storage'da görüntü zaten optimize JPEG. Uygulamada
// client tarafında computeDHash blob üzerinden çalışıyor; backfill için
// 'jpeg-js' kütüphanesi kullanıp piksel decode ediyoruz.
import { decode as jpegDecode } from 'https://esm.sh/jpeg-js@0.4.4';

function computeDHashFromRgba(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
): bigint {
  // Naive nearest-neighbor 9×8 küçültme. Backfill için yeterli — client
  // canvas.drawImage ile bicubic yapıyor; küçük farklar olabilir ama
  // Hamming distance toleransı (≤6) bunu absorbe eder.
  const w = 9, h = 8;
  // 8-bit grayscale buffer
  const gray = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const srcY = Math.min(srcH - 1, Math.floor((y * srcH) / h));
    for (let x = 0; x < w; x++) {
      const srcX = Math.min(srcW - 1, Math.floor((x * srcW) / w));
      const i = (srcY * srcW + srcX) * 4;
      gray[y * w + x] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }
  }
  let hash = 0n;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const g1 = gray[y * w + x];
      const g2 = gray[y * w + x + 1];
      hash = (hash << 1n) | (g1 < g2 ? 1n : 0n);
    }
  }
  return hash;
}

// Unsigned 64-bit → Postgres BIGINT signed (-2^63..2^63-1)
function dhashToPgBigint(hash: bigint): string {
  const MAX_U64 = 1n << 64n;
  const SIGNED_MAX = (1n << 63n) - 1n;
  let v = hash;
  if (v > SIGNED_MAX) v = v - MAX_U64;
  return v.toString();
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body: { limit?: number; days?: number } = {};
  try {
    body = await req.json();
  } catch {
    // boş body kabul
  }
  const limit = Math.min(Math.max(body.limit ?? 100, 1), 500);
  const days = Math.min(Math.max(body.days ?? 365, 1), 365);

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Hash'i olmayan, receipt_url'si dolu, son N gün
  const { data: rows, error: selErr } = await admin
    .from('sales_logs')
    .select('id, receipt_url, created_at')
    .is('receipt_sha256', null)
    .not('receipt_url', 'is', null)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (selErr) return json(500, { error: 'select_failed', detail: selErr.message });

  const results = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [] as { id: string; reason: string }[],
  };

  for (const row of rows || []) {
    results.processed++;
    try {
      const resp = await fetch(row.receipt_url);
      if (!resp.ok) {
        results.errors.push({ id: row.id, reason: `fetch_${resp.status}` });
        continue;
      }
      const buf = new Uint8Array(await resp.arrayBuffer());
      const sha = await sha256Hex(buf);

      // JPEG decode → dHash
      let dhashPg: string | null = null;
      try {
        const decoded = jpegDecode(buf, { useTArray: true });
        const dh = computeDHashFromRgba(decoded.data, decoded.width, decoded.height);
        dhashPg = dhashToPgBigint(dh);
      } catch (e) {
        // Decode başarısızsa SHA-256'yı yine de yaz; dHash null kalır.
        results.errors.push({ id: row.id, reason: `decode_${(e as Error).message}` });
      }

      const update: Record<string, unknown> = { receipt_sha256: sha };
      if (dhashPg !== null) update.receipt_dhash = dhashPg;

      const { error: updErr } = await admin
        .from('sales_logs')
        .update(update)
        .eq('id', row.id);

      if (updErr) {
        // 23505 (unique violation) → eski veride zaten aynı hash başka satırda var.
        // dedup_warning ile işaretleyip devam et; admin manuel inceleyebilir.
        if ((updErr as any).code === '23505') {
          await admin
            .from('sales_logs')
            .update({ receipt_dhash: dhashPg, dedup_warning: true })
            .eq('id', row.id);
          results.errors.push({ id: row.id, reason: 'duplicate_in_archive' });
        } else {
          results.errors.push({ id: row.id, reason: `update_${updErr.message}` });
        }
      } else {
        results.updated++;
      }
    } catch (e) {
      results.errors.push({ id: row.id, reason: `exception_${(e as Error).message}` });
    }

    // Hafif rate limit — 50ms ara (storage CDN'ini zorlamayalım)
    await new Promise(r => setTimeout(r, 50));
  }

  return json(200, results);
});
