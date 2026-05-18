-- ============================================================
-- ADMIN_UPDATE_TIME_LOG RPC
--
-- Amaç: Admin kullanıcının time_logs satırlarını GÜVENLİ ve TUTARLI
-- biçimde güncellemesi.
--
-- Sorun (daha önceki davranış):
--   Doğrudan supabase.from('time_logs').update(...) çağrısı iki ayrı
--   katmana takılıyordu:
--     1) RLS politikası (timelogs_admin_all) `app.current_user_role`
--        GUC'una bakıyor; client her zaman bu GUC'u set etmiyor.
--     2) prevent_qr_time_edit_trg trigger'ı admin'i tanımayıp QR ile
--        oluşmuş satırlarda start_time/check_in_at değişikliğini bloklar.
--   Sonuç: ekranda değişmiş görünür, DB'ye yazılmaz, sayfa yenilenince
--   eski değerler geri gelir.
--
-- Çözüm: Tek seferlik SECURITY DEFINER RPC.
--   - profiles tablosundan çağıranın admin olduğunu doğrular
--     (client'a güvenmek zorunda değiliz; rol DB'den okunuyor).
--   - SECURITY DEFINER → RLS bypass.
--   - set_config('app.current_user_role','Admin',true) → trigger'ın
--     admin bypass dalını aktive eder (tx-local).
--   - p_check_out_at parametresi ile QR satırlardaki açık vardiyanın
--     check_out_at'i de düzeltilebilir.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_update_time_log(
    p_caller_id      TEXT,
    p_log_id         UUID,
    p_date           DATE,
    p_start_time     TEXT,
    p_end_time       TEXT,
    p_break_duration INT,
    p_total_hours    NUMERIC,
    p_branch         TEXT,
    p_check_out_at   TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.time_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result   public.time_logs;
    v_is_admin BOOLEAN;
BEGIN
    -- 1) Çağıran admin mi? (Rol DB'den doğrulanır — client'a güvenmiyoruz.)
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
         WHERE id = p_caller_id
           AND role = 'Admin'
    ) INTO v_is_admin;

    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Bu işlem yalnızca admin kullanıcı tarafından yapılabilir (caller=%).', p_caller_id
            USING ERRCODE = '42501';
    END IF;

    -- 2) prevent_qr_time_edit trigger'ının admin bypass dalı için GUC set et
    PERFORM set_config('app.current_user_role', 'Admin', true);

    -- 3) Güncellemeyi uygula
    UPDATE public.time_logs
       SET date           = p_date,
           start_time     = p_start_time,
           end_time       = p_end_time,
           break_duration = COALESCE(p_break_duration, 0),
           total_hours    = p_total_hours,
           branch         = p_branch,
           check_out_at   = COALESCE(p_check_out_at, check_out_at)
     WHERE id = p_log_id
     RETURNING * INTO v_result;

    IF v_result.id IS NULL THEN
        RAISE EXCEPTION 'time_logs kaydı bulunamadı (id=%).', p_log_id
            USING ERRCODE = 'P0002';
    END IF;

    RETURN v_result;
END;
$$;

-- Anon/auth/public role'lerin RPC'yi çağırabilmesi için EXECUTE yetkisi
GRANT EXECUTE ON FUNCTION public.admin_update_time_log(
    TEXT, UUID, DATE, TEXT, TEXT, INT, NUMERIC, TEXT, TIMESTAMPTZ
) TO anon, authenticated, public;
