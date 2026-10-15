-- =============================================================
-- send_checkout_reminders() — "Çıkış QR'ını unutma" push hatırlatması
-- =============================================================
-- SORUN:
--   Personel çıkışta QR okutmayı unutunca vardiya açık kalıyor; 16 saat
--   sonra auto_close_open_shifts() kapatıp çıkışı PLANDAKİ bitişe yazıyor
--   (plan yoksa giriş+8sa). Personele hiçbir uyarı gitmiyordu.
--
-- ÇÖZÜM:
--   Her 15 dakikada bir çalışan görev, planlanan bitişi geçmiş ama hâlâ
--   açık olan vardiyaları bulur ve o personele BİR KEZ push gönderir:
--     "⏰ Mesain hâlâ açık — çıkarken QR okut"
--   - Bitiş saati auto_close_open_shifts() ile BİREBİR aynı kuralla
--     hesaplanır (aynı plan eşleştirmesi, gece geçişi +1 gün, plan yoksa
--     giriş+8sa) → personele söylenen saat = sistemin yazacağı saat.
--   - Her vardiya için tek hatırlatma: checkout_reminders tablosu.
--   - Push yalnızca bildirimlere izin vermiş (push_subscriptions'ta
--     kaydı olan) personele gider. İzni olmayanlar uygulamayı açtığında
--     ekrandaki hatırlatma kartını görür (ShiftReminderBanner).
--   - Gönderim: mevcut pg_net + send-push altyapısı (geofence
--     bildirimlerinin kullandığı app.notify_event_url / _anon ayarları).
--     Yeni Edge Function deploy'u GEREKMEZ.
--
-- Çalıştırma: Supabase Studio > SQL Editor > tek seferlik run.
-- Geri alma: dosyanın sonundaki ROLLBACK bölümü.
-- =============================================================

