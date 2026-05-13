import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../lib/firebase';
import { colors } from '../theme/colors';
import * as CRM from '../lib/crm';
import * as Ads from '../lib/ads';
import * as Salary from '../lib/salary';
import { fetchBusinessOrders } from '../lib/shop';

/* ── Theme ──────────────────────────────────────────────────────────────────── */

const C = {
  ...colors,
  surface: colors.surface,
  surfaceBorder: colors.border,
  textPrimary: colors.text,
  textSecondary: colors.textSecondary,
  textTertiary: colors.textMuted,
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#06b6d4',
  purple: '#8b5cf6',
  blue: '#3b82f6',
  white: colors.white,
  gold: '#ffd700',
  accent: colors.accent,
};

const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
const F = { xs: 10, sm: 12, md: 14, lg: 15, xl: 18, xxl: 22, xxxl: 28 };
const BR = { sm: 6, md: 10, lg: 16, xl: 24 };

const SCREEN_W = Dimensions.get('window').width;
const CARD_W = (SCREEN_W - 48 - 12) / 2;

/* ── Helpers ──────────────────────────────────────────────────────────────────── */

function formatINR(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN');
}

/* ── Quick Actions Config ──────────────────────────────────────────────────── */

const QUICK_ACTIONS = [
  { label: 'CRM Leads', icon: 'people-outline' as const, screen: 'CrmLeads', color: C.info },
  { label: 'CRM Deals', icon: 'briefcase' as const, screen: 'CrmDeals', color: C.purple },
  { label: 'CRM Analytics', icon: 'stats-chart' as const, screen: 'CrmAnalytics', color: C.blue },
  { label: 'Orders', icon: 'receipt' as const, screen: 'CrmOrders', color: C.warning },
  { label: 'Ads Manager', icon: 'megaphone' as const, screen: 'AdsManager', color: C.danger },
  { label: 'Salary', icon: 'cash' as const, screen: 'Salary', color: C.gold },
  { label: 'Affiliates', icon: 'people' as const, screen: 'Affiliates', color: C.gold },
  { label: 'Performance', icon: 'speedometer-outline' as const, screen: 'Performance', color: C.success },
  { label: 'My Store', icon: 'storefront-outline' as const, screen: 'MyStore', color: C.accent },
  { label: 'Store Dashboard', icon: 'grid' as const, screen: 'StoreDashboard', color: C.info },
  { label: 'ShipRocket', icon: 'rocket' as const, screen: 'ShipRocketSettings', color: C.blue },
  { label: 'Order Mgmt', icon: 'swap-vertical-outline' as const, screen: 'OrderManagement', color: C.warning },
  { label: 'AI Lead Gen', icon: 'sparkles' as const, screen: 'AiLeadGen', color: C.purple },
  { label: 'Ads Pricing', icon: 'pricetag' as const, screen: 'AdsPricing', color: C.danger },
];

/* ── Component ─────────────────────────────────────────────────────────────── */

interface Props {
  navigation?: any;
}

