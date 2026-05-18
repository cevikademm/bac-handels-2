-- ============================================================
-- BAC Handels — QR + manuel "Bekliyor" satırı çakışması düzeltmesi
-- ============================================================
-- Sorun:
--   time_logs üzerinde tanımlı partial-unique index
--     CREATE UNIQUE INDEX uniq_open_qr_shift_per_employee
--       ON time_logs(employee_id)
--       WHERE check_out_at IS NULL
--   manuel/plan tabanlı kayıtları (check_in_at IS NULL, status='Bekliyor')
--   da "açık vardiya" olarak sayıyor. Bu yüzden personel QR ile mesai
--   başlattığında RPC `entry_method='qr'` filtresiyle manuel satırı görmüyor
--   → INSERT'e gidiyor → index ihlali → 23505 duplicate_key.
--
--   Gerçek hayatta gözlenen senaryo (13.05.2026 Gül, 4 ardışık deneme):
--     time_logs satırları:
--       2026-05-13 07:00–16:30  manual  check_in_at=NULL  check_out_at=NULL
--       2026-05-12 21:53–06:07  manual  check_in_at=NULL  check_out_at=NULL
--     Gül 22:58'de QR okuttu → RPC manuel satırları "görmedi" → INSERT →
--     index ihlali → frontend bunu sessizce `network` etiketiyle gösterdi.
--
-- Çözüm (iki aşamalı):
--   1) Index'i `check_in_at IS NOT NULL` ile daralt. Yalnız fiziksel olarak
--      başlatılmış (check_in_at dolu) açık vardiyaları tekille; manuel/plan
--      satırları artık index dışında kalır.
--   2) RPC arama filtresinden `entry_method='qr'` kaldır; yerine
--      `check_in_at IS NOT NULL` koy. Bu sayede admin tarafından manuel
--      başlatılmış (ama henüz kapatılmamış) bir vardiya varsa RPC onu da
--      bulup doğru aksiyona yönlendirir; entry_method ayrımı artık önemsiz.
--
-- Yan etkiler:
--   - Mevcut "Bekliyor" statüsündeki manuel/plan satırları olduğu gibi
--     kalır; sadece partial-unique index dışına çıkarlar. Onay akışı (Bordro
--     > Onay Bekleyenler) etkilenmez.
--   - QR ile başlatılmış açık satırlar için davranış aynı; constraint hâlâ
--     "aynı çalışan için aynı anda iki fiziksel açık vardiya olmasın".
-- ============================================================

-- 1) Partial-unique index'i yeniden tanımla
DROP INDEX IF EXISTS public.uniq_open_qr_shift_per_employee;

CREATE UNIQUE INDEX uniq_open_qr_shift_per_employee
  ON public.time_logs(employee_id)
  WHERE check_out_at IS NULL
    AND check_in_at  IS NOT NULL;

-- 2) RPC: entry_method='qr' filtresini kaldır, fiziksel açık satırı ara
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

    -- Açık fiziksel vardiya araması:
    --   entry_method ayrımı yok. check_in_at NOT NULL koşulu manuel/plan
    --   satırlarını (check_in_at IS NULL) dışarıda tutar; onlar zaten admin
    --   onayına düşmüş "Bekliyor" satırlardır ve QR akışıyla ilgisi yok.
    SELECT * INTO v_open FROM public.time_logs
     WHERE employee_id  = p_employee_id
       AND check_in_at  IS NOT NULL
       AND check_out_at IS NULL
     ORDER BY check_in_at DESC LIMIT 1;
    v_found := FOUND;

    -- Niyet doğrulama
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
-- Doğrulama sorguları (Supabase Studio'da elle koş)
-- ============================================================
--
-- 1) Yeni index tanımı
-- SELECT indexdef FROM pg_indexes
--  WHERE indexname = 'uniq_open_qr_shift_per_employee';
-- Beklenen: WHERE bölümünde "check_out_at IS NULL AND check_in_at IS NOT NULL"
--
-- 2) Manuel açık satırlar artık index'i tetiklemiyor
-- SELECT employee_id, entry_method, check_in_at, check_out_at
--   FROM public.time_logs
--  WHERE check_out_at IS NULL
--  ORDER BY entry_method;
-- entry_method='manual' satırların hepsi check_in_at IS NULL olmalı
-- (varsa istisna admin'e raporlanır).
--
-- 3) Gül için tekrar test:
--   QR Einstempeln → INSERT başarılı (manuel açık satır engel olmaz)
--   QR Ausstempeln → açık QR satırı bulunur ve UPDATE ile kapanır
-- ============================================================
