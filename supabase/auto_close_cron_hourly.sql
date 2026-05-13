-- ============================================================
-- auto_close_open_shifts — pg_cron schedule: günde 1 → saatte 1
-- ============================================================
-- Önceki durum: job günde 1 kez 01:00 UTC = 03:00 Berlin çalışıyordu.
-- Sorun: gün ortasında 16h eşiğini geçen orphan vardiya bir sonraki
-- gece 03:00'a kadar açık kalıyor; personel bu arada yeni vardiya
-- başlatmaya çalışırsa 'already_checked_in_stale' hatası alıyor
-- (auto_close yetişmediği için sistemde temizlik gecikiyor).
--
-- Yeni davranış: saat başında çalış (0 * * * *). Fonksiyon idempotent
-- (açık satır yoksa no-op); 16h+ açık her satır en geç 1 saat içinde
-- kapanır, status='Bekliyor' admin onayına düşer.
--
-- Çalıştırma: Supabase Studio > SQL Editor > tek seferlik.
-- ============================================================

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  -- Mevcut auto_close cron tanımlarını topla ve kaldır
  FOR v_jobid IN
    SELECT jobid FROM cron.job
     WHERE command ILIKE '%auto_close_open_shifts%'
  LOOP
    PERFORM cron.unschedule(v_jobid);
  END LOOP;

  -- Saat başında yeniden zamanla
  PERFORM cron.schedule(
    'auto_close_open_shifts_hourly',
    '0 * * * *',
    'SELECT public.auto_close_open_shifts();'
  );
END $$;

-- Doğrulama:
-- SELECT jobid, jobname, schedule, active
--   FROM cron.job
--  WHERE jobname = 'auto_close_open_shifts_hourly';
--
-- Beklenen: 1 satır, schedule = '0 * * * *', active = true
