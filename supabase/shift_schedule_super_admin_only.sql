-- ===================================================================
-- VARDİYA PLANI — SÜPER ADMIN YALNIZCA YAZMA (Supabase Migration)
-- Hedef proje: xbbzwitvlrdwnoushgpf.supabase.co
-- Çalıştırma: Supabase Dashboard > SQL Editor > Run
--
-- Amaç: shift_schedules ve shift_publications tablolarına YALNIZCA
--       süper adminler (cevikademm@gmail.com + seda@bac.de) yazabilir.
--       Diğer tüm adminler/personeller planı yalnızca GÖRÜNTÜLER.
--
-- NEDEN SUNUCU TARAFI? İstemci (ShiftSchedule.tsx) içinde
-- canEditShiftSchedule kontrolü zaten var; AMA eski sürümde kalmış
-- (güncelleme almamış) cihazlardaki adminler hâlâ doğrudan REST ile
-- yazabiliyordu. Bu migration yazmayı DB seviyesinde kapatır: admin
-- hangi uygulama sürümünü çalıştırırsa çalıştırsın, yalnızca yetkili
-- süper adminin RPC çağrısı geçerlidir. Diğer her yazma reddedilir.
--
-- Mimari: tablolarda doğrudan INSERT/UPDATE/DELETE RLS ile kapatılır
--         (SELECT herkese açık kalır). Tüm yazma işlemleri SECURITY
--         DEFINER RPC'ler üzerinden yapılır; her RPC çağıranın süper
--         admin olduğunu profiles.email üzerinden doğrular.
--         (loss_control_admin_only.sql ile aynı desen.)
--
-- Not: profiles.id şeması TEXT olduğu için tüm caller_id'ler TEXT'tir.
--      shift_schedules.week_start_date = TEXT, days = TEXT[].
--      shift_publications.week_start_date = DATE.
-- ===================================================================

-- 1) YETKİ KONTROL FONKSİYONU ---------------------------------------
-- Çağıranın (profiles.id) vardiya düzenleme yetkisi var mı?
CREATE OR REPLACE FUNCTION public.shift_is_editor(p_caller_id TEXT)
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
       AND LOWER(TRIM(email)) IN ('cevikademm@gmail.com', 'seda@bac.de')
  );
$$;

COMMENT ON FUNCTION public.shift_is_editor(TEXT) IS
  'Vardiya planı düzenleme yetkisi — yalnızca süper adminler (cevikademm + seda).';

-- 1b) TASLAK GÖRÜNTÜLEME YETKİSİ ------------------------------------
-- Çağıranın yayınlanmamış (taslak) vardiya planını görme yetkisi var mı?
-- Düzenleme yetkisinden (shift_is_editor) AYRIDIR ve daha geniştir:
-- hakan + gurcan taslağı GÖRÜR ama düzenleyemez. Personel + diğer adminler
-- taslağı hiç göremez; yalnızca yayınlanmış satırları görür.
-- NOT: Bu liste frontend SHIFT_DRAFT_VIEW_ALLOWED_EMAILS ile bire bir aynı olmalı.
CREATE OR REPLACE FUNCTION public.shift_can_view_draft(p_caller_id TEXT)
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
       AND LOWER(TRIM(email)) IN (
         'cevikademm@gmail.com',
         'seda@bac.de',
         'hakan@bac.de',
         'gurcan@bac.de'
       )
  );
$$;

COMMENT ON FUNCTION public.shift_can_view_draft(TEXT) IS
  'Vardiya TASLAĞINI görüntüleme yetkisi — cevikadem, seda, hakan, gurcan.';

