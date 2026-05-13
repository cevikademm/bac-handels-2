-- ============================================================
-- REALTIME AUDIT & FIX — supabase_realtime publication
-- Hedef proje: xbbzwitvlrdwnoushgpf.supabase.co
-- Çalıştırma: Supabase Dashboard > SQL Editor > Run (idempotent)
--
-- Amaç:
--   1) Frontend'in canlı (postgres_changes) dinlediği tüm tabloların
--      supabase_realtime publication'ında olup olmadığını gösterir.
--   2) Eksik olanları ekler. Mevcutsa hata vermez.
--   3) REPLICA IDENTITY ayarını DEFAULT'a çeker (UPDATE/DELETE event'leri
--      için PRIMARY KEY üzerinden tetiklenir — projemizdeki kullanıma uygun).
-- ============================================================

-- ============================================================
-- 1) AUDIT — Şu anda publication'da hangi tablolar var?
-- ============================================================
-- Bu SELECT'i ayrı çalıştırıp sonucu görebilirsin. SQL Editor 'Run' bastığında
-- aynı pencerede tüm DO blokları çalışır, en sonda audit sonucu gelir.

-- ============================================================
-- 2) FIX — Frontend'in dinlediği tüm tabloları ekle (idempotent)
-- ============================================================
DO $$
DECLARE
  tbl TEXT;
  required_tables TEXT[] := ARRAY[
    'profiles',
    'time_logs',
    'tasks',
    'messages',
    'calendar_events',
    'sales_logs',
    'shift_publications',
    'shift_schedules',
    'live_locations',
    'geofence_events',
    'location_history',
    'notification_log',
    'qr_scan_attempts',
    'personnel_transfers',
    'app_settings',
    'stock_entries',
    'stock_counts'
  ];
BEGIN
  -- Publication mevcut mu?
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'supabase_realtime publication bulunamadı — Supabase Realtime kapalı olabilir. Dashboard > Database > Replication adımından açın.';
    RETURN;
  END IF;

  FOREACH tbl IN ARRAY required_tables
  LOOP
    -- Tablo gerçekten var mı? Yoksa atla, hata verme.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      RAISE NOTICE 'Tablo bulunamadı (atlanıyor): public.%', tbl;
      CONTINUE;
    END IF;

    -- Zaten publication'a dahilse atla
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = tbl
    ) THEN
      RAISE NOTICE 'Zaten publication''da: %', tbl;
      CONTINUE;
    END IF;

    -- Ekle
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    RAISE NOTICE 'Publication''a eklendi: %', tbl;
  END LOOP;
END $$;

-- ============================================================
-- 3) REPLICA IDENTITY — UPDATE/DELETE event'leri için PRIMARY KEY
-- ============================================================
-- DEFAULT (PRIMARY KEY) yeterli; FULL satır kopyası gönderir (ağır).
-- Tabloların çoğunda PRIMARY KEY zaten var; emin olmak için DEFAULT'a çekiyoruz.
DO $$
DECLARE
  tbl TEXT;
  required_tables TEXT[] := ARRAY[
    'profiles', 'time_logs', 'tasks', 'messages', 'calendar_events',
    'sales_logs', 'shift_publications', 'shift_schedules', 'live_locations',
    'geofence_events', 'location_history', 'notification_log',
    'qr_scan_attempts', 'personnel_transfers', 'app_settings',
    'stock_entries', 'stock_counts'
  ];
BEGIN
  FOREACH tbl IN ARRAY required_tables
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      BEGIN
        EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY DEFAULT', tbl);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'REPLICA IDENTITY ayarlanamadı: % — %', tbl, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 4) FINAL AUDIT — Sonuç: hangi tablolar publication'da
-- ============================================================
SELECT
  schemaname AS şema,
  tablename  AS tablo,
  '✓ aktif'  AS durum
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename IN (
    'profiles','time_logs','tasks','messages','calendar_events',
    'sales_logs','shift_publications','shift_schedules','live_locations',
    'geofence_events','location_history','notification_log',
    'qr_scan_attempts','personnel_transfers','app_settings',
    'stock_entries','stock_counts'
  )
ORDER BY tablename;

-- ============================================================
-- 5) EKSİK TABLOLAR (varsa) — frontend dinler ama publication'da yok
-- ============================================================
WITH required AS (
  SELECT unnest(ARRAY[
    'profiles','time_logs','tasks','messages','calendar_events',
    'sales_logs','shift_publications','shift_schedules','live_locations',
    'geofence_events','location_history','notification_log',
    'qr_scan_attempts'
    -- not: personnel_transfers, app_settings, stock_* tabloları
    -- frontend tarafından doğrudan postgres_changes ile dinlenmiyor;
    -- bu listede eksik olmaları sorun değil.
  ]) AS tbl
),
present AS (
  SELECT tablename AS tbl
    FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
)
SELECT
  required.tbl AS eksik_tablo,
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM information_schema.tables
                      WHERE table_schema='public' AND table_name = required.tbl)
      THEN 'tablo DB''de yok'
    ELSE 'publication''da değil'
  END AS sebep
FROM required
LEFT JOIN present USING (tbl)
WHERE present.tbl IS NULL;