-- (1) Hangi vardiyaya hatırlatma gitti — tek sefer garantisi
CREATE TABLE IF NOT EXISTS public.checkout_reminders (
  log_id       UUID PRIMARY KEY REFERENCES public.time_logs(id) ON DELETE CASCADE,
  employee_id  TEXT NOT NULL,   -- profiles.id TEXT
  expected_end TIMESTAMPTZ NOT NULL,
  from_plan    BOOLEAN NOT NULL,
  pushed       BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Yalnızca SECURITY DEFINER fonksiyon yazar/okur; istemciye kapalı
ALTER TABLE public.checkout_reminders ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_checkout_reminders_sent_at
  ON public.checkout_reminders (sent_at DESC);


-- (2) Hatırlatma fonksiyonu
CREATE OR REPLACE FUNCTION public.send_checkout_reminders()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  r          RECORD;
  v_base     TEXT;
  v_push_url TEXT;
  v_anon     TEXT;
  v_admin    TEXT;   -- profiles.id TEXT
  v_due      INT := 0;
  v_pushed   INT := 0;
  v_has_sub  BOOLEAN;
BEGIN
  -- send-push adresi: geofence trigger'ının kullandığı notify-event
  -- adresinden türetilir (…/functions/v1/notify-event → …/send-push)
  v_base := current_setting('app.notify_event_url', true);
  v_anon := current_setting('app.notify_event_anon', true);
  IF v_base IS NOT NULL AND v_base <> '' THEN
    v_push_url := regexp_replace(v_base, 'notify-event/?$', 'send-push');
  END IF;

  -- send-push yetkisi için bir admin id (notify-event ile aynı yöntem)
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'Admin' ORDER BY id LIMIT 1;

  FOR r IN
    WITH open_logs AS (
      SELECT tl.id, tl.employee_id, tl.check_in_at,
             (tl.check_in_at AT TIME ZONE 'Europe/Berlin')::date AS local_date
        FROM public.time_logs tl
       WHERE tl.check_out_at IS NULL
         AND tl.check_in_at  IS NOT NULL
         -- 16 saati geçen zaten auto_close'a düşer; hatırlatma anlamsız
         AND tl.check_in_at  > NOW() - INTERVAL '16 hours'
         AND NOT EXISTS (SELECT 1 FROM public.checkout_reminders cr WHERE cr.log_id = tl.id)
    ),
    with_week AS (
      SELECT o.*,
             (o.local_date - ((EXTRACT(ISODOW FROM o.local_date)::int - 1) || ' days')::interval)::date AS monday,
             EXTRACT(ISODOW FROM o.local_date)::int - 1 AS day_idx
        FROM open_logs o
    ),
    matched AS (
      SELECT w.*,
             regexp_match(ss.time_slot, '(\d{1,2}):?(\d{2})?\s*[-–]\s*(\d{1,2}):?(\d{2})?') AS rng
        FROM with_week w
        LEFT JOIN LATERAL (
          SELECT s.time_slot
            FROM public.shift_schedules s
           WHERE s.week_start_date = to_char(w.monday, 'YYYY-MM-DD')
             AND COALESCE(s.days[w.day_idx + 1], '') ILIKE '%' || w.employee_id::text || '%'
             AND s.time_slot ~ '\d'
           ORDER BY s.created_at DESC
           LIMIT 1
        ) ss ON TRUE
    ),
    calc AS (
      SELECT m.*,
        CASE WHEN rng IS NOT NULL THEN
          ((local_date::timestamp
            + (rng[3]::int || ' hours')::interval
            + (COALESCE(rng[4],'0')::int || ' minutes')::interval)
           AT TIME ZONE 'Europe/Berlin')
        END AS raw_co
      FROM matched m
    )
    SELECT c.id, c.employee_id, c.check_in_at, (c.rng IS NOT NULL) AS from_plan,
      CASE
        WHEN c.raw_co IS NULL          THEN c.check_in_at + INTERVAL '8 hours'
        WHEN c.raw_co <= c.check_in_at THEN c.raw_co + INTERVAL '1 day'
        ELSE c.raw_co
      END AS expected_end
      FROM calc c
  LOOP
    CONTINUE WHEN r.expected_end > NOW();   -- henüz zamanı gelmedi
    v_due := v_due + 1;

    SELECT EXISTS (
      SELECT 1 FROM public.push_subscriptions s WHERE s.user_id::text = r.employee_id::text
    ) INTO v_has_sub;

    IF v_has_sub AND v_push_url IS NOT NULL AND v_anon IS NOT NULL AND v_admin IS NOT NULL THEN
      BEGIN
        PERFORM net.http_post(
          url     := v_push_url,
          body    := jsonb_build_object(
            'caller_user_id',     v_admin,
            'user_ids',           jsonb_build_array(r.employee_id::text),
            'title',              '⏰ Mesain hâlâ açık · Schicht noch offen',
            'body',               'Giriş ' || to_char(r.check_in_at AT TIME ZONE 'Europe/Berlin', 'HH24:MI')
                                  || ' · bitiş ' || to_char(r.expected_end AT TIME ZONE 'Europe/Berlin', 'HH24:MI')
                                  || '. Çıkarken QR okut! / Beim Gehen per QR ausstempeln!',
            'url',                '/#qr',
            'tag',                'checkout-reminder-' || r.id::text,
            'requireInteraction', true
          ),
          headers := jsonb_build_object(
            'content-type',  'application/json',
            'authorization', 'Bearer ' || v_anon
          )
        );
        v_pushed := v_pushed + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'checkout reminder pg_net hata: %', SQLERRM;
        v_has_sub := FALSE;
      END;
    ELSE
      v_has_sub := FALSE;
    END IF;

    INSERT INTO public.checkout_reminders(log_id, employee_id, expected_end, from_plan, pushed)
    VALUES (r.id, r.employee_id::text, r.expected_end, r.from_plan, v_has_sub)
    ON CONFLICT (log_id) DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',      true,
    'due',     v_due,
    'pushed',  v_pushed,
    'ran_at',  NOW()
  );
END;
$function$;

-- İstemciden çağrılamasın; yalnızca pg_cron çalıştırır
REVOKE ALL ON FUNCTION public.send_checkout_reminders() FROM PUBLIC, anon, authenticated;


-- (3) Her 15 dakikada bir çalıştır
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  FOR v_jobid IN
    SELECT jobid FROM cron.job WHERE command ILIKE '%send_checkout_reminders%'
  LOOP
    PERFORM cron.unschedule(v_jobid);
  END LOOP;

  PERFORM cron.schedule(
    'send_checkout_reminders_15min',
    '*/15 * * * *',
    'SELECT public.send_checkout_reminders();'
  );
END $$;

-- =============================================================
-- Doğrulama (salt okunur):
--   SELECT jobname, schedule, active FROM cron.job
--    WHERE jobname = 'send_checkout_reminders_15min';
--   -- Beklenen: 1 satır, '*/15 * * * *', active = true
--
--   SELECT * FROM public.checkout_reminders ORDER BY sent_at DESC LIMIT 20;
--   -- Hatırlatma giden vardiyalar (pushed = push gönderildi mi)
-- =============================================================

-- =============================================================
-- ROLLBACK (gerekirse):
--   SELECT cron.unschedule('send_checkout_reminders_15min');
--   DROP FUNCTION IF EXISTS public.send_checkout_reminders();
--   DROP TABLE IF EXISTS public.checkout_reminders;
-- =============================================================