-- 1c) HAFTA SATIRLARINI GÜVENLİ OKU (TASLAK DAHİL) ------------------
-- Tüm vardiya okumaları bu RPC üzerinden yapılır. Çağıran taslak görme
-- yetkisine sahipse o hafta(+şube) için TÜM satırları (taslak dahil) döner;
-- değilse yalnızca YAYINLANMIŞ satırları döner. p_branch NULL ise tüm şubeler.
-- SECURITY DEFINER olduğu için RLS'i bypass eder, yetkiyi kendi içinde uygular.
CREATE OR REPLACE FUNCTION public.shift_get_week_rows(
  p_caller_id TEXT,
  p_week      TEXT,
  p_branch    TEXT DEFAULT NULL
) RETURNS SETOF public.shift_schedules
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.*
    FROM public.shift_schedules s
   WHERE s.week_start_date = p_week
     AND (p_branch IS NULL OR s.branch = p_branch)
     AND (
       public.shift_can_view_draft(p_caller_id)
       OR EXISTS (
         SELECT 1
           FROM public.shift_publications pub
          WHERE pub.week_start_date::text = s.week_start_date
            AND pub.branch = s.branch
       )
     )
   ORDER BY s.created_at ASC;
$$;

COMMENT ON FUNCTION public.shift_get_week_rows(TEXT, TEXT, TEXT) IS
  'Hafta vardiya satırlarını döner. Taslak yetkisi yoksa yalnızca yayınlanmışları verir.';

-- 2) TEK SATIR KAYDET (INSERT/UPDATE) -------------------------------
-- p_id NULL ise INSERT, dolu ise UPDATE. Kaydedilen satırı geri döner.
CREATE OR REPLACE FUNCTION public.shift_save_row(
  p_caller_id TEXT,
  p_id        UUID,
  p_week      TEXT,
  p_branch    TEXT,
  p_time_slot TEXT,
  p_days      TEXT[]
) RETURNS public.shift_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.shift_schedules;
BEGIN
  IF NOT public.shift_is_editor(p_caller_id) THEN
    RAISE EXCEPTION 'Yetkisiz: Vardiya planını yalnızca süper adminler düzenleyebilir.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.shift_schedules (week_start_date, branch, time_slot, days)
    VALUES (p_week, p_branch, COALESCE(p_time_slot, ''),
            COALESCE(p_days, ARRAY['','','','','','','']::TEXT[]))
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.shift_schedules
       SET week_start_date = p_week,
           branch          = p_branch,
           time_slot       = COALESCE(p_time_slot, ''),
           days            = COALESCE(p_days, ARRAY['','','','','','','']::TEXT[])
     WHERE id = p_id
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

-- 3) TEK SATIR SİL --------------------------------------------------
CREATE OR REPLACE FUNCTION public.shift_delete_row(
  p_caller_id TEXT,
  p_id        UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.shift_is_editor(p_caller_id) THEN
    RAISE EXCEPTION 'Yetkisiz: Vardiya planını yalnızca süper adminler düzenleyebilir.'
      USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.shift_schedules WHERE id = p_id;
END;
$$;

-- 4) HAFTAYI KOMPLE DEĞİŞTİR (KOPYALAMA) ----------------------------
-- Hedef hafta+şube satırlarını siler, p_rows (jsonb dizi) içeriğini
-- yeniden ekler ve hedef haftanın yayın kaydını düşürür (taze onay gerekir).
-- p_rows formatı: [{ "time_slot": "09:00-17:00", "days": ["id1,id2","",...] }, ...]
CREATE OR REPLACE FUNCTION public.shift_replace_week(
  p_caller_id TEXT,
  p_week      TEXT,
  p_branch    TEXT,
  p_rows      JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.shift_is_editor(p_caller_id) THEN
    RAISE EXCEPTION 'Yetkisiz: Vardiya planını yalnızca süper adminler düzenleyebilir.'
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.shift_schedules
   WHERE week_start_date = p_week AND branch = p_branch;

  INSERT INTO public.shift_schedules (week_start_date, branch, time_slot, days)
  SELECT p_week,
         p_branch,
         COALESCE(elem->>'time_slot', ''),
         COALESCE(
           (SELECT array_agg(d) FROM jsonb_array_elements_text(elem->'days') AS d),
           ARRAY['','','','','','','']::TEXT[]
         )
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS elem;

  -- İçerik ezildiği için hedef haftanın onayı geri çekilir.
  DELETE FROM public.shift_publications
   WHERE week_start_date = p_week::date AND branch = p_branch;
END;
$$;

-- 5) HAFTAYI YAYINLA (UPSERT) ---------------------------------------
CREATE OR REPLACE FUNCTION public.shift_publish(
  p_caller_id        TEXT,
  p_week             TEXT,
  p_branch           TEXT,
  p_published_by     TEXT,
  p_published_by_name TEXT
) RETURNS public.shift_publications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.shift_publications;
BEGIN
  IF NOT public.shift_is_editor(p_caller_id) THEN
    RAISE EXCEPTION 'Yetkisiz: Vardiya planını yalnızca süper adminler yayınlayabilir.'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.shift_publications
        (week_start_date, branch, published_at, published_by, published_by_name)
  VALUES (p_week::date, p_branch, NOW(), p_published_by, p_published_by_name)
  ON CONFLICT (week_start_date, branch)
  DO UPDATE SET published_at      = NOW(),
                published_by      = EXCLUDED.published_by,
                published_by_name = EXCLUDED.published_by_name
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- 6) YAYINI GERİ ÇEK ------------------------------------------------
CREATE OR REPLACE FUNCTION public.shift_unpublish(
  p_caller_id TEXT,
  p_id        UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.shift_is_editor(p_caller_id) THEN
    RAISE EXCEPTION 'Yetkisiz: Yayını yalnızca süper adminler geri çekebilir.'
      USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.shift_publications WHERE id = p_id;
END;
$$;

-- 7) RLS SIKILAŞTIRMA — doğrudan yazma kapatılır, SELECT açık kalır --
ALTER TABLE public.shift_schedules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_publications ENABLE ROW LEVEL SECURITY;

