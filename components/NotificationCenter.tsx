import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, X, ShoppingBag, Clock, FileText, BarChart3, CheckCheck, Loader2, Inbox } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { canSeeNotificationCenter } from '../constants';

// =============================================================
// NotificationCenter — Header'a mount edilen Bell butonu + dropdown
// =============================================================
// - Sadece NOTIFICATION_CENTER_ALLOWED_EMAILS listesindekilere render olur
// - notification_log tablosundan son 100 kaydı okur
// - Realtime: yeni INSERT geldiğinde anında listeye düşer
// - "Okundu" işareti read_by[] kolonuna user_id ekler (kişisel)
// =============================================================

interface NotificationRow {
  id: string;
  type: 'off_shift_sale' | 'off_shift_qr' | 'non_kiosk_check' | 'weekly_sales_anomaly' | string;
  title: string;
  body: string | null;
  url: string | null;
  tag: string | null;
  meta: any;
  read_by: string[];
  created_at: string;
}

interface Props {
  currentUserId: string | undefined;
  currentUserEmail: string | undefined;
  onNavigate?: (tab: string) => void;
}

const ICON_BY_TYPE: Record<string, { icon: React.ComponentType<{ size?: number; className?: string }>; color: string }> = {
  off_shift_sale: { icon: ShoppingBag, color: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
  off_shift_qr: { icon: Clock, color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  non_kiosk_check: { icon: FileText, color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  weekly_sales_anomaly: { icon: BarChart3, color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' },
};

const formatRelative = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'şimdi';
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} saat önce`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} gün önce`;
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
};

const NotificationCenter: React.FC<Props> = ({ currentUserId, currentUserEmail, onNavigate }) => {
  const allowed = canSeeNotificationCenter(currentUserEmail);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [routeUrl, setRouteUrl] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Hash route handler — bildirime tıklanınca tab değiştir
  useEffect(() => {
    if (!routeUrl) return;
    if (routeUrl.startsWith('/')) {
      const tab = routeUrl.replace(/^\//, '').split('?')[0] || 'dashboard';
      onNavigate?.(tab);
    }
    setRouteUrl(null);
  }, [routeUrl, onNavigate]);

  // İlk yükleme + realtime subscription
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    const fetchInitial = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('notification_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (!cancelled) {
        if (error) console.error('[NotificationCenter] fetch error:', error);
        else setItems((data || []) as NotificationRow[]);
        setLoading(false);
      }
    };
    fetchInitial();

    const channel = supabase
      .channel('notification_log_feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notification_log' },
        (payload) => {
          setItems((prev) => [payload.new as NotificationRow, ...prev].slice(0, 100));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [allowed]);

  // Dropdown dışına tıklayınca kapat
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const unreadCount = useMemo(() => {
    if (!currentUserId) return 0;
    return items.filter((n) => !n.read_by?.includes(currentUserId)).length;
  }, [items, currentUserId]);

  const markAsRead = async (id: string) => {
    if (!currentUserId) return;
    const item = items.find((n) => n.id === id);
    if (!item || item.read_by?.includes(currentUserId)) return;
    const newReadBy = [...(item.read_by || []), currentUserId];
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_by: newReadBy } : n)));
    await supabase.from('notification_log').update({ read_by: newReadBy }).eq('id', id);
  };

  const markAllAsRead = async () => {
    if (!currentUserId) return;
    const unread = items.filter((n) => !n.read_by?.includes(currentUserId));
    if (unread.length === 0) return;
    setItems((prev) =>
      prev.map((n) =>
        n.read_by?.includes(currentUserId) ? n : { ...n, read_by: [...(n.read_by || []), currentUserId] }
      )
    );
    // DB tarafında tek tek update — array_append RPC yerine pratik yol
    await Promise.all(
      unread.map((n) =>
        supabase
          .from('notification_log')
          .update({ read_by: [...(n.read_by || []), currentUserId] })
          .eq('id', n.id)
      )
    );
  };

  const handleItemClick = (item: NotificationRow) => {
    markAsRead(item.id);
    if (item.url) setRouteUrl(item.url);
    setOpen(false);
  };

  if (!allowed) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-1.5 md:p-2 text-zinc-400 hover:text-white transition-colors"
        title="Bildirimler"
        aria-label="Bildirimler"
      >
        <Bell size={18} className="md:hidden" />
        <Bell size={20} className="hidden md:block" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-zinc-950">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed md:absolute right-2 md:right-0 top-14 md:top-12 w-[calc(100vw-1rem)] md:w-96 max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl z-[100] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 text-white font-semibold">
              <Bell size={16} className="text-indigo-400" />
              <span>Bildirimler</span>
              {unreadCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] font-bold rounded">
                  {unreadCount} yeni
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs text-zinc-400 hover:text-white flex items-center gap-1"
                  title="Tümünü okundu işaretle"
                >
                  <CheckCheck size={14} /> Hepsini oku
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-zinc-400 hover:text-white"
                aria-label="Kapat"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Liste */}
          <div className="max-h-[60vh] md:max-h-[500px] overflow-y-auto custom-scrollbar">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-zinc-400 text-sm gap-2">
                <Loader2 size={16} className="animate-spin" /> Yükleniyor...
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-zinc-500 text-sm gap-2">
                <Inbox size={32} className="text-zinc-700" />
                Henüz bildirim yok
              </div>
            ) : (
              <ul className="divide-y divide-zinc-800/60">
                {items.map((n) => {
                  const cfg = ICON_BY_TYPE[n.type] || {
                    icon: Bell,
                    color: 'text-zinc-400 bg-zinc-700/30 border-zinc-700',
                  };
                  const Icon = cfg.icon;
                  const isRead = currentUserId ? n.read_by?.includes(currentUserId) : false;
                  return (
                    <li
                      key={n.id}
                      onClick={() => handleItemClick(n)}
                      className={`px-4 py-3 cursor-pointer transition-colors flex gap-3 ${
                        isRead ? 'bg-transparent hover:bg-zinc-800/40' : 'bg-indigo-900/10 hover:bg-indigo-900/20'
                      }`}
                    >
                      <div
                        className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${cfg.color}`}
                      >
                        <Icon size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className={`text-sm font-semibold truncate ${isRead ? 'text-zinc-300' : 'text-white'}`}>
                            {n.title}
                          </div>
                          {!isRead && (
                            <span className="w-2 h-2 bg-red-500 rounded-full mt-1.5 shrink-0" />
                          )}
                        </div>
                        {n.body && (
                          <div className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{n.body}</div>
                        )}
                        <div className="text-[10px] text-zinc-500 mt-1">{formatRelative(n.created_at)}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {items.length > 0 && (
            <div className="px-4 py-2 border-t border-zinc-800 text-[10px] text-zinc-500 text-center">
              Son 90 gün — toplam {items.length} bildirim
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationCenter;
