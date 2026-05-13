import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
  Alert,
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
  white: '#ffffff',
  white20: 'rgba(255,255,255,0.2)',
};

const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 };
const F = { xs: 10, sm: 12, md: 14, lg: 15, xl: 18, xxl: 22 };
const BR = { sm: 6, md: 10, lg: 16, xl: 24 };

/* ── Types ──────────────────────────────────────────────────────────────────── */

const STATUS_TABS = [
  { key: 'all', label: 'All', color: C.textSecondary },
  { key: 'pending', label: 'Pending', color: C.warning },
  { key: 'confirmed', label: 'Confirmed', color: C.info },
  { key: 'processing', label: 'Processing', color: C.white },
  { key: 'shipped', label: 'Shipped', color: '#8b5cf6' },
  { key: 'delivered', label: 'Delivered', color: C.success },
  { key: 'cancelled', label: 'Cancelled', color: C.danger },
] as const;

type OrderStatus = 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

interface Order {
  id: string;
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  items: string;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  status: OrderStatus;
  shippingAddress: string;
  trackingNumber: string;
  trackingPartner: string;
  createdAt: string;
}

const NEXT_STATUS: Record<string, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function tsToISO(v: any): string {
  if (v && typeof v === 'object' && 'seconds' in v) return new Date(v.seconds * 1000).toISOString();
  return typeof v === 'string' ? v : new Date().toISOString();
}

function parseJSON<T = any>(raw: string): T {
  try { return JSON.parse(raw); } catch { return [] as unknown as T; }
}

function formatINR(n: number) {
  return '\u20B9' + n.toLocaleString('en-IN');
}

function statusColor(s: string) {
  return STATUS_TABS.find(t => t.key === s)?.color ?? C.textSecondary;
}

/* ── Component ─────────────────────────────────────────────────────────────── */

