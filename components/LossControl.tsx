import React, { useState, useEffect, useMemo } from 'react';
import { Employee, Branch } from '../types';
import { supabase } from '../lib/supabase';
import {
  AlertTriangle, Package, TrendingDown, TrendingUp, ShieldAlert, BarChart3,
  Plus, Trash2, Pencil, CheckCircle2, XCircle, Filter, Calendar, MapPin, Clock,
  ArrowDownRight, ArrowUpRight, Eye, RefreshCw, Loader2, Search, FileText
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, Legend } from 'recharts';

// ========================
// KAYIP ÖNLEME PANELİ
// Erişim: cevikademm@gmail.com ve gurcan@bac.de
// ========================

export const LOSS_CONTROL_ALLOWED_EMAILS = ['cevikademm@gmail.com', 'gurcan@bac.de'];

export const canAccessLossControl = (email?: string | null): boolean =>
  !!email && LOSS_CONTROL_ALLOWED_EMAILS.includes(email.trim().toLowerCase());

interface LossControlProps {
  currentUser: Employee;
}

interface StockEntry {
  id: string;
  product_name: string;
  branch: string;
  quantity: number;
  entry_date: string;
  entered_by: string;
  note?: string;
  created_at: string;
}

interface StockCount {
  id: string;
  product_name: string;
  branch: string;
  counted_quantity: number;
  count_date: string;
  counted_by: string;
  note?: string;
  created_at: string;
}

interface SalesLog {
  id: string;
  employee_id: string;
  product_name: string;
  branch: string;
  quantity: number;
  sale_date: string;
  status: string;
  created_at: string;
}

interface LossAlert {
  id: string;
  branch: string;
  product_name: string;
  expected_stock: number;
  actual_stock: number;
  difference: number;
  alert_type: 'kayip' | 'fazla' | 'anormal_satis';
  severity: 'low' | 'medium' | 'high';
  date: string;
  resolved: boolean;
  note?: string;
}

const BRANCHES = Object.values(Branch);

// WhatsApp brand icon (lucide-react'da yok, inline SVG)
const WhatsAppIcon = ({ size = 20 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size} aria-hidden="true">
    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
  </svg>
);

const ADMIN_WHATSAPP = '905324961412';

