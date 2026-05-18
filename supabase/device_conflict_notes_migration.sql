-- ===================================================================
-- TELEFON ÇAKIŞMA NOTLARI — admin tarafından yazılan açıklama satırı
-- Hedef proje: xbbzwitvlrdwnoushgpf.supabase.co
-- Çalıştırma: Supabase Dashboard > SQL Editor > Run
--
-- Amaç: DeviceBrands "Çakışmalar" sekmesindeki her telefon-çakışma
--       kartına (employee_id × device_used çifti) opsiyonel yönetici
--       notu eklemek. Örnek kullanım: "Saniye'ye soruldu, telefonu
--       tamirde, 2 hafta Aleyna'nın eski telefonunu kullanıyor."
--
-- Notlar:
-- * profiles.id şeması TEXT olduğu için employee_id ve updated_by TEXT.
-- * device_used: time_logs.device_info'nun aynısı ("Apple iPhone · MAC")
--   — uzun olabilir ama PK'de sorun yok.
-- * Yetki: Admin rolü VEYA cihaz bilgisi görme allowlist'i
--   (cevikademm, gurcan, hakan, seda) — DEVICE_INFO_VISIBLE_EMAILS ile aynı.
-- ===================================================================

-- 1) Tablo --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_conflict_notes (
  employee_id     TEXT NOT NULL,
  device_used     TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT,
  updated_by_name TEXT,
  PRIMARY KEY (employee_id, device_used)
);

COMMENT ON TABLE public.device_conflict_notes IS
  'Telefon çakışması kartları için admin notları — kayıt silinmez, açıklama eklenir.';

-- 2) Yetki helper'ı -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.dcn_is_authorized(p_caller_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles
     WHERE id = p_caller_id
       AND (
         role = 'Admin'
         OR LOWER(TRIM(email)) IN (
           'cevikademm@gmail.com',
           'gurcan@bac.de',
           'hakan@bac.de',
           'seda@bac.de'
         )
       )
  );
$$;

COMMENT ON FUNCTION public.dcn_is_authorized(TEXT) IS
  'Çakışma notu görme/yazma yetkisi (Admin rolü VEYA cihaz bilgisi allowlist).';

-- 3) Liste RPC ----------------------------------------------------------
-- Tek seferde tüm notları döndürür (kayıt sayısı çok az olacak,
-- her çakışma için bir satır; pagination gereksiz).
CREATE OR REPLACE FUNCTION public.dcn_list_notes(p_caller_id TEXT)
RETURNS SETOF public.device_conflict_notes
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.dcn_is_authorized(p_caller_id) THEN
    RAISE EXCEPTION 'Yetkisiz erişim: çakışma notlarına yalnızca yetkili admin hesapları erişebilir.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  SELECT *
    FROM public.device_conflict_notes
    ORDER BY updated_at DESC;
END;
$$;

-- 4) Upsert RPC ---------------------------------------------------------
-- Boş not yazılırsa kayıt silinir.
CREATE OR REPLACE FUNCTION public.dcn_save_note(
  p_caller_id   TEXT,
  p_employee_id TEXT,
  p_device_used TEXT,
  p_note        TEXT
) RETURNS public.device_conflict_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row        public.device_conflict_notes;
  v_caller_nm  TEXT;
  v_trimmed    TEXT;
BEGIN
  IF NOT public.dcn_is_authorized(p_caller_id) THEN
    RAISE EXCEPTION 'Yetkisiz erişim.' USING ERRCODE = 'P0001';
  END IF;

  v_trimmed := COALESCE(TRIM(p_note), '');

  -- Boş not → kaydı sil ve NULL döndür
  IF v_trimmed = '' THEN
    DELETE FROM public.device_conflict_notes
     WHERE employee_id = p_employee_id
       AND device_used = p_device_used;
    RETURN NULL;
  END IF;

  SELECT full_name INTO v_caller_nm
    FROM public.profiles
   WHERE id = p_caller_id;

  INSERT INTO public.device_conflict_notes
    (employee_id, device_used, note, updated_at, updated_by, updated_by_name)
  VALUES
    (p_employee_id, p_device_used, v_trimmed, now(), p_caller_id, v_caller_nm)
  ON CONFLICT (employee_id, device_used)
  DO UPDATE SET
    note            = EXCLUDED.note,
    updated_at      = EXCLUDED.updated_at,
    updated_by      = EXCLUDED.updated_by,
    updated_by_name = EXCLUDED.updated_by_name
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- 5) RLS — doğrudan REST erişimini kapat, sadece RPC üzerinden -----------
ALTER TABLE public.device_conflict_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dcn_no_direct" ON public.device_conflict_notes;
CREATE POLICY "dcn_no_direct" ON public.device_conflict_notes
  FOR ALL USING (false) WITH CHECK (false);

-- 6) RPC çalıştırma izinleri ---------------------------------------------
GRANT EXECUTE ON FUNCTION public.dcn_is_authorized(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dcn_list_notes(TEXT)    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dcn_save_note(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
