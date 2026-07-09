-- ===================================================================
-- VARDİYA PLANI — HÜCRE-GRANÜL ATOMİK YAZMA (Supabase Migration)
-- Hedef proje: xbbzwitvlrdwnoushgpf.supabase.co
-- Çalıştırma: Supabase Dashboard > SQL Editor > Run
--
-- SORUN: "Vardiya planında ekleme yapınca bazı personellerin günleri
-- kayboluyor." Kök neden: shift_save_row tek hücre değişikliğinde bile
-- istemcinin (bayat olabilen) lokal kopyasından 7 günün TAMAMINI yazar
-- (SET days = p_days). İki cihaz/iki admin veya uçuştaki save ile yarışan
-- bir refetch, satırı eski kopyayla ezip diğer günlerdeki atamaları
-- kalıcı olarak siler (satır-granül last-write-wins).
--
-- ÇÖZÜM: İstemci artık SONUCU değil OPERASYONU gönderir (ekle/çıkar/
-- değiştir). Sunucu satırı FOR UPDATE ile kilitler, operasyonu DB'deki
-- GÜNCEL hücre değeri üzerine uygular ve yalnızca o hücreyi yazar.
-- Bayat istemci bile başka hücre/günü ezemez; eşzamanlı add+add ikisini
-- de korur.
--
-- Bu migration TAMAMEN ADDITIVE'dir: mevcut fonksiyonlara (shift_save_row,
-- shift_delete_row, shift_replace_week, shift_publish, shift_unpublish),
-- RLS politikalarına ve yayın-bazlı taslak gizliliğine DOKUNMAZ. Eski
-- frontend sürümleri shift_save_row ile çalışmaya devam eder; yeni sürüm
-- deploy + force update sonrası hücre yazmaları buradaki RPC'lere geçer.
--
-- Not: profiles.id şeması TEXT olduğu için caller_id TEXT'tir.
--      days = TEXT[7]; hücre CSV personel ID listesi ("id1,id2").
--      CSV semantiği lib/utils.ts parseCellIds/joinCellIds ile birebirdir:
--      trim + boş filtre + sıra koruyan dedupe.
-- ===================================================================

-- 1) HÜCRE-GRANÜL ATOMİK MUTASYON ------------------------------------
-- p_day_index: 0=Montag ... 6=Sonntag (istemci 0-indexli; Postgres
-- dizileri 1-indexli olduğundan içeride v_pos = p_day_index + 1).
-- Operasyon seçimi:
--   p_add dolu,  p_remove NULL  → ADD    (zaten varsa no-op)
--   p_add NULL,  p_remove dolu  → REMOVE
--   p_add dolu,  p_remove dolu  → REPLACE (p_remove yerine p_add; p_remove
--                                 hücrede yoksa p_add sona eklenir)
-- Dönüş: güncellenmiş satırın tamamı — istemci yalnızca bu satırı
-- reconcile eder, tüm grid'i yeniden çekmez.
CREATE OR REPLACE FUNCTION public.shift_cell_apply(
  p_caller_id TEXT,
  p_id        UUID,
  p_day_index INT,
  p_add       TEXT DEFAULT NULL,
  p_remove    TEXT DEFAULT NULL
) RETURNS public.shift_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row  public.shift_schedules;
  v_days TEXT[];
  v_ids  TEXT[];
  v_pos  INT := p_day_index + 1;