const BusinessDashboardScreen: React.FC<Props> = ({ navigation }) => {
  const uid = auth().currentUser?.uid ?? '';
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // KPI Data
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalOrders, setTotalOrders] = useState(0);
  const [activeCustomers, setActiveCustomers] = useState(0);
  const [conversionRate, setConversionRate] = useState(0);
  const [totalLeads, setTotalLeads] = useState(0);
  const [followUpsPending, setFollowUpsPending] = useState(0);

  // Recent data
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [leadSummary, setLeadSummary] = useState({ new: 0, contacted: 0, qualified: 0, converted: 0 });
  const [adSummary, setAdSummary] = useState({ active: 0, spent: 0, impressions: 0, clicks: 0 });
  const [storeStats, setStoreStats] = useState({ products: 0, reviews: 0 });

  /* ── Data Loading ── */

  const load = useCallback(async () => {
    if (!uid) { setLoading(false); return; }
    try {
      const [ordersResult, analytics, adAnalytics, leadData] = await Promise.all([
        fetchBusinessOrders(uid),
        CRM.fetchBusinessAnalytics(uid, '30d'),
        Ads.fetchAllAdAnalytics(uid),
        CRM.fetchLeads(uid, { sortBy: 'createdAt', sortOrder: 'desc', limit: 200 }),
      ]);

      // Orders KPIs
      let revenue = 0;
      let orders = 0;
      const customerIds = new Set<string>();
      const recent: any[] = [];

      for (const o of ordersResult) {
        revenue += o.total || 0;
        orders++;
        if (o.buyerId) customerIds.add(o.buyerId);
        recent.push(o);
      }

      setTotalRevenue(revenue);
      setTotalOrders(orders);
      setActiveCustomers(customerIds.size);
      setConversionRate(analytics.conversionRate ?? 0);
      setTotalLeads(analytics.totalLeads ?? 0);
      setRecentOrders(recent.slice(0, 5));

      // Lead summary
      const lb = analytics.leadsByStatus ?? {};
      setLeadSummary({
        new: lb.new ?? 0,
        contacted: lb.contacted ?? 0,
        qualified: lb.qualified ?? 0,
        converted: lb.converted ?? 0,
      });

      // Follow-ups pending
      const followUpCount = leadData.filter(l => l.status === 'new' || l.status === 'contacted').length;
      setFollowUpsPending(followUpCount);

      // Ad summary
      setAdSummary({
        active: adAnalytics.activeCampaigns ?? 0,
        spent: adAnalytics.totalSpent ?? 0,
        impressions: adAnalytics.totalImpressions ?? 0,
        clicks: adAnalytics.totalClicks ?? 0,
      });

      // Store stats — fetch business products count
      try {
        const { products } = await (await import('../lib/shop')).fetchBusinessProducts(uid, 200);
        const totalReviews = products.reduce((s: number, p: any) => s + (p.reviewCount || 0), 0);
        setStoreStats({ products: products.length, reviews: totalReviews });
      } catch {
        // Store stats remain 0
      }
    } catch (e) {
      console.error('[Dashboard] Failed to load:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  /* ── Render ── */

  if (loading) {
    return (
      <View style={styles.centerLoader}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  const navigate = (screen: string) => {
    if (navigation) navigation.navigate(screen);
  };

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.accent} />
      }>

        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIconWrap}>
              <Ionicons name="business-outline" size={24} color={C.accent} />
            </View>
            <View>
              <Text style={styles.headerTitle}>Business Dashboard</Text>
              <Text style={styles.headerSub}>Overview of your business performance</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.refreshBtn} onPress={() => { setRefreshing(true); load(); }}>
            <Ionicons name="refresh-outline" size={20} color={C.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* ═══ KPI Cards ═══ */}
        <View style={styles.kpiSection}>
          {[
            { icon: 'wallet-outline', label: 'Revenue', value: formatINR(totalRevenue), color: C.success },
            { icon: 'receipt-outline', label: 'Orders', value: String(totalOrders), color: C.blue },
            { icon: 'people-outline', label: 'Customers', value: String(activeCustomers), color: C.purple },
            { icon: 'swap-vertical-outline', label: 'Conversion', value: `${conversionRate.toFixed(1)}%`, color: C.info },
          ].map((kpi, i) => (
            <View key={i} style={[styles.kpiCard, { width: CARD_W }]}>
              <View style={[styles.kpiIcon, { backgroundColor: kpi.color + '15' }]}>
                <Ionicons name={kpi.icon as any} size={22} color={kpi.color} />
              </View>
              <Text style={styles.kpiValue}>{kpi.value}</Text>
              <Text style={styles.kpiLabel}>{kpi.label}</Text>
            </View>
          ))}
        </View>

        {/* ═══ Quick Actions Grid ═══ */}
        <View style={styles.sectionWrap}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionsGrid}>
            {QUICK_ACTIONS.map((action) => (
              <TouchableOpacity
                key={action.screen}
                style={styles.actionCard}
                onPress={() => navigate(action.screen)}
                activeOpacity={0.7}>
                <View style={[styles.actionIconWrap, { backgroundColor: action.color + '15' }]}>
                  <Ionicons name={action.icon} size={22} color={action.color} />
                </View>
                <Text style={styles.actionLabel}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ═══ Recent Orders ═══ */}
        <View style={styles.sectionWrap}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Recent Orders</Text>
            <TouchableOpacity onPress={() => navigate('BusinessOrders')}>
              <Text style={styles.viewAllLink}>View All</Text>
            </TouchableOpacity>
          </View>
          {recentOrders.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="receipt-outline" size={32} color={C.textTertiary} />
              <Text style={styles.emptyText}>No orders yet</Text>
            </View>
          ) : (
            recentOrders.map((order) => {
              const statusColors: Record<string, string> = {
                pending: C.warning,
                confirmed: C.info,
                processing: C.blue,
                shipped: C.purple,
                delivered: C.success,
                cancelled: C.danger,
                refunded: C.textTertiary,
              };
              const orderColor = statusColors[order.status] || C.textSecondary;
              return (
                <View key={order.id} style={styles.orderRow}>
                  <View style={styles.orderLeft}>
                    <Text style={styles.orderId}>#{(order.id || '').slice(-8).toUpperCase()}</Text>
                    <Text style={styles.orderBuyer}>{order.buyerName || 'Customer'}</Text>
                  </View>
                  <View style={styles.orderRight}>
                    <Text style={styles.orderTotal}>{formatINR(order.total || 0)}</Text>
                    <Text style={[styles.orderStatus, { color: orderColor }]}>
                      {order.status?.charAt(0).toUpperCase() + (order.status || '').slice(1)}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
          {recentOrders.length > 0 && (
            <TouchableOpacity style={styles.viewAllBtn} onPress={() => navigate('CrmOrders')}>
              <Text style={styles.viewAllText}>View All Orders</Text>
              <Ionicons name="chevron-forward" size={16} color={C.textTertiary} />
            </TouchableOpacity>
          )}
        </View>

        {/* ═══ Lead Summary ═══ */}
        <View style={styles.sectionWrap}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Lead Summary</Text>
            <TouchableOpacity onPress={() => navigate('CrmLeads')}>
              <Text style={styles.viewAllLink}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.leadSummaryCard}>
            {[
              { label: 'New Leads', value: totalLeads, color: C.blue },
              { label: 'Contacted', value: leadSummary.contacted, color: C.warning },
              { label: 'Qualified', value: leadSummary.qualified, color: C.purple },
              { label: 'Converted', value: leadSummary.converted, color: C.success },
            ].map((item, i) => (
              <View key={i} style={styles.leadRow}>
                <View style={[styles.leadDot, { backgroundColor: item.color }]} />
                <Text style={styles.leadLabel}>{item.label}</Text>
                <Text style={[styles.leadCount, item.color === C.success && { color: C.success }]}>{item.value}</Text>
              </View>
            ))}
          </View>
          {followUpsPending > 0 && (
            <View style={styles.followUpBanner}>
              <Ionicons name="alarm-outline" size={16} color={C.warning} />
              <Text style={styles.followUpText}>
                {followUpsPending} lead{followUpsPending > 1 ? 's' : ''} awaiting follow-up
              </Text>
              <TouchableOpacity onPress={() => navigate('CrmLeads')}>
                <Text style={styles.followUpAction}>Review</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ═══ Ad Spend Summary ═══ */}
        <View style={styles.sectionWrap}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Ad Spend Summary</Text>
            <TouchableOpacity onPress={() => navigate('AdsManager')}>
              <Text style={styles.viewAllLink}>Manage Ads</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.adSummaryCard}>
            <View style={styles.adSummaryRow}>
              {[
                { icon: 'megaphone-outline', value: String(adSummary.active), label: 'Active Campaigns', color: C.info },
                { icon: 'wallet-outline', value: formatINR(adSummary.spent), label: 'Total Spent', color: C.warning },
                { icon: 'eye-outline', value: adSummary.impressions.toLocaleString(), label: 'Impressions', color: C.blue },
                { icon: 'cursor-outline', value: adSummary.clicks.toLocaleString(), label: 'Clicks', color: C.purple },
              ].map((item, i) => (
                <View key={i} style={styles.adSummaryItem}>
                  <Ionicons name={item.icon as any} size={20} color={item.color} />
                  <Text style={styles.adSummaryValue}>{item.value}</Text>
                  <Text style={styles.adSummaryLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity style={styles.viewAllBtn} onPress={() => navigate('AdsManager')}>
              <Text style={styles.viewAllText}>Manage Ads</Text>
              <Ionicons name="chevron-forward" size={16} color={C.textTertiary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ═══ Store Quick Stats ═══ */}
        <View style={styles.sectionWrap}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Store Stats</Text>
            <TouchableOpacity onPress={() => navigate('MyStore')}>
              <Text style={styles.viewAllLink}>View Store</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.storeStatsCard}>
            <View style={styles.storeStat}>
              <Ionicons name="cube-outline" size={22} color={C.accent} />
              <Text style={styles.storeStatValue}>{storeStats.products}</Text>
              <Text style={styles.storeStatLabel}>Products</Text>
            </View>
            <View style={styles.storeStatDivider} />
            <View style={styles.storeStat}>
              <Ionicons name="star-outline" size={22} color={C.gold} />
              <Text style={styles.storeStatValue}>{storeStats.reviews}</Text>
              <Text style={styles.storeStatLabel}>Reviews</Text>
            </View>
            <View style={styles.storeStatDivider} />
            <View style={styles.storeStat}>
              <Ionicons name="trending-up-outline" size={22} color={C.success} />
              <Text style={styles.storeStatValue}>{totalOrders}</Text>
              <Text style={styles.storeStatLabel}>Total Orders</Text>
            </View>
          </View>
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
};

/* ── Styles ────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  centerLoader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, paddingTop: S.md, paddingBottom: S.md },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: S.md, flex: 1 },
  headerIconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.accent + '15', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: C.textPrimary, fontSize: F.xxl, fontWeight: '700' },
  headerSub: { color: C.textTertiary, fontSize: F.xs, marginTop: 2 },
  refreshBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  // KPI
  kpiSection: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: S.lg, marginTop: S.lg, gap: S.sm },
  kpiCard: { backgroundColor: C.surface, borderRadius: BR.lg, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.lg },
  kpiIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: S.sm },
  kpiValue: { color: C.white, fontSize: F.xxl, fontWeight: '800' },
  kpiLabel: { color: C.textSecondary, fontSize: F.xs, marginTop: 2 },

  // Sections
  sectionWrap: { paddingHorizontal: S.lg, marginTop: S.xxl },
  sectionTitle: { color: C.textPrimary, fontSize: F.lg, fontWeight: '600', marginBottom: S.md },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  viewAllLink: { color: C.accent, fontSize: F.sm, fontWeight: '600' },

  // Quick Actions
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  actionCard: { width: CARD_W, backgroundColor: C.surface, borderRadius: BR.lg, borderWidth: 1, borderColor: C.surfaceBorder, paddingVertical: S.xl, alignItems: 'center', gap: S.sm },
  actionIconWrap: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { color: C.textPrimary, fontSize: F.sm, fontWeight: '600' },

  // Order Row
  orderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md, marginBottom: S.sm },
  orderLeft: { flex: 1 },
  orderId: { color: C.textPrimary, fontSize: F.sm, fontWeight: '700' },
  orderBuyer: { color: C.textSecondary, fontSize: F.xs, marginTop: 2 },
  orderRight: { alignItems: 'flex-end' },
  orderTotal: { color: C.white, fontSize: F.md, fontWeight: '700' },
  orderStatus: { fontSize: F.xs, textTransform: 'capitalize', marginTop: 2, fontWeight: '600' },

  // Lead Summary
  leadSummaryCard: { backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md },
  leadRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.sm },
  leadDot: { width: 10, height: 10, borderRadius: 5 },
  leadLabel: { flex: 1, color: C.textSecondary, fontSize: F.sm },
  leadCount: { color: C.textPrimary, fontSize: F.sm, fontWeight: '700' },

  // Follow-up Banner
  followUpBanner: { flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: 'rgba(245,158,11,0.08)', borderRadius: BR.md, borderWidth: 1, borderColor: 'rgba(245,158,11,0.2)', padding: S.md, marginTop: S.sm },
  followUpText: { flex: 1, color: C.warning, fontSize: F.sm, fontWeight: '500' },
  followUpAction: { color: C.warning, fontSize: F.sm, fontWeight: '700' },

  // Ad Summary
  adSummaryCard: { backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.lg },
  adSummaryRow: { flexDirection: 'row', gap: S.lg },
  adSummaryItem: { flex: 1, alignItems: 'center', gap: S.xs },
  adSummaryValue: { color: C.textPrimary, fontSize: F.lg, fontWeight: '800' },
  adSummaryLabel: { color: C.textTertiary, fontSize: F.xs, marginTop: 2 },

  // Store Stats
  storeStatsCard: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.lg },
  storeStat: { flex: 1, alignItems: 'center', gap: S.xs },
  storeStatValue: { color: C.white, fontSize: F.xxl, fontWeight: '800' },
  storeStatLabel: { color: C.textTertiary, fontSize: F.xs },
  storeStatDivider: { width: 1, backgroundColor: C.surfaceBorder },

  // Empty
  emptyCard: { backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.xxl, alignItems: 'center' },
  emptyText: { color: C.textTertiary, fontSize: F.sm, textAlign: 'center', marginTop: S.md },

  // View All
  viewAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: S.md, marginTop: S.md },
  viewAllText: { color: C.accent, fontSize: F.sm, fontWeight: '600', marginRight: S.xs },
});

export default BusinessDashboardScreen;
