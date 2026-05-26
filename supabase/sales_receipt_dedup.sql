-- =====================================================
-- SALES_LOGS: MÜKERRER FİŞ ENGELLEME (SHA-256 + dHash)
-- - receipt_sha256: bit-eşit aynı dosya tespiti (hard block)
-- - receipt_dhash:  perceptual benzerlik (screenshot, re-encode, kırpma)
-- - dedup_warning:  benzer fiş onayı admin'e gitti
-- - Partial UNIQUE index: status<>'Reddedildi' kayıtlarda hash tekrar edemez
-- - check_receipt_duplicate RPC: client pre-check için
-- =====================================================

-- 1) Kolonlar
ALTER TABLE sales_logs
  ADD COLUMN IF NOT EXISTS receipt_sha256    CHAR(64),
  ADD COLUMN IF NOT EXISTS receipt_dhash     BIGINT,
  ADD COLUMN IF NOT EXISTS dedup_warning     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS dedup_override_by UUID,
  ADD COLUMN IF NOT EXISTS dedup_override_at TIMESTAMPTZ;

-- 2) Hard duplicate guard — reddedilmiş kayıtlar hariç (admin reddederse
--    aynı dosya tekrar yüklenebilir; örn. ürün adı düzeltmesi)
CREATE UNIQUE INDEX IF NOT EXISTS sales_logs_receipt_sha256_uniq
  ON sales_logs (receipt_sha256)
  WHERE receipt_sha256 IS NOT NULL AND status <> 'Reddedildi';

-- 3) dHash benzerlik aramasını hızlandırmak için
CREATE INDEX IF NOT EXISTS sales_logs_dhash_idx
  ON sales_logs (receipt_dhash)
  WHERE receipt_dhash IS NOT NULL;

-- 4) Atomik pre-check RPC
--    Client compressImageToJpeg sonrası sha256 + dhash hesaplar,
--    bu RPC'yi çağırır. exact bulunursa hard block; similar bulunursa
--    soft warning. Kapsam: exact 365 gün, similar 90 gün, global cross-user.
CREATE OR REPLACE FUNCTION check_receipt_duplicate(
  p_sha256 CHAR(64),
  p_dhash  BIGINT
) RETURNS TABLE(
  match_type             TEXT,
  matched_log_id         UUID,
  matched_employee_id    UUID,
  matched_employee_name  TEXT,
  matched_sale_date      DATE,
  matched_branch         TEXT,
  hamming_distance       INT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Exact (SHA-256, 365 gün, global)
  RETURN QUERY
  SELECT 'exact'::TEXT,
         sl.id,
         sl.employee_id,
         COALESCE(p.full_name, 'Personel')::TEXT,
         sl.sale_date,
         sl.branch::TEXT,
         0
  FROM sales_logs sl
  LEFT JOIN profiles p ON p.id = sl.employee_id
  WHERE sl.receipt_sha256 = p_sha256
    AND sl.status <> 'Reddedildi'
    AND sl.created_at > NOW() - INTERVAL '365 days'
  ORDER BY sl.created_at ASC
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- Similar (dHash Hamming ≤ 6, 90 gün, global)
  -- (a XOR b) bit'lerini sayarak Hamming distance bulunur.
  RETURN QUERY
  WITH cand AS (
    SELECT sl.id,
           sl.employee_id,
           sl.sale_date,
           sl.branch,
           sl.created_at,
           length(replace(
             ((sl.receipt_dhash # p_dhash)::BIT(64))::TEXT,
             '0', ''
           )) AS hd
    FROM sales_logs sl
    WHERE sl.receipt_dhash IS NOT NULL
      AND sl.status <> 'Reddedildi'
      AND sl.created_at > NOW() - INTERVAL '90 days'
  )
  SELECT 'similar'::TEXT,
         c.id,
         c.employee_id,
         COALESCE(p.full_name, 'Personel')::TEXT,
         c.sale_date,
         c.branch::TEXT,
         c.hd
  FROM cand c
  LEFT JOIN profiles p ON p.id = c.employee_id
  WHERE c.hd <= 6
  ORDER BY c.hd ASC, c.created_at ASC
  LIMIT 1;
END;
$$;

-- 5) Anon role'a execute izni (uygulama anon key kullanıyor)
GRANT EXECUTE ON FUNCTION check_receipt_duplicate(CHAR, BIGINT) TO anon, authenticated;

-- =====================================================
-- NOT: Bu SQL'i Supabase Dashboard > SQL Editor'da çalıştırın.
-- Backfill için ayrı edge function: supabase/functions/backfill-receipt-hashes
-- =====================================================