BEGIN
  IF NOT public.shift_is_editor(p_caller_id) THEN
    RAISE EXCEPTION 'Yetkisiz: Vardiya planını yalnızca süper adminler düzenleyebilir.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_day_index IS NULL OR p_day_index < 0 OR p_day_index > 6 THEN
    RAISE EXCEPTION 'Geçersiz gün indeksi: %', p_day_index
      USING ERRCODE = 'P0001';
  END IF;

  -- KİLİT: aynı satıra eşzamanlı hücre işlemleri sıraya girer →
  -- read-modify-write yarışı DB seviyesinde biter.
  SELECT * INTO v_row FROM public.shift_schedules WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Satır başka bir cihazda silinmiş — istemci P0002'yi yakalayıp
    -- kullanıcıya bildirir ve grid'i yeniler.
    RAISE EXCEPTION 'SHIFT_ROW_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Kısa/NULL dizi savunması: her zaman 7 elemanlı çalış.
  v_days := COALESCE(v_row.days, ARRAY['','','','','','','']::TEXT[]);
  WHILE COALESCE(array_length(v_days, 1), 0) < 7 LOOP
    v_days := array_append(v_days, '');
  END LOOP;

  -- CSV -> dizi (parseCellIds semantiği: trim + boş filtre)
  SELECT COALESCE(array_agg(x ORDER BY ord), '{}') INTO v_ids
    FROM (
      SELECT TRIM(u) AS x, ord
        FROM unnest(string_to_array(COALESCE(v_days[v_pos], ''), ',')) WITH ORDINALITY AS t(u, ord)
       WHERE TRIM(u) <> ''
    ) s;

  IF p_add IS NOT NULL AND p_remove IS NOT NULL THEN
    -- REPLACE: yerinde değiştir; hedef yoksa sona ekle
    IF p_remove = ANY(v_ids) THEN
      v_ids := array_replace(v_ids, p_remove, p_add);
    ELSIF NOT (p_add = ANY(v_ids)) THEN
      v_ids := array_append(v_ids, p_add);
    END IF;
  ELSIF p_add IS NOT NULL THEN
    -- ADD: zaten varsa no-op
    IF NOT (p_add = ANY(v_ids)) THEN
      v_ids := array_append(v_ids, p_add);
    END IF;
  ELSIF p_remove IS NOT NULL THEN
    v_ids := array_remove(v_ids, p_remove);
  END IF;

  -- Sıra koruyan dedupe (array_replace duplikat üretebilir;
  -- joinCellIds semantiği)
  SELECT COALESCE(array_agg(x ORDER BY ord), '{}') INTO v_ids
    FROM (
      SELECT DISTINCT ON (x) x, ord
        FROM unnest(v_ids) WITH ORDINALITY AS t(x, ord)
       ORDER BY x, ord
    ) d;

  -- Yalnızca hedef hücre yazılır — satırın diğer 6 günü DB'deki
  -- haliyle kalır.
  UPDATE public.shift_schedules
     SET days[v_pos] = array_to_string(v_ids, ',')
   WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.shift_cell_apply(TEXT, UUID, INT, TEXT, TEXT) IS
  'Tek vardiya hücresine atomik ekle/çıkar/değiştir. FOR UPDATE kilidi altında sunucu-tarafı merge — bayat istemci diğer gün/hücreleri ezemez.';

-- 2) YALNIZCA SAAT ETİKETİ -------------------------------------------
-- time_slot güncellemesi days'e HİÇ dokunmaz. Eski akışta saat etiketi
-- onBlur'da tüm satırı (days dahil) bayat render kopyasından yazıyordu;
-- bu fonksiyon o kayıp yolunu kökten kapatır.
CREATE OR REPLACE FUNCTION public.shift_set_time_slot(
  p_caller_id TEXT,
  p_id        UUID,
  p_time_slot TEXT
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

  UPDATE public.shift_schedules
     SET time_slot = COALESCE(p_time_slot, '')
   WHERE id = p_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'SHIFT_ROW_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.shift_set_time_slot(TEXT, UUID, TEXT) IS
  'Vardiya satırının yalnızca saat etiketini günceller — days dizisine dokunmaz.';

-- 3) İZİNLER + POSTGREST ŞEMA CACHE ----------------------------------
GRANT EXECUTE ON FUNCTION public.shift_cell_apply(TEXT, UUID, INT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_set_time_slot(TEXT, UUID, TEXT)         TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ===================================================================
-- DOĞRULAMA (Dashboard'da elle):
--   SELECT proname FROM pg_proc WHERE proname IN ('shift_cell_apply','shift_set_time_slot');
--   → 2 satır dönmeli.
-- Deploy sırası: 1) bu migration  2) frontend deploy  3) force update.
-- ===================================================================