-- Her iki tablodaki TÜM mevcut politikaları temizle (açık yazma dahil).
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT policyname, tablename
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('shift_schedules', 'shift_publications')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- shift_schedules: doğrudan SELECT YALNIZCA yayınlanmış (onaylanmış) satırlara
-- açıktır. Taslak satırlar anon/REST üzerinden hiç görünmez — auth.uid() olmadığı
-- için kimliğe dayalı satır filtresi yapılamaz, bu yüzden taslak okuması yalnızca
-- shift_get_week_rows RPC'si (caller_id doğrular) üzerinden mümkündür.
-- Bir satırın "yayınlanmış" sayılması için aynı (week_start_date, branch) için
-- shift_publications'ta kayıt olmalıdır. (week_start_date TEXT↔DATE: ::text ile
-- karşılaştırılır; her ikisi de 'YYYY-MM-DD' formatındadır, cast hatası olmaz.)
CREATE POLICY "shift_schedules_select_published" ON public.shift_schedules
  FOR SELECT USING (
    EXISTS (
      SELECT 1
        FROM public.shift_publications p
       WHERE p.week_start_date::text = public.shift_schedules.week_start_date
         AND p.branch = public.shift_schedules.branch
    )
  );

-- shift_publications: yalnızca yayın durumu metası (kim, ne zaman onayladı).
-- Hassas vardiya içeriği barındırmaz; durum kontrolü için okuma açık kalır.
CREATE POLICY "shift_publications_select_all" ON public.shift_publications
  FOR SELECT USING (true);

-- 8) RPC ÇALIŞTIRMA İZİNLERİ -----------------------------------------
GRANT EXECUTE ON FUNCTION public.shift_is_editor(TEXT)                        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_can_view_draft(TEXT)                   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_get_week_rows(TEXT, TEXT, TEXT)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_save_row(TEXT, UUID, TEXT, TEXT, TEXT, TEXT[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_delete_row(TEXT, UUID)                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_replace_week(TEXT, TEXT, TEXT, JSONB)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_publish(TEXT, TEXT, TEXT, TEXT, TEXT)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_unpublish(TEXT, UUID)                  TO anon, authenticated;

-- 9) PostgREST şema cache'ini hemen yenile — RPC'ler anında çağrılabilir.
NOTIFY pgrst, 'reload schema';
