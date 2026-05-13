/**
 * ShipRocketSettingsScreen.tsx — ShipRocket Integration Configuration
 *
 * Manages ShipRocket API credentials, courier partners, warehouses,
 * pickup locations, connection testing, and disconnect functionality.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  Modal,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { auth, firestore } from '../lib/firebase';
import {
  saveShipRocketCredentials,
  removeShipRocketCredentials,
  isShipRocketConfigured,
  getShipRocketClient,
  ShipRocketClient,
  ShipRocketCourierPartner,
  ShipRocketWarehouse,
  ShipRocketPickupLocation,
  ShipRocketConfig,
} from '../lib/shiprocket';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTokenExpiry(expiryMs: number): string {
  if (!expiryMs) return 'N/A';
  const diff = expiryMs - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h remaining`;
  return `${hours}h remaining`;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ShipRocketSettingsScreen({ navigation }: any) {
  const uid = auth()?.currentUser?.uid;

  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [config, setConfig] = useState<ShipRocketConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Data sections
  const [couriers, setCouriers] = useState<ShipRocketCourierPartner[]>([]);
  const [warehouses, setWarehouses] = useState<ShipRocketWarehouse[]>([]);
  const [pickupLocations, setPickupLocations] = useState<ShipRocketPickupLocation[]>([]);

  // Loading flags per section
  const [loadingCouriers, setLoadingCouriers] = useState(false);
  const [loadingWarehouses, setLoadingWarehouses] = useState(false);
  const [loadingPickups, setLoadingPickups] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Warehouse form modal
  const [warehouseModal, setWarehouseModal] = useState(false);
  const [whName, setWhName] = useState('');
  const [whAddress, setWhAddress] = useState('');
  const [whCity, setWhCity] = useState('');
  const [whState, setWhState] = useState('');
  const [whPincode, setWhPincode] = useState('');
  const [whPhone, setWhPhone] = useState('');
  const [creatingWarehouse, setCreatingWarehouse] = useState(false);

  // ── Load connection status ───────────────────────────────────────────────

  const loadConnectionStatus = useCallback(async () => {
    if (!uid) { setLoading(false); return; }
    try {
      const configured = await isShipRocketConfigured(uid);
      setIsConnected(configured);

      if (configured) {
        const snap = await firestore()
          .collection('shiprocket_config')
          .doc(uid)
          .get();
        if (snap.exists) {
          const d = snap.data();
          setConfig({
            email: d.email || '',
            password: '',
            token: d.token || '',
            tokenExpiry: d.tokenExpiry || 0,
            companyId: d.companyId,
            companyName: d.companyName,
          });
        }
      }
    } catch (e) {
      console.error('[ShipRocketSettings] loadConnectionStatus error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => {
    loadConnectionStatus();
  }, [loadConnectionStatus]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadConnectionStatus();
  }, [loadConnectionStatus]);

  // ── Connect ──────────────────────────────────────────────────────────────

  const handleConnect = useCallback(async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing Fields', 'Please enter both email and password.');
      return;
    }
    if (!uid) return;

    setConnecting(true);
    try {
      await saveShipRocketCredentials(uid, email.trim(), password.trim());
      setIsConnected(true);
      // Reload config
      const snap = await firestore()
        .collection('shiprocket_config')
        .doc(uid)
        .get();
      if (snap.exists) {
        const d = snap.data();
        setConfig({
          email: d.email || '',
          password: '',
          token: d.token || '',
          tokenExpiry: d.tokenExpiry || 0,
          companyId: d.companyId,
          companyName: d.companyName,
        });
      }
      Alert.alert('Connected', `ShipRocket connected as ${config?.companyName || email.trim()}`);
    } catch (e: any) {
      Alert.alert('Connection Failed', e?.message || 'Failed to authenticate with ShipRocket.');
    } finally {
      setConnecting(false);
    }
  }, [email, password, uid, config?.companyName]);

  // ── Disconnect ───────────────────────────────────────────────────────────

  const handleDisconnect = useCallback(() => {
    if (!uid) return;
    Alert.alert(
      'Disconnect ShipRocket?',
      'This will remove all ShipRocket credentials. Active shipments will not be affected but you won\'t be able to create new ones.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeShipRocketCredentials(uid);
              setIsConnected(false);
              setConfig(null);
              setCouriers([]);
              setWarehouses([]);
              setPickupLocations([]);
              setTestResult(null);
            } catch (e) {
              console.error('[ShipRocketSettings] disconnect error:', e);
            }
          },
        },
      ],
    );
  }, [uid]);

  // ── Fetch sections ───────────────────────────────────────────────────────

  const loadCouriers = useCallback(async () => {
    if (!uid) return;
    setLoadingCouriers(true);
    try {
      const client = await getShipRocketClient(uid);
      const result = await client.getCourierPartners();
      const allCouriers = [
        ...(result?.data?.shipping_couriers || []),
        ...(result?.data?.logistics_couriers || []),
        ...(result?.data?.available_courier_companies || []),
      ];
      // Deduplicate by id
      const seen = new Set<number>();
      const unique = allCouriers.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
      setCouriers(unique);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to load courier partners.');
    } finally {
      setLoadingCouriers(false);
    }
  }, [uid]);

  const loadWarehouses = useCallback(async () => {
    if (!uid) return;
    setLoadingWarehouses(true);
    try {
      const client = await getShipRocketClient(uid);
      const result = await client.getWarehouses();
      setWarehouses(result);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to load warehouses.');
    } finally {
      setLoadingWarehouses(false);
    }
  }, [uid]);

  const loadPickupLocations = useCallback(async () => {
    if (!uid) return;
    setLoadingPickups(true);
    try {
      const client = await getShipRocketClient(uid);
      const result = await client.getPickupLocations();
      setPickupLocations(result);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to load pickup locations.');
    } finally {
      setLoadingPickups(false);
    }
  }, [uid]);

  // ── Test Connection ──────────────────────────────────────────────────────

  const handleTestConnection = useCallback(async () => {
    if (!uid) return;
    setTestingConnection(true);
    setTestResult(null);
    try {
      const client = await getShipRocketClient(uid);
      const result = await client.getCourierPartners();
      if (result && result.status !== false) {
        setTestResult('Connection successful! ShipRocket API is responding.');
      } else {
        setTestResult('Connection responded with an unexpected status.');
      }
    } catch (e: any) {
      setTestResult(`Connection failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setTestingConnection(false);
    }
  }, [uid]);

  // ── Create Warehouse ─────────────────────────────────────────────────────

  const handleCreateWarehouse = useCallback(async () => {
    if (!uid) return;
    if (!whName.trim() || !whAddress.trim() || !whCity.trim() || !whState.trim() || !whPincode.trim() || !whPhone.trim()) {
      Alert.alert('Missing Fields', 'Please fill in all warehouse fields.');
      return;
    }
    setCreatingWarehouse(true);
    try {
      const client = await getShipRocketClient(uid);
      await client.createWarehouse({
        name: whName.trim(),
        address: whAddress.trim(),
        city: whCity.trim(),
        state: whState.trim(),
        pincode: whPincode.trim(),
        phone: whPhone.trim(),
        email: config?.email || '',
        country: 'India',
      });
      Alert.alert('Warehouse Created', `${whName.trim()} has been added.`);
      setWarehouseModal(false);
      setWhName('');
      setWhAddress('');
      setWhCity('');
      setWhState('');
      setWhPincode('');
      setWhPhone('');
      loadWarehouses();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create warehouse.');
    } finally {
      setCreatingWarehouse(false);
    }
  }, [uid, whName, whAddress, whCity, whState, whPincode, whPhone, config?.email, loadWarehouses]);

  // ── Loading state ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading ShipRocket settings…</Text>
      </SafeAreaView>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>ShipRocket Settings</Text>
          <View style={{ width: 32 }} />
        </View>

        {/* ═══ Section 1: Connect ShipRocket ═══ */}
        {!isConnected && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="rocket-outline" size={20} color={colors.accent} />
              <Text style={styles.sectionTitle}>Connect ShipRocket</Text>
            </View>
            <Text style={styles.sectionDesc}>
              Enter your ShipRocket account credentials to enable shipping integration.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Email address"
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, connecting && styles.btnDisabled]}
              onPress={handleConnect}
              disabled={connecting}
              activeOpacity={0.7}
            >
              {connecting ? (
                <ActivityIndicator size="small" color={colors.bg} />
              ) : (
                <Text style={styles.primaryBtnText}>Connect</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* ═══ Section 2: Connection Status ═══ */}
        {isConnected && config && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="checkmark-circle" size={20} color={colors.accentGreen} />
              <Text style={styles.sectionTitle}>Connection Status</Text>
            </View>
            <View style={styles.statusCard}>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Status</Text>
                <View style={[styles.statusBadge, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                  <Text style={[styles.statusBadgeText, { color: colors.accentGreen }]}>Connected</Text>
                </View>
              </View>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Account</Text>
                <Text style={styles.statusValue}>{config.companyName || config.email}</Text>
              </View>
              {config.companyId && (
                <View style={styles.statusRow}>
                  <Text style={styles.statusLabel}>Company ID</Text>
                  <Text style={styles.statusValue}>{config.companyId}</Text>
                </View>
              )}
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Email</Text>
                <Text style={styles.statusValue}>{config.email}</Text>
              </View>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Token Expiry</Text>
                <Text style={[styles.statusValue, { color: colors.accentGold }]}>
                  {formatTokenExpiry(config.tokenExpiry)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* ═══ Section 3: Courier Partners ═══ */}
        {isConnected && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="bicycle-outline" size={20} color={colors.accent} />
              <Text style={styles.sectionTitle}>Courier Partners</Text>
            </View>
            {couriers.length === 0 && !loadingCouriers ? (
              <TouchableOpacity style={styles.loadBtn} onPress={loadCouriers} activeOpacity={0.7}>
                <Text style={styles.loadBtnText}>Load Courier Partners</Text>
              </TouchableOpacity>
            ) : loadingCouriers ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <View style={styles.listContainer}>
                {couriers.slice(0, 20).map((courier) => (
                  <View key={courier.id} style={styles.listItem}>
                    <View style={styles.listItemLeft}>
                      <Text style={styles.listItemName}>{courier.name}</Text>
                      <View style={styles.courierTags}>
                        {courier.has_cod && (
                          <View style={styles.tag}><Text style={styles.tagText}>COD</Text></View>
                        )}
                        {courier.has_air && (
                          <View style={[styles.tag, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
                            <Text style={[styles.tagText, { color: colors.verified }]}>Air</Text>
                          </View>
                        )}
                        {courier.has_surface && (
                          <View style={[styles.tag, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                            <Text style={[styles.tagText, { color: colors.accentGold }]}>Surface</Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <View style={[styles.statusDot, { backgroundColor: courier.active ? colors.accentGreen : colors.textMuted }]} />
                  </View>
                ))}
                {couriers.length > 20 && (
                  <Text style={styles.showingMore}>Showing 20 of {couriers.length} couriers</Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* ═══ Section 4: Warehouses ═══ */}
        {isConnected && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="business-outline" size={20} color={colors.accentGold} />
              <Text style={styles.sectionTitle}>Warehouses</Text>
              <TouchableOpacity style={styles.addBtn} onPress={() => setWarehouseModal(true)} activeOpacity={0.7}>
                <Ionicons name="add" size={18} color={colors.bg} />
              </TouchableOpacity>
            </View>
            {warehouses.length === 0 && !loadingWarehouses ? (
              <TouchableOpacity style={styles.loadBtn} onPress={loadWarehouses} activeOpacity={0.7}>
                <Text style={styles.loadBtnText}>Load Warehouses</Text>
              </TouchableOpacity>
            ) : loadingWarehouses ? (
              <ActivityIndicator size="small" color={colors.accentGold} />
            ) : (
              <View style={styles.listContainer}>
                {warehouses.map((wh) => (
                  <View key={wh.id} style={styles.listItem}>
                    <View style={styles.listItemLeft}>
                      <Text style={styles.listItemName}>{wh.name}</Text>
                      <Text style={styles.listItemSub}>
                        {wh.address}, {wh.city}, {wh.state} - {wh.pincode}
                      </Text>
                    </View>
                    {wh.is_default && (
                      <View style={styles.defaultBadge}>
                        <Text style={styles.defaultBadgeText}>Default</Text>
                      </View>
                    )}
                  </View>
                ))}
                {warehouses.length === 0 && (
                  <Text style={styles.emptyText}>No warehouses found.</Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* ═══ Section 5: Pickup Locations ═══ */}
        {isConnected && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="location-outline" size={20} color={colors.accentGreen} />
              <Text style={styles.sectionTitle}>Pickup Locations</Text>
            </View>
            {pickupLocations.length === 0 && !loadingPickups ? (
              <TouchableOpacity style={styles.loadBtn} onPress={loadPickupLocations} activeOpacity={0.7}>
                <Text style={styles.loadBtnText}>Load Pickup Locations</Text>
              </TouchableOpacity>
            ) : loadingPickups ? (
              <ActivityIndicator size="small" color={colors.accentGreen} />
            ) : (
              <View style={styles.listContainer}>
                {pickupLocations.map((loc) => (
                  <View key={loc.id} style={styles.listItem}>
                    <View style={styles.listItemLeft}>
                      <Text style={styles.listItemName}>{loc.name}</Text>
                      <Text style={styles.listItemSub}>
                        {loc.address}, {loc.city}, {loc.state} - {loc.pincode}
                      </Text>
                      {loc.pickup_time ? (
                        <Text style={styles.listItemSub}>Pickup: {loc.pickup_time}</Text>
                      ) : null}
                    </View>
                    {loc.is_default && (
                      <View style={styles.defaultBadge}>
                        <Text style={styles.defaultBadgeText}>Default</Text>
                      </View>
                    )}
                  </View>
                ))}
                {pickupLocations.length === 0 && (
                  <Text style={styles.emptyText}>No pickup locations found.</Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* ═══ Section 6: Test Connection ═══ */}
        {isConnected && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="flash-outline" size={20} color={colors.verified} />
              <Text style={styles.sectionTitle}>Test Connection</Text>
            </View>
            <TouchableOpacity
              style={[styles.testBtn, testingConnection && styles.btnDisabled]}
              onPress={handleTestConnection}
              disabled={testingConnection}
              activeOpacity={0.7}
            >
              {testingConnection ? (
                <ActivityIndicator size="small" color={colors.bg} />
              ) : (
                <>
                  <Ionicons name="pulse-outline" size={16} color={colors.bg} />
                  <Text style={styles.testBtnText}>Verify Connection</Text>
                </>
              )}
            </TouchableOpacity>
            {testResult && (
              <View style={[styles.testResult, { borderColor: testResult.includes('successful') ? colors.accentGreen : colors.error }]}>
                <Text style={[styles.testResultText, { color: testResult.includes('successful') ? colors.accentGreen : colors.error }]}>
                  {testResult}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ═══ Section 7: Disconnect ═══ */}
        {isConnected && (
          <View style={styles.section}>
            <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect} activeOpacity={0.7}>
              <Ionicons name="log-out-outline" size={18} color={colors.error} />
              <Text style={styles.disconnectBtnText}>Disconnect ShipRocket</Text>
            </TouchableOpacity>
            <Text style={styles.disconnectDesc}>
              This removes credentials but won't affect existing shipments.
            </Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ═══ Add Warehouse Modal ═══ */}
      <Modal visible={warehouseModal} transparent animationType="fade" onRequestClose={() => setWarehouseModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Warehouse</Text>
              <TouchableOpacity onPress={() => setWarehouseModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <TextInput style={styles.input} placeholder="Warehouse Name" placeholderTextColor={colors.textMuted} value={whName} onChangeText={setWhName} />
              <TextInput style={styles.input} placeholder="Address" placeholderTextColor={colors.textMuted} value={whAddress} onChangeText={setWhAddress} />
              <TextInput style={styles.input} placeholder="City" placeholderTextColor={colors.textMuted} value={whCity} onChangeText={setWhCity} />
              <TextInput style={styles.input} placeholder="State" placeholderTextColor={colors.textMuted} value={whState} onChangeText={setWhState} />
              <TextInput style={styles.input} placeholder="Pincode" placeholderTextColor={colors.textMuted} value={whPincode} onChangeText={setWhPincode} keyboardType="number-pad" maxLength={6} />
              <TextInput style={styles.input} placeholder="Phone" placeholderTextColor={colors.textMuted} value={whPhone} onChangeText={setWhPhone} keyboardType="phone-pad" />
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setWarehouseModal(false)} activeOpacity={0.7}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, creatingWarehouse && styles.btnDisabled]}
                onPress={handleCreateWarehouse}
                disabled={creatingWarehouse}
                activeOpacity={0.7}
              >
                {creatingWarehouse ? (
                  <ActivityIndicator size="small" color={colors.bg} />
                ) : (
                  <Text style={styles.primaryBtnText}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg, gap: 12 },
  loadingText: { fontSize: 14, color: colors.textMuted },
  scrollContent: { padding: 16, paddingBottom: 40 },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  backBtn: { padding: 4 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },

  // Section
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sectionDesc: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginBottom: 14 },

  // Input
  input: {
    backgroundColor: colors.bgInput,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: colors.text,
    marginBottom: 10,
  },

  // Buttons
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.4 },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: colors.bg },
  loadBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  loadBtnText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 'auto',
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.verified,
    borderRadius: 12,
    paddingVertical: 13,
  },
  testBtnText: { fontSize: 15, fontWeight: '700', color: colors.bg },
  disconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 12,
    paddingVertical: 13,
  },
  disconnectBtnText: { fontSize: 15, fontWeight: '600', color: colors.error },
  disconnectDesc: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 8 },

  // Connection status card
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  statusValue: { fontSize: 13, color: colors.text, fontWeight: '600' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  statusBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },

  // List items
  listContainer: { gap: 8 },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  listItemLeft: { flex: 1 },
  listItemName: { fontSize: 14, fontWeight: '600', color: colors.text },
  listItemSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  courierTags: { flexDirection: 'row', gap: 6, marginTop: 6 },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  tagText: { fontSize: 10, fontWeight: '600', color: colors.accentGreen, textTransform: 'uppercase' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  defaultBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
  },
  defaultBadgeText: { fontSize: 10, fontWeight: '600', color: colors.verified, textTransform: 'uppercase' },
  showingMore: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: 12 },

  // Test result
  testResult: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  testResultText: { fontSize: 13, fontWeight: '500' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalContent: { backgroundColor: colors.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 400, borderWidth: 1, borderColor: colors.border, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modalCancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: 'transparent' },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
});
