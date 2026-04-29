// =============================================================
// notify-event — Olay tabanlı push tetikleyici
// =============================================================
// Body örnekleri:
//
// 1) Vardiya dışı satış:
// { "type":"off_shift_sale", "employee_name":"Lada", "branch":"Dom",
//   "product_name":"Marlboro", "quantity":3 }
//
// 2) Vardiya saati dışı QR mesai:
// { "type":"off_shift_qr", "employee_id":"...", "employee_name":"Lada",
//   "branch":"Dom", "action":"in" | "out", "at":"2026-04-30T14:15:00Z" }
//
// 3) Kiosk haricinde mesai (manual):
// { "type":"non_kiosk_check", "employee_name":"Lada", "branch":"Dom",
//   "action":"in" | "out" }
//
// Edge function admin kullanıcıların notification_prefs'ine bakar,
// ilgili anahtar true ise send-push edge function'ını çağırır.
// =============================================================

// @ts-nocheck Deno
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), {
    status: s,
    headers: { 'content-type': 'application/json', ...CORS },
  });

interface EventBody {
  type: 'off_shift_sale' | 'off_shift_qr' | 'non_kiosk_check';
  employee_name?: string;
  employee_id?: string;
  branch?: string;
  product_name?: string;
  quantity?: number;
  action?: 'in' | 'out';
  at?: string;
}

const buildNotification = (e: EventBody): { title: string; body: string; url: string; tag: string } => {
  switch (e.type) {
    case 'off_shift_sale':
      return {
        title: '🚨 Vardiya Dışı Satış',
        body: `${e.employee_name || 'Personel'} (${e.branch || '-'}) → ${e.product_name || 'ürün'} × ${e.quantity ?? 1}`,
        url: '/sales',
        tag: 'off-shift-sale',
      };
    case 'off_shift_qr':
      return {
        title: '⏰ Vardiya Saati Dışı Mesai QR',
        body: `${e.employee_name || 'Personel'} (${e.branch || '-'}) — ${e.action === 'out' ? 'çıkış' : 'giriş'} yaptı`,
        url: '/payroll',
        tag: 'off-shift-qr',
      };
    case 'non_kiosk_check':
      return {
        title: '📝 Kiosk Dışı Mesai Girişi',
        body: `${e.employee_name || 'Personel'} (${e.branch || '-'}) — manuel ${e.action === 'out' ? 'çıkış' : 'giriş'}`,
        url: '/payroll',
        tag: 'non-kiosk-check',
      };
    default:
      return { title: 'BAC Handels', body: '', url: '/dashboard', tag: 'event' };
  }
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let body: EventBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }
  if (!body?.type) return json(400, { error: 'type zorunlu' });

  // 0) off_shift_qr için: personelin bugün vardiya planı VAR ise sessiz dön
  if (body.type === 'off_shift_qr' && body.employee_name && body.branch) {
    const { data: hasShift } = await admin.rpc('has_shift_today', {
      p_employee_name: body.employee_name,
      p_branch: body.branch,
      p_at: body.at || new Date().toISOString(),
    });
    if (hasShift === true) {
      return json(200, { skipped: 'on_shift', type: body.type });
    }
  }

  // 1) İlgili tercihi açık olan adminleri bul
  const { data: admins, error: adminsErr } = await admin
    .from('profiles')
    .select('id, notification_prefs')
    .eq('role', 'Admin');

  if (adminsErr) return json(500, { error: adminsErr.message });

  const prefKey = body.type;
  const targetIds = (admins || [])
    .filter((a: any) => a.notification_prefs?.[prefKey] !== false)
    .map((a: any) => a.id);

  if (targetIds.length === 0) {
    return json(200, { sent: 0, skipped: 'no_admin_with_pref', pref: prefKey });
  }

  // 2) send-push edge function'ını çağır
  const notif = buildNotification(body);
  const sendUrl = `${SUPABASE_URL}/functions/v1/send-push`;

  const resp = await fetch(sendUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      caller_user_id: targetIds[0], // admin yetkisi için (tek admin → admin_1)
      user_ids: targetIds,
      title: notif.title,
      body: notif.body,
      url: notif.url,
      tag: notif.tag,
      requireInteraction: false,
    }),
  });

  const result = await resp.json().catch(() => ({}));
  return json(200, { ok: true, type: body.type, target_count: targetIds.length, push: result });
});
