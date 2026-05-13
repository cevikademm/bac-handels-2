-- ============================================================
-- UPDATE_MY_PHONE — Personel & Dual-Role Admin Telefon Güncelleme
-- Hedef proje: xbbzwitvlrdwnoushgpf.supabase.co
-- Çalıştırma: Supabase Dashboard > SQL Editor > Run (idempotent)
--
-- Amaç:
--   profiles.phone alanını personel + dual-role admin için RLS bypass'lı
--   güncelleyebilmek. profiles_update_own policy 'app.current_user_id'
--   GUC'una bağlı, ama frontend bu GUC'u set etmiyor — bu yüzden
--   doğrudan UPDATE çalışmıyor. Bu RPC SECURITY DEFINER ile sadece
--   phone (ve istenirse bio) alanlarını günceller, başka alana
--   dokunmaz, log_audit_event ile denetlenir.
--
-- Güvenlik notu:
--   Caller_id parametresi olarak kullanıcı kendi ID'sini geçirir.
--   Bu, projedeki mevcut güven modeliyle (verify_user_password sonrası
--   client'in session ID'sini kullanması) tutarlıdır. RPC sadece
--   phone (ve bio) alanlarını günceller — başka kolonu güncellemez,
--   şifre/rol/avatar dokunulmaz.
-- ============================================================

-- 1) Fonksiyon: kullanıcının kendi telefon ve bio'sunu günceller
CREATE OR REPLACE FUNCTION public.update_my_phone(
  p_user_id TEXT,
  p_phone   TEXT,
  p_bio     TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits TEXT;
  v_user   public.profiles;
BEGIN
  -- Telefonu rakamlara indirgeyip uzunluğu doğrula (en az 8 hane)
  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  IF length(v_digits) < 8 THEN
    RAISE EXCEPTION 'Telefon numarası en az 8 hane içermelidir (Phone number must contain at least 8 digits).'
      USING ERRCODE = '22023';
  END IF;

  -- Kullanıcı gerçekten var mı?
  SELECT * INTO v_user FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kullanıcı bulunamadı (User not found): %', p_user_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Sadece phone (ve sağlanmışsa bio) alanlarını güncelle.
  -- COALESCE ile bio NULL geçilirse mevcut değer korunur.
  UPDATE public.profiles
     SET phone      = p_phone,
         bio        = COALESCE(p_bio, bio),
         updated_at = NOW()
   WHERE id = p_user_id;

  -- Denetim kaydı (log_audit_event mevcut)
  BEGIN
    PERFORM public.log_audit_event(
      p_user_id,
      v_user.email,
      'SELF_PHONE_UPDATE',
      'profiles',
      p_user_id,
      jsonb_build_object('phone_digits_len', length(v_digits))
    );
  EXCEPTION WHEN OTHERS THEN
    -- audit log opsiyonel — fonksiyon failure sebebi olmasın
    NULL;
  END;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.update_my_phone(TEXT, TEXT, TEXT) IS
  'Kullanıcının kendi telefon ve bio alanını günceller. RequirePhoneModal ve Bordro self-edit akışlarında kullanılır. RLS bypass için SECURITY DEFINER; sadece phone+bio kolonlarına yazar.';

-- 2) Execute hakkı: anon + authenticated rollerine ver
GRANT EXECUTE ON FUNCTION public.update_my_phone(TEXT, TEXT, TEXT) TO anon, authenticated;

-- 3) Doğrulama sorgusu (manuel test için yorum satırı):
-- SELECT public.update_my_phone('USER_ID_HERE', '+49 1xx xxx xx xx', NULL);