const LossControl: React.FC<LossControlProps> = ({ currentUser }) => {
  const isLossAdmin = canAccessLossControl(currentUser.email);

  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'stock' | 'alerts' | 'report'>(isLossAdmin ? 'overview' : 'stock');
  const [isLoading, setIsLoading] = useState(true);

  // Data States
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([]);
  const [stockCounts, setStockCounts] = useState<StockCount[]>([]);
  const [salesData, setSalesData] = useState<SalesLog[]>([]);
  const [alerts, setAlerts] = useState<LossAlert[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [products, setProducts] = useState<string[]>([]);

  // Filter States
  const [filterBranch, setFilterBranch] = useState<string>('ALL');
  const [filterDateRange, setFilterDateRange] = useState<'today' | 'week' | 'month' | 'all'>('month');

  // Stock Entry Form
  const [stockForm, setStockForm] = useState({
    product_name: '',
    branch: BRANCHES[0],
    quantity: 0,
    entry_date: new Date().toISOString().split('T')[0],
    note: ''
  });

  // Count Form
  const [countForm, setCountForm] = useState({
    product_name: '',
    branch: BRANCHES[0],
    counted_quantity: 0,
    count_date: new Date().toISOString().split('T')[0],
    note: ''
  });

  const [showStockForm, setShowStockForm] = useState(false);
  const [showCountForm, setShowCountForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingEntry, setEditingEntry] = useState<StockEntry | null>(null);
  const [editingCount, setEditingCount] = useState<StockCount | null>(null);

  // Mevcut Stok Durumu için periyot toggle
  const [stockPeriod, setStockPeriod] = useState<'week' | 'month'>('month');

  // Fetch all data
  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      // Fetch stock entries
      const { data: stockData } = await supabase
        .from('stock_entries')
        .select('*')
        .order('entry_date', { ascending: false });

      // Fetch stock counts
      const { data: countData } = await supabase
        .from('stock_counts')
        .select('*')
        .order('count_date', { ascending: false });

      // Fetch all sales (approved only for loss calc)
      const { data: sales } = await supabase
        .from('sales_logs')
        .select('*')
        .order('sale_date', { ascending: false });

      // Fetch products
      const { data: productsData } = await supabase
        .from('action_products')
        .select('name')
        .eq('is_active', true);

      // Fetch employees
      const { data: empData } = await supabase
        .from('profiles')
        .select('*');

      if (stockData) setStockEntries(stockData);
      if (countData) setStockCounts(countData);
      if (sales) setSalesData(sales.map((s: any) => ({
        id: s.id,
        employee_id: s.employee_id,
        product_name: s.product_name,
        branch: s.branch,
        quantity: s.quantity,
        sale_date: s.sale_date,
        status: s.status,
        created_at: s.created_at
      })));
      if (productsData) setProducts(productsData.map((p: any) => p.name));
      if (empData) setEmployees(empData.map((d: any) => ({
        id: d.id,
        name: d.full_name || d.email || 'İsimsiz',
        email: d.email,
        role: d.role,
        branch: d.branch,
        hourlyRate: d.hourly_rate || 0,
        taxClass: d.tax_class || 1,
        avatarUrl: d.avatar_url || '',
        advances: d.advances || 0,
      })));

      // Generate alerts after data load
      generateAlerts(stockData || [], countData || [], sales || []);
    } catch (err) {
      console.error('Kayıp Önleme veri hatası:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Alert Generation Logic
  const generateAlerts = (stocks: StockEntry[], counts: StockCount[], sales: any[]) => {
    const newAlerts: LossAlert[] = [];
    const approvedSales = sales.filter((s: any) => s.status === 'Onaylandı');

    // Group by branch + product
    const branchProducts = new Map<string, { stocked: number; sold: number; counted: number | null }>();

    stocks.forEach(s => {
      const key = `${s.branch}|${s.product_name}`;
      const existing = branchProducts.get(key) || { stocked: 0, sold: 0, counted: null };
      existing.stocked += s.quantity;
      branchProducts.set(key, existing);
    });

    approvedSales.forEach((s: any) => {
      const key = `${s.branch}|${s.product_name}`;
      const existing = branchProducts.get(key) || { stocked: 0, sold: 0, counted: null };
      existing.sold += s.quantity;
      branchProducts.set(key, existing);
    });

    counts.forEach(c => {
      const key = `${c.branch}|${c.product_name}`;
      const existing = branchProducts.get(key) || { stocked: 0, sold: 0, counted: null };
      existing.counted = c.counted_quantity;
      branchProducts.set(key, existing);
    });

    branchProducts.forEach((data, key) => {
      const [branch, product] = key.split('|');
      const expectedStock = data.stocked - data.sold;

      if (data.counted !== null) {
        const diff = expectedStock - data.counted;
        if (diff > 0) {
          // Kayıp var
          const severity = diff >= 5 ? 'high' : diff >= 2 ? 'medium' : 'low';
          newAlerts.push({
            id: `loss_${key}`,
            branch,
            product_name: product,
            expected_stock: expectedStock,
            actual_stock: data.counted,
            difference: diff,
            alert_type: 'kayip',
            severity,
            date: new Date().toISOString().split('T')[0],
            resolved: false
          });
        } else if (diff < -2) {
          // Fazla var (stokta olmaması gereken ürün var)
          newAlerts.push({
            id: `extra_${key}`,
            branch,
            product_name: product,
            expected_stock: expectedStock,
            actual_stock: data.counted,
            difference: Math.abs(diff),
            alert_type: 'fazla',
            severity: 'medium',
            date: new Date().toISOString().split('T')[0],
            resolved: false
          });
        }
      }
    });

    // Anomaly detection: unusual sales patterns
    const salesToday = sales.filter((s: any) => s.sale_date === new Date().toISOString().split('T')[0]);
    const salesByEmployee = new Map<string, number>();
    salesToday.forEach((s: any) => {
      salesByEmployee.set(s.employee_id, (salesByEmployee.get(s.employee_id) || 0) + s.quantity);
    });

    salesByEmployee.forEach((qty, empId) => {
      if (qty > 20) {
        // Anormal yüksek satış
        const emp = employees.find(e => e.id === empId);
        newAlerts.push({
          id: `anomaly_${empId}_${Date.now()}`,
          branch: emp?.branch || 'Bilinmiyor',
          product_name: 'Çoklu Ürün',
          expected_stock: 0,
          actual_stock: 0,
          difference: qty,
          alert_type: 'anormal_satis',
          severity: 'high',
          date: new Date().toISOString().split('T')[0],
          resolved: false,
          note: `${emp?.name || empId} - Günlük ${qty} adet satış (Anormal)`
        });
      }
    });

    setAlerts(newAlerts);
  };

  // Open Edit / Reset helpers
  const resetStockForm = () => setStockForm({ product_name: '', branch: BRANCHES[0], quantity: 0, entry_date: new Date().toISOString().split('T')[0], note: '' });
  const resetCountForm = () => setCountForm({ product_name: '', branch: BRANCHES[0], counted_quantity: 0, count_date: new Date().toISOString().split('T')[0], note: '' });

  const closeStockForm = () => { setShowStockForm(false); setEditingEntry(null); resetStockForm(); };
  const closeCountForm = () => { setShowCountForm(false); setEditingCount(null); resetCountForm(); };

  const openEditEntry = (e: StockEntry) => {
    setEditingEntry(e);
    setStockForm({ product_name: e.product_name, branch: e.branch, quantity: e.quantity, entry_date: e.entry_date, note: e.note || '' });
    setShowStockForm(true);
  };

  const openEditCount = (c: StockCount) => {
    setEditingCount(c);
    setCountForm({ product_name: c.product_name, branch: c.branch, counted_quantity: c.counted_quantity, count_date: c.count_date, note: c.note || '' });
    setShowCountForm(true);
  };

  // Save Stock Entry (insert or update)
  const handleSaveStockEntry = async () => {
    if (!stockForm.product_name || stockForm.quantity <= 0) return;
    setIsSaving(true);
    try {
      const payload = {
        product_name: stockForm.product_name,
        branch: stockForm.branch,
        quantity: stockForm.quantity,
        entry_date: stockForm.entry_date,
        note: stockForm.note || null
      };
      const { error } = editingEntry
        ? await supabase.from('stock_entries').update(payload).eq('id', editingEntry.id)
        : await supabase.from('stock_entries').insert({ ...payload, entered_by: currentUser.id });
      if (error) throw error;
      closeStockForm();
      fetchAllData();
    } catch (err) {
      alert('Stok girişi kaydedilemedi: ' + (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  // Save Stock Count (insert or update)
  const handleSaveCount = async () => {
    if (!countForm.product_name || countForm.counted_quantity < 0) return;
    setIsSaving(true);
    try {
      const payload = {
        product_name: countForm.product_name,
        branch: countForm.branch,
        counted_quantity: countForm.counted_quantity,
        count_date: countForm.count_date,
        note: countForm.note || null
      };
      const { error } = editingCount
        ? await supabase.from('stock_counts').update(payload).eq('id', editingCount.id)
        : await supabase.from('stock_counts').insert({ ...payload, counted_by: currentUser.id });
      if (error) throw error;
      closeCountForm();
      fetchAllData();
    } catch (err) {
      alert('Sayım kaydedilemedi: ' + (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  // Delete handlers
  const handleDeleteEntry = async (id: string) => {
    if (!confirm('Bu stok girişini silmek istediğinizden emin misiniz?')) return;
    try {
      const { error } = await supabase.from('stock_entries').delete().eq('id', id);
      if (error) throw error;
      fetchAllData();
    } catch (err) {
      alert('Silinemedi: ' + (err as Error).message);
    }
  };

  const handleDeleteCount = async (id: string) => {
    if (!confirm('Bu sayımı silmek istediğinizden emin misiniz?')) return;
    try {
      const { error } = await supabase.from('stock_counts').delete().eq('id', id);
      if (error) throw error;
      fetchAllData();
    } catch (err) {
      alert('Silinemedi: ' + (err as Error).message);
    }
  };

  // (Şube, Ürün) bazında mevcut stok: toplam giriş - dönemde onaylı satış
  const currentStock = useMemo(() => {
    const map = new Map<string, { branch: string; product: string; stocked: number; sold: number }>();

    stockEntries.forEach(s => {
      const key = `${s.branch}|${s.product_name}`;
      const cur = map.get(key) || { branch: s.branch, product: s.product_name, stocked: 0, sold: 0 };
      cur.stocked += s.quantity;
      map.set(key, cur);
    });

    const days = stockPeriod === 'week' ? 7 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // "Reddedildi" hariç tüm satışlar (Bekliyor + Onaylandı) stoktan düşer.
    // Reddedilen satış gerçekleşmemiş demek olduğu için stoktan düşmez.
    salesData
      .filter(s => s.status !== 'Reddedildi' && s.sale_date >= since)
      .forEach(s => {
        const key = `${s.branch}|${s.product_name}`;
        const cur = map.get(key) || { branch: s.branch, product: s.product_name, stocked: 0, sold: 0 };
        cur.sold += s.quantity;
        map.set(key, cur);
      });

    let rows = Array.from(map.values()).map(r => ({ ...r, remaining: r.stocked - r.sold }));
    if (filterBranch !== 'ALL') rows = rows.filter(r => r.branch === filterBranch);
    rows.sort((a, b) => a.branch.localeCompare(b.branch) || a.product.localeCompare(b.product));
    return rows;
  }, [stockEntries, salesData, stockPeriod, filterBranch]);

  // Filtered data
  const filteredSales = useMemo(() => {
    let data = salesData;
    if (filterBranch !== 'ALL') data = data.filter(s => s.branch === filterBranch);
    const now = new Date();
    if (filterDateRange === 'today') {
      const today = now.toISOString().split('T')[0];
      data = data.filter(s => s.sale_date === today);
    } else if (filterDateRange === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      data = data.filter(s => s.sale_date >= weekAgo);
    } else if (filterDateRange === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      data = data.filter(s => s.sale_date >= monthAgo);
    }
    return data;
  }, [salesData, filterBranch, filterDateRange]);

  // Branch Summary Cards
  const branchSummary = useMemo(() => {
    return BRANCHES.map(branch => {
      const branchSales = filteredSales.filter(s => s.branch === branch && s.status === 'Onaylandı');
      const branchStock = stockEntries.filter(s => s.branch === branch);
      const branchCounts = stockCounts.filter(c => c.branch === branch);
      const branchAlerts = alerts.filter(a => a.branch === branch && !a.resolved);

      const totalSold = branchSales.reduce((sum, s) => sum + s.quantity, 0);
      const totalStocked = branchStock.reduce((sum, s) => sum + s.quantity, 0);
      const totalCounted = branchCounts.length > 0
        ? branchCounts.reduce((sum, c) => sum + c.counted_quantity, 0)
        : null;

      const expectedRemaining = totalStocked - totalSold;
      const loss = totalCounted !== null ? expectedRemaining - totalCounted : null;

      return {
        branch,
        totalSold,
        totalStocked,
        totalCounted,
        expectedRemaining,
        loss,
        alertCount: branchAlerts.length,
        highAlerts: branchAlerts.filter(a => a.severity === 'high').length
      };
    });
  }, [filteredSales, stockEntries, stockCounts, alerts]);

  // Trend data for chart
  const trendData = useMemo(() => {
    const last7Days: { date: string; satis: number; stok_giris: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const daySales = salesData.filter(s => s.sale_date === dateStr && s.status === 'Onaylandı')
        .reduce((sum, s) => sum + s.quantity, 0);
      const dayStock = stockEntries.filter(s => s.entry_date === dateStr)
        .reduce((sum, s) => sum + s.quantity, 0);
      last7Days.push({
        date: dateStr.slice(5), // MM-DD
        satis: daySales,
        stok_giris: dayStock
      });
    }
    return last7Days;
  }, [salesData, stockEntries]);

  // Employee name helper
  const getEmpName = (id: string) => employees.find(e => e.id === id)?.name || id;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-indigo-400" size={32} />
        <span className="ml-3 text-zinc-400">Kayıp Önleme verileri yükleniyor...</span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-y-auto overflow-x-hidden custom-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
      {!isLossAdmin && (
        <a
          href={`https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent('Merhaba, stokta bir sorun var. Detay: ')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-24 right-4 md:bottom-8 md:right-8 z-40 flex items-center gap-2 px-4 py-3 bg-[#25D366] hover:bg-[#1ebe5a] active:scale-95 rounded-full shadow-lg shadow-emerald-500/40 text-white font-semibold text-xs md:text-sm transition-all"
          title="Stok hatası varsa admine WhatsApp at"
          aria-label="WhatsApp ile admine ulaş"
        >
          <WhatsAppIcon size={18} />
          <span className="hidden sm:inline">Admine Ulaş</span>
        </a>
      )}
      <div className="p-3 md:p-6 pb-32 md:pb-10 space-y-4 md:space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg md:text-2xl font-bold text-white flex items-center gap-2">
            <ShieldAlert className="text-red-400 shrink-0" size={22} />
            <span className="truncate">{isLossAdmin ? 'Kayıp Önleme' : 'Stok'}</span>
          </h1>
          <p className="text-zinc-500 text-xs md:text-sm mt-0.5 hidden sm:block">
            {isLossAdmin ? 'Stok takip, kayıp tespiti, şube analizi' : 'Stok girişi yapın · sorun varsa admine WhatsApp atın'}
          </p>
        </div>
        <button
          onClick={fetchAllData}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 active:scale-95 rounded-lg text-zinc-300 text-xs md:text-sm transition-all"
          title="Yenile"
        >
          <RefreshCw size={14} />
          <span className="hidden sm:inline">Yenile</span>
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-zinc-900/50 p-1 rounded-xl border border-zinc-800 overflow-x-auto custom-scrollbar -mx-1 px-1">
        {[
          { id: 'overview', label: 'Genel Bakış', icon: BarChart3, adminOnly: false },
          { id: 'stock', label: 'Stok Yönetimi', icon: Package, adminOnly: false },
          { id: 'alerts', label: 'Alarmlar', icon: AlertTriangle, adminOnly: true },
          { id: 'report', label: 'Şube Raporu', icon: FileText, adminOnly: true },
        ].filter(tab => isLossAdmin || !tab.adminOnly).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id as any)}
            className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition-all whitespace-nowrap shrink-0 ${
              activeSubTab === tab.id
                ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-600/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3">
        <select
          value={filterBranch}
          onChange={e => setFilterBranch(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300 w-full sm:w-auto"
        >
          <option value="ALL">Tüm Şubeler</option>
          {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select
          value={filterDateRange}
          onChange={e => setFilterDateRange(e.target.value as any)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300 w-full sm:w-auto"
        >
          <option value="today">Bugün</option>
          <option value="week">Son 7 Gün</option>
          <option value="month">Son 30 Gün</option>
          <option value="all">Tümü</option>
        </select>
      </div>

      {/* === OVERVIEW TAB === */}
      {activeSubTab === 'overview' && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 md:p-4">
              <div className="text-zinc-500 text-[10px] md:text-xs mb-1 leading-tight">Toplam Stok Girişi</div>
              <div className="text-xl md:text-2xl font-bold text-white">{stockEntries.reduce((s, e) => s + e.quantity, 0)}</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 md:p-4">
              <div className="text-zinc-500 text-[10px] md:text-xs mb-1 leading-tight">Toplam Satış (Onaylı)</div>
              <div className="text-xl md:text-2xl font-bold text-emerald-400">
                {salesData.filter(s => s.status === 'Onaylandı').reduce((s, e) => s + e.quantity, 0)}
              </div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 md:p-4">
              <div className="text-zinc-500 text-[10px] md:text-xs mb-1 leading-tight">Aktif Alarm</div>
              <div className="text-xl md:text-2xl font-bold text-red-400">{alerts.filter(a => !a.resolved).length}</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 md:p-4">
              <div className="text-zinc-500 text-[10px] md:text-xs mb-1 leading-tight">Toplam Kayıp</div>
              <div className="text-xl md:text-2xl font-bold text-orange-400">
                {alerts.filter(a => a.alert_type === 'kayip').reduce((s, a) => s + a.difference, 0)}
              </div>
            </div>
          </div>

          {/* Trend Chart */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 md:p-4">
            <h3 className="text-xs md:text-sm font-semibold text-zinc-300 mb-3 md:mb-4">Son 7 Gün — Stok Giriş vs Satış</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" stroke="#71717a" fontSize={12} />
                <YAxis stroke="#71717a" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                  labelStyle={{ color: '#a1a1aa' }}
                />
                <Legend />
                <Line type="monotone" dataKey="stok_giris" stroke="#60a5fa" strokeWidth={2} name="Stok Giriş" dot={false} />
                <Line type="monotone" dataKey="satis" stroke="#34d399" strokeWidth={2} name="Satış" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Branch Quick Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {branchSummary.map(bs => (
              <div key={bs.branch} className={`bg-zinc-900/50 border rounded-xl p-3 md:p-4 ${
                bs.highAlerts > 0 ? 'border-red-600/50' : bs.alertCount > 0 ? 'border-orange-600/30' : 'border-zinc-800'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-white flex items-center gap-2">
                    <MapPin size={14} className="text-zinc-500" />
                    {bs.branch}
                  </h4>
                  {bs.highAlerts > 0 && (
                    <span className="text-xs bg-red-600/20 text-red-400 px-2 py-0.5 rounded-full border border-red-600/30">
                      {bs.highAlerts} Kritik
                    </span>
                  )}
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Stok Giriş:</span>
                    <span className="text-zinc-200">{bs.totalStocked}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Satış:</span>
                    <span className="text-emerald-400">{bs.totalSold}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Beklenen Kalan:</span>
                    <span className="text-zinc-200">{bs.expectedRemaining}</span>
                  </div>
                  {bs.totalCounted !== null && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Sayım:</span>
                        <span className="text-zinc-200">{bs.totalCounted}</span>
                      </div>
                      <div className="flex justify-between border-t border-zinc-800 pt-2">
                        <span className="text-zinc-500 font-medium">Fark:</span>
                        <span className={`font-bold ${bs.loss && bs.loss > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                          {bs.loss !== null ? (bs.loss > 0 ? `-${bs.loss} Kayıp` : bs.loss < 0 ? `+${Math.abs(bs.loss)} Fazla` : '✓ Eşit') : '—'}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === STOCK MANAGEMENT TAB === */}
      {activeSubTab === 'stock' && (
        <div className="space-y-4 md:space-y-6">
          {/* Action Buttons */}
          <div className={`grid ${isLossAdmin ? 'grid-cols-2 sm:flex' : 'grid-cols-1'} gap-2 sm:gap-3`}>
            <button
              onClick={() => setShowStockForm(true)}
              className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 rounded-lg text-white text-xs sm:text-sm font-medium transition-all"
            >
              <Plus size={16} /> Stok Girişi
            </button>
            {isLossAdmin && (
              <button
                onClick={() => setShowCountForm(true)}
                className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 rounded-lg text-white text-xs sm:text-sm font-medium transition-all"
              >
                <Search size={16} /> Sayım Ekle
              </button>
            )}
          </div>

          {/* Stock Entry Form Modal */}
          {showStockForm && (
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-4">
              <h3 className="text-lg font-semibold text-white">{editingEntry ? 'Stok Girişi Düzenle' : 'Yeni Stok Girişi'}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Ürün</label>
                  <select
                    value={stockForm.product_name}
                    onChange={e => setStockForm(p => ({ ...p, product_name: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200"
                  >
                    <option value="">Seçin...</option>
                    {products.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Şube</label>
                  <select
                    value={stockForm.branch}
                    onChange={e => setStockForm(p => ({ ...p, branch: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200"
                  >
                    {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Adet</label>
                  <input
                    type="number"
                    min={1}
                    value={stockForm.quantity}
                    onChange={e => setStockForm(p => ({ ...p, quantity: Number(e.target.value) }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Tarih</label>
                  <input
                    type="date"
                    value={stockForm.entry_date}
                    onChange={e => setStockForm(p => ({ ...p, entry_date: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Not (Opsiyonel)</label>
                <input
                  type="text"
                  value={stockForm.note}
                  onChange={e => setStockForm(p => ({ ...p, note: e.target.value }))}
                  placeholder="Fatura no, tedarikçi vs."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleSaveStockEntry}
                  disabled={isSaving || !stockForm.product_name || stockForm.quantity <= 0}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-white text-sm font-medium transition-colors"
                >
                  {isSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  Kaydet
                </button>
                <button
                  onClick={closeStockForm}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 text-sm transition-colors"
                >
                  İptal
                </button>
              </div>
            </div>
          )}

          {/* Count Form Modal */}
          {showCountForm && (
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-4">
              <h3 className="text-lg font-semibold text-white">{editingCount ? 'Sayım Düzenle' : 'Fiziksel Sayım Girişi'}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Ürün</label>
                  <select
                    value={countForm.product_name}
                    onChange={e => setCountForm(p => ({ ...p, product_name: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200"
                  >
                    <option value="">Seçin...</option>
                    {products.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Şube</label>
                  <select
                    value={countForm.branch}
                    onChange={e => setCountForm(p => ({ ...p, branch: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200"
                  >
                    {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Sayılan Adet</label>
                  <input
                    type="number"
                    min={0}
                    value={countForm.counted_quantity}
                    onChange={e => setCountForm(p => ({ ...p, counted_quantity: Number(e.target.value) }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Tarih</label>
                  <input
                    type="date"
                    value={countForm.count_date}
                    onChange={e => setCountForm(p => ({ ...p, count_date: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Not</label>
                <input
                  type="text"
                  value={countForm.note}
                  onChange={e => setCountForm(p => ({ ...p, note: e.target.value }))}
                  placeholder="Sayım detayı..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleSaveCount}
                  disabled={isSaving || !countForm.product_name}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-white text-sm font-medium transition-colors"
                >
                  {isSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  Kaydet
                </button>
                <button
                  onClick={closeCountForm}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 text-sm transition-colors"
                >
                  İptal
                </button>
              </div>
            </div>
          )}

          {/* Mevcut Stok Durumu — (şube + ürün) bazında giriş, satılan, kalan */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-3 md:px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-xs md:text-sm font-semibold text-zinc-300">Mevcut Stok Durumu</h3>
              <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-1 border border-zinc-800">
                <button
                  onClick={() => setStockPeriod('week')}
                  className={`px-3 py-1 text-[11px] md:text-xs font-bold rounded transition-all ${stockPeriod === 'week' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  Son 7 Gün
                </button>
                <button
                  onClick={() => setStockPeriod('month')}
                  className={`px-3 py-1 text-[11px] md:text-xs font-bold rounded transition-all ${stockPeriod === 'month' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  Son 30 Gün
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900">
                  <tr className="text-zinc-500 text-xs">
                    <th className="px-3 md:px-4 py-2 text-left">Şube</th>
                    <th className="px-3 md:px-4 py-2 text-left">Ürün</th>
                    <th className="px-3 md:px-4 py-2 text-right">Toplam Giriş</th>
                    <th className="px-3 md:px-4 py-2 text-right">Satılan</th>
                    <th className="px-3 md:px-4 py-2 text-right">Kalan</th>
                  </tr>
                </thead>
                <tbody>
                  {currentStock.map(r => (
                    <tr key={`${r.branch}|${r.product}`} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-3 md:px-4 py-2 text-zinc-300 whitespace-nowrap">{r.branch}</td>
                      <td className="px-3 md:px-4 py-2 text-zinc-200">{r.product}</td>
                      <td className="px-3 md:px-4 py-2 text-right text-zinc-300 tabular-nums">{r.stocked}</td>
                      <td className="px-3 md:px-4 py-2 text-right text-emerald-400 font-medium tabular-nums">−{r.sold}</td>
                      <td className={`px-3 md:px-4 py-2 text-right font-bold tabular-nums ${r.remaining < 0 ? 'text-red-400' : r.remaining < 5 ? 'text-orange-400' : 'text-white'}`}>
                        {r.remaining}
                      </td>
                    </tr>
                  ))}
                  {currentStock.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-zinc-600">Bu filtreyle eşleşen kayıt yok</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Stock History Table */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-300">Son Stok Girişleri</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900">
                  <tr className="text-zinc-500 text-xs">
                    <th className="px-4 py-2 text-left">Tarih</th>
                    <th className="px-4 py-2 text-left">Şube</th>
                    <th className="px-4 py-2 text-left">Ürün</th>
                    <th className="px-4 py-2 text-right">Adet</th>
                    <th className="px-4 py-2 text-left">Not</th>
                    {isLossAdmin && <th className="px-4 py-2 text-right">İşlem</th>}
                  </tr>
                </thead>
                <tbody>
                  {stockEntries.slice(0, 20).map(entry => (
                    <tr key={entry.id} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-4 py-2 text-zinc-400">{entry.entry_date}</td>
                      <td className="px-4 py-2 text-zinc-300">{entry.branch}</td>
                      <td className="px-4 py-2 text-zinc-200">{entry.product_name}</td>
                      <td className="px-4 py-2 text-right text-white font-medium">{entry.quantity}</td>
                      <td className="px-4 py-2 text-zinc-500">{entry.note || '—'}</td>
                      {isLossAdmin && (
                        <td className="px-4 py-2">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => openEditEntry(entry)}
                              className="p-1.5 rounded text-zinc-400 hover:text-indigo-400 hover:bg-indigo-600/10 transition-colors"
                              title="Düzenle"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteEntry(entry.id)}
                              className="p-1.5 rounded text-zinc-400 hover:text-red-400 hover:bg-red-600/10 transition-colors"
                              title="Sil"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {stockEntries.length === 0 && (
                    <tr>
                      <td colSpan={isLossAdmin ? 6 : 5} className="px-4 py-8 text-center text-zinc-600">Henüz stok girişi yok</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Count History */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-300">Son Sayımlar</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900">
                  <tr className="text-zinc-500 text-xs">
                    <th className="px-4 py-2 text-left">Tarih</th>
                    <th className="px-4 py-2 text-left">Şube</th>
                    <th className="px-4 py-2 text-left">Ürün</th>
                    <th className="px-4 py-2 text-right">Sayılan</th>
                    <th className="px-4 py-2 text-left">Not</th>
                    {isLossAdmin && <th className="px-4 py-2 text-right">İşlem</th>}
                  </tr>
                </thead>
                <tbody>
                  {stockCounts.slice(0, 20).map(count => (
                    <tr key={count.id} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-4 py-2 text-zinc-400">{count.count_date}</td>
                      <td className="px-4 py-2 text-zinc-300">{count.branch}</td>
                      <td className="px-4 py-2 text-zinc-200">{count.product_name}</td>
                      <td className="px-4 py-2 text-right text-white font-medium">{count.counted_quantity}</td>
                      <td className="px-4 py-2 text-zinc-500">{count.note || '—'}</td>
                      {isLossAdmin && (
                        <td className="px-4 py-2">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => openEditCount(count)}
                              className="p-1.5 rounded text-zinc-400 hover:text-indigo-400 hover:bg-indigo-600/10 transition-colors"
                              title="Düzenle"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteCount(count.id)}
                              className="p-1.5 rounded text-zinc-400 hover:text-red-400 hover:bg-red-600/10 transition-colors"
                              title="Sil"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {stockCounts.length === 0 && (
                    <tr>
                      <td colSpan={isLossAdmin ? 6 : 5} className="px-4 py-8 text-center text-zinc-600">Henüz sayım yok</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* === ALERTS TAB === */}
      {activeSubTab === 'alerts' && (
        <div className="space-y-4">
          {alerts.filter(a => !a.resolved).length === 0 ? (
            <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-xl p-8 text-center">
              <CheckCircle2 className="mx-auto text-emerald-400 mb-3" size={40} />
              <h3 className="text-emerald-300 font-semibold text-lg">Aktif Alarm Yok</h3>
              <p className="text-zinc-500 mt-1">Tüm şubelerde stok-satış dengesi normal görünüyor.</p>
            </div>
          ) : (
            alerts.filter(a => !a.resolved).map(alert => (
              <div
                key={alert.id}
                className={`border rounded-xl p-4 ${
                  alert.severity === 'high' ? 'bg-red-950/30 border-red-600/40' :
                  alert.severity === 'medium' ? 'bg-orange-950/20 border-orange-600/30' :
                  'bg-yellow-950/10 border-yellow-600/20'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {alert.alert_type === 'kayip' && <TrendingDown className="text-red-400" size={20} />}
                    {alert.alert_type === 'fazla' && <TrendingUp className="text-blue-400" size={20} />}
                    {alert.alert_type === 'anormal_satis' && <AlertTriangle className="text-orange-400" size={20} />}
                    <div>
                      <h4 className="text-white font-medium text-sm">
                        {alert.alert_type === 'kayip' && `Kayıp Tespit: ${alert.product_name}`}
                        {alert.alert_type === 'fazla' && `Stok Fazlası: ${alert.product_name}`}
                        {alert.alert_type === 'anormal_satis' && `Anormal Satış Aktivitesi`}
                      </h4>
                      <p className="text-zinc-400 text-xs mt-0.5">
                        {alert.branch} • {alert.date}
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    alert.severity === 'high' ? 'bg-red-600/20 text-red-400' :
                    alert.severity === 'medium' ? 'bg-orange-600/20 text-orange-400' :
                    'bg-yellow-600/20 text-yellow-400'
                  }`}>
                    {alert.severity === 'high' ? 'Kritik' : alert.severity === 'medium' ? 'Orta' : 'Düşük'}
                  </span>
                </div>
                {alert.alert_type !== 'anormal_satis' && (
                  <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-zinc-500 text-xs">Beklenen</span>
                      <div className="text-zinc-200 font-medium">{alert.expected_stock}</div>
                    </div>
                    <div>
                      <span className="text-zinc-500 text-xs">Sayılan</span>
                      <div className="text-zinc-200 font-medium">{alert.actual_stock}</div>
                    </div>
                    <div>
                      <span className="text-zinc-500 text-xs">Fark</span>
                      <div className="text-red-400 font-bold">{alert.difference} adet</div>
                    </div>
                  </div>
                )}
                {alert.note && (
                  <p className="mt-2 text-xs text-zinc-500 italic">{alert.note}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* === REPORT TAB === */}
      {activeSubTab === 'report' && (
        <div className="space-y-4 md:space-y-6">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 md:p-5">
            <h3 className="text-sm md:text-lg font-semibold text-white mb-3 md:mb-4">Şube Performans Karşılaştırması</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={branchSummary}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="branch" stroke="#71717a" fontSize={12} />
                <YAxis stroke="#71717a" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                  labelStyle={{ color: '#a1a1aa' }}
                />
                <Legend />
                <Bar dataKey="totalStocked" fill="#60a5fa" name="Stok Giriş" radius={[4, 4, 0, 0]} />
                <Bar dataKey="totalSold" fill="#34d399" name="Satış" radius={[4, 4, 0, 0]} />
                <Bar dataKey="alertCount" fill="#f87171" name="Alarm" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Detailed Branch Table */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-300">Detaylı Şube Raporu</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900">
                  <tr className="text-zinc-500 text-xs">
                    <th className="px-4 py-2 text-left">Şube</th>
                    <th className="px-4 py-2 text-right">Stok Giriş</th>
                    <th className="px-4 py-2 text-right">Satış</th>
                    <th className="px-4 py-2 text-right">Beklenen Kalan</th>
                    <th className="px-4 py-2 text-right">Sayım</th>
                    <th className="px-4 py-2 text-right">Kayıp/Fazla</th>
                    <th className="px-4 py-2 text-center">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {branchSummary.map(bs => (
                    <tr key={bs.branch} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-4 py-3 text-zinc-200 font-medium">{bs.branch}</td>
                      <td className="px-4 py-3 text-right text-zinc-300">{bs.totalStocked}</td>
                      <td className="px-4 py-3 text-right text-emerald-400">{bs.totalSold}</td>
                      <td className="px-4 py-3 text-right text-zinc-300">{bs.expectedRemaining}</td>
                      <td className="px-4 py-3 text-right text-zinc-300">{bs.totalCounted !== null ? bs.totalCounted : '—'}</td>
                      <td className={`px-4 py-3 text-right font-bold ${
                        bs.loss === null ? 'text-zinc-600' :
                        bs.loss > 0 ? 'text-red-400' :
                        bs.loss < 0 ? 'text-blue-400' : 'text-emerald-400'
                      }`}>
                        {bs.loss === null ? '—' : bs.loss > 0 ? `-${bs.loss}` : bs.loss < 0 ? `+${Math.abs(bs.loss)}` : '✓'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {bs.highAlerts > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-red-600/20 text-red-400 px-2 py-0.5 rounded-full">
                            <AlertTriangle size={10} /> Risk
                          </span>
                        ) : bs.alertCount > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-orange-600/20 text-orange-400 px-2 py-0.5 rounded-full">
                            Dikkat
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs bg-emerald-600/20 text-emerald-400 px-2 py-0.5 rounded-full">
                            <CheckCircle2 size={10} /> Normal
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Sales Activity - for verification */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-300">Son Satış Aktivitesi (Tüm Durumlar)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900">
                  <tr className="text-zinc-500 text-xs">
                    <th className="px-4 py-2 text-left">Tarih</th>
                    <th className="px-4 py-2 text-left">Personel</th>
                    <th className="px-4 py-2 text-left">Şube</th>
                    <th className="px-4 py-2 text-left">Ürün</th>
                    <th className="px-4 py-2 text-right">Adet</th>
                    <th className="px-4 py-2 text-center">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSales.slice(0, 30).map(sale => (
                    <tr key={sale.id} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-4 py-2 text-zinc-400">{sale.sale_date}</td>
                      <td className="px-4 py-2 text-zinc-200">{getEmpName(sale.employee_id)}</td>
                      <td className="px-4 py-2 text-zinc-300">{sale.branch}</td>
                      <td className="px-4 py-2 text-zinc-200">{sale.product_name}</td>
                      <td className="px-4 py-2 text-right text-white font-medium">{sale.quantity}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          sale.status === 'Onaylandı' ? 'bg-emerald-600/20 text-emerald-400' :
                          sale.status === 'Reddedildi' ? 'bg-red-600/20 text-red-400' :
                          'bg-yellow-600/20 text-yellow-400'
                        }`}>
                          {sale.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default LossControl;
