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
  textTertiary: '#71767b',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#3b82f6',
  purple: '#8b5cf6',
  gold: '#eab308',
  accent: '#2a7fff',
};

const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
const F = { xs: 10, sm: 12, md: 14, lg: 15, xl: 18, xxl: 22, xxxl: 28 };
const BR = { sm: 6, md: 10, lg: 16, xl: 24 };

/* ── Constants ──────────────────────────────────────────────────────────────── */

const PERIODS = [
  { key: '7d', label: '7d', days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
  { key: 'all', label: 'All', days: 0 },
] as const;

type PeriodKey = (typeof PERIODS)[number]['key'];

const FUNNEL_STAGES = [
  { status: 'new', label: 'New', color: C.info },
  { status: 'contacted', label: 'Contacted', color: C.warning },
  { status: 'qualified', label: 'Qualified', color: C.purple },
  { status: 'converted', label: 'Converted', color: C.success },
];

const SOURCE_LABELS: Record<string, string> = {
  store: 'Store',
  affiliate: 'Affiliate',
  direct: 'Direct',
};

const SOURCE_COLORS: Record<string, string> = {
  store: C.accent,
  affiliate: C.purple,
  direct: C.gold,
};

/* ── Types ──────────────────────────────────────────────────────────────────── */

interface KpiData {
  totalRevenue: number;
  totalOrders: number;
  activeCustomers: number;
  avgOrderValue: number;
}

interface FunnelItem {
  status: string;
  label: string;
  color: string;
  count: number;
}

interface ProductItem {
  id: string;
  name: string;
  soldCount: number;
  price: number;
}

interface RevenueSource {
  key: string;
  label: string;
  color: string;
  amount: number;
}

interface CustomerStats {
  newCustomers: number;
  returningCustomers: number;
  avgSpend: number;
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

const formatINR = (val: number) =>
  '\u20B9' + Math.round(val).toLocaleString('en-IN');

function tsToMillis(ts: any): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return new Date(ts).getTime() || 0;
  if (ts?.toMillis) return ts.toMillis();
  if (ts?.seconds) return ts.seconds * 1000;
  return 0;
}

/* ── Component ─────────────────────────────────────────────────────────────── */

const CrmAnalyticsScreen: React.FC = () => {
  const uid = auth().currentUser?.uid ?? '';
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [kpi, setKpi] = useState<KpiData>({
    totalRevenue: 0,
    totalOrders: 0,
    activeCustomers: 0,
    avgOrderValue: 0,
  });
  const [funnel, setFunnel] = useState<FunnelItem[]>([]);
  const [topProducts, setTopProducts] = useState<ProductItem[]>([]);
  const [revenueBySource, setRevenueBySource] = useState<RevenueSource[]>([]);
  const [customerStats, setCustomerStats] = useState<CustomerStats>({
    newCustomers: 0,
    returningCustomers: 0,
    avgSpend: 0,
  });

  const periodDays = useMemo(
    () => PERIODS.find((p) => p.key === period)?.days ?? 0,
    [period],
  );

  const cutoffTs = useMemo(
    () => (periodDays > 0 ? Date.now() - periodDays * 86_400_000 : 0),
    [periodDays],
  );

  /* ── Data Loading ─────────────────────────────────────────────────────── */

  const loadData = useCallback(async () => {
    if (!uid) return;
    try {
      /* ── Orders ── */
      let ordersQuery = firestore()
        .collection('orders')
        .where('businessId', '==', uid);
      if (periodDays > 0) {
        ordersQuery = ordersQuery
          .where('createdAt', '>=', cutoffTs)
          .orderBy('createdAt', 'desc');
      } else {
        ordersQuery = ordersQuery.orderBy('createdAt', 'desc');
      }
      ordersQuery = ordersQuery.limit(500);
      const ordersSnap = await ordersQuery.get();

      /* ── Leads ── */
      let leadsQuery = firestore()
        .collection('leads')
        .where('businessId', '==', uid);
      if (periodDays > 0) {
        leadsQuery = leadsQuery
          .where('createdAt', '>=', cutoffTs)
          .orderBy('createdAt', 'desc');
      } else {
        leadsQuery = leadsQuery.orderBy('createdAt', 'desc');
      }
      leadsQuery = leadsQuery.limit(500);
      const leadsSnap = await leadsQuery.get();

      /* ── Products ── */
      const productsSnap = await firestore()
        .collection('products')
        .where('businessId', '==', uid)
        .orderBy('soldCount', 'desc')
        .limit(5)
        .get();

      /* ═══ Process Orders ═══ */
      const orders = ordersSnap.docs.map((d) => ({
        ...d.data(),
        id: d.id,
      }));
      const totalRevenue = orders.reduce(
        (sum: number, o: any) => sum + (o.total || 0),
        0,
      );
      const totalOrders = orders.length;

      // Unique customers
      const buyerSet = new Set<string>();
      orders.forEach((o: any) => {
        if (o.buyerId) buyerSet.add(o.buyerId);
        else if (o.buyerEmail) buyerSet.add(o.buyerEmail);
        else if (o.buyerName) buyerSet.add(o.buyerName);
      });
      const activeCustomers = buyerSet.size;
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      setKpi({ totalRevenue, totalOrders, activeCustomers, avgOrderValue });

      /* ═══ Revenue by Source ═══ */
      const sourceMap: Record<string, number> = { store: 0, affiliate: 0, direct: 0 };
      orders.forEach((o: any) => {
        const src = o.source || o.orderSource || 'store';
        if (sourceMap[src] !== undefined) {
          sourceMap[src] += o.total || 0;
        } else {
          sourceMap['direct'] += o.total || 0;
        }
      });
      const srcEntries: RevenueSource[] = Object.entries(sourceMap)
        .map(([key, amount]) => ({
          key,
          label: SOURCE_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1),
          color: SOURCE_COLORS[key] || C.textSecondary,
          amount,
        }))
        .filter((s) => s.amount > 0)
        .sort((a, b) => b.amount - a.amount);
      setRevenueBySource(srcEntries);

      /* ═══ Customer Stats ═══ */
      const orderMap = new Map<string, { count: number; spent: number; firstTs: number }>();
      orders.forEach((o: any) => {
        const key = o.buyerId || o.buyerEmail || o.buyerName || '__anon__';
        const existing = orderMap.get(key) || { count: 0, spent: 0, firstTs: Infinity };
        existing.count += 1;
        existing.spent += o.total || 0;
        const ts = tsToMillis(o.createdAt);
        if (ts > 0 && ts < existing.firstTs) existing.firstTs = ts;
        orderMap.set(key, existing);
      });

      const periodStart = periodDays > 0 ? cutoffTs : 0;
      let newCustomers = 0;
      let returningCustomers = 0;
      let totalSpend = 0;
      orderMap.forEach((cust) => {
        totalSpend += cust.spent;
        if (periodStart > 0 && cust.firstTs >= periodStart) {
          newCustomers += 1;
        } else {
          returningCustomers += 1;
        }
      });
      const totalCustCount = newCustomers + returningCustomers;
      setCustomerStats({
        newCustomers,
        returningCustomers,
        avgSpend: totalCustCount > 0 ? totalSpend / totalCustCount : 0,
      });

      /* ═══ Lead Funnel ═══ */
      const leads = leadsSnap.docs.map((d) => d.data());
      const statusCount: Record<string, number> = {};
      leads.forEach((l: any) => {
        const s = l.status || 'new';
        statusCount[s] = (statusCount[s] || 0) + 1;
      });
      const funnelData: FunnelItem[] = FUNNEL_STAGES.map((stage) => ({
        status: stage.status,
        label: stage.label,
        color: stage.color,
        count: statusCount[stage.status] || 0,
      }));
      setFunnel(funnelData);

      /* ═══ Top Products ═══ */
      const products = productsSnap.docs.map((d) => ({
        id: d.id,
        name: d.data().name || d.data().productName || 'Untitled',
        soldCount: d.data().soldCount || 0,
        price: d.data().price || d.data().sellingPrice || 0,
      }));
      setTopProducts(products);
    } catch (e) {
      console.error('[CrmAnalytics] Failed to load:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid, periodDays, cutoffTs]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  /* ── Render ───────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <View style={styles.centerLoader}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* ═══ Header ═══ */}
      <View style={styles.header}>
        <Ionicons name="analytics-outline" size={22} color={C.accent} />
        <Text style={styles.headerTitle}>Business Analytics</Text>
      </View>

      {/* ═══ Period Selector ═══ */}
      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[styles.periodChip, period === p.key && styles.periodChipActive]}
            onPress={() => setPeriod(p.key)}>
            <Text
              style={[
                styles.periodChipText,
                period === p.key && styles.periodChipTextActive,
              ]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={C.accent}
          />
        }>

        {/* ═══ KPI Row (2x2 grid) ═══ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Key Metrics</Text>
          <View style={styles.kpiGrid}>
            <View style={styles.kpiCard}>
              <View style={[styles.kpiIconBg, { backgroundColor: C.success + '1a' }]}>
                <Ionicons name="wallet-outline" size={20} color={C.success} />
              </View>
              <View style={styles.kpiInfo}>
                <Text style={styles.kpiValue}>{formatINR(kpi.totalRevenue)}</Text>
                <Text style={styles.kpiLabel}>Total Revenue</Text>
              </View>
            </View>

            <View style={styles.kpiCard}>
              <View style={[styles.kpiIconBg, { backgroundColor: C.info + '1a' }]}>
                <Ionicons name="receipt-outline" size={20} color={C.info} />
              </View>
              <View style={styles.kpiInfo}>
                <Text style={styles.kpiValue}>{kpi.totalOrders}</Text>
                <Text style={styles.kpiLabel}>Total Orders</Text>
              </View>
            </View>

            <View style={styles.kpiCard}>
              <View style={[styles.kpiIconBg, { backgroundColor: C.purple + '1a' }]}>
                <Ionicons name="people-outline" size={20} color={C.purple} />
              </View>
              <View style={styles.kpiInfo}>
                <Text style={styles.kpiValue}>{kpi.activeCustomers}</Text>
                <Text style={styles.kpiLabel}>Active Customers</Text>
              </View>
            </View>

            <View style={styles.kpiCard}>
              <View style={[styles.kpiIconBg, { backgroundColor: C.warning + '1a' }]}>
                <Ionicons name="pricetag-outline" size={20} color={C.warning} />
              </View>
              <View style={styles.kpiInfo}>
                <Text style={styles.kpiValue}>{formatINR(kpi.avgOrderValue)}</Text>
                <Text style={styles.kpiLabel}>Avg Order Value</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ═══ Lead Conversion Funnel ═══ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Lead Conversion Funnel</Text>
          <View style={styles.card}>
            {funnel.length > 0 ? (
              <View>
                {(() => {
                  const maxCount = Math.max(...funnel.map((f) => f.count), 1);
                  return funnel.map((item) => {
                    const pct = (item.count / maxCount) * 100;
                    return (
                      <View key={item.status} style={styles.funnelRow}>
                        <View style={styles.funnelMeta}>
                          <Text style={styles.funnelLabel}>{item.label}</Text>
                          <Text style={[styles.funnelCount, { color: item.color }]}>
                            {item.count}
                          </Text>
                        </View>
                        <View style={styles.funnelTrack}>
                          <View
                            style={[
                              styles.funnelFill,
                              {
                                width: `${Math.max(pct, 3)}%`,
                                backgroundColor: item.color,
                              },
                            ]}
                          />
                        </View>
                      </View>
                    );
                  });
                })()}

                {/* Funnel summary */}
                <View style={styles.funnelSummary}>
                  <View style={styles.funnelSummaryItem}>
                    <Text style={styles.funnelSummaryLabel}>Total Leads</Text>
                    <Text style={styles.funnelSummaryValue}>
                      {funnel.reduce((s, f) => s + f.count, 0)}
                    </Text>
                  </View>
                  <View style={styles.funnelSummaryItem}>
                    <Text style={styles.funnelSummaryLabel}>Converted</Text>
                    <Text style={[styles.funnelSummaryValue, { color: C.success }]}>
                      {funnel.find((f) => f.status === 'converted')?.count ?? 0}
                    </Text>
                  </View>
                  <View style={styles.funnelSummaryItem}>
                    <Text style={styles.funnelSummaryLabel}>Rate</Text>
                    <Text style={[styles.funnelSummaryValue, { color: C.info }]}>
                      {(() => {
                        const total = funnel.reduce((s, f) => s + f.count, 0);
                        const conv = funnel.find((f) => f.status === 'converted')?.count ?? 0;
                        return total > 0 ? ((conv / total) * 100).toFixed(1) + '%' : '0%';
                      })()}
                    </Text>
                  </View>
                </View>
              </View>
            ) : (
              <Text style={styles.emptyText}>No funnel data available yet</Text>
            )}
          </View>
        </View>

        {/* ═══ Top Products ═══ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Products</Text>
          {topProducts.length > 0 ? (
            <View style={styles.card}>
              {(() => {
                const maxSold = Math.max(...topProducts.map((p) => p.soldCount), 1);
                return topProducts.map((product, idx) => {
                  const barPct = (product.soldCount / maxSold) * 100;
                  return (
                    <View key={product.id} style={styles.productRow}>
                      <View
                        style={[
                          styles.productRank,
                          idx < 3 && { backgroundColor: C.warning, borderColor: C.warning },
                        ]}>
                        <Text
                          style={[
                            styles.productRankText,
                            idx < 3 && { color: C.black },
                          ]}>
                          {idx + 1}
                        </Text>
                      </View>
                      <View style={styles.productInfo}>
                        <Text style={styles.productName} numberOfLines={1}>
                          {product.name}
                        </Text>
                        <View style={styles.productBarRow}>
                          <View style={styles.productBarTrack}>
                            <View
                              style={[
                                styles.productBarFill,
                                { width: `${Math.max(barPct, 3)}%` },
                              ]}
                            />
                          </View>
                          <Text style={styles.productSold}>
                            {product.soldCount} sold
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.productRevenue}>
                        {formatINR(product.soldCount * product.price)}
                      </Text>
                    </View>
                  );
                });
              })()}
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.emptyText}>No product data available yet</Text>
            </View>
          )}
        </View>

        {/* ═══ Revenue by Source ═══ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Revenue by Source</Text>
          <View style={styles.card}>
            {revenueBySource.length > 0 ? (
              <View>
                {(() => {
                  const maxRev = Math.max(...revenueBySource.map((s) => s.amount), 1);
                  return revenueBySource.map((src) => {
                    const pct = (src.amount / maxRev) * 100;
                    return (
                      <View key={src.key} style={styles.sourceRow}>
                        <View style={styles.sourceMeta}>
                          <View style={[styles.sourceDot, { backgroundColor: src.color }]} />
                          <Text style={styles.sourceLabel}>{src.label}</Text>
                        </View>
                        <View style={styles.sourceBarRow}>
                          <View style={styles.sourceBarTrack}>
                            <View
                              style={[
                                styles.sourceBarFill,
                                {
                                  width: `${Math.max(pct, 3)}%`,
                                  backgroundColor: src.color,
                                },
                              ]}
                            />
                          </View>
                          <Text style={styles.sourceAmount}>
                            {formatINR(src.amount)}
                          </Text>
                        </View>
                      </View>
                    );
                  });
                })()}

                {/* Source total */}
                <View style={styles.sourceTotalRow}>
                  <Text style={styles.sourceTotalLabel}>Total</Text>
                  <Text style={styles.sourceTotalValue}>
                    {formatINR(revenueBySource.reduce((s, r) => s + r.amount, 0))}
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={styles.emptyText}>No revenue source data yet</Text>
            )}
          </View>
        </View>

        {/* ═══ Customer Stats ═══ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Customer Stats</Text>
          <View style={styles.card}>
            {/* Visual bar */}
            <View style={styles.custBarOuter}>
              {(() => {
                const total = customerStats.newCustomers + customerStats.returningCustomers;
                if (total === 0) return null;
                const newPct = (customerStats.newCustomers / total) * 100;
                const retPct = (customerStats.returningCustomers / total) * 100;
                return (
                  <>
                    <View
                      style={[
                        styles.custBarSeg,
                        {
                          width: `${newPct}%`,
                          backgroundColor: C.accent,
                          borderTopLeftRadius: BR.sm,
                          borderBottomLeftRadius: BR.sm,
                        },
                      ]}
                    />
                    <View
                      style={[
                        styles.custBarSeg,
                        {
                          width: `${retPct}%`,
                          backgroundColor: C.success,
                          borderTopRightRadius: BR.sm,
                          borderBottomRightRadius: BR.sm,
                        },
                      ]}
                    />
                  </>
                );
              })()}
            </View>

            {/* Legend */}
            <View style={styles.custLegendRow}>
              <View style={styles.custLegendItem}>
                <View style={[styles.custLegendDot, { backgroundColor: C.accent }]} />
                <View style={styles.custLegendTextWrap}>
                  <Text style={styles.custLegendVal}>{customerStats.newCustomers}</Text>
                  <Text style={styles.custLegendLbl}>New Customers</Text>
                </View>
              </View>
              <View style={styles.custLegendItem}>
                <View style={[styles.custLegendDot, { backgroundColor: C.success }]} />
                <View style={styles.custLegendTextWrap}>
                  <Text style={styles.custLegendVal}>{customerStats.returningCustomers}</Text>
                  <Text style={styles.custLegendLbl}>Returning</Text>
                </View>
              </View>
            </View>

            {/* Metric boxes */}
            <View style={styles.custMetricsRow}>
              <View style={styles.custMetricBox}>
                <Ionicons name="person-add-outline" size={16} color={C.accent} />
                <Text style={styles.custMetricValue}>{customerStats.newCustomers}</Text>
                <Text style={styles.custMetricLabel}>New This Period</Text>
              </View>
              <View style={styles.custMetricBox}>
                <Ionicons name="refresh-outline" size={16} color={C.success} />
                <Text style={styles.custMetricValue}>{customerStats.returningCustomers}</Text>
                <Text style={styles.custMetricLabel}>Returning</Text>
              </View>
              <View style={styles.custMetricBox}>
                <Ionicons name="card-outline" size={16} color={C.warning} />
                <Text style={styles.custMetricValue}>{formatINR(customerStats.avgSpend)}</Text>
                <Text style={styles.custMetricLabel}>Avg Spend</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
};

