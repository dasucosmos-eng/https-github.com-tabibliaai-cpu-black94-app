import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { firestore, auth } from '../lib/firebase';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';

/* ── Theme ──────────────────────────────────────────────────────────────────── */

const C = {
  black: '#000',
  surface: '#16181c',
  border: '#374151',
  text: '#e7e9ea',
  textSecondary: '#a1a1aa',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#3b82f6',
  purple: '#8b5cf6',
  white: '#ffffff',
  white20: 'rgba(255,255,255,0.2)',
};

const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 };
const F = { xs: 10, sm: 12, md: 14, lg: 15, xl: 18, xxl: 22 };
const BR = { sm: 6, md: 10, lg: 16, xl: 24 };

/* ── Types ──────────────────────────────────────────────────────────────────── */

type Period = '7d' | '30d' | '90d';

const PERIODS: { key: Period; label: string }[] = [
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
];

interface RawOrder {
  id: string;
  buyerId: string;
  buyerName: string;
  total: number;
  status: string;
  items: string;
  createdAt: string;
}

interface RawProduct {
  id: string;
  name: string;
  price: number;
  soldCount: number;
  revenue: number;
}

interface ChartPoint {
  label: string;
  value: number;
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function tsToISO(v: any): string {
  if (v && typeof v === 'object' && 'seconds' in v) return new Date(v.seconds * 1000).toISOString();
  return typeof v === 'string' ? v : new Date().toISOString();
}

function formatINR(n: number) {
  return '\u20B9' + Math.round(n).toLocaleString('en-IN');
}

function periodMs(p: Period) {
  return { '7d': 7, '30d': 30, '90d': 90 }[p]! * 86400000;
}

/* ── Component ─────────────────────────────────────────────────────────────── */

const PerformanceScreen: React.FC = () => {
  const uid = auth().currentUser?.uid ?? '';
  const [period, setPeriod] = useState<Period>('30d');
  const [orders, setOrders] = useState<RawOrder[]>([]);
  const [products, setProducts] = useState<RawProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /* ── Data Loading ─────────────────────────────────────────────────────── */

  const load = useCallback(async () => {
    try {
      const [ordersSnap, productsSnap] = await Promise.all([
        firestore().collection('orders').where('businessId', '==', uid).orderBy('createdAt', 'desc').limit(500).get(),
        firestore().collection('products').where('businessId', '==', uid).where('isActive', '==', true).get(),
      ]);

      const ords: RawOrder[] = ordersSnap.docs.map((doc: any) => {
        const d = doc.data();
        return { id: doc.id, buyerId: d.buyerId ?? '', buyerName: d.buyerName ?? 'Customer', total: d.total ?? 0, status: d.status ?? 'pending', items: typeof d.items === 'string' ? d.items : JSON.stringify(d.items ?? []), createdAt: tsToISO(d.createdAt) };
      });
      setOrders(ords);

      const prds: RawProduct[] = productsSnap.docs.map((doc: any) => {
        const d = doc.data();
        return { id: doc.id, name: d.name ?? 'Product', price: d.price ?? 0, soldCount: d.soldCount ?? 0, revenue: (d.price ?? 0) * (d.soldCount ?? 0) };
      });
      setProducts(prds);
    } catch { /* silent */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  const handlePeriod = (p: Period) => { setPeriod(p); setRefreshing(true); };
  const handleRefresh = () => { setRefreshing(true); load(); };

  /* ── Derived Metrics ──────────────────────────────────────────────────── */

  const { filteredOrders, kpis, chartData, topProducts, recentActivity } = useMemo(() => {
    const cutoff = Date.now() - periodMs(period);
    const fO = orders.filter(o => new Date(o.createdAt).getTime() >= cutoff);

    const completed = fO.filter(o => o.status === 'delivered');
    const totalRevenue = completed.reduce((s, o) => s + o.total, 0);
    const ordersCompleted = completed.length;
    const customerSet = new Set(fO.map(o => o.buyerId).filter(Boolean));
    const activeCustomers = customerSet.size;
    const conversionRate = fO.length > 0 ? (ordersCompleted / fO.length) * 100 : 0;

    /* Chart data */
    const chartPts: ChartPoint[] = [];
    const buckets = period === '7d' ? 7 : 4;
    const bucketMs = periodMs(period) / buckets;
    const now = new Date();

    for (let i = buckets - 1; i >= 0; i--) {
      const end = new Date(now.getTime() - i * bucketMs);
      const start = new Date(end.getTime() - bucketMs);
      const label = period === '7d'
        ? end.toLocaleDateString('en-IN', { weekday: 'short' })
        : end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const rev = completed
        .filter(o => { const t = new Date(o.createdAt).getTime(); return t >= start.getTime() && t < end.getTime(); })
        .reduce((s, o) => s + o.total, 0);
      chartPts.push({ label, value: rev });
    }

    /* Top products */
    const productRevenue: Record<string, { name: string; revenue: number; sold: number }> = {};
    for (const o of completed) {
      try {
        const items = JSON.parse(o.items);
        if (Array.isArray(items)) {
          for (const it of items) {
            const key = it.productId || it.productName || it.name || 'Product';
            if (!productRevenue[key]) productRevenue[key] = { name: it.productName || it.name || 'Product', revenue: 0, sold: 0 };
            productRevenue[key].revenue += (it.price || 0) * (it.quantity || 1);
            productRevenue[key].sold += it.quantity || 1;
          }
        }
      } catch { /* skip */ }
    }
    const top = Object.values(productRevenue).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    /* Recent activity */
    const recent = fO.slice(0, 5);

    return {
      filteredOrders: fO,
      kpis: { totalRevenue, ordersCompleted, conversionRate, activeCustomers },
      chartData: chartPts,
      topProducts: top,
      recentActivity: recent,
    };
  }, [orders, period]);

  const maxChart = Math.max(...chartData.map(p => p.value), 1);

  /* ── Status color ─────────────────────────────────────────────────────── */

  const sColor = (s: string) => {
    const map: Record<string, string> = { pending: C.warning, confirmed: C.info, processing: C.white, shipped: C.purple, delivered: C.success, cancelled: C.danger };
    return map[s] ?? C.textSecondary;
  };

  /* ── Render ───────────────────────────────────────────────────────────── */

  if (loading) {
    return <View style={styles.centerLoader}><ActivityIndicator color={C.info} size="large" /></View>;
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="speedometer-outline" size={22} color={C.info} />
        <Text style={styles.headerTitle}>Performance</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.info} />
      }>

        {/* Period Selector */}
        <View style={styles.periodBar}>
          <Ionicons name="calendar-outline" size={16} color={C.textSecondary} />
          {PERIODS.map(p => (
            <TouchableOpacity key={p.key} style={[styles.pill, period === p.key && styles.pillActive]} onPress={() => handlePeriod(p.key)}>
              <Text style={[styles.pillText, period === p.key && styles.pillTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* KPI Cards */}
        <View style={styles.section}>
          <View style={styles.kpiRow}>
            {[
              { icon: 'wallet-outline', label: 'Total Revenue', value: formatINR(kpis.totalRevenue), color: C.success },
              { icon: 'checkmark-done-outline', label: 'Orders Completed', value: String(kpis.ordersCompleted), color: C.info },
            ].map((k, i) => (
              <View key={i} style={styles.kpiCard}>
                <View style={[styles.kpiIconWrap, { backgroundColor: k.color + '15' }]}>
                  <Ionicons name={k.icon as any} size={20} color={k.color} />
                </View>
                <Text style={styles.kpiValue}>{k.value}</Text>
                <Text style={styles.kpiLabel}>{k.label}</Text>
              </View>
            ))}
          </View>
          <View style={styles.kpiRow}>
            {[
              { icon: 'trending-up-outline', label: 'Conversion Rate', value: kpis.conversionRate.toFixed(1) + '%', color: C.warning },
              { icon: 'people-outline', label: 'Active Customers', value: String(kpis.activeCustomers), color: C.purple },
            ].map((k, i) => (
              <View key={i} style={styles.kpiCard}>
                <View style={[styles.kpiIconWrap, { backgroundColor: k.color + '15' }]}>
                  <Ionicons name={k.icon as any} size={20} color={k.color} />
                </View>
                <Text style={styles.kpiValue}>{k.value}</Text>
                <Text style={styles.kpiLabel}>{k.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Revenue Chart */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Revenue Trend</Text>
          <View style={styles.chartCard}>
            {chartData.length > 0 ? (
              <View style={styles.chartContainer}>
                <View style={styles.chartYAxis}>
                  <Text style={styles.chartYLabel}>{formatINR(maxChart)}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={styles.chartYLabel}>{formatINR(maxChart / 2)}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={styles.chartYLabel}>0</Text>
                </View>
                <View style={styles.chartBarsWrap}>
                  <View style={styles.gridLine} />
                  <View style={[styles.gridLine, { bottom: '50%' }]} />
                  {chartData.map((pt, i) => {
                    const h = maxChart > 0 ? (pt.value / maxChart) * 100 : 0;
                    const isMax = pt.value === Math.max(...chartData.map(p => p.value));
                    return (
                      <View key={i} style={styles.barCol}>
                        {pt.value > 0 && <Text style={styles.barVal} numberOfLines={1}>{formatINR(pt.value)}</Text>}
                        <View style={styles.barTrack}>
                          <View style={[styles.barFill, { height: `${Math.max(h, 2)}%`, backgroundColor: isMax ? C.info : 'rgba(59,130,246,0.45)' }]} />
                        </View>
                        <Text style={styles.barLabel} numberOfLines={1}>{pt.label}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : (
              <View style={styles.chartEmpty}>
                <Ionicons name="bar-chart-outline" size={32} color={C.white20} />
                <Text style={styles.chartEmptyText}>No revenue data for this period</Text>
              </View>
            )}
          </View>
        </View>

        {/* Top Products */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Products by Revenue</Text>
          {topProducts.length > 0 ? topProducts.map((p, i) => {
            const maxRev = topProducts[0]?.revenue || 1;
            const pct = (p.revenue / maxRev) * 100;
            return (
              <View key={i} style={styles.productRow}>
                <View style={[styles.productRank, i === 0 && styles.productRankFirst]}>
                  <Text style={[styles.productRankText, i === 0 && styles.productRankTextFirst]}>{i + 1}</Text>
                </View>
                <View style={styles.productInfo}>
                  <Text style={styles.productName} numberOfLines={1}>{p.name}</Text>
                  <View style={styles.productBarRow}>
                    <View style={styles.productBarTrack}>
                      <View style={[styles.productBarFill, { width: `${Math.max(pct, 4)}%` }]} />
                    </View>
                    <Text style={styles.productSold}>{p.sold} sold</Text>
                  </View>
                </View>
                <Text style={styles.productRevenue}>{formatINR(p.revenue)}</Text>
              </View>
            );
          }) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyCardText}>No product data for this period</Text>
            </View>
          )}
        </View>

        {/* Recent Activity */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          {recentActivity.length > 0 ? recentActivity.map((o, i) => {
            const sc = sColor(o.status);
            return (
              <View key={i} style={styles.activityRow}>
                <View style={[styles.activityIcon, { backgroundColor: sc + '15' }]}>
                  <Ionicons name="receipt-outline" size={16} color={sc} />
                </View>
                <View style={styles.activityContent}>
                  <Text style={styles.activityName} numberOfLines={1}>{o.buyerName}</Text>
                  <Text style={styles.activityMeta}>#{o.id.slice(-8)} &middot; {formatINR(o.total)}</Text>
                </View>
                <View style={[styles.activityBadge, { backgroundColor: sc + '20' }]}>
                  <Text style={[styles.activityBadgeText, { color: sc }]}>
                    {o.status.charAt(0).toUpperCase() + o.status.slice(1)}
                  </Text>
                </View>
              </View>
            );
          }) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyCardText}>No recent activity</Text>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
};

/* ── Styles ────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.black },
  centerLoader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.black },
  header: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { color: C.text, fontSize: F.xl, fontWeight: '700' },
  scroll: { paddingBottom: 40 },

  /* Period Selector */
  periodBar: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingHorizontal: S.lg, paddingVertical: S.md, borderBottomWidth: 1, borderBottomColor: C.border },
  pill: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: BR.lg, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  pillActive: { backgroundColor: 'rgba(59,130,246,0.2)', borderColor: C.info },
  pillText: { color: C.textSecondary, fontSize: F.sm, fontWeight: '600' },
  pillTextActive: { color: C.info },

  /* Sections */
  section: { padding: S.lg },
  sectionTitle: { color: C.text, fontSize: F.lg, fontWeight: '600', marginBottom: S.md },

  /* KPI Cards */
  kpiRow: { flexDirection: 'row', gap: S.sm },
  kpiCard: { flex: 1, backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.border, padding: S.md, gap: S.sm },
  kpiIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  kpiValue: { color: C.white, fontSize: F.xl, fontWeight: '800' },
  kpiLabel: { color: C.textSecondary, fontSize: F.xs, marginTop: 2 },

  /* Chart */
  chartCard: { backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.border, padding: S.md },
  chartContainer: { flexDirection: 'row', height: 180 },
  chartYAxis: { width: 60, justifyContent: 'space-between', paddingVertical: 4 },
  chartYLabel: { color: C.textSecondary, fontSize: 9, textAlign: 'right' },
  chartBarsWrap: { flex: 1, position: 'relative', justifyContent: 'flex-end', paddingLeft: S.sm },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: C.border, bottom: 0 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
  barVal: { color: C.textSecondary, fontSize: 8, marginBottom: 2 },
  barTrack: { width: '60%', height: 120, backgroundColor: C.black, borderRadius: 4, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: 4 },
  barLabel: { color: C.textSecondary, fontSize: 9, marginTop: 4 },
  chartEmpty: { alignItems: 'center', justifyContent: 'center', height: 160, gap: S.sm },
  chartEmptyText: { color: C.textSecondary, fontSize: F.sm },

  /* Top Products */
  productRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.sm },
  productRank: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center' },
  productRankFirst: { backgroundColor: C.warning, },
  productRankText: { color: C.white, fontSize: F.sm, fontWeight: '700' },
  productRankTextFirst: { color: C.black },
  productInfo: { flex: 1, gap: 4 },
  productName: { color: C.text, fontSize: F.sm, fontWeight: '500' },
  productBarRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  productBarTrack: { flex: 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  productBarFill: { height: '100%', backgroundColor: C.info, borderRadius: 3 },
  productSold: { color: C.textSecondary, fontSize: F.xs, width: 48, textAlign: 'right' },
  productRevenue: { color: C.text, fontSize: F.sm, fontWeight: '700', width: 72, textAlign: 'right' },

  /* Activity */
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.sm },
  activityIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  activityContent: { flex: 1 },
  activityName: { color: C.text, fontSize: F.sm, fontWeight: '600' },
  activityMeta: { color: C.textSecondary, fontSize: F.xs, marginTop: 2 },
  activityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: BR.sm },
  activityBadgeText: { fontSize: F.xs, fontWeight: '600' },

  /* Empty */
  emptyCard: { backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.border, padding: S.xxl, alignItems: 'center' },
  emptyCardText: { color: C.textSecondary, fontSize: F.sm },
});

export default PerformanceScreen;
