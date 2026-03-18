
-- 1. Eklentileri Aktif Et
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Tabloları Oluştur

-- Personel Profilleri
CREATE TABLE IF NOT EXISTS public.profiles (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL, -- Bcrypt hash ile saklanır
  full_name TEXT NOT NULL,
  role TEXT DEFAULT 'Personel', -- 'Admin' veya 'Personel'
  branch TEXT, -- 'Dom', 'Backaffee' vb.
  hourly_rate DECIMAL(10, 2) DEFAULT 15.00,
  tax_class INTEGER DEFAULT 1,
  avatar_url TEXT,
  phone TEXT,
  bio TEXT,
  badges TEXT[],
  tags TEXT[],
  metrics JSONB DEFAULT '{"speed": 50, "satisfaction": 50, "attendance": 50}'::jsonb,
  advances DECIMAL(10, 2) DEFAULT 0.00,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Mesai Kayıtları
CREATE TABLE IF NOT EXISTS public.time_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  break_duration INTEGER DEFAULT 60,
  total_hours DECIMAL(5, 2),
  status TEXT DEFAULT 'Bekliyor',
  branch TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Görevler
CREATE TABLE IF NOT EXISTS public.tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to TEXT[] DEFAULT '{}',
  due_date DATE,
  priority TEXT,
  status TEXT DEFAULT 'todo',
  progress INTEGER DEFAULT 0,
  checklist JSONB DEFAULT '[]'::jsonb,
  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Mesajlar
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  receiver_id TEXT NOT NULL,
  subject TEXT,
  content TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Takvim Etkinlikleri & Transferler
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  type TEXT,
  date DATE NOT NULL,
  end_date DATE,
  start_time TEXT,
  end_time TEXT,
  description TEXT,
  attendees TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vardiya Planı
CREATE TABLE IF NOT EXISTS public.shift_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start_date TEXT NOT NULL,
  branch TEXT NOT NULL,
  time_slot TEXT DEFAULT '',
  days TEXT[] DEFAULT ARRAY['', '', '', '', '', '', '']::TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Performans İndeksi (Vardiya Planı İçin)
CREATE INDEX IF NOT EXISTS idx_shift_week_branch ON public.shift_schedules (week_start_date, branch);

-- Aktion (Satış) Kayıtları
CREATE TABLE IF NOT EXISTS public.sales_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  branch TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  sale_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'Bekliyor',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- MIGRATION: Eğer tablo önceden varsa ve status kolonu yoksa ekle
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_logs' AND column_name = 'status') THEN
        ALTER TABLE public.sales_logs ADD COLUMN status TEXT DEFAULT 'Bekliyor';
    END IF;
END $$;

-- Uygulama Ayarları
CREATE TABLE IF NOT EXISTS public.app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 2.1 DENETİM KAYDI TABLOSU (Audit Log)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT,
    user_email TEXT,
    action TEXT NOT NULL, -- 'LOGIN', 'UPDATE', 'DELETE', 'PASSWORD_RESET', 'ADMIN_ACTION' vb.
    target_table TEXT,
    target_id TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON public.audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON public.audit_logs (action, created_at DESC);

-- Audit Log RPC Fonksiyonu
CREATE OR REPLACE FUNCTION log_audit_event(
    p_user_id TEXT,
    p_user_email TEXT,
    p_action TEXT,
    p_target_table TEXT DEFAULT NULL,
    p_target_id TEXT DEFAULT NULL,
    p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS void AS $$
BEGIN
    INSERT INTO public.audit_logs (user_id, user_email, action, target_table, target_id, details)
    VALUES (p_user_id, p_user_email, p_action, p_target_table, p_target_id, p_details);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. Güvenlik Politikaları (RLS - Üretim Modu: Kullanıcı Bazlı Erişim)
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Mevcut politikaları temizle
DO $$
BEGIN
    -- Eski politikalar
    DROP POLICY IF EXISTS "Public Profiles Access" ON public.profiles;
    DROP POLICY IF EXISTS "Public TimeLogs Access" ON public.time_logs;
    DROP POLICY IF EXISTS "Public Tasks Access" ON public.tasks;
    DROP POLICY IF EXISTS "Public Messages Access" ON public.messages;
    DROP POLICY IF EXISTS "Public Calendar Access" ON public.calendar_events;
    DROP POLICY IF EXISTS "Public Shift Access" ON public.shift_schedules;
    DROP POLICY IF EXISTS "Public Sales Access" ON public.sales_logs;
    DROP POLICY IF EXISTS "Public Settings Access" ON public.app_settings;
    -- Yeni politikalar
    DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
    DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
    DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
    DROP POLICY IF EXISTS "timelogs_select_own" ON public.time_logs;
    DROP POLICY IF EXISTS "timelogs_insert_own" ON public.time_logs;
    DROP POLICY IF EXISTS "timelogs_admin_all" ON public.time_logs;
    DROP POLICY IF EXISTS "tasks_select_assigned" ON public.tasks;
    DROP POLICY IF EXISTS "tasks_admin_all" ON public.tasks;
    DROP POLICY IF EXISTS "messages_select_own" ON public.messages;
    DROP POLICY IF EXISTS "messages_insert_own" ON public.messages;
    DROP POLICY IF EXISTS "messages_admin_all" ON public.messages;
    DROP POLICY IF EXISTS "calendar_select_all" ON public.calendar_events;
    DROP POLICY IF EXISTS "calendar_admin_all" ON public.calendar_events;
    DROP POLICY IF EXISTS "shifts_select_all" ON public.shift_schedules;
    DROP POLICY IF EXISTS "shifts_admin_all" ON public.shift_schedules;
    DROP POLICY IF EXISTS "sales_select_own" ON public.sales_logs;
    DROP POLICY IF EXISTS "sales_insert_own" ON public.sales_logs;
    DROP POLICY IF EXISTS "sales_admin_all" ON public.sales_logs;
    DROP POLICY IF EXISTS "settings_select_all" ON public.app_settings;
    DROP POLICY IF EXISTS "settings_admin_all" ON public.app_settings;
    DROP POLICY IF EXISTS "audit_admin_only" ON public.audit_logs;
    DROP POLICY IF EXISTS "audit_insert_all" ON public.audit_logs;
END $$;

-- PROFILES: Herkes okuyabilir, sadece kendi profilini güncelleyebilir, Admin tam yetki
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE
  USING (id = current_setting('app.current_user_id', true))
  WITH CHECK (id = current_setting('app.current_user_id', true));
CREATE POLICY "profiles_admin_all" ON public.profiles FOR ALL
  USING (current_setting('app.current_user_role', true) = 'Admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'Admin');

-- TIME_LOGS: Personel kendi kayıtlarını görür/ekler, Admin tam yetki
CREATE POLICY "timelogs_select_own" ON public.time_logs FOR SELECT
  USING (employee_id = current_setting('app.current_user_id', true) OR current_setting('app.current_user_role', true) = 'Admin');
CREATE POLICY "timelogs_insert_own" ON public.time_logs FOR INSERT
  WITH CHECK (employee_id = current_setting('app.current_user_id', true) OR current_setting('app.current_user_role', true) = 'Admin');
CREATE POLICY "timelogs_admin_all" ON public.time_logs FOR ALL
  USING (current_setting('app.current_user_role', true) = 'Admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'Admin');

-- TASKS: Atanan kişi görebilir, Admin tam yetki
CREATE POLICY "tasks_select_assigned" ON public.tasks FOR SELECT
  USING (current_setting('app.current_user_id', true) = ANY(assigned_to) OR current_setting('app.current_user_role', true) = 'Admin');
CREATE POLICY "tasks_admin_all" ON public.tasks FOR ALL
  USING (current_setting('app.current_user_role', true) = 'Admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'Admin');

-- MESSAGES: Sadece kendi mesajlarını görür, Admin tam yetki
CREATE POLICY "messages_select_own" ON public.messages FOR SELECT
  USING (sender_id = current_setting('app.current_user_id', true) OR receiver_id = current_setting('app.current_user_id', true) OR receiver_id = 'ALL' OR current_setting('app.current_user_role', true) = 'Admin');
CREATE POLICY "messages_insert_own" ON public.messages FOR INSERT
  WITH CHECK (sender_id = current_setting('app.current_user_id', true) OR current_setting('app.current_user_role', true) = 'Admin');
CREATE POLICY "messages_admin_all" ON public.messages FOR ALL
  USING (current_setting('app.current_user_role', true) = 'Admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'Admin');

-- CALENDAR_EVENTS: Herkes okuyabilir, Admin tam yetki
CREATE POLICY "calendar_select_all" ON public.calendar_events FOR SELECT USING (true);
CREATE POLICY "calendar_admin_all" ON public.calendar_events FOR ALL
  USING (current_setting('app.current_user_role', true) = 'Admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'Admin');

-- SHIFT_SCHEDULES: Herkes okuyabilir, Admin tam yetki
CREATE POLICY "shifts_select_all" ON public.shift_schedules FOR SELECT USING (true);
CREATE POLICY "shifts_admin_all" ON public.shift_schedules FOR ALL
  USING (current_setting('app.current_user_role', true) = 'Admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'Admin');

-- SALES_LOGS: Personel kendi satışlarını görür/ekler, Admin tam yetki
CREATE POLICY "sales_select_own" ON public.sales_logs FOR SELECT
  USING (employee_id = current_setting('app.current_user_id', true) OR current_setting('app.current_user_role', true) = 'Admin');
CREATE POLICY "sales_insert_own" ON public.sales_logs FOR INSERT
  WITH CHECK (employee_id = current_setting('app.current_user_id', true) OR current_setting('app.current_user_role', true) = 'Admin');
CREATE POLICY "sales_admin_all" ON public.sales_logs FOR ALL
  USING (current_setting('app.current_user_role', true) = 'Admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'Admin');

-- APP_SETTINGS: Herkes okuyabilir, Admin tam yetki
CREATE POLICY "settings_select_all" ON public.app_settings FOR SELECT USING (true);
CREATE POLICY "settings_admin_all" ON public.app_settings FOR ALL
  USING (current_setting('app.current_user_role', true) = 'Admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'Admin');

-- AUDIT_LOGS: Herkes yazabilir (log kaydı), sadece Admin okuyabilir
CREATE POLICY "audit_insert_all" ON public.audit_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "audit_admin_only" ON public.audit_logs FOR SELECT
  USING (current_setting('app.current_user_role', true) = 'Admin');

-- 4. Realtime Yayınlarını Aç (Filtrelenmiş)
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.time_logs; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.calendar_events; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.shift_schedules; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_logs; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ============================================================
-- 5. Başlangıç Verileri (Seed) - ŞİFRELER BCRYPT İLE HASHLENMIŞ
-- ============================================================

-- Admin (Cevik Adem) - Bcrypt hashlenmiş şifre
INSERT INTO public.profiles (id, full_name, email, password, role, branch, hourly_rate, avatar_url)
VALUES ('admin_1', 'Cevik Adem', 'cevikademm@gmail.com', crypt('Adem123', gen_salt('bf', 10)), 'Admin', 'Dom', 30.00, 'https://ui-avatars.com/api/?name=Cevik+Adem&background=6366f1&color=fff')
ON CONFLICT (email) DO UPDATE SET password = crypt('Adem123', gen_salt('bf', 10));

-- Dom Branch Personelleri (Bcrypt hashlenmiş varsayılan şifre)
INSERT INTO public.profiles (full_name, email, password, role, branch, avatar_url) VALUES
('Lada', 'lada.dom@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Dom', 'https://ui-avatars.com/api/?name=Lada&background=random'),
('Mehmet', 'mehmet.dom@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Dom', 'https://ui-avatars.com/api/?name=Mehmet&background=random'),
('Gülay', 'gulay.dom@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Dom', 'https://ui-avatars.com/api/?name=Gulay&background=random'),
('Anil', 'anil.dom@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Dom', 'https://ui-avatars.com/api/?name=Anil&background=random')
ON CONFLICT (email) DO NOTHING;

-- Backaffee Branch Personelleri
INSERT INTO public.profiles (full_name, email, password, role, branch, avatar_url) VALUES
('Fatma', 'fatma.back@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Backaffee', 'https://ui-avatars.com/api/?name=Fatma&background=random'),
('Hazal', 'hazal.back@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Backaffee', 'https://ui-avatars.com/api/?name=Hazal&background=random'),
('Nilofar', 'nilofar.back@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Backaffee', 'https://ui-avatars.com/api/?name=Nilofar&background=random'),
('Muri', 'muri.back@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Backaffee', 'https://ui-avatars.com/api/?name=Muri&background=random')
ON CONFLICT (email) DO NOTHING;

-- Ringe Branch Personelleri
INSERT INTO public.profiles (full_name, email, password, role, branch, avatar_url) VALUES
('Malik', 'malik.ringe@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Ringe', 'https://ui-avatars.com/api/?name=Malik&background=random'),
('Züleyha', 'zuleyha.ringe@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Ringe', 'https://ui-avatars.com/api/?name=Zuleyha&background=random'),
('Ramazan', 'ramazan.ringe@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Ringe', 'https://ui-avatars.com/api/?name=Ramazan&background=random'),
('Ibrahim', 'ibrahim.ringe@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Ringe', 'https://ui-avatars.com/api/?name=Ibrahim&background=random'),
('Musti', 'musti.ringe@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Ringe', 'https://ui-avatars.com/api/?name=Musti&background=random')
ON CONFLICT (email) DO NOTHING;

-- Mülheim Branch Personelleri
INSERT INTO public.profiles (full_name, email, password, role, branch, avatar_url) VALUES
('Saniye', 'saniye.mul@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Mülheim', 'https://ui-avatars.com/api/?name=Saniye&background=random'),
('Rima', 'rima.mul@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Mülheim', 'https://ui-avatars.com/api/?name=Rima&background=random'),
('Samil', 'samil.mul@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Mülheim', 'https://ui-avatars.com/api/?name=Samil&background=random'),
('Derya', 'derya.mul@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Mülheim', 'https://ui-avatars.com/api/?name=Derya&background=random'),
('Yildiz', 'yildiz.mul@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Mülheim', 'https://ui-avatars.com/api/?name=Yildiz&background=random'),
('Yeliz', 'yeliz.mul@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Mülheim', 'https://ui-avatars.com/api/?name=Yeliz&background=random'),
('Alican', 'alican.mul@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Mülheim', 'https://ui-avatars.com/api/?name=Alican&background=random'),
('Murat', 'murat.mul@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Mülheim', 'https://ui-avatars.com/api/?name=Murat&background=random'),
('Abdel', 'abdel.mul@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Mülheim', 'https://ui-avatars.com/api/?name=Abdel&background=random'),
('Ercan', 'ercan.mul@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Mülheim', 'https://ui-avatars.com/api/?name=Ercan&background=random'),
('Ismail', 'ismail.mul@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Mülheim', 'https://ui-avatars.com/api/?name=Ismail&background=random'),
('Kaan', 'kaan.mul@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Mülheim', 'https://ui-avatars.com/api/?name=Kaan&background=random')
ON CONFLICT (email) DO NOTHING;

-- Tobacgo Branch Personelleri
INSERT INTO public.profiles (full_name, email, password, role, branch, avatar_url) VALUES
('Apo', 'apo.tob@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Tobacgo', 'https://ui-avatars.com/api/?name=Apo&background=random'),
('Saime', 'saime.tob@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Tobacgo', 'https://ui-avatars.com/api/?name=Saime&background=random'),
('Engin', 'engin.tob@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Tobacgo', 'https://ui-avatars.com/api/?name=Engin&background=random'),
('Dilan', 'dilan.tob@bac.com', crypt('Bac2026!', gen_salt('bf', 10)), 'Personel', 'Tobacgo', 'https://ui-avatars.com/api/?name=Dilan&background=random')
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.app_settings (setting_key, setting_value, description)
VALUES ('company_logo', 'https://xbbzwitvlrdwnoushgpf.supabase.co/storage/v1/object/public/Bac_Logo/bac.jpeg', 'Ana Logo')
ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- TEMİZLİK İŞLEMİ: Admin olmayan ve 'mail.com' ile biten kullanıcıları sil
DELETE FROM public.profiles
WHERE email LIKE '%mail.com' AND role != 'Admin';

-- ============================================================
-- 6. Şifre Doğrulama Fonksiyonu (SADECE Bcrypt - Düz metin desteği kaldırıldı)
-- ============================================================
CREATE OR REPLACE FUNCTION verify_user_password(user_email TEXT, user_password TEXT)
RETURNS SETOF public.profiles AS $$
BEGIN
  -- Bcrypt hash ile karşılaştırma ($2a$/$2b$ ile başlayan şifreler)
  RETURN QUERY
  SELECT * FROM public.profiles
  WHERE email = user_email
  AND (
    -- Bcrypt hash karşılaştırma
    (password LIKE '$2a$%' OR password LIKE '$2b$%') AND password = crypt(user_password, password)
    -- Düz metin karşılaştırma (henüz hash'lenmemiş şifreler)
    OR (password NOT LIKE '$2a$%' AND password NOT LIKE '$2b$%' AND password = user_password)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7. Güvenli Şifre Güncelleme Fonksiyonu (Bcrypt ile hashleyerek kaydeder)
-- ============================================================
CREATE OR REPLACE FUNCTION update_user_password(
    p_user_id TEXT,
    p_current_password TEXT,
    p_new_password TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    v_user public.profiles;
    v_stored_password TEXT;
BEGIN
    -- Kullanıcıyı bul
    SELECT * INTO v_user FROM public.profiles WHERE id = p_user_id;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    v_stored_password := v_user.password;

    -- Şifre doğrulama: Bcrypt hash ($2a$/$2b$ ile başlar) veya düz metin
    IF v_stored_password LIKE '$2a$%' OR v_stored_password LIKE '$2b$%' THEN
        -- Bcrypt hash karşılaştırma
        IF v_stored_password != crypt(p_current_password, v_stored_password) THEN
            RETURN FALSE;
        END IF;
    ELSE
        -- Düz metin karşılaştırma (eski/yeni eklenen kullanıcılar için)
        IF v_stored_password != p_current_password THEN
            RETURN FALSE;
        END IF;
    END IF;

    -- Yeni şifreyi bcrypt ile hashleyerek güncelle
    UPDATE public.profiles
    SET password = crypt(p_new_password, gen_salt('bf', 10)),
        updated_at = NOW()
    WHERE id = p_user_id;

    -- Denetim kaydı oluştur
    PERFORM log_audit_event(p_user_id, v_user.email, 'PASSWORD_CHANGE', 'profiles', p_user_id, '{}'::jsonb);

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 8. Admin Şifre Sıfırlama Fonksiyonu (Güvenli)
-- ============================================================
CREATE OR REPLACE FUNCTION admin_reset_password(
    p_admin_id TEXT,
    p_target_user_id TEXT,
    p_new_password TEXT DEFAULT 'Bac2026!'
)
RETURNS BOOLEAN AS $$
DECLARE
    v_admin public.profiles;
BEGIN
    -- Admin yetkisini kontrol et
    SELECT * INTO v_admin FROM public.profiles
    WHERE id = p_admin_id AND role = 'Admin';

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Hedef kullanıcının şifresini bcrypt ile hashleyerek güncelle
    UPDATE public.profiles
    SET password = crypt(p_new_password, gen_salt('bf', 10)),
        updated_at = NOW()
    WHERE id = p_target_user_id;

    -- Denetim kaydı oluştur
    PERFORM log_audit_event(p_admin_id, v_admin.email, 'ADMIN_PASSWORD_RESET', 'profiles', p_target_user_id,
        json_build_object('reset_by', v_admin.full_name)::jsonb);

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
