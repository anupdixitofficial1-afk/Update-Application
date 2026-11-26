import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  DeviceEventEmitter,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  DraftItem,
  deleteStudioDraft,
  getStudioDrafts,
} from '../../lib/creatorStudio';

type StudioDraftRecord = Partial<DraftItem> & { id: string };

function getVisibilityBadge(visibility?: string): {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
} {
  if (visibility === 'subscribers') {
    return { label: 'Subscriptions only', icon: 'people-outline' };
  }
  if (visibility === 'private') {
    return { label: 'Private', icon: 'lock-closed-outline' };
  }
  return { label: 'Public', icon: 'globe-outline' };
}

function getModeLabel(mode?: string): string {
  if (mode === 'reel') return 'REEL';
  if (mode === 'post') return 'POST';
  if (mode === 'live') return 'LIVE';
  return 'VIDEO';
}

export default function StudioDraftsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [drafts, setDrafts] = useState<StudioDraftRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadDrafts = useCallback(async () => {
    setRefreshing(true);
    try {
      const items = await getStudioDrafts();
      setDrafts(items);
    } catch {
      setDrafts([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDrafts();
    const sub = DeviceEventEmitter.addListener('studio-drafts-updated', loadDrafts);
    return () => {
      sub.remove();
    };
  }, [loadDrafts]);

  const handleDeleteDraft = useCallback((item: StudioDraftRecord) => {
    Alert.alert(
      'Delete Draft',
      `Remove "${item.title || 'Untitled Draft'}" from drafts?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const next = await deleteStudioDraft(item.id);
              setDrafts(next);
            } catch {
              Alert.alert('Error', 'Unable to delete draft.');
            }
          },
        },
      ]
    );
  }, []);

  const handleOpenDraft = useCallback(
    (item: StudioDraftRecord) => {
      const targetMode =
        item.mode === 'reel' || item.mode === 'post' || item.mode === 'live'
          ? item.mode
          : 'video';
      router.push({
        pathname: `/studio/${targetMode}` as any,
        params: { draftId: item.id },
      });
    },
    [router]
  );

  const renderDraftItem = useCallback(
    ({ item }: { item: StudioDraftRecord }) => {
      const vis = getVisibilityBadge(item.visibility);
      const modeLabel = getModeLabel(item.mode);
      const previewUri = (item.coverUri || item.mediaUri || '').trim();
      const isImage =
        Boolean(previewUri) &&
        !/\.(mp4|mov|m4v|webm|avi)$/i.test(previewUri.split('?')[0] || '');

      return (
        <TouchableOpacity
          style={styles.draftCard}
          onPress={() => handleOpenDraft(item)}
          activeOpacity={0.8}
        >
          <View style={styles.thumbBox}>
            {isImage ? (
              <Image
                source={{ uri: previewUri }}
                style={styles.thumbImg}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.thumbPlaceholder}>
                <Ionicons name="videocam-outline" size={22} color="#94a3b8" />
              </View>
            )}
            <View style={styles.modeBadge}>
              <Text style={styles.modeBadgeText}>{modeLabel}</Text>
            </View>
          </View>

          <View style={styles.cardBody}>
            <Text style={styles.draftTitle} numberOfLines={1}>
              {item.title || 'Untitled Draft'}
            </Text>

            <View style={styles.metaRow}>
              <View style={styles.visPill}>
                <Ionicons name={vis.icon} size={11} color="#059669" />
                <Text style={styles.visPillText}>{vis.label}</Text>
              </View>

              {item.category ? (
                <Text style={styles.categoryLabel}>{item.category}</Text>
              ) : null}
            </View>

            <Text style={styles.savedAtText}>
              Saved {item.savedAt || 'recently'}
            </Text>
          </View>

          <View style={styles.actionsCol}>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => handleOpenDraft(item)}
              activeOpacity={0.75}
            >
              <Ionicons name="create-outline" size={16} color="#059669" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => handleDeleteDraft(item)}
              activeOpacity={0.75}
            >
              <Ionicons name="trash-outline" size={16} color="#dc2626" />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      );
    },
    [handleOpenDraft, handleDeleteDraft]
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.75}
        >
          <Ionicons name="chevron-back" size={20} color="#0f172a" />
        </TouchableOpacity>

        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>Studio Drafts</Text>
          <Text style={styles.headerSub}>
            {drafts.length} saved {drafts.length === 1 ? 'draft' : 'drafts'}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => router.push('/studio/video' as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={18} color="#ffffff" />
          <Text style={styles.newBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={drafts}
        keyExtractor={(item, idx) => item?.id || String(idx)}
        renderItem={renderDraftItem}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Math.max(insets.bottom, 16) + 20 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={loadDrafts}
            tintColor="#059669"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="bookmark-outline" size={26} color="#64748b" />
            </View>
            <Text style={styles.emptyTitle}>No drafts yet</Text>
            <Text style={styles.emptySub}>
              Tap Draft in any Creator Studio flow to save your progress.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#eef2f6' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  headerSub: { fontSize: 11.5, color: '#64748b', fontWeight: '600' },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#059669',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  newBtnText: { fontSize: 12.5, fontWeight: '800', color: '#ffffff' },

  listContent: { padding: 14, gap: 10 },
  draftCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
  },
  thumbBox: {
    width: 96,
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    position: 'relative',
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeBadge: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  modeBadgeText: {
    color: '#ffffff',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  cardBody: { flex: 1, gap: 4 },
  draftTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  visPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  visPillText: { fontSize: 10.5, fontWeight: '700', color: '#059669' },
  categoryLabel: { fontSize: 11, fontWeight: '700', color: '#64748b' },
  savedAtText: { fontSize: 11, color: '#94a3b8' },

  actionsCol: { gap: 6 },
  editBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#d1fae5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 72,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  emptySub: { fontSize: 12.5, color: '#64748b', textAlign: 'center' },
});