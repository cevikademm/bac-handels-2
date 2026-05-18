-- ============================================================
-- ADMIN_QR_TIME_EDIT
--   Amaç: prevent_qr_time_edit_trg trigger'ı QR ile oluşmuş
--   time_logs satırlarının start_time / check_in_at / entry_method
--   alanlarını koruyor. Personelin kendi kaydını sonradan
--   değiştirmesini engellemek için bu kilit doğru, ancak admin
--   manuel düzeltme yapmak istediğinde de hataya yol açıyor.
--   Bu migration trigger'ı admin için bypass eder.
--
--   Kontrol: app.current_user_role GUC'u 'Admin' ise trigger
--   hiçbir koruma uygulamadan satırı geçirir. Bu GUC, supabase
--   client tarafında set_session_context RPC ile zaten set
--   ediliyor (timelogs_admin_all policy aynı koşulu kullanıyor).
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_qr_time_edit()
RETURNS TRIGGER AS $$
DECLARE
    v_role TEXT;
BEGIN
    -- Admin oturumu → koruma yok
    v_role := current_setting('app.current_user_role', true);
    IF v_role = 'Admin' THEN
        RETURN NEW;
    END IF;

    -- Personel oturumu → QR satırı korunur
    IF OLD.entry_method = 'qr' THEN
        IF NEW.start_time IS DISTINCT FROM OLD.start_time THEN
            RAISE EXCEPTION 'QR girişinin start_time alanı değiştirilemez (kayıt id: %)', OLD.id;
        END IF;
        IF NEW.check_in_at IS DISTINCT FROM OLD.check_in_at THEN
            RAISE EXCEPTION 'QR girişinin check_in_at alanı değiştirilemez (kayıt id: %)', OLD.id;
        END IF;
        IF NEW.entry_method IS DISTINCT FROM OLD.entry_method THEN
            RAISE EXCEPTION 'QR kaydının entry_method değeri değiştirilemez';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger zaten var; CREATE OR REPLACE FUNCTION yeterli, yeniden bind etmeye gerek yok.
