/**
 * BusinessStoreScreen.tsx — Full Store Management for Business Accounts
 *
 * Product listing with search, category filter, stats row, product cards,
 * and navigation to AddProduct / ProductDetail screens.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '../stores/app';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import * as Shop from '../lib/shop';
import { firestore } from '../lib/firebase';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getProductImage(product: Shop.ShopProduct): string {
  try {
    const imgs = typeof product.images === 'string' ? JSON.parse(product.images) : product.images;
    if (Array.isArray(imgs) && imgs.length > 0) return imgs[0];
  } catch { /* ignore */ }
  return '';
}

// ── Component ──────────────────────────────────────────────────────────────

export default function BusinessStoreScreen() {
  const navigation = useNavigation<any>();
  const user = useAppStore((s) => s.user);

  const [products, setProducts] = useState<Shop.ShopProduct[]>([]);
  const [allProducts, setAllProducts] = useState<Shop.ShopProduct[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Stats
  const [totalOrders, setTotalOrders] = useState(0);
  const [revenue, setRevenue] = useState(0);
  const [rating, setRating] = useState(0);

  // ── Data loading ─────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    const userId = user?.id;
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      // Load products
      let prodResult = await Shop.fetchBusinessProducts(userId, 200);
      let prods = prodResult.products;

      // Fallback: fetch all products with isActive
      if (prods.length === 0) {
        const snap = await firestore()
          .collection('products')
          .where('businessId', '==', userId)
          .orderBy('createdAt', 'desc')
          .limit(200)
          .get();
        prods = snap.docs.map((d: any) => {
          const data = d.data();
          return {
            id: d.id,
            businessId: data.businessId ?? userId,
            businessName: data.businessName ?? '',
            businessImage: data.businessImage ?? '',
            name: data.name ?? '',
            description: data.description ?? '',
            price: data.price ?? 0,
            compareAtPrice: data.compareAtPrice,
            category: data.category ?? '',
            tags: Array.isArray(data.tags) ? data.tags : [],
            images: data.images ?? '',
            stock: data.stock ?? 0,
            sku: data.sku ?? '',
            variants: data.variants ?? '[]',
            isDigital: data.isDigital ?? false,
            isFeatured: data.isFeatured ?? false,
            isActive: data.isActive ?? true,
            rating: data.rating ?? 0,
            reviewCount: data.reviewCount ?? 0,
            soldCount: data.soldCount ?? 0,
            createdAt: data.createdAt ?? '',
            updatedAt: data.updatedAt ?? '',
          };
        });
      }

      setAllProducts(prods);

      // Extract categories
      const cats = new Set<string>();
      prods.forEach((p) => { if (p.category) cats.add(p.category); });
      setCategories(['All', ...Array.from(cats).sort()]);

      // Load orders for stats
      try {
        const ordersSnap = await firestore()
          .collection('orders')
          .where('businessId', '==', userId)
          .limit(500)
          .get();

        let totalRev = 0;
        let totalOrd = ordersSnap.size;
        ordersSnap.docs.forEach((d: any) => {
          totalRev += d.data().total || 0;
        });
        setTotalOrders(totalOrd);
        setRevenue(totalRev);
      } catch (e) {
        console.warn('[BusinessStore] failed to load orders:', e);
      }

      // Average rating
      if (prods.length > 0) {
        const avg = prods.reduce((sum, p) => sum + (p.rating || 0), 0) / prods.length;
        setRating(Math.round(avg * 10) / 10);
      }
    } catch (err) {
      console.error('[BusinessStoreScreen] loadData error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  // ── Filtering ────────────────────────────────────────────────────────────

  const filteredProducts = useMemo(() => {
    let filtered = allProducts;

    if (activeCategory !== 'All') {
      filtered = filtered.filter((p) => p.category === activeCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q),
      );
    }

    return filtered;
  }, [allProducts, activeCategory, searchQuery]);

  // ── Product actions ──────────────────────────────────────────────────────

  const handleLongPress = useCallback(
    (product: Shop.ShopProduct) => {
      Alert.alert(
        product.name,
        'Choose an action:',
        [
          {
            text: product.isActive ? 'Deactivate' : 'Activate',
            onPress: async () => {
              try {
                await Shop.updateProduct(product.id, { isActive: !product.isActive });
                setAllProducts((prev) =>
                  prev.map((p) => (p.id === product.id ? { ...p, isActive: !p.isActive } : p)),
                );
              } catch (e) {
                Alert.alert('Error', 'Failed to update product.');
              }
            },
          },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              Alert.alert(
                'Delete Product?',
                `"${product.name}" will be deactivated permanently.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await Shop.deleteProduct(product.id);
                        setAllProducts((prev) => prev.filter((p) => p.id !== product.id));
                      } catch (e) {
                        Alert.alert('Error', 'Failed to delete product.');
                      }
                    },
                  },
                ],
              );
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    },
    [],
  );

  // ── Render helpers ───────────────────────────────────────────────────────

  const renderProductCard = ({ item }: { item: Shop.ShopProduct }) => {
    const imageUrl = getProductImage(item);
    const inStock = item.stock > 0;

    return (
      <TouchableOpacity
        style={styles.productCard}
        onPress={() => navigation.navigate('ProductDetail' as never, { productId: item.id } as never)}
        onLongPress={() => handleLongPress(item)}
        activeOpacity={0.7}
      >
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.productImage} resizeMode="cover" />
        ) : (
          <View style={styles.productImagePlaceholder}>
            <Ionicons name="image-outline" size={28} color={colors.textMuted} />
          </View>
        )}

        <View style={styles.productInfo}>
          <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
          <View style={styles.productMetaRow}>
            <Text style={styles.productPrice}>{formatINR(item.price)}</Text>
            {item.compareAtPrice && item.compareAtPrice > item.price && (
              <Text style={styles.productComparePrice}>{formatINR(item.compareAtPrice)}</Text>
            )}
          </View>
          <View style={styles.productBottomRow}>
            <Text style={[styles.stockText, !inStock && styles.stockTextOut]}>
              {inStock ? `${item.stock} in stock` : 'Out of stock'}
            </Text>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: item.isActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                },
              ]}
            >
              <Text
                style={[
                  styles.statusBadgeText,
                  { color: item.isActive ? colors.accentGreen : colors.error },
                ]}
              >
                {item.isActive ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderCategoryPill = ({ item }: { item: string }) => {
    const isActive = activeCategory === item;
    return (
      <TouchableOpacity
        style={[styles.categoryPill, isActive && styles.categoryPillActive]}
        onPress={() => setActiveCategory(item)}
        activeOpacity={0.7}
      >
        <Text style={[styles.categoryPillText, isActive && styles.categoryPillTextActive]}>
          {item}
        </Text>
      </TouchableOpacity>
    );
  };

  // ── Loading state ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading store…</Text>
      </SafeAreaView>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Store</Text>
        <TouchableOpacity
          style={styles.addProductBtn}
          onPress={() => navigation.navigate('AddProduct' as never)}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={20} color={colors.bg} />
        </TouchableOpacity>
      </View>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Ionicons name="cube-outline" size={16} color={colors.accent} />
          <Text style={styles.statValue}>{allProducts.length}</Text>
          <Text style={styles.statLabel}>Products</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="receipt-outline" size={16} color={colors.accentGold} />
          <Text style={styles.statValue}>{totalOrders}</Text>
          <Text style={styles.statLabel}>Orders</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="wallet-outline" size={16} color={colors.accentGreen} />
          <Text style={styles.statValue}>{formatINR(revenue)}</Text>
          <Text style={styles.statLabel}>Revenue</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="star" size={16} color={colors.accentGold} />
          <Text style={styles.statValue}>{rating}</Text>
          <Text style={styles.statLabel}>Rating</Text>
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search products..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Category pills */}
      {categories.length > 1 && (
        <View style={styles.categoriesRow}>
          <FlatList
            data={categories}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item}
            renderItem={renderCategoryPill}
            contentContainerStyle={styles.categoriesList}
          />
        </View>
      )}

      {/* Product list */}
      <FlatList
        data={filteredProducts}
        renderItem={renderProductCard}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.productRow}
        contentContainerStyle={filteredProducts.length === 0 ? styles.emptyList : styles.productList}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="cube-outline" size={44} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No products found</Text>
            <Text style={styles.emptySubtitle}>
              {searchQuery
                ? 'Try a different search term.'
                : 'Add your first product to start selling.'}
            </Text>
            {!searchQuery && (
              <TouchableOpacity
                style={styles.emptyAddBtn}
                onPress={() => navigation.navigate('AddProduct' as never)}
                activeOpacity={0.7}
              >
                <Ionicons name="add" size={16} color={colors.bg} />
                <Text style={styles.emptyAddBtnText}>Add Product</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      />

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('AddProduct' as never)}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={28} color={colors.bg} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const CARD_GAP = 10;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg, gap: 12 },
  loadingText: { fontSize: 14, color: colors.textMuted },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  backBtn: { padding: 4 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  addProductBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },

  // Stats
  statsRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 3,
  },
  statValue: { fontSize: 15, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 10, color: colors.textMuted, fontWeight: '500' },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.text, padding: 0 },

  // Categories
  categoriesRow: { marginBottom: 8 },
  categoriesList: { paddingHorizontal: 16, gap: 8 },
  categoryPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryPillText: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  categoryPillTextActive: { color: colors.bg, fontWeight: '600' },

  // Product list
  productList: { paddingHorizontal: 16, paddingBottom: 100, paddingTop: 8 },
  emptyList: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingBottom: 100 },
  productRow: { gap: CARD_GAP },

  // Product card
  productCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    maxWidth: '48%',
  },
  productImage: { width: '100%', aspectRatio: 1, backgroundColor: colors.surfaceLight },
  productImagePlaceholder: { width: '100%', aspectRatio: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  productInfo: { padding: 10, gap: 4 },
  productName: { fontSize: 13, fontWeight: '600', color: colors.text, lineHeight: 17 },
  productMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  productPrice: { fontSize: 14, fontWeight: '700', color: colors.text },
  productComparePrice: { fontSize: 11, color: colors.textMuted, textDecorationLine: 'line-through' },
  productBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  stockText: { fontSize: 11, color: colors.accentGreen, fontWeight: '500' },
  stockTextOut: { color: colors.error },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  statusBadgeText: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },

  // Empty state
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyIconWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: colors.textSecondary },
  emptySubtitle: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 8, paddingHorizontal: 32, lineHeight: 20 },
  emptyAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, marginTop: 16 },
  emptyAddBtnText: { fontSize: 13, fontWeight: '600', color: colors.bg },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
});
