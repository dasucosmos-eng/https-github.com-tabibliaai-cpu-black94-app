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
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { auth, firestore } from '../lib/firebase';
import { colors } from '../theme/colors';

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
};

const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
const F = { xs: 10, sm: 12, md: 14, lg: 15, xl: 18, xxl: 22, xxxl: 28 };
const BR = { sm: 6, md: 10, lg: 16, xl: 24 };

/* ── Types ──────────────────────────────────────────────────────────────────── */

interface Affiliate {
  id: string;
  userId: string;
  referralCode: string;
  name: string;
  email: string;
  profileImage: string | null;
  commissionRate: number;
  totalClicks: number;
  totalConversions: number;
  totalCommission: number;
  pendingPayout: number;
  status: 'active' | 'revoked';
  referredUsers: string[];
  joinedAt: number;
}

interface Payout {
  id: string;
  affiliateId: string;
  affiliateName: string;
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  method: string;
  createdAt: number;
}

/* ── Helpers ──────────────────────────────────────────────────────────────────── */

function formatINR(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN');
}

function tsToMillis(ts: any): number {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return new Date(ts).getTime() || Date.now();
  if (ts?.toMillis) return ts.toMillis();
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts?.seconds) return ts.seconds * 1000;
  return Date.now();
}

function timeAgo(timestamp: number): string {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'BLK94';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/* ── Badge Config ──────────────────────────────────────────────────────────── */

const TIER_TIERS = [
  { label: 'Starter', min: 0, color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
  { label: 'Bronze', min: 5, color: '#CD7F32', bg: 'rgba(205,127,50,0.15)' },
  { label: 'Silver', min: 20, color: '#C0C0C0', bg: 'rgba(192,192,192,0.15)' },
  { label: 'Gold', min: 50, color: '#ffd700', bg: 'rgba(255,215,0,0.15)' },
  { label: 'Platinum', min: 100, color: '#E5E4E2', bg: 'rgba(229,228,226,0.15)' },
];

function getTier(conversions: number) {
  let tier = TIER_TIERS[0];
  for (const t of TIER_TIERS) {
    if (conversions >= t.min) tier = t;
  }
  return tier;
}

/* ── Commission Structure ──────────────────────────────────────────────────── */

const COMMISSION_TIERS = [
  { conversions: '0–4', rate: '5%', payout: '₹0 – ₹999' },
  { conversions: '5–19', rate: '8%', payout: '₹1,000 – ₹4,999' },
  { conversions: '20–49', rate: '10%', payout: '₹5,000 – ₹14,999' },
  { conversions: '50–99', rate: '12%', payout: '₹15,000 – ₹49,999' },
  { conversions: '100+', rate: '15%', payout: '₹50,000+' },
];

/* ── Component ─────────────────────────────────────────────────────────────── */

interface Props {
  navigation?: any;
}

const AffiliatesScreen: React.FC<Props> = () => {
  const uid = auth().currentUser?.uid ?? '';
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'affiliates' | 'payouts' | 'structure'>('overview');

  // Selected affiliate
  const [selectedAffiliate, setSelectedAffiliate] = useState<Affiliate | null>(null);

  // Commission config modal
  const [showCommissionModal, setShowCommissionModal] = useState(false);

  /* ── Data Loading ── */

  const load = useCallback(async () => {
    if (!uid) { setLoading(false); return; }
    try {
      const [affSnap, paySnap] = await Promise.all([
        firestore().collection('affiliates').where('businessId', '==', uid).orderBy('joinedAt', 'desc').limit(100).get(),
        firestore().collection('affiliate_payouts').where('businessId', '==', uid).orderBy('createdAt', 'desc').limit(50).get(),
      ]);

      const affList: Affiliate[] = affSnap.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          userId: d.userId || '',
          referralCode: d.referralCode || '',
          name: d.name || 'Unknown',
          email: d.email || '',
          profileImage: d.profileImage || null,
          commissionRate: d.commissionRate || 5,
          totalClicks: d.totalClicks || 0,
          totalConversions: d.totalConversions || 0,
          totalCommission: d.totalCommission || 0,
          pendingPayout: d.pendingPayout || 0,
          status: d.status || 'active',
          referredUsers: d.referredUsers || [],
          joinedAt: tsToMillis(d.joinedAt),
        };
      });
      setAffiliates(affList);

      const payList: Payout[] = paySnap.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          affiliateId: d.affiliateId || '',
          affiliateName: d.affiliateName || '',
          amount: d.amount || 0,
          status: d.status || 'pending',
          method: d.method || 'bank_transfer',
          createdAt: tsToMillis(d.createdAt),
        };
      });
      setPayouts(payList);
    } catch (e) {
      console.error('[Affiliates] Failed:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  /* ── Derived Stats ── */

  const totalAffiliates = affiliates.length;
  const activeAffiliates = affiliates.filter(a => a.status === 'active').length;
  const totalReferrals = affiliates.reduce((s, a) => s + a.totalConversions, 0);
  const totalCommission = affiliates.reduce((s, a) => s + a.totalCommission, 0);
  const pendingPayout = affiliates.reduce((s, a) => s + a.pendingPayout, 0);
  const totalClicks = affiliates.reduce((s, a) => s + a.totalClicks, 0);

  /* ── Handlers ── */

  const handleGenerateReferralCode = async () => {
    try {
      const code = generateReferralCode();
      await firestore().collection('affiliates').add({
        businessId: uid,
        userId: uid,
        referralCode: code,
        name: 'My Referral Link',
        email: '',
        profileImage: null,
        commissionRate: 5,
        totalClicks: 0,
        totalConversions: 0,
        totalCommission: 0,
        pendingPayout: 0,
        status: 'active',
        referredUsers: [],
        joinedAt: firestore.FieldValue.serverTimestamp(),
        createdAt: firestore.FieldValue.serverTimestamp(),
      });
      Alert.alert('Referral Code Generated', `Your referral code: ${code}\n\nShare this code with others to earn commissions.`);
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to generate referral code');
    }
  };

  const handleRevoke = async (id: string) => {
    Alert.alert('Revoke Affiliate', 'Are you sure you want to revoke this affiliate?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: async () => {
        try {
          await firestore().collection('affiliates').doc(id).update({ status: 'revoked' });
          load();
        } catch { Alert.alert('Error', 'Failed to revoke'); }
      }},
    ]);
  };

  const handlePayout = async (affiliate: Affiliate) => {
    if (affiliate.pendingPayout <= 0) {
      Alert.alert('Info', 'No pending commissions to payout.');
      return;
    }
    Alert.alert('Process Payout', `Pay ${affiliate.name} ${formatINR(affiliate.pendingPayout)}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pay Now', onPress: async () => {
        try {
          await firestore().collection('affiliate_payouts').add({
            businessId: uid,
            affiliateId: affiliate.id,
            affiliateName: affiliate.name,
            amount: affiliate.pendingPayout,
            status: 'completed',
            method: 'bank_transfer',
            createdAt: firestore.FieldValue.serverTimestamp(),
          });
          await firestore().collection('affiliates').doc(affiliate.id).update({
            pendingPayout: 0,
          });
          load();
        } catch { Alert.alert('Error', 'Failed to process payout'); }
      }},
    ]);
  };

  /* ── Render ── */

  if (loading) {
    return (
      <View style={styles.centerLoader}>
        <ActivityIndicator color={C.gold} size="large" />
      </View>
    );
  }

  const renderAffiliate = ({ item }: { item: Affiliate }) => {
    const tier = getTier(item.totalConversions);
    return (
      <TouchableOpacity style={styles.card} onPress={() => setSelectedAffiliate(item)} activeOpacity={0.7}>
        <View style={styles.cardTop}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.affiliateName}>{item.name}</Text>
            <Text style={styles.joinDate}>
              {item.referralCode ? `Code: ${item.referralCode}` : ''} · Joined {timeAgo(item.joinedAt)}
            </Text>
          </View>
          <View style={[styles.tierBadge, { backgroundColor: tier.bg }]}>
            <Text style={[styles.tierBadgeText, { color: tier.color }]}>{tier.label}</Text>
          </View>
        </View>
        <View style={styles.statsRow}>
          {[
            { label: 'Clicks', value: item.totalClicks.toLocaleString() },
            { label: 'Conversions', value: String(item.totalConversions) },
            { label: 'Earned', value: formatINR(item.totalCommission) },
            { label: 'Pending', value: formatINR(item.pendingPayout) },
          ].map((stat, i) => (
            <View key={i} style={styles.statBox}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.cardFooter}>
          <View style={[styles.statusBadge, { backgroundColor: item.status === 'active' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)' }]}>
            <Text style={[styles.statusText, { color: item.status === 'active' ? C.success : C.danger }]}>
              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </Text>
          </View>
          <Text style={styles.commissionRate}>{item.commissionRate}% commission</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderPayout = ({ item }: { item: Payout }) => {
    const statusCfg: Record<string, { color: string; bg: string }> = {
      completed: { color: C.success, bg: 'rgba(34,197,94,0.15)' },
      failed: { color: C.danger, bg: 'rgba(239,68,68,0.15)' },
      pending: { color: C.warning, bg: 'rgba(245,158,11,0.15)' },
    };
    const cfg = statusCfg[item.status] || statusCfg.pending;
    return (
      <View style={styles.payoutCard}>
        <View style={styles.payoutLeft}>
          <Text style={styles.payoutName}>{item.affiliateName}</Text>
          <Text style={styles.payoutDate}>{timeAgo(item.createdAt)} · {item.method.replace('_', ' ')}</Text>
        </View>
        <View style={styles.payoutRight}>
          <Text style={styles.payoutAmount}>{formatINR(item.amount)}</Text>
          <View style={[styles.payoutStatusBadge, { backgroundColor: cfg.bg }]}>
            <Text style={[styles.payoutStatusText, { color: cfg.color }]}>
              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Ionicons name="handshake-outline" size={22} color={C.gold} />
        <Text style={styles.headerTitle}>Affiliates</Text>
        <TouchableOpacity style={styles.addBtn} onPress={handleGenerateReferralCode}>
          <Ionicons name="link-outline" size={18} color={C.bg} />
        </TouchableOpacity>
      </View>

      {/* ── Tabs ── */}
      <View style={styles.tabBar}>
        {(['overview', 'affiliates', 'payouts', 'structure'] as const).map((tab) => (
          <TouchableOpacity key={tab} style={[styles.tab, activeTab === tab && styles.tabActive]} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Overview Tab ── */}
      {activeTab === 'overview' && (
        <FlatList
          data={[]}
          keyExtractor={() => 'overview'}
          renderItem={() => null}
          ListHeaderComponent={() => (
            <View style={styles.listContent}>
              {/* Stats Grid */}
              <View style={styles.statsGrid}>
                {[
                  { icon: 'people-outline', label: 'Total Affiliates', value: String(totalAffiliates), color: C.gold },
                  { icon: 'checkmark-circle-outline', label: 'Active', value: String(activeAffiliates), color: C.success },
                  { icon: 'swap-horizontal-outline', label: 'Total Referrals', value: String(totalReferrals), color: C.blue },
                  { icon: 'cash-outline', label: 'Total Commission', value: formatINR(totalCommission), color: C.gold },
                  { icon: 'hourglass-outline', label: 'Pending Payout', value: formatINR(pendingPayout), color: C.warning },
                  { icon: 'cursor-outline', label: 'Total Clicks', value: totalClicks.toLocaleString(), color: C.info },
                ].map((item, i) => (
                  <View key={i} style={styles.statCard}>
                    <View style={[styles.statIconWrap, { backgroundColor: item.color + '15' }]}>
                      <Ionicons name={item.icon as any} size={18} color={item.color} />
                    </View>
                    <Text style={styles.statCardValue}>{item.value}</Text>
                    <Text style={styles.statCardLabel}>{item.label}</Text>
                  </View>
                ))}
              </View>

              {/* Quick Actions */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Quick Actions</Text>
                <View style={styles.quickActions}>
                  <TouchableOpacity style={styles.actionBtn} onPress={handleGenerateReferralCode}>
                    <Ionicons name="link-outline" size={20} color={C.bg} />
                    <Text style={styles.actionBtnText}>Generate Referral Code</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.actionBtnOutline]} onPress={() => setShowCommissionModal(true)}>
                    <Ionicons name="information-circle-outline" size={20} color={C.gold} />
                    <Text style={[styles.actionBtnText, { color: C.gold }]}>View Commission Structure</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Top Affiliates */}
              {affiliates.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Top Affiliates</Text>
                  {affiliates.slice(0, 3).map((aff, i) => {
                    const tier = getTier(aff.totalConversions);
                    return (
                      <TouchableOpacity key={aff.id} style={styles.topAffCard} onPress={() => setSelectedAffiliate(aff)}>
                        <View style={styles.topAffRank}>
                          <Text style={styles.topAffRankText}>#{i + 1}</Text>
                        </View>
                        <View style={styles.topAffInfo}>
                          <Text style={styles.topAffName}>{aff.name}</Text>
                          <Text style={styles.topAffMeta}>{aff.totalConversions} conversions · {formatINR(aff.totalCommission)} earned</Text>
                        </View>
                        <View style={[styles.tierBadge, { backgroundColor: tier.bg }]}>
                          <Text style={[styles.tierBadgeText, { color: tier.color }]}>{tier.label}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          )}
        />
      )}

      {/* ── Affiliates Tab ── */}
      {activeTab === 'affiliates' && (
        <FlatList
          data={affiliates}
          keyExtractor={(item) => item.id}
          renderItem={renderAffiliate}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.gold} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={48} color={C.textTertiary} />
              <Text style={styles.emptyTitle}>No affiliates yet</Text>
              <Text style={styles.emptyText}>Generate a referral code to start your affiliate program.</Text>
            </View>
          }
        />
      )}

      {/* ── Payouts Tab ── */}
      {activeTab === 'payouts' && (
        <FlatList
          data={payouts}
          keyExtractor={(item) => item.id}
          renderItem={renderPayout}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.gold} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="wallet-outline" size={48} color={C.textTertiary} />
              <Text style={styles.emptyTitle}>No payouts yet</Text>
              <Text style={styles.emptyText}>Payout history will appear when you process affiliate commissions.</Text>
            </View>
          }
        />
      )}

      {/* ── Commission Structure Tab ── */}
      {activeTab === 'structure' && (
        <FlatList
          data={[]}
          keyExtractor={() => 'structure'}
          renderItem={() => null}
          ListHeaderComponent={() => (
            <View style={styles.listContent}>
              <Text style={styles.sectionTitle}>Commission Structure</Text>
              <Text style={styles.structureDesc}>
                Affiliates earn commission based on their cumulative conversions. Higher tiers unlock better rates.
              </Text>

              <View style={styles.commissionList}>
                {COMMISSION_TIERS.map((tier, i) => (
                  <View key={i} style={styles.commissionCard}>
                    <View style={styles.commissionLeft}>
                      <Text style={styles.commissionConversions}>{tier.conversions} conversions</Text>
                      <Text style={styles.commissionRate}>{tier.rate} commission rate</Text>
                    </View>
                    <View style={styles.commissionRight}>
                      <Text style={styles.commissionPayout}>{tier.payout}</Text>
                      <Text style={styles.commissionPayoutLabel}>earning range</Text>
                    </View>
                  </View>
                ))}
              </View>

              <Text style={[styles.sectionTitle, { marginTop: S.xxl }]}>Tier Badges</Text>
              {TIER_TIERS.map((tier, i) => (
                <View key={i} style={styles.tierRow}>
                  <View style={[styles.tierBadge, { backgroundColor: tier.bg }]}>
                    <Text style={[styles.tierBadgeText, { color: tier.color }]}>{tier.label}</Text>
                  </View>
                  <Text style={styles.tierReq}>{tier.min}+ conversions</Text>
                </View>
              ))}

              <View style={{ height: 40 }} />
            </View>
          )}
        />
      )}

      {/* ═══ Affiliate Detail Modal ═══ */}
      <Modal visible={!!selectedAffiliate} animationType="slide" transparent onRequestClose={() => setSelectedAffiliate(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedAffiliate && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Affiliate Details</Text>
                  <TouchableOpacity onPress={() => setSelectedAffiliate(null)}>
                    <Ionicons name="close" size={24} color={C.white} />
                  </TouchableOpacity>
                </View>
                <ScrollView style={styles.modalBody}>
                  {/* Header */}
                  <View style={styles.detailRow}>
                    <View style={styles.detailAvatar}>
                      <Text style={styles.detailAvatarText}>{selectedAffiliate.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={styles.detailInfo}>
                      <Text style={styles.detailName}>{selectedAffiliate.name}</Text>
                      {selectedAffiliate.email ? <Text style={styles.detailEmail}>{selectedAffiliate.email}</Text> : null}
                      <Text style={styles.detailJoined}>Joined {timeAgo(selectedAffiliate.joinedAt)}</Text>
                    </View>
                  </View>

                  {/* Referral Code */}
                  {selectedAffiliate.referralCode ? (
                    <TouchableOpacity
                      style={styles.referralCodeBox}
                      onPress={() => {
                        Alert.alert('Referral Code', `Code copied: ${selectedAffiliate.referralCode}`);
                      }}>
                      <Ionicons name="copy-outline" size={16} color={C.gold} />
                      <Text style={styles.referralCodeText}>{selectedAffiliate.referralCode}</Text>
                    </TouchableOpacity>
                  ) : null}

                  {/* Stats */}
                  <View style={styles.detailStatsGrid}>
                    {[
                      { label: 'Commission Rate', value: `${selectedAffiliate.commissionRate}%` },
                      { label: 'Total Clicks', value: selectedAffiliate.totalClicks.toLocaleString() },
                      { label: 'Conversions', value: String(selectedAffiliate.totalConversions) },
                      { label: 'Total Earned', value: formatINR(selectedAffiliate.totalCommission) },
                      { label: 'Pending Payout', value: formatINR(selectedAffiliate.pendingPayout) },
                      { label: 'Referred Users', value: String(selectedAffiliate.referredUsers?.length || 0) },
                    ].map((item, i) => (
                      <View key={i} style={styles.detailStatCard}>
                        <Text style={styles.detailStatValue}>{item.value}</Text>
                        <Text style={styles.detailStatLabel}>{item.label}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Status */}
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>Status</Text>
                    <View style={[styles.statusBadge, { backgroundColor: selectedAffiliate.status === 'active' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)' }]}>
                      <Text style={[styles.statusText, { color: selectedAffiliate.status === 'active' ? C.success : C.danger }]}>
                        {selectedAffiliate.status.charAt(0).toUpperCase() + selectedAffiliate.status.slice(1)}
                      </Text>
                    </View>
                  </View>

                  {/* Actions */}
                  {selectedAffiliate.status === 'active' && (
                    <View style={styles.detailActions}>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => handlePayout(selectedAffiliate)}>
                        <Ionicons name="wallet-outline" size={18} color={C.bg} />
                        <Text style={styles.actionBtnText}>Process Payout</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, styles.dangerBtn]} onPress={() => handleRevoke(selectedAffiliate.id)}>
                        <Ionicons name="ban-outline" size={18} color={C.danger} />
                        <Text style={[styles.actionBtnText, { color: C.danger }]}>Revoke</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <View style={{ height: 20 }} />
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ═══ Commission Structure Modal ═══ */}
      <Modal visible={showCommissionModal} animationType="slide" transparent onRequestClose={() => setShowCommissionModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Commission Structure</Text>
              <TouchableOpacity onPress={() => setShowCommissionModal(false)}>
                <Ionicons name="close" size={24} color={C.white} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              <Text style={styles.modalDesc}>
                Affiliates earn commission based on successful referrals. Higher conversion counts unlock better commission tiers.
              </Text>
              <View style={styles.commissionList}>
                {COMMISSION_TIERS.map((tier, i) => (
                  <View key={i} style={styles.commissionCard}>
                    <View style={styles.commissionLeft}>
                      <Text style={styles.commissionConversions}>{tier.conversions}</Text>
                      <Text style={styles.commissionRate}>{tier.rate} rate</Text>
                    </View>
                    <Text style={styles.commissionPayout}>{tier.payout}</Text>
                  </View>
                ))}
              </View>
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

/* ── Styles ────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  centerLoader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md, borderBottomWidth: 1, borderBottomColor: C.surfaceBorder },
  headerTitle: { color: C.textPrimary, fontSize: F.xl, fontWeight: '700', flex: 1 },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center' },

  // Tabs
  tabBar: { flexDirection: 'row', paddingHorizontal: S.lg, borderBottomWidth: 1, borderBottomColor: C.surfaceBorder },
  tab: { paddingVertical: S.md, marginRight: S.lg, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: C.gold },
  tabText: { color: C.textTertiary, fontSize: F.sm, fontWeight: '600' },
  tabTextActive: { color: C.gold },
  listContent: { padding: S.lg, paddingBottom: 60 },

  // Stats Grid (Overview)
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  statCard: { width: '48%', backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md, alignItems: 'center' },
  statIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: S.sm },
  statCardValue: { color: C.white, fontSize: F.lg, fontWeight: '800' },
  statCardLabel: { color: C.textSecondary, fontSize: F.xs, marginTop: 2 },

  // Section
  section: { marginTop: S.xl },
  sectionTitle: { color: C.textPrimary, fontSize: F.lg, fontWeight: '600', marginBottom: S.md },

  // Quick Actions
  quickActions: { gap: S.sm },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm, backgroundColor: C.gold, borderRadius: BR.md, paddingVertical: 14 },
  actionBtnText: { color: C.bg, fontSize: F.md, fontWeight: '700' },
  actionBtnOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.gold },

  // Affiliate Card
  card: { backgroundColor: C.surface, borderRadius: BR.lg, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md, marginBottom: S.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,215,0,0.15)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: C.gold, fontSize: F.lg, fontWeight: '700' },
  cardInfo: { flex: 1, minWidth: 0 },
  affiliateName: { color: C.textPrimary, fontSize: F.md, fontWeight: '700' },
  joinDate: { color: C.textSecondary, fontSize: F.xs, marginTop: 2 },
  tierBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: BR.sm },
  tierBadgeText: { fontSize: F.xs, fontWeight: '700' },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: S.md, gap: S.sm },
  statBox: { flex: 1, minWidth: '22%', backgroundColor: C.bg, borderRadius: BR.sm, padding: 10, alignItems: 'center' },
  statValue: { color: C.textPrimary, fontSize: F.lg, fontWeight: '700', marginTop: 4 },
  statLabel: { color: C.textTertiary, fontSize: 10 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: S.sm },
  statusBadge: { borderRadius: BR.sm, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { fontSize: F.xs, fontWeight: '700' },
  commissionRateLabel: { color: C.textTertiary, fontSize: F.xs },

  // Payout Card
  payoutCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md, marginBottom: S.sm },
  payoutLeft: { flex: 1 },
  payoutName: { color: C.textPrimary, fontSize: F.sm, fontWeight: '600' },
  payoutDate: { color: C.textTertiary, fontSize: F.xs, marginTop: 2 },
  payoutRight: { alignItems: 'flex-end' },
  payoutAmount: { color: C.white, fontSize: F.md, fontWeight: '700' },
  payoutStatusBadge: { marginTop: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: BR.sm },
  payoutStatusText: { fontSize: F.xs, fontWeight: '700' },

  // Commission Structure
  structureDesc: { color: C.textSecondary, fontSize: F.sm, marginBottom: S.lg },
  commissionList: { gap: S.sm },
  commissionCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md },
  commissionLeft: { flex: 1 },
  commissionConversions: { color: C.textPrimary, fontSize: F.md, fontWeight: '600' },
  commissionRate: { color: C.gold, fontSize: F.xs, marginTop: 2 },
  commissionRight: { alignItems: 'flex-end' },
  commissionPayout: { color: C.textPrimary, fontSize: F.md, fontWeight: '700' },
  commissionPayoutLabel: { color: C.textTertiary, fontSize: F.xs, marginTop: 2 },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: S.sm, borderBottomWidth: 0.5, borderBottomColor: C.surfaceBorder },
  tierReq: { color: C.textSecondary, fontSize: F.sm },

  // Top Affiliates
  topAffCard: { flexDirection: 'row', alignItems: 'center', gap: S.md, backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md, marginBottom: S.sm },
  topAffRank: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,215,0,0.15)', alignItems: 'center', justifyContent: 'center' },
  topAffRankText: { color: C.gold, fontSize: F.sm, fontWeight: '800' },
  topAffInfo: { flex: 1 },
  topAffName: { color: C.textPrimary, fontSize: F.sm, fontWeight: '600' },
  topAffMeta: { color: C.textSecondary, fontSize: F.xs, marginTop: 2 },

  // Empty
  emptyState: { alignItems: 'center', paddingTop: 100, paddingHorizontal: S.xxxl },
  emptyTitle: { color: C.textPrimary, fontSize: F.lg, fontWeight: '600', marginTop: S.lg },
  emptyText: { color: C.textSecondary, fontSize: F.sm, textAlign: 'center', marginTop: S.xs },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: C.surface, borderTopLeftRadius: BR.xl, borderTopRightRadius: BR.xl, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: S.lg, borderBottomWidth: 1, borderBottomColor: C.surfaceBorder },
  modalTitle: { color: C.textPrimary, fontSize: F.lg, fontWeight: '600' },
  modalBody: { padding: S.lg },
  modalDesc: { color: C.textSecondary, fontSize: F.sm, marginBottom: S.lg },

  // Detail
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, marginTop: S.lg },
  detailAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,215,0,0.15)', alignItems: 'center', justifyContent: 'center' },
  detailAvatarText: { color: C.gold, fontSize: F.xxl, fontWeight: '700' },
  detailInfo: { flex: 1 },
  detailName: { color: C.textPrimary, fontSize: F.lg, fontWeight: '700' },
  detailEmail: { color: C.textSecondary, fontSize: F.sm, marginTop: 2 },
  detailJoined: { color: C.textTertiary, fontSize: F.xs, marginTop: 2 },
  referralCodeBox: { flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.bg, borderRadius: BR.md, borderWidth: 1, borderColor: C.gold, padding: S.md, marginTop: S.md },
  referralCodeText: { color: C.gold, fontSize: F.md, fontWeight: '700', letterSpacing: 2 },
  detailStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.lg },
  detailStatCard: { width: '48%', backgroundColor: C.bg, borderRadius: BR.sm, padding: S.md, alignItems: 'center' },
  detailStatValue: { color: C.textPrimary, fontSize: F.md, fontWeight: '700' },
  detailStatLabel: { color: C.textTertiary, fontSize: F.xs, marginTop: 2 },
  detailSection: { marginTop: S.lg },
  detailSectionLabel: { color: C.textSecondary, fontSize: F.sm, marginBottom: S.sm },
  detailActions: { flexDirection: 'row', gap: S.sm, marginTop: S.xxl },
  dangerBtn: { backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: C.danger },
});

export default AffiliatesScreen;