const CrmOrdersScreen: React.FC = () => {
  const uid = auth().currentUser?.uid ?? '';
  const [orders, setOrders] = useState<Order[]>([]);
  const [filtered, setFiltered] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [selected, setSelected] = useState<Order | null>(null);
  const [updating, setUpdating] = useState(false);

  /* ── Data ─────────────────────────────────────────────────────────────── */

  const loadOrders = useCallback(async () => {
    try {
      const snap = await firestore()
        .collection('orders')
        .where('businessId', '==', uid)
        .orderBy('createdAt', 'desc')
        .get();
      const list: Order[] = snap.docs.map((doc: any) => {
        const d = doc.data();
        return {
          id: doc.id,
          buyerId: d.buyerId ?? '',
          buyerName: d.buyerName ?? 'Customer',
          buyerEmail: d.buyerEmail ?? '',
          items: typeof d.items === 'string' ? d.items : JSON.stringify(d.items ?? []),
          subtotal: d.subtotal ?? 0,
          shipping: d.shipping ?? 0,
          tax: d.tax ?? 0,
          total: d.total ?? 0,
          status: d.status ?? 'pending',
          shippingAddress: typeof d.shippingAddress === 'string' ? d.shippingAddress : JSON.stringify(d.shippingAddress ?? {}),
          trackingNumber: d.trackingNumber ?? '',
          trackingPartner: d.trackingPartner ?? '',
          createdAt: tsToISO(d.createdAt),
        };
      });
      setOrders(list);
    } catch { /* silent */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  useEffect(() => {
    setFiltered(activeTab === 'all' ? orders : orders.filter(o => o.status === activeTab));
  }, [orders, activeTab]);

  /* ── Actions ──────────────────────────────────────────────────────────── */

  const handleUpdateStatus = async (order: Order, next: OrderStatus) => {
    setUpdating(true);
    try {
      await firestore().collection('orders').doc(order.id).update({
        status: next,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: next } : o));
      setSelected(prev => prev?.id === order.id ? { ...prev, status: next } : prev);
    } catch {
      Alert.alert('Error', 'Failed to update order status.');
    } finally {
      setUpdating(false);
    }
  };

  /* ── Render Card ──────────────────────────────────────────────────────── */

  const renderOrder = ({ item }: { item: Order }) => {
    const items = parseJSON<any[]>(item.items);
    const count = Array.isArray(items) ? items.length : 0;
    const sc = statusColor(item.status);
    return (
      <TouchableOpacity style={styles.card} onPress={() => setSelected(item)} activeOpacity={0.75}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={styles.orderId}>#{item.id.slice(-8)}</Text>
            <Text style={styles.orderDate}>
              {new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: sc + '20' }]}>
            <Text style={[styles.badgeText, { color: sc }]}>
              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </Text>
          </View>
        </View>
        <View style={styles.cardBody}>
          <View style={styles.cardInfo}>
            <View style={styles.buyerRow}>
              <Ionicons name="person-outline" size={14} color={C.textSecondary} />
              <Text style={styles.buyerName}>{item.buyerName}</Text>
            </View>
            <Text style={styles.itemCount}>{count} item{count !== 1 ? 's' : ''}</Text>
          </View>
          <Text style={styles.totalText}>{formatINR(item.total)}</Text>
        </View>
        {item.trackingNumber ? (
          <View style={styles.trackingRow}>
            <Ionicons name="navigate-outline" size={12} color={C.info} />
            <Text style={styles.trackingText}>AWB: {item.trackingNumber}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.centerLoader}>
        <ActivityIndicator color={C.info} size="large" />
      </View>
    );
  }

  /* ── Main Render ──────────────────────────────────────────────────────── */

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Orders</Text>
        <Text style={styles.headerCount}>{orders.length} total</Text>
      </View>

      {/* Status Tabs */}
      <View style={styles.tabBar}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={STATUS_TABS}
          keyExtractor={t => t.key}
          contentContainerStyle={styles.tabList}
          renderItem={({ item: tab }) => (
            <TouchableOpacity
              style={[styles.tab, activeTab === tab.key && { backgroundColor: tab.color + '20', borderColor: tab.color }]}
              onPress={() => setActiveTab(tab.key)}>
              <Text style={[styles.tabText, activeTab === tab.key && { color: tab.color }]}>{tab.label}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={o => o.id}
        renderItem={renderOrder}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={48} color={C.white20} />
            <Text style={styles.emptyTitle}>No orders</Text>
            <Text style={styles.emptySub}>
              {activeTab === 'all' ? 'Orders appear when customers purchase' : `No ${activeTab} orders`}
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadOrders(); }} tintColor={C.info} />
        }
      />

      {/* ═══ Detail Modal ═══ */}
      <Modal visible={!!selected} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selected && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Order #{selected.id.slice(-8)}</Text>
                  <TouchableOpacity onPress={() => setSelected(null)}>
                    <Ionicons name="close" size={24} color={C.white} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                  {/* Status + Date */}
                  <View style={styles.modalRow}>
                    <View style={[styles.badge, { backgroundColor: statusColor(selected.status) + '20' }]}>
                      <Text style={[styles.badgeText, { color: statusColor(selected.status) }]}>
                        {selected.status.charAt(0).toUpperCase() + selected.status.slice(1)}
                      </Text>
                    </View>
                    <Text style={styles.modalDate}>
                      {new Date(selected.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </Text>
                  </View>

                  {/* Progress */}
                  <View style={styles.progressRow}>
                    {(['pending', 'confirmed', 'processing', 'shipped', 'delivered'] as const).map((stage, idx) => {
                      const stageIdx = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'].indexOf(selected.status);
                      const active = idx <= stageIdx && selected.status !== 'cancelled';
                      const current = stage === selected.status;
                      return (
                        <View key={stage} style={styles.progressStep}>
                          <View style={styles.progressLine}>
                            <View style={[styles.progressDot, active && styles.progressDotActive]} />
                            {idx < 4 && <View style={[styles.progressTrack, idx < stageIdx && selected.status !== 'cancelled' && styles.progressTrackActive]} />}
                          </View>
                          <Text style={[styles.progressLabel, current && styles.progressLabelActive]}>
                            {stage.charAt(0).toUpperCase() + stage.slice(1)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>

                  {/* Buyer */}
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Customer</Text>
                    <Text style={styles.bodyText}>{selected.buyerName}</Text>
                    <Text style={styles.subText}>{selected.buyerEmail}</Text>
                  </View>

                  {/* Items */}
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Items</Text>
                    {parseJSON<any[]>(selected.items).map((it, i) => (
                      <View key={i} style={styles.itemRow}>
                        <Text style={styles.itemName}>{it.productName || it.name || 'Product'} x{it.quantity}</Text>
                        <Text style={styles.itemPrice}>{formatINR((it.price || 0) * (it.quantity || 1))}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Summary */}
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Summary</Text>
                    <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Subtotal</Text><Text style={styles.summaryVal}>{formatINR(selected.subtotal)}</Text></View>
                    <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Shipping</Text><Text style={styles.summaryVal}>{formatINR(selected.shipping)}</Text></View>
                    <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Tax</Text><Text style={styles.summaryVal}>{formatINR(selected.tax)}</Text></View>
                    <View style={[styles.summaryRow, styles.summaryTotal]}><Text style={styles.summaryTotalLabel}>Total</Text><Text style={styles.summaryTotalVal}>{formatINR(selected.total)}</Text></View>
                  </View>

                  {/* Tracking */}
                  {selected.trackingNumber ? (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Tracking</Text>
                      <View style={styles.trackingCard}>
                        <Ionicons name="airplane-outline" size={20} color={C.info} />
                        <View style={styles.trackingInfo}>
                          <Text style={styles.trackingCarrier}>{selected.trackingPartner || 'Courier'}</Text>
                          <Text style={styles.trackingAWB}>{selected.trackingNumber}</Text>
                        </View>
                        <View style={[styles.trackBadge, { backgroundColor: statusColor(selected.status) + '20' }]}>
                          <Text style={[styles.trackBadgeText, { color: statusColor(selected.status) }]}>
                            {selected.status.charAt(0).toUpperCase() + selected.status.slice(1)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ) : null}

                  {/* Shipping Address */}
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Shipping Address</Text>
                    {(() => {
                      const addr = parseJSON<Record<string, string>>(selected.shippingAddress);
                      return (
                        <>
                          <Text style={styles.bodyText}>{addr.name || selected.buyerName}</Text>
                          <Text style={styles.subText}>{addr.line1 || addr.address || ''}</Text>
                          {addr.line2 ? <Text style={styles.subText}>{addr.line2}</Text> : null}
                          <Text style={styles.subText}>{addr.city}{addr.city && ', '}{addr.state} - {addr.pincode}</Text>
                          {addr.phone ? <Text style={styles.subText}>{addr.phone}</Text> : null}
                        </>
                      );
                    })()}
                  </View>

                  {/* Update Status Buttons */}
                  {(NEXT_STATUS[selected.status] || []).length > 0 && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Update Status</Text>
                      <View style={styles.statusActions}>
                        {NEXT_STATUS[selected.status]!.map(ns => {
                          const nc = statusColor(ns);
                          return (
                            <TouchableOpacity
                              key={ns}
                              style={[styles.statusBtn, { borderColor: nc, backgroundColor: nc + '15' }]}
                              onPress={() => handleUpdateStatus(selected, ns)}
                              disabled={updating}>
                              {updating ? <ActivityIndicator size="small" color={nc} /> : (
                                <Text style={[styles.statusBtnText, { color: nc }]}>
                                  {ns === 'cancelled' ? '\u2715 ' : '\u2192 '}
                                  {ns.charAt(0).toUpperCase() + ns.slice(1)}
                                </Text>
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  )}
                  <View style={{ height: 32 }} />
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

/* ── Styles ────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.black },
  centerLoader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.black },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, paddingVertical: S.md, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { color: C.text, fontSize: F.xl, fontWeight: '700' },
  headerCount: { color: C.textSecondary, fontSize: F.sm },
  tabBar: { borderBottomWidth: 1, borderBottomColor: C.border },
  tabList: { paddingHorizontal: S.lg, paddingVertical: S.sm, gap: S.sm },
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: BR.lg, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  tabText: { color: C.textSecondary, fontSize: F.sm, fontWeight: '600' },
  list: { padding: S.lg },
  separator: { height: 8 },

  card: { backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.border, padding: S.md, gap: S.sm },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeaderLeft: { gap: S.xs },
  orderId: { color: C.text, fontSize: F.md, fontWeight: '700' },
  orderDate: { color: C.textSecondary, fontSize: F.xs, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: BR.sm },
  badgeText: { fontSize: F.xs, fontWeight: '600' },
  cardBody: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardInfo: { flex: 1, gap: 2 },
  buyerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  buyerName: { color: C.textSecondary, fontSize: F.sm },
  itemCount: { color: C.textSecondary, fontSize: F.xs },
  totalText: { color: C.text, fontSize: F.lg, fontWeight: '800' },
  trackingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trackingText: { color: C.info, fontSize: F.xs, fontWeight: '500' },

  empty: { alignItems: 'center', paddingVertical: 80, paddingHorizontal: S.xxl },
  emptyTitle: { color: C.text, fontSize: F.lg, fontWeight: '600', marginTop: S.lg },
  emptySub: { color: C.textSecondary, fontSize: F.sm, marginTop: S.xs, textAlign: 'center' },

  /* Modal */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: C.surface, borderTopLeftRadius: BR.xl, borderTopRightRadius: BR.xl, maxHeight: '88%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: S.lg, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { color: C.text, fontSize: F.lg, fontWeight: '600' },
  modalBody: { padding: S.lg },
  modalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: S.md },
  modalDate: { color: C.textSecondary, fontSize: F.sm },

  /* Progress */
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: S.lg, backgroundColor: C.black, borderRadius: BR.md, paddingHorizontal: S.md, marginBottom: S.lg },
  progressStep: { alignItems: 'center', flex: 1 },
  progressLine: { flexDirection: 'row', alignItems: 'center' },
  progressDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.border },
  progressDotActive: { backgroundColor: C.info },
  progressTrack: { flex: 1, height: 2, backgroundColor: C.border, marginHorizontal: 2 },
  progressTrackActive: { backgroundColor: C.info },
  progressLabel: { color: C.textSecondary, fontSize: 9, marginTop: 6, textAlign: 'center' },
  progressLabelActive: { color: C.info, fontWeight: '700' },

  /* Sections */
  section: { marginBottom: S.lg },
  sectionTitle: { color: C.textSecondary, fontSize: F.sm, fontWeight: '600', marginBottom: S.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  bodyText: { color: C.text, fontSize: F.md, fontWeight: '500' },
  subText: { color: C.textSecondary, fontSize: F.sm, marginTop: 2 },

  /* Items */
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: S.xs },
  itemName: { color: C.text, fontSize: F.sm },
  itemPrice: { color: C.textSecondary, fontSize: F.sm, fontWeight: '600' },

  /* Summary */
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: S.xs },
  summaryLabel: { color: C.textSecondary, fontSize: F.sm },
  summaryVal: { color: C.text, fontSize: F.sm },
  summaryTotal: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: S.sm, marginTop: S.xs },
  summaryTotalLabel: { color: C.text, fontSize: F.md, fontWeight: '700' },
  summaryTotalVal: { color: C.text, fontSize: F.md, fontWeight: '800' },

  /* Tracking */
  trackingCard: { flexDirection: 'row', alignItems: 'center', gap: S.md, backgroundColor: C.black, borderRadius: BR.md, padding: S.md },
  trackingInfo: { flex: 1 },
  trackingCarrier: { color: C.text, fontSize: F.sm, fontWeight: '600' },
  trackingAWB: { color: C.info, fontSize: F.xs, marginTop: 2, fontFamily: 'monospace' },
  trackBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: BR.sm },
  trackBadgeText: { fontSize: F.xs, fontWeight: '700' },

  /* Status Actions */
  statusActions: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  statusBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: BR.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', minWidth: 120 },
  statusBtnText: { fontSize: F.sm, fontWeight: '700' },
});

export default CrmOrdersScreen;
