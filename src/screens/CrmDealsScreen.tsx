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
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { firestore, auth } from '../lib/firebase';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';

/* ── Theme constants ───────────────────────────────────────────────────────── */

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
  white20: 'rgba(255,255,255,0.2)',
};

const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
const F = { xs: 10, sm: 12, md: 14, lg: 15, xl: 18, xxl: 22, xxxl: 28 };
const BR = { sm: 6, md: 10, lg: 16, xl: 24 };

/* ── Types ─────────────────────────────────────────────────────────────────── */

type Stage = 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';

interface Deal {
  id: string;
  name: string;
  company: string;
  value: number;
  contactName: string;
  contactEmail: string;
  stage: Stage;
  assignedTo: string;
  notes: string;
  activities: Activity[];
  createdAt: string;
  updatedAt: string;
}

interface Activity {
  id: string;
  text: string;
  type: 'stage_change' | 'note' | 'created';
  createdAt: string;
}

const STAGES: Array<{ key: Stage | 'all'; label: string; color: string }> = [
  { key: 'all', label: 'All', color: C.textSecondary },
  { key: 'lead', label: 'Lead', color: C.info },
  { key: 'qualified', label: 'Qualified', color: C.purple },
  { key: 'proposal', label: 'Proposal', color: C.gold },
  { key: 'negotiation', label: 'Negotiation', color: C.warning },
  { key: 'won', label: 'Won', color: C.success },
  { key: 'lost', label: 'Lost', color: C.danger },
];

const STAGE_KEYS: Stage[] = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

/* ── Helpers ───────────────────────────────────────────────────────────────── */

const stageColor = (stage: Stage): string => {
  const s = STAGES.find((st) => st.key === stage);
  return s?.color ?? C.textTertiary;
};