/* ── Styles ────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.black },
  centerLoader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: C.black,
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    paddingHorizontal: S.lg,
    paddingTop: S.xl,
    paddingBottom: S.sm,
  },
  headerTitle: {
    color: C.text,
    fontSize: F.xxl,
    fontWeight: '700',
  },

  /* Period selector */
  periodRow: {
    flexDirection: 'row',
    gap: S.sm,
    paddingHorizontal: S.lg,
    paddingBottom: S.sm,
  },
  periodChip: {
    paddingHorizontal: S.md + 2,
    paddingVertical: S.xs + 2,
    borderRadius: BR.lg,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  periodChipActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
  periodChipText: {
    color: C.textSecondary,
    fontSize: F.sm,
    fontWeight: '600',
  },
  periodChipTextActive: {
    color: '#fff',
  },

  /* Scroll */
  scrollContent: { paddingBottom: 40 },

  /* Section */
  section: { padding: S.lg },
  sectionTitle: {
    color: C.text,
    fontSize: F.lg,
    fontWeight: '600',
    marginBottom: S.md,
  },

  /* Card */
  card: {
    backgroundColor: C.surface,
    borderRadius: BR.md,
    borderWidth: 1,
    borderColor: C.border,
    padding: S.md,
  },
  emptyText: {
    color: C.textTertiary,
    fontSize: F.sm,
    textAlign: 'center',
    paddingVertical: S.xl,
  },

  /* KPI Grid */
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.sm,
    marginHorizontal: -S.xs / 2,
  },
  kpiCard: {
    flex: 1,
    minWidth: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: BR.md,
    borderWidth: 1,
    borderColor: C.border,
    padding: S.md,
    gap: S.sm,
  },
  kpiIconBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiInfo: { flex: 1 },
  kpiValue: {
    color: C.text,
    fontSize: F.lg,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  kpiLabel: {
    color: C.textSecondary,
    fontSize: F.xs,
    marginTop: 2,
  },

  /* Funnel */
  funnelRow: {
    marginBottom: S.md,
  },
  funnelMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  funnelLabel: {
    color: C.textSecondary,
    fontSize: F.sm,
    fontWeight: '500',
  },
  funnelCount: {
    fontSize: F.sm,
    fontWeight: '700',
  },
  funnelTrack: {
    height: 14,
    borderRadius: 7,
    backgroundColor: C.border,
    overflow: 'hidden',
  },
  funnelFill: {
    height: '100%',
    borderRadius: 7,
  },
  funnelSummary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: S.md,
    paddingTop: S.md,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  funnelSummaryItem: { alignItems: 'center' },
  funnelSummaryLabel: {
    color: C.textSecondary,
    fontSize: F.xs,
  },
  funnelSummaryValue: {
    color: C.text,
    fontSize: F.xl,
    fontWeight: '800',
    marginTop: 2,
  },

  /* Products */
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingVertical: S.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  productRank: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.border,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productRankText: {
    color: C.textTertiary,
    fontSize: F.xs,
    fontWeight: '700',
  },
  productInfo: { flex: 1 },
  productName: {
    color: C.text,
    fontSize: F.sm,
    fontWeight: '600',
  },
  productBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    marginTop: 4,
  },
  productBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.border,
    overflow: 'hidden',
  },
  productBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: C.accent,
  },
  productSold: {
    color: C.textTertiary,
    fontSize: F.xs,
    width: 50,
    textAlign: 'right',
  },
  productRevenue: {
    color: C.success,
    fontSize: F.sm,
    fontWeight: '700',
    width: 80,
    textAlign: 'right',
  },

  /* Revenue by Source */
  sourceRow: {
    marginBottom: S.md,
  },
  sourceMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    marginBottom: 4,
  },
  sourceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sourceLabel: {
    color: C.textSecondary,
    fontSize: F.sm,
    fontWeight: '500',
  },
  sourceBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
  },
  sourceBarTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.border,
    overflow: 'hidden',
  },
  sourceBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  sourceAmount: {
    color: C.text,
    fontSize: F.xs,
    fontWeight: '700',
    width: 80,
    textAlign: 'right',
  },
  sourceTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: S.sm,
    marginTop: S.xs,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  sourceTotalLabel: {
    color: C.textSecondary,
    fontSize: F.sm,
    fontWeight: '600',
  },
  sourceTotalValue: {
    color: C.text,
    fontSize: F.md,
    fontWeight: '800',
  },

  /* Customer Stats */
  custBarOuter: {
    height: 10,
    borderRadius: BR.sm,
    backgroundColor: C.border,
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: S.md,
  },
  custBarSeg: {
    height: '100%',
  },
  custLegendRow: {
    flexDirection: 'row',
    gap: S.xl,
    marginBottom: S.lg,
  },
  custLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
  },
  custLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  custLegendTextWrap: {},
  custLegendVal: {
    color: C.text,
    fontSize: F.md,
    fontWeight: '700',
  },
  custLegendLbl: {
    color: C.textTertiary,
    fontSize: F.xs,
  },
  custMetricsRow: {
    flexDirection: 'row',
    gap: S.sm,
  },
  custMetricBox: {
    flex: 1,
    backgroundColor: C.black,
    borderRadius: BR.sm,
    padding: S.md,
    alignItems: 'center',
    gap: 4,
  },
  custMetricValue: {
    color: C.text,
    fontSize: F.md,
    fontWeight: '700',
  },
  custMetricLabel: {
    color: C.textTertiary,
    fontSize: F.xs,
  },
});

export default CrmAnalyticsScreen;
