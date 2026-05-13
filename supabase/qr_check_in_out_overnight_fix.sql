-- ============================================================
-- BAC Handels — qr_check_in_out gece vardiyası fix (overnight bug)
-- ============================================================
-- Sorun:
--   Eski sürümde açık QR kaydı şu filtre ile aranıyordu:
--     WHERE employee_id = p_employee_id
--       AND date        = v_today                ← darboğaz
--       AND entry_method = 'qr'
--       AND check_out_at IS NULL
--
--   Personel dün gece (örn. 22:00) check-in yapıp ertesi gün sabah
--   (örn. 06:00) çıkış yapmaya çalıştığında time_logs.date = dün olduğu
--   için filtre eşleşmiyor, RPC yanlış olarak 'not_checked_in' dönüyordu.
--
-- Düzeltme:
--   Tarih filtresini kaldır; bunun yerine son 18 saatte açılmış ve henüz
--   check_out_at = NULL olan kaydı bul. 18 saat penceresi gerçekçi tek
--   vardiya max süresini kapsar; daha eski açık kayıtlar zaten orphan
--   sayılır ve auto_close_open_shifts cron'una bırakılır.
--
-- Yan etkiler:
--   - İmza değişmiyor (CREATE OR REPLACE FUNCTION).
--   - GRANT EXECUTE korunur (replace yalnız body değiştirir).
--   - Halihazırda dün açık kalan satırlar (Gül/Sedat/Ismail) bu fix
--     uygulanır uygulanmaz QR ile "Ausstempeln" yapabilecek (her biri
--     18 saat penceresi içinde).
-- ============================================================

CREATE OR REPLACE FUNCTION public.qr_check_in_out(
    p_employee_id TEXT,
    p_qr_token    TEXT,
    p_lat         NUMERIC DEFAULT NULL,
    p_lng         NUMERIC DEFAULT NULL,
    p_action      TEXT    DEFAULT 'auto',
    p_device_info TEXT    DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_loc     public.branch_locations;
    v_today   DATE := (NOW() AT TIME ZONE 'Europe/Berlin')::date;
    v_now     TIMESTAMPTZ := NOW();
    v_open    public.time_logs;
    v_found   BOOLEAN;
    v_dist    NUMERIC;
    v_in_rng  BOOLEAN := TRUE;
    v_status  TEXT;
    v_hours   NUMERIC;
BEGIN
    SELECT * INTO v_loc FROM public.branch_locations
     WHERE qr_token = p_qr_token AND is_active = TRUE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_qr');
    END IF;

    IF p_lat IS NULL OR p_lng IS NULL THEN
        v_in_rng := FALSE;
    ELSE
        v_dist := 6371000 * 2 * asin(sqrt(
            power(sin(radians((p_lat - v_loc.latitude)/2)), 2)
          + cos(radians(v_loc.latitude)) * cos(radians(p_lat))
          * power(sin(radians((p_lng - v_loc.longitude)/2)), 2)));
        v_in_rng := v_dist <= v_loc.radius_m;
    END IF;
    v_status := CASE WHEN v_in_rng THEN 'Onaylandı' ELSE 'Bekliyor' END;

    -- FIX (gece vardiyası + orphan koruması):
    --   Önceki sürüm 'date = v_today' filtresi yüzünden gece geçen vardiyada
    --   yanlış 'not_checked_in' veriyordu. Ara fix 18h penceresi koydu, ancak
    --   o da auto_close çalışmadığında (24h+ açık kalan satırlar) yeni INSERT
    --   denenince 'uniq_open_qr_shift_per_employee' partial-unique constraint'i
    --   tetikliyordu (23505 duplicate_key).
    --   Çözüm: zaman penceresini kaldır. 'check_out_at IS NULL' satırı varsa
    --   RPC onu doğru yönetir (action='out' kapatır, action='in' already_checked_in
    --   döner). Orphan satırlar için ek bilgi 'stale' bayrağı ile gönderilir.
    SELECT * INTO v_open FROM public.time_logs
     WHERE employee_id  = p_employee_id
       AND entry_method = 'qr'
       AND check_out_at IS NULL
     ORDER BY check_in_at DESC LIMIT 1;
    v_found := FOUND;

    -- Niyet doğrulama: personel yanlış butona bastıysa ret.
    -- 'stale' bayrağı: açık satır 16 saatten eski ise (orphan/unutulmuş)
    -- frontend ek uyarı + admin'e başvur yönlendirmesi yapar.
    IF p_action = 'in' AND v_found THEN
        RETURN jsonb_build_object(
          'ok', false, 'error', 'already_checked_in',
          'branch', v_open.branch, 'start_time', v_open.start_time,
          'open_log_id', v_open.id,
          'open_for_hours', ROUND(EXTRACT(EPOCH FROM (v_now - v_open.check_in_at))/3600.0, 2),
          'stale', (v_now - v_open.check_in_at) > INTERVAL '16 hours'
        );
    END IF;
    IF p_action = 'out' AND NOT v_found THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_checked_in');
    END IF;

    IF NOT v_found THEN
        -- GİRİŞ (check-in)
        INSERT INTO public.time_logs(
          employee_id, date, start_time, end_time, break_duration,
          total_hours, status, branch, entry_method,
          check_in_at, check_in_lat, check_in_lng, device_info)
        VALUES (
          p_employee_id, v_today,
          to_char(v_now AT TIME ZONE 'Europe/Berlin', 'HH24:MI'), '',
          0, 0, v_status, v_loc.branch, 'qr',
          v_now, p_lat, p_lng, p_device_info)
        RETURNING * INTO v_open;

        RETURN jsonb_build_object('ok', true, 'action', 'in', 'status', v_status,
          'branch', v_loc.branch, 'start_time', v_open.start_time,
          'in_range', v_in_rng, 'log_id', v_open.id);
    ELSE
        -- ÇIKIŞ (check-out)
        v_hours := ROUND(EXTRACT(EPOCH FROM (v_now - v_open.check_in_at))/3600.0, 2);
        UPDATE public.time_logs
           SET check_out_at  = v_now,
               check_out_lat = p_lat,
               check_out_lng = p_lng,
               end_time      = to_char(v_now AT TIME ZONE 'Europe/Berlin', 'HH24:MI'),
               total_hours   = v_hours,
               status        = v_status
         WHERE id = v_open.id
         RETURNING * INTO v_open;

        RETURN jsonb_build_object('ok', true, 'action', 'out', 'status', v_status,
          'branch', v_loc.branch, 'start_time', v_open.start_time,
          'end_time', v_open.end_time, 'total_hours', v_hours,
          'in_range', v_in_rng, 'log_id', v_open.id);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Doğrulama sorguları (uygulamadan sonra elle çalıştır)
-- ============================================================
--
-- 1) Halen açık kalan QR satırları:
-- SELECT employee_id, branch, date, check_in_at, check_out_at,
--        NOW() - check_in_at AS open_for
--   FROM public.time_logs
--  WHERE entry_method = 'qr' AND check_out_at IS NULL
--  ORDER BY check_in_at;
--
-- 2) Fix sonrası gece geçişi senaryosu test (Gül/Sedat/Ismail için):
--    "Ausstempeln" QR'ı okuttuklarında now() - check_in_at < 18 saat ise
--    'not_checked_in' yerine başarıyla kapanmalı.
-- ============================================================
