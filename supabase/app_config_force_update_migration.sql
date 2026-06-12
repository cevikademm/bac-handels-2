-- ===================================================================
-- UYGULAMA GENELİ YAPILANDIRMA — Zorunlu Güncelleme (Force Update)
-- Çalıştırma: Supabase Dashboard > SQL Editor > Run
--
-- Amaç: Süper admin (cevikademm) "Tüm kullanıcıları güncellemeye zorla"
--       butonuna bastığında, bu tablodaki `force_update` satırının
--       `value->>nonce` değeri yenilenir. Tüm açık istemciler bu değeri
--       hem polling hem realtime ile dinler; kendi yerel "ack" değeriyle
--       farklıysa engelleyici güncelleme kartını gösterir ve kullanıcı
--       butona basınca cache + SW temizlenip hard-reload yapılır.
--
-- key = 'force_update', value örn:
--   { "nonce": "lq3x9k", "triggeredBy": "Adem", "triggeredAt": "2026-06-12T..." }
-- ===================================================================

CREATE TABLE IF NOT EXISTS public.app_config (
  key         text PRIMARY KEY,
  value       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_by  text
);

-- RLS aç
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Mevcut policy'leri temizle (idempotent migration)
DROP POLICY IF EXISTS "app_config_read_all"   ON public.app_config;
DROP POLICY IF EXISTS "app_config_write_open" ON public.app_config;

-- Herkes okuyabilir — tüm istemcilerin zorunlu güncelleme sinyalini görmesi için
CREATE POLICY "app_config_read_all"
  ON public.app_config FOR SELECT
  USING (true);

-- Yazma açık — uygulama tarafında yalnızca cevikademm'e buton gösterilir.
-- (shift_publications / shift_schedules ile aynı pattern.)
CREATE POLICY "app_config_write_open"
  ON public.app_config FOR ALL
  USING (true)
  WITH CHECK (true);

-- Başlangıç satırı — nonce boş; ilk tetiklemeye kadar kimse güncellemeye zorlanmaz.
INSERT INTO public.app_config (key, value)
VALUES ('force_update', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- PostgREST schema cache'ini hemen yenile
NOTIFY pgrst, 'reload schema';

-- Realtime publication: nonce değişikliği tüm bağlı cihazlara anında yansısın.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.app_config;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END$$;
