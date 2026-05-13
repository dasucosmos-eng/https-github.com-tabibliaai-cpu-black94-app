import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  ScrollView,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../lib/firebase';
import { colors } from '../theme/colors';
import * as Ads from '../lib/ads';

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

/* ── Status Config ──────────────────────────────────────────────────────────── */

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'Active', color: C.success, bg: 'rgba(34,197,94,0.15)' },
  paused: { label: 'Paused', color: C.warning, bg: 'rgba(245,158,11,0.15)' },
  completed: { label: 'Completed', color: C.textSecondary, bg: 'rgba(113,118,123,0.15)' },
  draft: { label: 'Draft', color: C.textTertiary, bg: 'rgba(113,118,123,0.1)' },
  archived: { label: 'Archived', color: C.textTertiary, bg: 'rgba(113,118,123,0.08)' },
};

const PLACEMENTS: Ads.AdPlacement[] = ['feed', 'story', 'profile', 'search', 'comment'];

/* ── Component ─────────────────────────────────────────────────────────────── */

interface Props {
  navigation?: any;
}

const AdsManagerScreen: React.FC<Props> = ({ navigation }) => {
  const uid = auth().currentUser?.uid ?? '';
  const [campaigns, setCampaigns] = useState<Ads.AdCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Ads.AdCampaign | null>(null);
  const [adAnalytics, setAdAnalytics] = useState<Ads.AdAnalytics | null>(null);
  const [pricingTiers, setPricingTiers] = useState<Ads.AdPricingTier[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'paused' | 'completed'>('all');

  // Create form state
  const [campaignName, setCampaignName] = useState('');
  const [campaignHeadline, setCampaignHeadline] = useState('');
  const [campaignBudget, setCampaignBudget] = useState('');
  const [campaignDuration, setCampaignDuration] = useState('7');
  const [campaignPlacement, setCampaignPlacement] = useState<Ads.AdPlacement>('feed');
  const [campaignBillingModel, setCampaignBillingModel] = useState<Ads.AdBillingModel>('cpc');
  const [creating, setCreating] = useState(false);

  // Cost calculator state
  const [calcPlacement, setCalcPlacement] = useState<Ads.AdPlacement>('feed');
  const [calcModel, setCalcModel] = useState<Ads.AdBillingModel>('cpc');
  const [calcBudget, setCalcBudget] = useState('50000');
  const [costEstimate, setCostEstimate] = useState<Ads.AdCostEstimate | null>(null);

  /* ── Data Loading ── */

  const loadCampaigns = useCallback(async () => {
    try {
      const result = await Ads.fetchAdCampaigns(uid);
      setCampaigns(result);
    } catch (e) {
      console.error('[AdsManager] Failed:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  const filteredCampaigns = campaigns.filter((c) => {
    if (activeTab === 'all') return !['archived', 'draft'].includes(c.status);
    return c.status === activeTab;
  });

  /* ── Derived Stats ── */

  const totalSpend = campaigns.reduce((s, c) => s + c.spent, 0);
  const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
  const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);
  const activeCampaignsCount = campaigns.filter(c => c.status === 'active').length;

  /* ── Handlers ── */

  const handleCreate = async () => {
    if (!campaignName.trim()) { Alert.alert('Error', 'Campaign name is required'); return; }
    setCreating(true);
    try {
      await Ads.createAdCampaign({
        businessId: uid,
        name: campaignName.trim(),
        headline: campaignHeadline.trim() || campaignName.trim(),
        placement: campaignPlacement,
        billingModel: campaignBillingModel,
        dailyBudget: parseInt(campaignBudget) || 50000,
        duration: parseInt(campaignDuration) || 7,
        targeting: { ageMin: 18, ageMax: 65, location: '', interests: [] },
      });
      setCampaignName(''); setCampaignHeadline(''); setCampaignBudget(''); setCampaignDuration('7');
      setShowCreateModal(false);
      loadCampaigns();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create campaign');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (campaign: Ads.AdCampaign) => {
    try {
      if (campaign.status === 'active') {
        await Ads.pauseAdCampaign(campaign.id);
      } else if (campaign.status === 'paused') {
        await Ads.resumeAdCampaign(campaign.id);
      }
      loadCampaigns();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to update campaign status');
    }
  };

  const handleLoadAnalytics = async (campaign: Ads.AdCampaign) => {
    try {
      const analytics = await Ads.fetchAdAnalytics(campaign.id);
      setAdAnalytics(analytics);
      setSelectedCampaign(campaign);
      setShowAnalyticsModal(true);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to load analytics');
    }
  };

  const handleLoadPricing = async () => {
    try {
      const tiers = await Ads.getAdPricingTiers();
      setPricingTiers(tiers);
      setShowPricingModal(true);
    } catch (e) {
      console.error('[AdsManager] Failed to load pricing:', e);
    }
  };

  const handleCalculateCost = async () => {
    try {
      const estimate = await Ads.calculateAdCost(calcPlacement, calcModel, parseInt(calcBudget) || 0);
      setCostEstimate(estimate);
    } catch {
      // silent
    }
  };

  const handleNavigatePricing = () => {
    if (navigation) {
      navigation.navigate('AdsPricing');
    } else {
      handleLoadPricing();
    }
  };

  /* ── Render ── */

  if (loading) {
    return (
      <View style={styles.centerLoader}>
        <ActivityIndicator color={C.info} size="large" />
      </View>
    );
  }

  const renderCampaign = ({ item }: { item: Ads.AdCampaign }) => {
    const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.draft;
    const spendPct = item.budget > 0 ? Math.min((item.spent / item.budget) * 100, 100) : 0;
    return (
      <TouchableOpacity style={styles.campaignCard} activeOpacity={0.8} onPress={() => handleLoadAnalytics(item)}>
        <View style={styles.campaignHeader}>
          <Text style={styles.campaignName} numberOfLines={1}>{item.name}</Text>
          <View style={[styles.campaignStatusBadge, { backgroundColor: cfg.bg }]}>
            <Text style={[styles.campaignStatusText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
        </View>

        <Text style={styles.campaignPlacement}>
          {item.placement.charAt(0).toUpperCase() + item.placement.slice(1)} · {item.billingModel.toUpperCase()} · {item.duration}d
        </Text>

        <View style={styles.campaignStats}>
          <View style={styles.campaignStat}>
            <Text style={styles.campaignStatValue}>{Ads.formatAdCurrency(item.dailyBudget)}/day</Text>
            <Text style={styles.campaignStatLabel}>Budget</Text>
          </View>
          <View style={styles.campaignStat}>
            <Text style={styles.campaignStatValue}>{Ads.formatAdNumber(item.impressions)}</Text>
            <Text style={styles.campaignStatLabel}>Impressions</Text>
          </View>
          <View style={styles.campaignStat}>
            <Text style={styles.campaignStatValue}>{Ads.formatAdNumber(item.clicks)}</Text>
            <Text style={styles.campaignStatLabel}>Clicks</Text>
          </View>
          <View style={styles.campaignStat}>
            <Text style={[styles.campaignStatValue, { color: C.info }]}>{Ads.formatAdRate(item.ctr)}</Text>
            <Text style={styles.campaignStatLabel}>CTR</Text>
          </View>
          <View style={styles.campaignStat}>
            <Text style={styles.campaignStatValue}>{item.conversions}</Text>
            <Text style={styles.campaignStatLabel}>Conv.</Text>
          </View>
        </View>

        <View style={styles.campaignSpendRow}>
          <Text style={styles.campaignSpendLabel}>Spent</Text>
          <View style={styles.campaignSpendBar}>
            <View style={[styles.campaignSpendFill, { width: `${spendPct}%` }]} />
          </View>
          <Text style={styles.campaignSpendValue}>
            {Ads.formatAdCurrency(item.spent)} / {Ads.formatAdCurrency(item.budget)}
          </Text>
        </View>

        <View style={styles.campaignActions}>
          {(item.status === 'active' || item.status === 'paused') && (
            <TouchableOpacity
              style={[styles.campaignActionBtn, item.status === 'paused' && styles.actionBtnPrimary]}
              onPress={() => handleToggleStatus(item)}>
              <Ionicons name={item.status === 'active' ? 'pause-outline' : 'play-outline'} size={16} color={item.status === 'paused' ? C.bg : C.textPrimary} />
              <Text style={[styles.campaignActionText, item.status === 'paused' ? { color: C.bg } : { color: C.textPrimary }]}>
                {item.status === 'active' ? 'Pause' : 'Resume'}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.campaignActionBtnSecondary} onPress={() => handleLoadAnalytics(item)}>
            <Ionicons name="stats-chart-outline" size={16} color={C.info} />
            <Text style={[styles.campaignActionText, { color: C.info }]}>Analytics</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Ionicons name="megaphone-outline" size={22} color={C.info} />
        <Text style={styles.headerTitle}>Ads Manager</Text>
        <TouchableOpacity style={styles.createBtn} onPress={() => setShowCreateModal(true)}>
          <Ionicons name="add" size={18} color={C.bg} />
        </TouchableOpacity>
      </View>

      {/* ── Summary Bar ── */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{activeCampaignsCount}</Text>
          <Text style={styles.summaryLabel}>Active</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{Ads.formatAdCurrency(totalSpend)}</Text>
          <Text style={styles.summaryLabel}>Spent</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{Ads.formatAdNumber(totalClicks)}</Text>
          <Text style={styles.summaryLabel}>Clicks</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <TouchableOpacity onPress={handleNavigatePricing}>
            <Ionicons name="pricetag-outline" size={14} color={C.warning} />
          </TouchableOpacity>
          <Text style={styles.summaryLabel}>Pricing</Text>
        </View>
      </View>

      {/* ── Tabs ── */}
      <View style={styles.tabBar}>
        {(['all', 'active', 'paused', 'completed'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === 'all' ? ` (${filteredCampaigns.length})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Campaign List ── */}
      <FlatList
        data={filteredCampaigns}
        keyExtractor={(item) => item.id}
        renderItem={renderCampaign}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadCampaigns(); }} tintColor={C.info} />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="megaphone-outline" size={48} color={C.textTertiary} />
            <Text style={styles.emptyTitle}>No ad campaigns</Text>
            <Text style={styles.emptyText}>Create your first ad campaign to reach more customers.</Text>
          </View>
        }
      />

      {/* ═══════════ Create Campaign Modal ═══════════ */}
      <Modal visible={showCreateModal} animationType="slide" transparent onRequestClose={() => setShowCreateModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Ad Campaign</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Ionicons name="close" size={24} color={C.white} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              <Text style={styles.inputLabel}>Campaign Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Summer Sale 2024"
                placeholderTextColor={C.textTertiary}
                value={campaignName}
                onChangeText={setCampaignName}
              />

              <Text style={styles.inputLabel}>Headline</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Up to 50% Off Everything"
                placeholderTextColor={C.textTertiary}
                value={campaignHeadline}
                onChangeText={setCampaignHeadline}
              />

              <Text style={styles.inputLabel}>Placement</Text>
              <View style={styles.optionRow}>
                {PLACEMENTS.map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.optionPill, campaignPlacement === p && styles.optionPillActive]}
                    onPress={() => setCampaignPlacement(p)}>
                    <Text style={[styles.optionPillText, campaignPlacement === p && styles.optionPillTextActive]}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>Billing Model</Text>
              <View style={styles.optionRow}>
                {(['cpc', 'cpm'] as const).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.optionPill, campaignBillingModel === m && styles.optionPillActive]}
                    onPress={() => setCampaignBillingModel(m)}>
                    <Text style={[styles.optionPillText, campaignBillingModel === m && styles.optionPillTextActive]}>
                      {m.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>Daily Budget (paise)</Text>
              <TextInput
                style={styles.input}
                placeholder="50000 (= ₹500/day)"
                placeholderTextColor={C.textTertiary}
                keyboardType="numeric"
                value={campaignBudget}
                onChangeText={setCampaignBudget}
              />

              <Text style={styles.inputLabel}>Duration (days)</Text>
              <TextInput
                style={styles.input}
                placeholder="7"
                placeholderTextColor={C.textTertiary}
                keyboardType="numeric"
                value={campaignDuration}
                onChangeText={setCampaignDuration}
              />

              <View style={styles.budgetPreview}>
                <Text style={styles.budgetPreviewLabel}>Total Budget</Text>
                <Text style={styles.budgetPreviewValue}>
                  {Ads.formatAdCurrency((parseInt(campaignBudget) || 0) * (parseInt(campaignDuration) || 7))}
                </Text>
              </View>

              <TouchableOpacity style={[styles.submitBtn, creating && { opacity: 0.6 }]} onPress={handleCreate} disabled={creating}>
                <Text style={styles.submitBtnText}>{creating ? 'Creating...' : 'Launch Campaign'}</Text>
              </TouchableOpacity>
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ═══════════ Analytics Modal ═══════════ */}
      <Modal visible={showAnalyticsModal && !!selectedCampaign && !!adAnalytics} animationType="slide" transparent onRequestClose={() => { setShowAnalyticsModal(false); setAdAnalytics(null); }}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '85%' }]}>
            {selectedCampaign && adAnalytics && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{adAnalytics.campaignName}</Text>
                  <TouchableOpacity onPress={() => { setShowAnalyticsModal(false); setAdAnalytics(null); }}>
                    <Ionicons name="close" size={24} color={C.white} />
                  </TouchableOpacity>
                </View>
                <ScrollView style={styles.modalBody}>
                  <Text style={styles.sectionTitle}>Overview</Text>
                  <View style={styles.analyticsGrid}>
                    {[
                      { label: 'Impressions', value: Ads.formatAdNumber(adAnalytics.impressions) },
                      { label: 'Clicks', value: Ads.formatAdNumber(adAnalytics.clicks) },
                      { label: 'CTR', value: Ads.formatAdRate(adAnalytics.ctr), color: C.info },
                      { label: 'Conversions', value: String(adAnalytics.conversions) },
                      { label: 'Spent', value: Ads.formatAdCurrency(adAnalytics.spent) },
                      { label: 'Avg CPC', value: Ads.formatAdCurrency(adAnalytics.cpc) },
                      { label: 'Avg CPM', value: Ads.formatAdCurrency(adAnalytics.cpm) },
                      { label: 'Conv. Rate', value: Ads.formatAdRate(adAnalytics.conversionRate) },
                    ].map((item, idx) => (
                      <View key={idx} style={styles.aCard}>
                        <Text style={[styles.aCardValue, item.color ? { color: item.color } : undefined]}>{item.value}</Text>
                        <Text style={styles.aCardLabel}>{item.label}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Demographics */}
                  {adAnalytics.topDemographics && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Demographics</Text>
                      <View style={styles.demoCard}>
                        {Object.entries(adAnalytics.topDemographics.byAge || {}).map(([age, pct]) => (
                          <View key={age} style={styles.demoRow}>
                            <Text style={styles.demoLabel}>{age}</Text>
                            <View style={styles.demoBarTrack}>
                              <View style={[styles.demoBarFill, { width: `${(pct as number) * 100}%` }]} />
                            </View>
                            <Text style={styles.demoValue}>{((pct as number) * 100).toFixed(1)}%</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Daily Performance */}
                  {adAnalytics.dailyData.length > 0 && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Daily Performance</Text>
                      <View style={styles.dailyList}>
                        {adAnalytics.dailyData.slice(0, 7).map((day, idx) => {
                          const maxImp = Math.max(...adAnalytics.dailyData.map(d => d.impressions), 1);
                          const maxClk = Math.max(...adAnalytics.dailyData.map(d => d.clicks), 1);
                          return (
                            <View key={idx} style={styles.dailyRow}>
                              <Text style={styles.dailyDate}>
                                {day.date ? new Date(day.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                              </Text>
                              <View style={styles.dailyBars}>
                                <View style={styles.dailyBarTrack}>
                                  <View style={[styles.dailyBarFill, { width: `${Math.min((day.impressions / maxImp) * 100, 100)}%` }]} />
                                </View>
                                <View style={styles.dailyBarTrack}>
                                  <View style={[styles.dailyBarFill2, { width: `${Math.min((day.clicks / maxClk) * 100, 100)}%` }]} />
                                </View>
                              </View>
                              <Text style={styles.dailySpend}>{Ads.formatAdCurrency(day.spent)}</Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  )}
                  <View style={{ height: 40 }} />
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ═══════════ Pricing Modal ═══════════ */}
      <Modal visible={showPricingModal} animationType="slide" transparent onRequestClose={() => setShowPricingModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Ad Pricing Tiers</Text>
              <TouchableOpacity onPress={() => setShowPricingModal(false)}>
                <Ionicons name="close" size={24} color={C.white} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              {/* Cost Calculator */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Ad Cost Calculator</Text>
                <View style={styles.optionRow}>
                  {PLACEMENTS.map((p) => (
                    <TouchableOpacity key={p} style={[styles.optionPill, calcPlacement === p && styles.optionPillActive]} onPress={() => setCalcPlacement(p)}>
                      <Text style={[styles.optionPillText, calcPlacement === p && styles.optionPillTextActive]}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.optionRow}>
                  {(['cpc', 'cpm'] as const).map((m) => (
                    <TouchableOpacity key={m} style={[styles.optionPill, calcModel === m && styles.optionPillActive]} onPress={() => setCalcModel(m)}>
                      <Text style={[styles.optionPillText, calcModel === m && styles.optionPillTextActive]}>{m.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.inputLabel}>Budget (paise/day)</Text>
                <TextInput style={styles.input} placeholder="50000" placeholderTextColor={C.textTertiary} keyboardType="numeric" value={calcBudget} onChangeText={setCalcBudget} />
                <TouchableOpacity style={styles.calcBtn} onPress={handleCalculateCost}>
                  <Text style={styles.calcBtnText}>Calculate</Text>
                </TouchableOpacity>

                {costEstimate && (
                  <View style={styles.calcResult}>
                    <Text style={styles.calcResultTitle}>Estimated Results</Text>
                    {[
                      { label: 'Est. Clicks/Day', value: String(costEstimate.estimatedClicksPerDay) },
                      { label: 'Est. Impressions/Day', value: costEstimate.estimatedImpressionsPerDay.toLocaleString() },
                      { label: 'Avg CPC', value: Ads.formatAdCurrency(costEstimate.avgCpc) },
                      { label: 'Avg CPM', value: Ads.formatAdCurrency(costEstimate.avgCpm) },
                      { label: 'Est. Reach', value: `${costEstimate.estimatedReach.toLocaleString()} users` },
                    ].map((row, i) => (
                      <View key={i} style={styles.calcRow}>
                        <Text style={styles.calcLabel}>{row.label}</Text>
                        <Text style={styles.calcValue}>{row.value}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* Pricing by Placement */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Pricing by Placement</Text>
                {pricingTiers.map((tier) => (
                  <View key={tier.placement} style={styles.tierCard}>
                    <View style={styles.tierHeader}>
                      <Ionicons name="layers-outline" size={18} color={C.info} />
                      <Text style={styles.tierName}>{tier.placement.charAt(0).toUpperCase() + tier.placement.slice(1)}</Text>
                    </View>
                    <View style={styles.tierGrid}>
                      {[
                        { label: 'CPC Range', value: `${Ads.formatAdCurrency(tier.cpcMin)} - ${Ads.formatAdCurrency(tier.cpcMax)}` },
                        { label: 'CPM Range', value: `${Ads.formatAdCurrency(tier.cpmMin)} - ${Ads.formatAdCurrency(tier.cpmMax)}` },
                        { label: 'Daily Min', value: Ads.formatAdCurrency(tier.dailyBudgetMin) },
                        { label: 'Daily Max', value: Ads.formatAdCurrency(tier.dailyBudgetMax) },
                      ].map((item, i) => (
                        <View key={i} style={styles.tierItem}>
                          <Text style={styles.tierLabel}>{item.label}</Text>
                          <Text style={styles.tierValue}>{item.value}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
              <View style={{ height: 40 }} />
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
  createBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.info, alignItems: 'center', justifyContent: 'center' },

  // Summary
  summaryBar: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingVertical: S.md, paddingHorizontal: S.lg, borderBottomWidth: 1, borderBottomColor: C.surfaceBorder },
  summaryItem: { alignItems: 'center' },
  summaryNumber: { color: C.textPrimary, fontSize: F.lg, fontWeight: '800' },
  summaryLabel: { color: C.textSecondary, fontSize: F.xs, marginTop: 2 },
  summaryDivider: { width: 1, height: 32, backgroundColor: C.surfaceBorder },

  // Tabs
  tabBar: { flexDirection: 'row', paddingHorizontal: S.lg, borderBottomWidth: 1, borderBottomColor: C.surfaceBorder, gap: S.sm },
  tab: { paddingVertical: S.md, paddingBottom: S.md - 1, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: C.info },
  tabText: { color: C.textTertiary, fontSize: F.sm, fontWeight: '600' },
  tabTextActive: { color: C.info },
  listContent: { padding: S.lg, paddingBottom: 100 },

  // Campaign Card
  campaignCard: { backgroundColor: C.surface, borderRadius: BR.lg, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md, marginBottom: S.sm },
  campaignHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: S.xs },
  campaignName: { color: C.textPrimary, fontSize: F.sm, fontWeight: '700', flex: 1, marginRight: S.sm },
  campaignStatusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: BR.sm },
  campaignStatusText: { fontSize: F.xs, fontWeight: '700' },
  campaignPlacement: { color: C.textTertiary, fontSize: F.xs, marginTop: 2 },
  campaignStats: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.md },
  campaignStat: { flex: 1, minWidth: '18%', backgroundColor: C.bg, borderRadius: BR.sm, padding: S.sm, alignItems: 'center' },
  campaignStatValue: { color: C.textPrimary, fontSize: F.xs, fontWeight: '700' },
  campaignStatLabel: { color: C.textTertiary, fontSize: 9, marginTop: 2 },
  campaignSpendRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.sm },
  campaignSpendLabel: { color: C.textSecondary, fontSize: F.xs },
  campaignSpendBar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: C.surfaceBorder, overflow: 'hidden' },
  campaignSpendFill: { height: '100%', borderRadius: 3, backgroundColor: C.info },
  campaignSpendValue: { color: C.textSecondary, fontSize: 10, fontWeight: '600', width: 110, textAlign: 'right' },
  campaignActions: { flexDirection: 'row', gap: S.sm, marginTop: S.md },
  campaignActionBtn: { flexDirection: 'row', alignItems: 'center', gap: S.xs, flex: 1, paddingVertical: 8, borderRadius: BR.md, backgroundColor: C.surfaceBorder, justifyContent: 'center', borderWidth: 1, borderColor: C.surfaceBorder },
  actionBtnPrimary: { backgroundColor: C.info, borderColor: C.info },
  campaignActionBtnSecondary: { flexDirection: 'row', alignItems: 'center', gap: S.xs, flex: 1, paddingVertical: 8, borderRadius: BR.md, justifyContent: 'center', borderWidth: 1, borderColor: C.info },
  campaignActionText: { fontSize: F.xs, fontWeight: '700' },

  // Empty
  emptyState: { alignItems: 'center', paddingTop: 100, paddingHorizontal: S.xxxl },
  emptyTitle: { color: C.textPrimary, fontSize: F.lg, fontWeight: '600', marginTop: S.lg },
  emptyText: { color: C.textSecondary, fontSize: F.sm, textAlign: 'center', marginTop: S.xs },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: C.surface, borderTopLeftRadius: BR.xl, borderTopRightRadius: BR.xl, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: S.lg, borderBottomWidth: 1, borderBottomColor: C.surfaceBorder },
  modalTitle: { color: C.textPrimary, fontSize: F.lg, fontWeight: '600' },
  modalBody: { padding: S.lg },

  // Form
  inputLabel: { color: C.textSecondary, fontSize: F.sm, fontWeight: '500', marginBottom: S.xs, marginTop: S.md },
  input: { backgroundColor: C.bg, borderRadius: BR.sm, borderWidth: 1, borderColor: C.surfaceBorder, paddingHorizontal: S.md, paddingVertical: 10, color: C.textPrimary, fontSize: F.md },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.sm },
  optionPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: BR.md, backgroundColor: C.bg, borderWidth: 1, borderColor: C.surfaceBorder },
  optionPillActive: { borderColor: C.info, backgroundColor: 'rgba(6,182,212,0.15)' },
  optionPillText: { color: C.textTertiary, fontSize: F.sm, fontWeight: '500' },
  optionPillTextActive: { color: C.info, fontWeight: '600' },
  budgetPreview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.bg, borderRadius: BR.sm, padding: S.md, marginTop: S.lg },
  budgetPreviewLabel: { color: C.textSecondary, fontSize: F.sm },
  budgetPreviewValue: { color: C.white, fontSize: F.lg, fontWeight: '800' },
  submitBtn: { backgroundColor: C.info, borderRadius: BR.md, paddingVertical: 14, alignItems: 'center', marginTop: S.xxl },
  submitBtnText: { color: C.bg, fontSize: F.md, fontWeight: '700' },

  // Analytics
  section: {},
  sectionTitle: { color: C.textPrimary, fontSize: F.md, fontWeight: '600', marginBottom: S.md, marginTop: S.lg },
  analyticsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  aCard: { width: '48%', backgroundColor: C.bg, borderRadius: BR.sm, padding: S.md },
  aCardValue: { color: C.textPrimary, fontSize: F.md, fontWeight: '700' },
  aCardLabel: { color: C.textTertiary, fontSize: F.xs, marginTop: 2 },

  // Demographics
  demoCard: { backgroundColor: C.bg, borderRadius: BR.sm, padding: S.md, gap: S.sm },
  demoRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  demoLabel: { width: 50, color: C.textSecondary, fontSize: F.xs },
  demoBarTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.surfaceBorder, overflow: 'hidden' },
  demoBarFill: { height: '100%', borderRadius: 4, backgroundColor: C.info },
  demoValue: { width: 50, color: C.textPrimary, fontSize: F.xs, fontWeight: '600', textAlign: 'right' },

  // Daily
  dailyList: { gap: S.sm },
  dailyRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: BR.sm, padding: S.sm, gap: S.sm },
  dailyDate: { width: 50, color: C.textSecondary, fontSize: F.xs },
  dailyBars: { flex: 1, flexDirection: 'row', gap: 2, height: 40 },
  dailyBarTrack: { flex: 1, height: 40, borderRadius: 3, backgroundColor: C.surfaceBorder, overflow: 'hidden' },
  dailyBarFill: { height: '100%', borderRadius: 3, backgroundColor: C.white },
  dailyBarFill2: { height: '100%', borderRadius: 3, backgroundColor: C.info },
  dailySpend: { width: 60, color: C.textTertiary, fontSize: F.xs, textAlign: 'right' },

  // Pricing
  calcBtn: { backgroundColor: C.info, borderRadius: BR.md, paddingVertical: 12, alignItems: 'center', marginTop: S.md },
  calcBtnText: { color: C.bg, fontSize: F.md, fontWeight: '700' },
  calcResult: { backgroundColor: C.bg, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md, marginTop: S.md },
  calcResultTitle: { color: C.textPrimary, fontSize: F.md, fontWeight: '600', marginBottom: S.sm },
  calcRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: S.xs, borderBottomWidth: 0.5, borderBottomColor: C.surfaceBorder },
  calcLabel: { color: C.textSecondary, fontSize: F.sm },
  calcValue: { color: C.textPrimary, fontSize: F.sm, fontWeight: '600' },

  // Tiers
  tierCard: { backgroundColor: C.surface, borderRadius: BR.md, borderWidth: 1, borderColor: C.surfaceBorder, padding: S.md, marginBottom: S.sm },
  tierHeader: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.sm },
  tierName: { color: C.textPrimary, fontSize: F.sm, fontWeight: '700' },
  tierGrid: { gap: S.xs },
  tierItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: S.xs },
  tierLabel: { color: C.textSecondary, fontSize: F.xs },
  tierValue: { color: C.textPrimary, fontSize: F.xs, fontWeight: '600' },
});

export default AdsManagerScreen;
