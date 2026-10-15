-- =============================================================
-- request_overtime — "Fazla Mesai Bildir" düzeltmesi
-- =============================================================
-- SORUN:
--   Eski request_overtime(p_log_id, p_minutes) çağıranı auth.uid()
--   ile buluyordu ve yalnızca 'authenticated' rolüne açıktı. Uygulama
--   Supabase Auth kullanmadığı (özel login → her istek 'anon') için
--   auth.uid() hep NULL döner; bugüne kadar tek bir fazla mesai
--   bildirimi bile kaydedilemedi (overtime_minutes dolu kayıt: 0).
--
-- ÇÖZÜM:
--   Diğer RPC'lerle aynı desen: çağıran p_caller_id (TEXT) ile gelir.
--   - Personel yalnızca KENDİ kaydına bildirim yapabilir
--     (employee_id = p_caller_id).
--   - Yalnızca otomatik kapatılmış (auto_closed_at dolu) ve hâlâ
--     'Bekliyor' durumundaki kayıtlar.
--   - Bir vardiyaya toplam en fazla 720 dk (12 sa) eklenebilir.
--   - Yeni çıkış saati şu andan ileri olamaz.
--   - Sonuç yine admin onayına ('Bekliyor') düşer + bildirim merkezine
--     'overtime_requested' kaydı yazılır.
--
-- Çalıştırma: Supabase Studio > SQL Editor > tek seferlik run.
-- Geri alma: dosyanın sonundaki ROLLBACK bölümü.
-- =============================================================

-- Eski (auth.uid() kullanan) imzayı kaldır — karışıklık olmasın
DROP FUNCTION IF EXISTS public.request_overtime(UUID, INT);

CREATE OR REPLACE FUNCTION public.request_overtime(
  p_caller_id TEXT,
  p_log_id    UUID,
  p_minutes   INT
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_log       RECORD;
  v_new_co    TIMESTAMPTZ;
  v_total     NUMERIC(6,2);
  v_emp_name  TEXT;
  v_prev_min  INT;
BEGIN
  IF p_caller_id IS NULL OR btrim(p_caller_id) = '' THEN
    RAISE EXCEPTION 'Oturum bulunamadı';
  END IF;

  IF p_minutes IS NULL OR p_minutes < 1 OR p_minutes > 720 THEN
    RAISE EXCEPTION 'Geçersiz süre — 1 ile 720 dk arasında olmalı';
  END IF;

  -- Satırı kilitle: aynı anda iki bildirim gelirse sırayla işlensin
  SELECT * INTO v_log
    FROM public.time_logs
   WHERE id = p_log_id
     AND employee_id::text = p_caller_id   -- profiles.id TEXT; ::text her iki tipte de güvenli
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kayıt bulunamadı veya size ait değil';
  END IF;

  IF v_log.auto_closed_at IS NULL THEN
    RAISE EXCEPTION 'Bu kayıt otomatik kapatılmamış — fazla mesai bildirimi yapılamaz';
  END IF;

  IF v_log.status IS DISTINCT FROM 'Bekliyor' THEN
    RAISE EXCEPTION 'Bu kayıt zaten % — fazla mesai bildirimi yapılamaz', v_log.status;
  END IF;

  IF v_log.check_out_at IS NULL OR v_log.check_in_at IS NULL THEN
    RAISE EXCEPTION 'Vardiyanın giriş/çıkış zamanı eksik';
  END IF;

  v_prev_min := COALESCE(v_log.overtime_minutes, 0);
  IF v_prev_min + p_minutes > 720 THEN
    RAISE EXCEPTION 'Bir vardiyaya toplam en fazla 720 dk eklenebilir (şu ana kadar: % dk)', v_prev_min;
  END IF;

  -- Yeni çıkış = mevcut çıkış + p_minutes
  v_new_co := v_log.check_out_at + make_interval(mins => p_minutes);

  IF v_new_co > NOW() THEN
    RAISE EXCEPTION 'Yeni çıkış saati şu andan ileri olamaz';
  END IF;

  -- total_hours = (yeni çıkış - giriş)/3600 - mola(dk)/60
  v_total := ROUND(
    (EXTRACT(EPOCH FROM (v_new_co - v_log.check_in_at)) / 3600.0)
    - (COALESCE(v_log.break_duration, 0) / 60.0),
    2
  );

  IF v_total < 0 THEN
    RAISE EXCEPTION 'Hesaplanan toplam saat negatif çıktı — yöneticinize başvurun';
  END IF;

  UPDATE public.time_logs
     SET check_out_at          = v_new_co,
         end_time              = to_char(v_new_co AT TIME ZONE 'Europe/Berlin', 'HH24:MI'),
         total_hours           = v_total,
         status                = 'Bekliyor',
         overtime_minutes      = v_prev_min + p_minutes,
         overtime_requested_at = NOW()
   WHERE id = p_log_id;

  SELECT full_name INTO v_emp_name
    FROM public.profiles
   WHERE id::text = v_log.employee_id::text;

  -- Admin bildirim merkezine kayıt (hata verirse bildirimi engellemesin)
  BEGIN
    INSERT INTO public.notification_log(type, title, body, url, tag, meta)
    VALUES (
      'overtime_requested',
      COALESCE(v_emp_name, 'Personel') || ' fazla mesai bildirdi',
      to_char(v_log.check_in_at AT TIME ZONE 'Europe/Berlin', 'DD.MM HH24:MI')
        || ' girişli otomatik kapatılan vardiyaya +' || p_minutes
        || ' dk eklendi. Yeni çıkış '
        || to_char(v_new_co AT TIME ZONE 'Europe/Berlin', 'DD.MM HH24:MI')
        || ', toplam ' || ROUND(v_total, 2) || ' saat. Onayınızı bekliyor.',
      '/payroll',
      'overtime-' || p_log_id::text || '-' || to_char(NOW(), 'YYYYMMDDHH24MISS'),
      jsonb_build_object(
        'log_id',           p_log_id,
        'employee_id',      v_log.employee_id,
        'employee_name',    v_emp_name,
        'overtime_minutes', p_minutes,
        'overtime_total',   v_prev_min + p_minutes,
        'new_total_hours',  v_total,
        'new_check_out_at', v_new_co
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'ok',               true,
    'new_total_hours',  v_total,
    'new_check_out_at', v_new_co,
    'overtime_minutes', p_minutes,
    'overtime_total',   v_prev_min + p_minutes
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.request_overtime(TEXT, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_overtime(TEXT, UUID, INT) TO anon, authenticated;

-- PostgREST şema önbelleğini yenile (yeni imza hemen görünsün)
NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Doğrulama (salt okunur):
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'request_overtime';
--   Beklenen: tek satır → p_caller_id text, p_log_id uuid, p_minutes integer
-- =============================================================

-- =============================================================
-- ROLLBACK (gerekirse):
--   DROP FUNCTION IF EXISTS public.request_overtime(TEXT, UUID, INT);
--   -- ve overtime_and_validator_migration.sql içindeki (4) bölümünü
--   -- yeniden çalıştırın.
-- =============================================================
