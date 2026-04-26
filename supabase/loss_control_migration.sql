-- ===================================
-- KAYIP ÖNLEME SİSTEMİ - Supabase Migration
-- ===================================

-- 1. STOK GİRİŞLERİ TABLOSU
-- Şubeye gelen ürün miktarlarını takip eder
CREATE TABLE IF NOT EXISTS stock_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_name TEXT NOT NULL,
  branch TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  entered_by UUID NOT NULL REFERENCES auth.users(id),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. FİZİKSEL SAYIM TABLOSU
-- Şubedeki gerçek stok sayımını kaydeder
CREATE TABLE IF NOT EXISTS stock_counts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_name TEXT NOT NULL,
  branch TEXT NOT NULL,
  counted_quantity INTEGER NOT NULL CHECK (counted_quantity >= 0),
  count_date DATE NOT NULL DEFAULT CURRENT_DATE,
  counted_by UUID NOT NULL REFERENCES auth.users(id),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. INDEX'LER (Performans)
CREATE INDEX IF NOT EXISTS idx_stock_entries_branch ON stock_entries(branch);
CREATE INDEX IF NOT EXISTS idx_stock_entries_date ON stock_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_stock_entries_product ON stock_entries(product_name);
CREATE INDEX IF NOT EXISTS idx_stock_counts_branch ON stock_counts(branch);
CREATE INDEX IF NOT EXISTS idx_stock_counts_date ON stock_counts(count_date);

-- 4. RLS POLİTİKALARI
ALTER TABLE stock_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;

-- Sadece Admin (cevikademm@gmail.com) okuyabilir ve yazabilir
CREATE POLICY "Admin full access stock_entries" ON stock_entries
  FOR ALL
  USING (
    auth.uid() IN (
      SELECT id FROM auth.users WHERE email = 'cevikademm@gmail.com'
    )
  )
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM auth.users WHERE email = 'cevikademm@gmail.com'
    )
  );

CREATE POLICY "Admin full access stock_counts" ON stock_counts
  FOR ALL
  USING (
    auth.uid() IN (
      SELECT id FROM auth.users WHERE email = 'cevikademm@gmail.com'
    )
  )
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM auth.users WHERE email = 'cevikademm@gmail.com'
    )
  );

-- ===================================
-- NOT: Bu SQL'i Supabase Dashboard > SQL Editor'da çalıştırın.
-- Eğer profiles tablosu auth.users yerine kullanılıyorsa,
-- entered_by/counted_by referanslarını profiles(id) olarak değiştirin.
-- ===================================