const formatINR = (value: number): string => {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(2)} L`;
  return `₹${new Intl.NumberFormat('en-IN').format(value)}`;
};

const parseTimestamp = (v: any): string => {
  if (v && typeof v === 'object' && 'seconds' in v) {
    return new Date(v.seconds * 1000).toISOString();
  }
  return typeof v === 'string' ? v : new Date().toISOString();
};

const formatDate = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
};

const timeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
};

/* ── Component ─────────────────────────────────────────────────────────────── */

interface Props {
  navigation?: any;
}

const CrmDealsScreen: React.FC<Props> = () => {
  const uid = auth().currentUser?.uid ?? '';

  // ── State ────────────────────────────────────────────────────────────────
  const [deals, setDeals] = useState<Deal[]>([]);
  const [filteredDeals, setFilteredDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeStage, setActiveStage] = useState<Stage | 'all'>('all');

  // Detail modal
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [detailActivities, setDetailActivities] = useState<Activity[]>([]);
  const [noteInput, setNoteInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Create modal
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newDeal, setNewDeal] = useState({
    name: '',
    company: '',
    value: '',
    contactName: '',
    contactEmail: '',
    stage: 'lead' as Stage,
  });
  const [creating, setCreating] = useState(false);

  // ── Load deals ───────────────────────────────────────────────────────────
  const loadDeals = useCallback(async () => {
    try {
      const snap = await firestore()
        .collection('deals')
        .where('businessId', '==', uid)
        .orderBy('createdAt', 'desc')
        .get();

      const dealsData = snap.docs.map((doc: any) => {
        const d = doc.data();
        return {
          id: doc.id,
          name: d.name ?? '',
          company: d.company ?? '',
          value: d.value ?? 0,
          contactName: d.contactName ?? '',
          contactEmail: d.contactEmail ?? '',
          stage: d.stage ?? 'lead',
          assignedTo: d.assignedTo ?? '',
          notes: d.notes ?? '',
          activities: [],
          createdAt: parseTimestamp(d.createdAt),
          updatedAt: parseTimestamp(d.updatedAt),
        };
      });
      setDeals(dealsData);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => {
    loadDeals();
  }, [loadDeals]);

  // ── Filter ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeStage === 'all') {
      setFilteredDeals(deals);
    } else {
      setFilteredDeals(deals.filter((d) => d.stage === activeStage));
    }
  }, [deals, activeStage]);

  // ── Load activities subcollection ────────────────────────────────────────
  const loadActivities = useCallback(async (dealId: string) => {
    try {
      const snap = await firestore()
        .collection('deals')
        .doc(dealId)
        .collection('activities')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      const acts: Activity[] = snap.docs.map((doc: any) => {
        const d = doc.data();
        return {
          id: doc.id,
          text: d.text ?? '',
          type: d.type ?? 'note',
          createdAt: parseTimestamp(d.createdAt),
        };
      });
      setDetailActivities(acts);
    } catch {
      setDetailActivities([]);
    }
  }, []);

  // ── Open deal detail ─────────────────────────────────────────────────────
  const openDealDetail = async (deal: Deal) => {
    setSelectedDeal(deal);
    setNoteInput('');
    await loadActivities(deal.id);
  };

  // ── Change stage ─────────────────────────────────────────────────────────
  const handleChangeStage = async (dealId: string, newStage: Stage) => {
    const prevStage = selectedDeal?.stage ?? 'lead';
    try {
      await firestore().collection('deals').doc(dealId).update({
        stage: newStage,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });

      // Log activity
      await firestore()
        .collection('deals')
        .doc(dealId)
        .collection('activities')
        .add({
          text: `Stage changed from "${prevStage}" to "${newStage}"`,
          type: 'stage_change',
          createdAt: new Date().toISOString(),
        });

      // Update local state
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stage: newStage } : d)),
      );
      setSelectedDeal((prev) => (prev ? { ...prev, stage: newStage } : null));
      loadActivities(dealId);
    } catch {
      // silent
    }
  };

  // ── Add note ─────────────────────────────────────────────────────────────
  const handleAddNote = async () => {
    if (!selectedDeal || !noteInput.trim() || savingNote) return;
    setSavingNote(true);
    try {
      const noteText = noteInput.trim();
      const appended = selectedDeal.notes
        ? `${selectedDeal.notes}\n[${formatDate(new Date().toISOString())}] ${noteText}`
        : `[${formatDate(new Date().toISOString())}] ${noteText}`;

      await firestore().collection('deals').doc(selectedDeal.id).update({
        notes: appended,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });

      await firestore()
        .collection('deals')
        .doc(selectedDeal.id)
        .collection('activities')
        .add({
          text: noteText,
          type: 'note',
          createdAt: new Date().toISOString(),
        });

      const updated: Deal = { ...selectedDeal, notes: appended };
      setSelectedDeal(updated);
      setDeals((prev) =>
        prev.map((d) => (d.id === selectedDeal.id ? updated : d)),
      );
      setNoteInput('');
      await loadActivities(selectedDeal.id);
    } catch {
      // silent
    } finally {
      setSavingNote(false);
    }
  };

  // ── Create deal ──────────────────────────────────────────────────────────
  const handleCreateDeal = async () => {
    if (!newDeal.name.trim() || creating) return;
    setCreating(true);
    try {
      const now = new Date().toISOString();
      const dealData = {
        businessId: uid,
        name: newDeal.name.trim(),
        company: newDeal.company.trim(),
        value: parseFloat(newDeal.value) || 0,
        contactName: newDeal.contactName.trim(),
        contactEmail: newDeal.contactEmail.trim(),
        stage: newDeal.stage,
        assignedTo: uid,
        notes: '',
        createdAt: now,
        updatedAt: now,
      };

      const ref = await firestore().collection('deals').add(dealData);

      // Log creation activity
      await firestore()
        .collection('deals')
        .doc(ref.id)
        .collection('activities')
        .add({
          text: 'Deal created',
          type: 'created',
          createdAt: now,
        });

      setNewDeal({
        name: '',
        company: '',
        value: '',
        contactName: '',
        contactEmail: '',
        stage: 'lead',
      });
      setCreateModalVisible(false);
      await loadDeals();
    } catch {
      // silent
    } finally {
      setCreating(false);
    }
  };

  // ── Pipeline summary for header ──────────────────────────────────────────
  const totalValue = filteredDeals.reduce((sum, d) => sum + (d.value || 0), 0);

  // ── Render deal card ─────────────────────────────────────────────────────
  const renderDeal = ({ item }: { item: Deal }) => (
    <TouchableOpacity
      style={styles.dealCard}
      onPress={() => openDealDetail(item)}
      activeOpacity={0.7}>
      {/* Top row: name + stage badge */}
      <View style={styles.dealHeader}>
        <View style={styles.dealIcon}>
          <Ionicons name="business-outline" size={16} color={stageColor(item.stage)} />
        </View>
        <View style={styles.dealHeaderInfo}>
          <Text style={styles.dealName} numberOfLines={1}>
            {item.name}
          </Text>
          {item.company ? (
            <Text style={styles.dealCompany} numberOfLines={1}>
              {item.company}
            </Text>
          ) : null}
        </View>
        <View style={[styles.stageBadge, { backgroundColor: stageColor(item.stage) + '20' }]}>
          <Text style={[styles.stageBadgeText, { color: stageColor(item.stage) }]}>
            {item.stage.charAt(0).toUpperCase() + item.stage.slice(1)}
          </Text>
        </View>
      </View>

      {/* Middle row: value + contact */}
      <View style={styles.dealMeta}>
        <View style={styles.dealMetaItem}>
          <Ionicons name="cash-outline" size={14} color={C.success} />
          <Text style={styles.dealValue}>{formatINR(item.value || 0)}</Text>
        </View>
        {item.contactName ? (
          <View style={styles.dealMetaItem}>
            <Ionicons name="person-outline" size={14} color={C.textTertiary} />
            <Text style={styles.dealContact}>{item.contactName}</Text>
          </View>
        ) : null}
      </View>

      {/* Bottom row: date */}
      <Text style={styles.dealDate}>{formatDate(item.createdAt)}</Text>
    </TouchableOpacity>
  );

  // ── Loading state ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centerLoader}>
        <ActivityIndicator color={C.text} size="large" />
      </View>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Deals Pipeline</Text>
          <Text style={styles.headerSub}>
            {filteredDeals.length} deal{filteredDeals.length !== 1 ? 's' : ''} • {formatINR(totalValue)}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.createBtn}
          onPress={() => setCreateModalVisible(true)}>
          <Ionicons name="add" size={20} color={C.black} />
          <Text style={styles.createBtnText}>New Deal</Text>
        </TouchableOpacity>
      </View>

      {/* Stage filter pills */}
      <View style={styles.filterBar}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={STAGES}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.filterList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.filterPill,
                activeStage === item.key && {
                  backgroundColor: item.color + '20',
                  borderColor: item.color,
                },
              ]}
              onPress={() => setActiveStage(item.key)}>
              <Text
                style={[
                  styles.filterPillText,
                  activeStage === item.key && { color: item.color },
                ]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Deals list */}
      <FlatList
        data={filteredDeals}
        keyExtractor={(item) => item.id}
        renderItem={renderDeal}
        contentContainerStyle={styles.dealsList}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="ribbon-outline" size={48} color={C.white20} />
            <Text style={styles.emptyTitle}>No deals yet</Text>
            <Text style={styles.emptySubtitle}>
              {activeStage === 'all'
                ? 'Tap "New Deal" to start tracking your pipeline'
                : `No ${activeStage} deals found`}
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadDeals();
            }}
            tintColor={C.text}
          />
        }
      />

      {/* ═══ CREATE DEAL MODAL ═══ */}
      <Modal
        visible={createModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setCreateModalVisible(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Deal</Text>
              <TouchableOpacity onPress={() => setCreateModalVisible(false)}>
                <Ionicons name="close" size={24} color={C.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              {/* Deal Name */}
              <Text style={styles.formLabel}>Deal Name *</Text>
              <TextInput
                style={styles.formInput}
                value={newDeal.name}
                onChangeText={(t) => setNewDeal((p) => ({ ...p, name: t }))}
                placeholder="e.g. Website Redesign"
                placeholderTextColor={C.textTertiary}
              />

              {/* Company */}
              <Text style={styles.formLabel}>Company</Text>
              <TextInput
                style={styles.formInput}
                value={newDeal.company}
                onChangeText={(t) => setNewDeal((p) => ({ ...p, company: t }))}
                placeholder="Acme Corp"
                placeholderTextColor={C.textTertiary}
              />

              {/* Value */}
              <Text style={styles.formLabel}>Value (₹)</Text>
              <TextInput
                style={styles.formInput}
                value={newDeal.value}
                onChangeText={(t) => setNewDeal((p) => ({ ...p, value: t.replace(/[^0-9.]/g, '') }))}
                placeholder="50000"
                placeholderTextColor={C.textTertiary}
                keyboardType="decimal-pad"
              />

              {/* Contact Name */}
              <Text style={styles.formLabel}>Contact Name</Text>
              <TextInput
                style={styles.formInput}
                value={newDeal.contactName}
                onChangeText={(t) => setNewDeal((p) => ({ ...p, contactName: t }))}
                placeholder="John Doe"
                placeholderTextColor={C.textTertiary}
              />

              {/* Contact Email */}
              <Text style={styles.formLabel}>Contact Email</Text>
              <TextInput
                style={styles.formInput}
                value={newDeal.contactEmail}
                onChangeText={(t) => setNewDeal((p) => ({ ...p, contactEmail: t }))}
                placeholder="john@acme.com"
                placeholderTextColor={C.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              {/* Stage picker */}
              <Text style={styles.formLabel}>Stage</Text>
              <View style={styles.stagePicker}>
                {STAGE_KEYS.map((sk) => (
                  <TouchableOpacity
                    key={sk}
                    style={[
                      styles.stagePickerBtn,
                      newDeal.stage === sk && {
                        backgroundColor: stageColor(sk) + '20',
                        borderColor: stageColor(sk),
                      },
                    ]}
                    onPress={() => setNewDeal((p) => ({ ...p, stage: sk }))}>
                    <Text
                      style={[
                        styles.stagePickerText,
                        newDeal.stage === sk && { color: stageColor(sk) },
                      ]}>
                      {sk.charAt(0).toUpperCase() + sk.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Submit */}
              <TouchableOpacity
                style={[styles.submitBtn, (!newDeal.name.trim() || creating) && styles.submitBtnDisabled]}
                onPress={handleCreateDeal}
                disabled={!newDeal.name.trim() || creating}>
                {creating ? (
                  <ActivityIndicator color={C.black} size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>Create Deal</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ═══ DEAL DETAIL MODAL ═══ */}
      <Modal
        visible={!!selectedDeal}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedDeal(null)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalContent}>
            {selectedDeal && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Deal Details</Text>
                  <TouchableOpacity onPress={() => setSelectedDeal(null)}>
                    <Ionicons name="close" size={24} color={C.text} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
                  {/* Deal name + badge */}
                  <Text style={styles.detailName}>{selectedDeal.name}</Text>
                  <View style={styles.detailBadgeRow}>
                    <View style={[styles.stageBadge, { backgroundColor: stageColor(selectedDeal.stage) + '20' }]}>
                      <Text style={[styles.stageBadgeText, { color: stageColor(selectedDeal.stage) }]}>
                        {selectedDeal.stage.charAt(0).toUpperCase() + selectedDeal.stage.slice(1)}
                      </Text>
                    </View>
                    <Text style={styles.detailValue}>{formatINR(selectedDeal.value || 0)}</Text>
                  </View>

                  {/* Fields */}
                  <View style={styles.detailField}>
                    <Text style={styles.detailFieldLabel}>Company</Text>
                    <Text style={styles.detailFieldValue}>
                      {selectedDeal.company || '—'}
                    </Text>
                  </View>

                  <View style={styles.detailField}>
                    <Text style={styles.detailFieldLabel}>Contact</Text>
                    <Text style={styles.detailFieldValue}>
                      {selectedDeal.contactName || '—'}
                    </Text>
                    {selectedDeal.contactEmail ? (
                      <Text style={styles.detailFieldSub}>{selectedDeal.contactEmail}</Text>
                    ) : null}
                  </View>

                  <View style={styles.detailField}>
                    <Text style={styles.detailFieldLabel}>Created</Text>
                    <Text style={styles.detailFieldValue}>{formatDate(selectedDeal.createdAt)}</Text>
                  </View>

                  <View style={styles.detailField}>
                    <Text style={styles.detailFieldLabel}>Last Updated</Text>
                    <Text style={styles.detailFieldValue}>{formatDate(selectedDeal.updatedAt)}</Text>
                  </View>

                  {/* Notes */}
                  {selectedDeal.notes ? (
                    <View style={styles.detailField}>
                      <Text style={styles.detailFieldLabel}>Notes</Text>
                      <Text style={styles.detailNotes}>{selectedDeal.notes}</Text>
                    </View>
                  ) : null}

                  {/* Change Stage */}
                  <Text style={[styles.sectionLabel, { marginTop: S.xl }]}>Change Stage</Text>
                  <View style={styles.stageActions}>
                    {STAGE_KEYS.map((sk) => (
                      <TouchableOpacity
                        key={sk}
                        style={[
                          styles.stageActionBtn,
                          selectedDeal.stage === sk && {
                            backgroundColor: stageColor(sk) + '20',
                            borderColor: stageColor(sk),
                          },
                        ]}
                        onPress={() => handleChangeStage(selectedDeal.id, sk)}>
                        <Text
                          style={[
                            styles.stageActionText,
                            selectedDeal.stage === sk && { color: stageColor(sk) },
                          ]}>
                          {sk.charAt(0).toUpperCase() + sk.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Activity Log */}
                  <Text style={[styles.sectionLabel, { marginTop: S.xl }]}>Activity Log</Text>
                  {detailActivities.length === 0 ? (
                    <Text style={styles.noActivity}>No activity recorded yet</Text>
                  ) : (
                    <View style={styles.activityList}>
                      {detailActivities.map((act) => (
                        <View key={act.id} style={styles.activityItem}>
                          <View style={styles.activityDot}>
                            <Ionicons
                              name={
                                act.type === 'stage_change'
                                  ? 'swap-horizontal'
                                  : act.type === 'created'
                                    ? 'add-circle'
                                    : 'chatbubble'
                              }
                              size={14}
                              color={
                                act.type === 'stage_change'
                                  ? C.info
                                  : act.type === 'created'
                                    ? C.success
                                    : C.warning
                              }
                            />
                          </View>
                          <View style={styles.activityContent}>
                            <Text style={styles.activityText}>{act.text}</Text>
                            <Text style={styles.activityTime}>{timeAgo(act.createdAt)}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Add Note */}
                  <Text style={[styles.sectionLabel, { marginTop: S.xxl }]}>Add Note</Text>
                  <View style={styles.noteRow}>
                    <TextInput
                      style={styles.noteInput}
                      value={noteInput}
                      onChangeText={setNoteInput}
                      placeholder="Write a note..."
                      placeholderTextColor={C.textTertiary}
                      multiline
                      numberOfLines={2}
                      textAlignVertical="top"
                    />
                    <TouchableOpacity
                      style={[
                        styles.noteSendBtn,
                        (!noteInput.trim() || savingNote) && styles.noteSendBtnDisabled,
                      ]}
                      onPress={handleAddNote}
                      disabled={!noteInput.trim() || savingNote}>
                      {savingNote ? (
                        <ActivityIndicator size="small" color={C.text} />
                      ) : (
                        <Ionicons name="send" size={18} color={C.text} />
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Bottom padding for scroll */}
                  <View style={{ height: S.xxl }} />
                </ScrollView>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

/* ── Styles ───────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.black },
  centerLoader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.black },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: { color: C.text, fontSize: F.xl, fontWeight: '700' },
  headerSub: { color: C.textSecondary, fontSize: F.sm, marginTop: 2 },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs,
    backgroundColor: C.text,
    borderRadius: BR.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  createBtnText: { color: C.black, fontSize: F.sm, fontWeight: '600' },

  // Filter bar
  filterBar: { borderBottomWidth: 1, borderBottomColor: C.border },
  filterList: { paddingHorizontal: S.lg, paddingVertical: S.sm, gap: S.sm },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: BR.lg,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  filterPillText: { color: C.textSecondary, fontSize: F.sm, fontWeight: '500' },

  // Deals list
  dealsList: { padding: S.lg },
  separator: { height: 8 },

  // Deal card
  dealCard: {
    backgroundColor: C.surface,
    borderRadius: BR.md,
    borderWidth: 1,
    borderColor: C.border,
    padding: S.md,
    gap: S.sm,
  },
  dealHeader: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  dealIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dealHeaderInfo: { flex: 1, gap: 2 },
  dealName: { color: C.text, fontSize: F.md, fontWeight: '600' },
  dealCompany: { color: C.textTertiary, fontSize: F.xs },
  stageBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: BR.sm },
  stageBadgeText: { fontSize: F.xs, fontWeight: '600' },
  dealMeta: { flexDirection: 'row', gap: S.lg, marginLeft: 48 },
  dealMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dealValue: { color: C.success, fontSize: F.sm, fontWeight: '600' },
  dealContact: { color: C.textSecondary, fontSize: F.xs },
  dealDate: { color: C.textTertiary, fontSize: F.xs, marginLeft: 48 },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 80, paddingHorizontal: S.xl },
  emptyTitle: { color: C.text, fontSize: F.lg, fontWeight: '600', marginTop: S.lg },
  emptySubtitle: { color: C.textSecondary, fontSize: F.sm, marginTop: S.xs, textAlign: 'center' },

  // Modal shared
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: C.surface,
    borderTopLeftRadius: BR.xl,
    borderTopRightRadius: BR.xl,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: S.lg,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  modalTitle: { color: C.text, fontSize: F.lg, fontWeight: '600' },
  modalBody: { padding: S.lg },

  // Create form
  formLabel: { color: C.textSecondary, fontSize: F.sm, fontWeight: '500', marginBottom: S.xs, marginTop: S.md },
  formInput: {
    backgroundColor: C.black,
    borderRadius: BR.sm,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: S.md,
    paddingVertical: 10,
    color: C.text,
    fontSize: F.md,
  },
  stagePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  stagePickerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BR.sm,
    backgroundColor: C.black,
    borderWidth: 1,
    borderColor: C.border,
  },
  stagePickerText: { color: C.textSecondary, fontSize: F.sm, fontWeight: '500' },
  submitBtn: {
    backgroundColor: C.text,
    borderRadius: BR.md,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: S.xxl,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: C.black, fontSize: F.md, fontWeight: '700' },

  // Detail modal
  detailName: { color: C.text, fontSize: F.xxl, fontWeight: '700', marginTop: S.sm },
  detailBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    marginTop: S.sm,
  },
  detailValue: { color: C.success, fontSize: F.xl, fontWeight: '700' },
  detailField: { marginTop: S.lg },
  detailFieldLabel: { color: C.textSecondary, fontSize: F.sm, fontWeight: '500', marginBottom: S.xs },
  detailFieldValue: { color: C.text, fontSize: F.md },
  detailFieldSub: { color: C.textTertiary, fontSize: F.xs, marginTop: 2 },
  detailNotes: {
    color: C.text,
    fontSize: F.sm,
    backgroundColor: C.black,
    borderRadius: BR.sm,
    borderWidth: 1,
    borderColor: C.border,
    padding: S.md,
    lineHeight: 20,
  },

  // Stage actions in detail
  sectionLabel: { color: C.textSecondary, fontSize: F.sm, fontWeight: '600', marginBottom: S.sm },
  stageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  stageActionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BR.md,
    backgroundColor: C.black,
    borderWidth: 1,
    borderColor: C.border,
  },
  stageActionText: { color: C.textSecondary, fontSize: F.sm, fontWeight: '500' },

  // Activity log
  noActivity: { color: C.textTertiary, fontSize: F.sm, fontStyle: 'italic' },
  activityList: { gap: S.sm },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: S.sm,
    backgroundColor: C.black,
    borderRadius: BR.sm,
    borderWidth: 1,
    borderColor: C.border,
    padding: S.sm,
  },
  activityDot: { width: 24, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  activityContent: { flex: 1, gap: 2 },
  activityText: { color: C.text, fontSize: F.sm },
  activityTime: { color: C.textTertiary, fontSize: F.xs },

  // Add note
  noteRow: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' },
  noteInput: {
    flex: 1,
    backgroundColor: C.black,
    borderRadius: BR.sm,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: S.md,
    paddingVertical: S.md,
    color: C.text,
    fontSize: F.sm,
    minHeight: 44,
    maxHeight: 100,
  },
  noteSendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteSendBtnDisabled: { opacity: 0.3 },
});

export default CrmDealsScreen;
